// 자동 분류(사용자 규칙 → 기본 단서 점수)와 통합 검색
(function () {
  // 기본 단서: 설계 보고서 6장 규칙표
  const BUILTIN = [
    { cat: '재무', words: ['합계', '결제', '카드', '승인번호', '부가세', '영수증', '공급가액', '거래일시', '가맹점'], patterns: [/[0-9]{1,3}(,[0-9]{3})+\s*원/, /₩\s*[0-9]/, /\b[0-9]{3}-[0-9]{2}-[0-9]{5}\b/] },
    { cat: '일정', words: ['회의', '약속', '예약', '미팅', '마감', '까지', '일시', '장소'], patterns: [/\b[0-9]{1,2}\s*[:시]\s*[0-9]{0,2}/, /[0-9]{1,2}\s*월\s*[0-9]{1,2}\s*일/] },
    { cat: '할 일', words: ['해야', '준비', '확인', '제출', '연락', '처리', '할일', '할 일', 'todo'], patterns: [/☐|□|\[ \]/] },
    { cat: '책', words: ['ISBN', '지은이', '옮긴이', '출판사', '저자', '펴낸곳', '초판'], patterns: [/97[89][-\s]?[0-9]/] },
    { cat: '건강', words: ['처방', '약국', '진료', '병원', '혈압', '체중', '복용', 'mg', '검진'], patterns: [] }
  ];
  const THRESHOLD = 2;

  const norm = s => String(s || '').toLowerCase();
  const textOf = it => [it.title, it.body, it.ocr, it.transcript, (it.tags || []).join(' ')].filter(Boolean).join('\n');

  // 사용자 규칙: { id, enabled, words:[...](하나라도 포함), tag, source, cat, priority }
  function ruleMatches(rule, item) {
    if (rule.enabled === false) return false;
    const t = norm(textOf(item));
    const hasWords = rule.words && rule.words.length;
    if (!hasWords && !rule.tag && !rule.source) return false;
    if (hasWords && !rule.words.some(w => w && t.includes(norm(w)))) return false;
    if (rule.tag && !(item.tags || []).map(norm).includes(norm(rule.tag.replace(/^#/, '')))) return false;
    if (rule.source && item.source !== rule.source) return false;
    return true;
  }

  // 결과: { cat, by: 'rule'|'auto'|'none', score, ruleId }
  function classify(item, rules, categoryNames) {
    const sorted = (rules || []).slice().sort((a, b) => (a.priority || 0) - (b.priority || 0));
    for (const r of sorted) {
      if (ruleMatches(r, item) && categoryNames.includes(r.cat)) return { cat: r.cat, by: 'rule', ruleId: r.id };
    }
    const t = textOf(item);
    const tl = norm(t);
    let best = null;
    for (const b of BUILTIN) {
      if (!categoryNames.includes(b.cat)) continue;
      let score = 0;
      b.words.forEach(w => { if (tl.includes(norm(w))) score += 1; });
      b.patterns.forEach(p => { if (p.test(t)) score += 1; });
      if (!best || score > best.score) best = { cat: b.cat, score };
    }
    if (best && best.score >= THRESHOLD) return { cat: best.cat, by: 'auto', score: best.score };
    return { cat: null, by: 'none', score: best ? best.score : 0 };
  }

  // 영수증 금액 추출: '합계/결제금액/총액' 근처 숫자 우선, 없으면 가장 큰 '원' 금액
  function extractAmount(text) {
    const t = String(text || '');
    const near = t.match(/(합\s*계|결제\s*금액|총\s*액|받을\s*금액|청구\s*금액)[^0-9]{0,10}([0-9]{1,3}(,[0-9]{3})+|[0-9]{4,})/);
    if (near) return Number(near[2].replace(/,/g, ''));
    const all = [...t.matchAll(/([0-9]{1,3}(,[0-9]{3})+|[0-9]{4,})\s*원/g)].map(m => Number(m[1].replace(/,/g, '')));
    return all.length ? Math.max(...all) : null;
  }

  // 통합 검색: 공백으로 나눈 모든 단어가 들어 있는 기록
  function search(items, query) {
    const terms = norm(query).split(/\s+/).filter(Boolean);
    if (!terms.length) return [];
    const out = [];
    for (const it of items) {
      if (it.deleted) continue;
      const fields = {
        title: it.title || '', body: it.body || '', ocr: it.ocr || '',
        transcript: it.transcript || '', tags: (it.tags || []).join(' ')
      };
      const all = norm(Object.values(fields).join('\n'));
      if (!terms.every(q => all.includes(q))) continue;
      // 제목 외에서 맞은 경우 그 부분을 보여줄 짧은 발췌
      let snippet = '', where = '';
      for (const [k, v] of Object.entries(fields)) {
        if (k === 'title') continue;
        const i = norm(v).indexOf(terms[0]);
        if (i >= 0) {
          snippet = (i > 20 ? '…' : '') + v.slice(Math.max(0, i - 20), i + 40).replace(/\s+/g, ' ') + (i + 40 < v.length ? '…' : '');
          where = { body: '본문', ocr: '사진 속 글자', transcript: '녹취록', tags: '태그' }[k];
          break;
        }
      }
      const titleHit = terms.some(q => norm(fields.title).includes(q));
      out.push({ item: it, snippet, where, rank: titleHit ? 0 : 1 });
    }
    return out.sort((a, b) => a.rank - b.rank || (b.item.updated || 0) - (a.item.updated || 0));
  }

  window.Classifier = { classify, ruleMatches, extractAmount, search, textOf };
})();
