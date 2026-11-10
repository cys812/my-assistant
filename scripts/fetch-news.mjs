// RSS에서 헤드라인과 링크만 모아 docs/news.json을 만듭니다. (Node 20+, 외부 패키지 없음)
// 실행: node scripts/fetch-news.mjs
import { readFile, writeFile } from 'node:fs/promises';

const root = new URL('..', import.meta.url);
const cfg = JSON.parse(await readFile(new URL('news-sources.json', root), 'utf8'));
const outPath = new URL('docs/news.json', root);

let previous = {};
try { previous = JSON.parse(await readFile(outPath, 'utf8')); } catch { /* 첫 실행 */ }

const decode = s => s
  .replace(/^\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*$/, '$1')
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'")
  .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n))
  .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
  .replace(/&amp;/g, '&')
  .replace(/<[^>]+>/g, '')
  .replace(/\s+/g, ' ').trim();

export function parseFeed(xml, count) {
  const items = [];
  // RSS <item> 또는 Atom <entry>
  const blocks = xml.match(/<item[\s>][\s\S]*?<\/item>/gi) || xml.match(/<entry[\s>][\s\S]*?<\/entry>/gi) || [];
  for (const b of blocks) {
    const t = b.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
    let link = (b.match(/<link[^>]*>([\s\S]*?)<\/link>/i) || [])[1];
    if (!link) link = (b.match(/<link[^>]*href="([^"]+)"/i) || [])[1];
    const title = t ? decode(t[1]) : '';
    link = link ? decode(link) : '';
    if (title && /^https?:\/\//.test(link)) items.push({ title, link });
    if (items.length >= count) break;
  }
  return items;
}

async function load(src, count) {
  const res = await fetch(src.url, { headers: { 'User-Agent': 'life-assistant-news/1.0 (personal RSS reader)' }, redirect: 'follow' });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const items = parseFeed(await res.text(), count);
  if (!items.length) throw new Error('기사를 찾지 못함');
  return { label: src.label, source: src.url, items };
}

const out = { updated: new Date().toISOString() };
let failures = 0;
for (const key of ['domestic', 'world']) {
  try {
    out[key] = await load(cfg[key], cfg.count || 5);
    console.log(`${key}: ${out[key].items.length}건`);
  } catch (e) {
    failures++;
    console.error(`${key} 실패: ${e.message}`);
    // 실패 시 이전 기사를 유지하고 오류를 표시
    out[key] = previous[key] ? { ...previous[key], error: `최근 수집 실패(${e.message}), 이전 기사 표시` }
      : { label: cfg[key].label, source: cfg[key].url, items: [], error: `수집 실패: ${e.message}` };
  }
}
await writeFile(outPath, JSON.stringify(out, null, 2) + '\n');
if (failures === 2) process.exitCode = 1;
