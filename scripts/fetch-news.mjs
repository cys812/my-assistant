// RSS에서 헤드라인과 링크만 모아 docs/news.json을 만듭니다. (Node 20+, 외부 패키지 없음)
// 실행: node scripts/fetch-news.mjs
// - 각 묶음(국내 주요·조경·엔지니어링·해외)은 출처를 차례로 시도하고, 첫 출처가 실패하면
//   예비 출처(같은 매체의 구글 뉴스 검색)를 씁니다. 모두 실패하면 이전 기사를 유지하고 실패 사유를 남깁니다.
import { readFile, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

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
    const d = (b.match(/<(?:pubDate|published|updated|dc:date)[^>]*>([\s\S]*?)<\/(?:pubDate|published|updated|dc:date)>/i) || [])[1];
    const title = t ? decode(t[1]) : '';
    link = link ? decode(link) : '';
    const ts = d ? Date.parse(decode(d)) : NaN;
    if (title && /^https?:\/\//.test(link)) items.push({ title, link, ...(isNaN(ts) ? {} : { date: new Date(ts).toISOString() }) });
  }
  // 날짜가 있으면 최신순
  if (items.every(i => i.date)) items.sort((a, b) => b.date.localeCompare(a.date));
  return items.slice(0, count);
}

async function fetchFeed(src, count) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 20000);
  try {
    const res = await fetch(src.url, { headers: { 'User-Agent': 'Mozilla/5.0 (personal RSS reader; life-assistant-news/1.1)' }, redirect: 'follow', signal: ctl.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const items = parseFeed(await res.text(), count);
    if (!items.length) throw new Error('기사를 찾지 못함');
    // 구글 뉴스 제목 끝의 " - 매체명" 제거
    if (src.fallback) items.forEach(i => { i.title = i.title.replace(/\s+-\s+[^-]{1,30}$/, ''); });
    return items;
  } catch (e) {
    throw new Error(e.name === 'AbortError' ? '시간 초과' : (e.cause && e.cause.code) || e.message);
  } finally { clearTimeout(timer); }
}

export async function loadGroup(group, count, previous, fetcher = fetchFeed) {
  const errs = [];
  for (const src of group.sources) {
    try {
      const items = await fetcher(src, count);
      return { label: group.label, source: src.name, items, ...(errs.length ? { note: errs.join(' / ') } : {}) };
    } catch (e) { errs.push(`${src.name}: ${e.message}`); }
  }
  const msg = `수집 실패(${errs.join(' / ')})`;
  return previous && (previous.items || []).length
    ? { ...previous, label: group.label, error: msg + ', 이전 기사 표시' }
    : { label: group.label, source: '', items: [], error: msg };
}

async function main() {
  const root = new URL('..', import.meta.url);
  const cfg = JSON.parse(await readFile(new URL('news-sources.json', root), 'utf8'));
  const outPath = new URL('docs/news.json', root);
  let prev = {};
  try { prev = JSON.parse(await readFile(outPath, 'utf8')); } catch { /* 첫 실행 */ }
  const count = cfg.count || 5;
  const prevTab = k => (prev.domesticTabs || []).find(t => t.key === k);

  const out = { updated: new Date().toISOString() };
  out.domestic = await loadGroup(cfg.domestic, count, prev.domestic);
  out.domesticTabs = [];
  for (const tab of cfg.domesticTabs || []) {
    out.domesticTabs.push({ key: tab.key, ...(await loadGroup(tab, count, prevTab(tab.key))) });
  }
  out.world = await loadGroup(cfg.world, count, prev.world);

  const all = [['국내 주요', out.domestic], ...out.domesticTabs.map(t => [t.label, t]), ['해외', out.world]];
  for (const [name, g] of all) console.log(`${name}: ${g.items.length}건 · ${g.source || '-'}${g.error ? ' · ' + g.error : ''}${g.note ? ' · 참고: ' + g.note : ''}`);
  await writeFile(outPath, JSON.stringify(out, null, 2) + '\n');
  if (all.every(([, g]) => !g.items.length)) process.exitCode = 1;
}

// 직접 실행할 때만 수집(테스트에서 import할 때는 실행하지 않음)
if (import.meta.url === pathToFileURL(process.argv[1] || '').href) await main();
