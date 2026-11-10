// 나만의비서 — 2단계 앱 (1단계 + 구글 캘린더·할 일 연동)
(function () {
  'use strict';
  const CFG = window.APP_CONFIG || {};
  const $app = document.getElementById('app');
  const S = { settings: null, items: [], undo: null, news: null, weather: null };
  let lockTimer = null;

  // ---------- 공통 도구 ----------
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  const today = () => new Date().toLocaleDateString('sv-SE'); // YYYY-MM-DD (현지 시각)
  const won = n => (n == null || n === '' ? '' : Number(n).toLocaleString('ko-KR') + '원');
  const fmtDate = s => {
    if (!s) return '';
    const d = new Date(s.length <= 10 ? s + 'T00:00' : s);
    if (isNaN(d)) return s;
    const md = `${d.getMonth() + 1}월 ${d.getDate()}일`;
    return s.length > 10 ? `${md} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}` : md;
  };
  const dayIndex = () => { const d = new Date(); return Math.floor((Date.UTC(d.getFullYear(), d.getMonth(), d.getDate())) / 864e5); };
  function highlight(text, query) {
    let h = esc(text);
    String(query || '').split(/\s+/).filter(Boolean).forEach(q => {
      const re = new RegExp(esc(q).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
      h = h.replace(re, m => `<mark>${m}</mark>`);
    });
    return h;
  }
  const ICON = {
    search: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="M20 20l-4-4"/></svg>',
    lock: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/></svg>',
    gear: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/></svg>',
    plus: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>',
    refresh: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M20 11a8 8 0 1 0-2.3 5.7"/><path d="M20 4v7h-7"/></svg>',
    back: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M15 5l-7 7 7 7"/></svg>'
  };

  // ---------- 토스트 ----------
  function toast(msg, action) {
    let el = document.getElementById('toast');
    if (!el) { el = document.createElement('div'); el.id = 'toast'; el.setAttribute('role', 'status'); document.body.appendChild(el); }
    el.innerHTML = `<span>${esc(msg)}</span>` + (action ? `<button type="button" id="toast-act">${esc(action.label)}</button>` : '');
    el.className = 'show';
    if (action) document.getElementById('toast-act').onclick = () => { el.className = ''; action.fn(); };
    clearTimeout(el._t);
    el._t = setTimeout(() => { el.className = ''; }, action ? 10000 : 3000);
  }

  // ---------- 설정 기본값 ----------
  function defaultSettings() {
    const c = (name, sys) => ({ id: uid(), name, sys: sys || null });
    return {
      v: 1,
      categories: [c('일정', 'schedule'), c('할 일', 'todo'), c('재무'), c('건강'), c('목표'), c('메모'), c('아이디어'), c('책'), c('음성 녹취'), c('미분류', 'unsorted')],
      rules: [],
      location: null,
      trashDays: 30
    };
  }
  const cats = () => S.settings.categories;
  const catById = id => cats().find(c => c.id === id);
  const catBySys = sys => cats().find(c => c.sys === sys);
  const catName = id => (catById(id) || {}).name || '미분류';
  const live = () => S.items.filter(i => !i.deleted);
  const saveSettings = () => Vault.saveSettings(S.settings);

  async function saveItem(it) {
    it.updated = Date.now();
    await Vault.saveItem(it);
    const i = S.items.findIndex(x => x.id === it.id);
    if (i >= 0) S.items[i] = it; else S.items.push(it);
  }

  // ---------- 구글 연동 공통 ----------
  const G = () => S.settings.google || (S.settings.google = { clientId: '', listId: '', listName: '', cache: null });
  const gOn = () => !!G().clientId;
  const pad2 = n => String(n).padStart(2, '0');
  const localDT = d => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}T${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
  const addDays = (ymd, n) => { const d = new Date(ymd + 'T00:00'); d.setDate(d.getDate() + n); return d.toLocaleDateString('sv-SE'); };
  const hm = ts => { const d = new Date(ts); return `${d.getHours()}:${pad2(d.getMinutes())}`; };
  // 일정은 캘린더마다 따로 있으므로 '캘린더ID::일정ID'를 고유 키로 사용
  function normEv(e, cal) {
    const all = !e.start.dateTime;
    const c = cal || { id: 'primary', name: '', color: '', edit: true };
    return { gid: `${c.id}::${e.id}`, eid: e.id, cal: c.id, calName: c.name, color: c.color, canEdit: c.edit !== false,
      title: e.summary || '(제목 없음)', allDay: all, start: all ? e.start.date : e.start.dateTime,
      end: all ? e.end.date : e.end.dateTime, location: e.location || '', desc: e.description || '', link: e.htmlLink || '' };
  }
  const safeColor = c => /^#[0-9a-fA-F]{6}$/.test(c || '') ? c : '#0b5c6b';
  const dot = c => `<svg class="cdot" width="10" height="10" viewBox="0 0 10 10" aria-hidden="true"><circle cx="5" cy="5" r="5" fill="${safeColor(c)}"/></svg>`;
  // 구글 캘린더 목록 → 표시할 캘린더(사용자가 앱에서 바꾼 선택 우선, 없으면 구글에서 '표시' 중인 캘린더)
  const calById = id => (G().calendars || []).find(c => c.id === id);
  const shownCals = () => (G().calendars || []).filter(c => c.show);
  const writableCals = () => (G().calendars || []).filter(c => c.edit && c.show);
  function normTask(t) {
    return { gid: t.id, title: t.title || '(제목 없음)', notes: t.notes || '', due: t.due ? t.due.slice(0, 10) : null,
      done: t.status === 'completed', completedAt: t.completed || null };
  }
  function evOnDay(e, ymd) {
    if (e.allDay) return e.start <= ymd && ymd < e.end;
    const s = new Date(e.start).toLocaleDateString('sv-SE');
    const en = new Date(new Date(e.end).getTime() - 1).toLocaleDateString('sv-SE');
    return s <= ymd && ymd <= en;
  }
  const evTime = e => e.allDay ? '종일' : (() => { const d = new Date(e.start); return pad2(d.getHours()) + ':' + pad2(d.getMinutes()); })();
  const gEvents = () => (G().cache && G().cache.events) || [];
  const gTasks = () => (G().cache && G().cache.tasks) || [];

  function gPreload() { if (gOn()) GApi.load().catch(() => {}); }
  // 캘린더 목록 권한이 추가된 뒤(scopeVer 2) 처음 연결할 때는 동의 화면을 한 번 더 띄움
  const gConnect = consent => GApi.connect(G().clientId, consent || G().scopeVer !== 2).then(() => { G().scopeVer = 2; });
  // 토큰이 없으면 먼저 연결하고 실행합니다(버튼을 누른 처리 안에서 호출해야 팝업이 열림).
  async function gRun(fn) {
    if (!GApi.hasToken()) await gConnect(false);
    return fn();
  }
  let gSyncing = false;
  async function gSync() {
    if (!gOn() || !GApi.hasToken() || gSyncing) return false;
    gSyncing = true;
    try {
      const g = G(), t = today();
      const min = new Date(addDays(t, -30) + 'T00:00'), max = new Date(addDays(t, 61) + 'T00:00');
      // 1) 캘린더 목록: 기본 캘린더뿐 아니라 구독·공유·직접 만든 캘린더 모두
      const prev = {};
      (g.calendars || []).forEach(c => { if (c.userSet) prev[c.id] = c.show; });
      g.calendars = (await GApi.calendars()).filter(c => !c.deleted).map(c => ({
        id: c.id, name: c.summaryOverride || c.summary || c.id, color: c.backgroundColor || '', primary: !!c.primary,
        edit: c.accessRole === 'owner' || c.accessRole === 'writer',
        show: c.id in prev ? prev[c.id] : !!(c.selected || c.primary), userSet: c.id in prev
      })).sort((a, b) => (b.primary ? 1 : 0) - (a.primary ? 1 : 0) || a.name.localeCompare(b.name, 'ko'));
      // 2) 표시할 캘린더마다 일정 가져오기(한 캘린더가 실패해도 나머지는 표시)
      const evs = [], failed = [];
      await Promise.all(shownCals().map(async c => {
        try { (await GApi.listEvents(c.id, min.toISOString(), max.toISOString())).forEach(e => { if (e.status !== 'cancelled' && e.start) evs.push(normEv(e, c)); }); }
        catch (e) { if (e.code === 'EXPIRED') throw e; failed.push(c.name); }
      }));
      if (failed.length) toast(`일부 캘린더를 불러오지 못했습니다: ${failed.join(', ')}`);
      if (!g.listId) {
        const ls = await GApi.lists();
        if (ls.length) { g.listId = ls[0].id; g.listName = ls[0].title; }
      }
      const tks = g.listId ? await GApi.listTasks(g.listId) : [];
      g.cache = { events: evs, tasks: tks.filter(x => !x.deleted).map(normTask), at: Date.now() };
      await saveSettings();
      return true;
    } catch (e) { toast(e.message); return false; }
    finally { gSyncing = false; }
  }
  // 변경 후 캐시만 고쳐 바로 화면에 반영
  async function gCachePut(kind, obj, remove) {
    const g = G();
    if (!g.cache) g.cache = { events: [], tasks: [], at: Date.now() };
    const arr = g.cache[kind];
    const i = arr.findIndex(x => x.gid === obj.gid);
    if (remove) { if (i >= 0) arr.splice(i, 1); }
    else if (i >= 0) arr[i] = obj; else arr.push(obj);
    await saveSettings();
  }
  // Date 입력값 → 구글 일정 시작/끝
  function evBody(title, allDay, startV, endV, location, desc) {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (allDay) {
      const s = startV.slice(0, 10);
      let e = (endV || '').slice(0, 10);
      e = e && e >= s ? addDays(e, 1) : addDays(s, 1); // 구글 종일 일정의 끝 날짜는 '다음 날'
      return { summary: title, location, description: desc, start: { date: s }, end: { date: e } };
    }
    const s = new Date(startV);
    let e = endV ? new Date(endV) : new Date(s.getTime() + 3600000);
    if (!(e > s)) e = new Date(s.getTime() + 3600000);
    return { summary: title, location, description: desc, start: { dateTime: s.toISOString(), timeZone: tz }, end: { dateTime: e.toISOString(), timeZone: tz } };
  }

  // 자동 분류: 사용자 규칙 → 기본 단서 → 미분류
  function autoCategorize(it) {
    const names = cats().map(c => c.name);
    const rules = S.settings.rules.map(r => Object.assign({}, r, { cat: catName(r.catId) }));
    const r = Classifier.classify(it, rules, names);
    if (r.cat) {
      const c = cats().find(x => x.name === r.cat);
      it.catId = c.id; it.catBy = r.by;
    } else { it.catId = catBySys('unsorted').id; it.catBy = 'none'; }
    if (catById(it.catId) && catById(it.catId).name === '재무' && it.amount == null) {
      const a = Classifier.extractAmount(Classifier.textOf(it));
      if (a) it.amount = a;
    }
    return r;
  }

  // ---------- 잠금·설정 화면 ----------
  async function start() {
    if ('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js').catch(() => {});
    if (!(await Vault.isSetUp())) renderSetup(); else renderLock();
  }

  function renderSetup() {
    $app.innerHTML = `
    <main class="screen center">
      <h1>나만의비서 시작하기</h1>
      <p class="muted">모든 기록은 이 폰 안에서 암호화되어 저장됩니다. 서버가 없으므로 비밀번호를 잊으면 복구 코드로만 열 수 있습니다.</p>
      <form id="f-setup" class="card stack">
        <input type="text" name="username" autocomplete="username" value="나만의비서" hidden>
        <label>비밀번호 (8자 이상)<input type="password" id="pw1" autocomplete="new-password" minlength="8" required></label>
        <label>비밀번호 확인<input type="password" id="pw2" autocomplete="new-password" minlength="8" required></label>
        <button class="primary" type="submit">암호화 저장소 만들기</button>
        <p class="muted small" id="setup-msg"></p>
      </form>
      <details class="card"><summary>백업 파일로 복원하기</summary>
        <p class="muted small">다른 폰에서 내보낸 백업 파일과 그때의 비밀번호가 필요합니다.</p>
        <input type="file" id="restore-file" accept="application/json,.json">
      </details>
    </main>`;
    document.getElementById('f-setup').onsubmit = async e => {
      e.preventDefault();
      const a = document.getElementById('pw1').value, b = document.getElementById('pw2').value;
      const msg = document.getElementById('setup-msg');
      if (a.length < 8) { msg.textContent = '8자 이상 입력하세요.'; return; }
      if (a !== b) { msg.textContent = '두 비밀번호가 다릅니다.'; return; }
      msg.textContent = '열쇠를 만드는 중입니다(몇 초 걸립니다)…';
      const code = await Vault.setup(a);
      S.settings = defaultSettings(); await saveSettings(); S.items = [];
      renderRecoveryCode(code);
    };
    document.getElementById('restore-file').onchange = restoreFromFile;
  }

  function renderRecoveryCode(code) {
    $app.innerHTML = `
    <main class="screen center">
      <h1>복구 코드</h1>
      <p>비밀번호를 잊었을 때 이 코드로만 데이터를 열 수 있습니다. <b>지금 종이에 적어 안전한 곳에 보관하세요.</b> 다시 보여드리지 않습니다.</p>
      <div class="card code">${esc(code)}</div>
      <label class="row"><input type="checkbox" id="rc-ok"> 종이에 적어 두었습니다</label>
      <button class="primary" id="rc-next" disabled>시작하기</button>
    </main>`;
    const ok = document.getElementById('rc-ok'), next = document.getElementById('rc-next');
    ok.onchange = () => { next.disabled = !ok.checked; };
    next.onclick = afterUnlock;
  }

  function renderLock(msg) {
    $app.innerHTML = `
    <main class="screen center">
      <div class="lock-icon">${ICON.lock}</div>
      <h1>나만의비서</h1>
      <form id="f-unlock" class="card stack">
        <input type="text" name="username" autocomplete="username" value="나만의비서" hidden>
        <label>비밀번호<input type="password" id="pw" autocomplete="current-password" required autofocus></label>
        <button class="primary" type="submit">잠금 해제</button>
        <p class="muted small" id="lock-msg">${esc(msg || '')}</p>
      </form>
      <details class="card"><summary>비밀번호를 잊었어요</summary>
        <form id="f-recover" class="stack">
          <label>복구 코드<input type="text" id="rc" autocomplete="off" placeholder="XXXXX-XXXXX-XXXXX-XXXXX" required></label>
          <label>새 비밀번호 (8자 이상)<input type="password" id="npw" autocomplete="new-password" minlength="8" required></label>
          <button type="submit">복구 코드로 열기</button>
        </form>
      </details>
    </main>`;
    document.getElementById('f-unlock').onsubmit = async e => {
      e.preventDefault();
      const m = document.getElementById('lock-msg');
      m.textContent = '확인 중…';
      if (await Vault.unlock(document.getElementById('pw').value)) afterUnlock();
      else m.textContent = '비밀번호가 맞지 않습니다.';
    };
    document.getElementById('f-recover').onsubmit = async e => {
      e.preventDefault();
      const np = document.getElementById('npw').value;
      if (np.length < 8) { toast('새 비밀번호는 8자 이상이어야 합니다.'); return; }
      if (await Vault.unlockWithRecovery(document.getElementById('rc').value, np)) { toast('새 비밀번호로 바뀌었습니다.'); afterUnlock(); }
      else toast('복구 코드가 맞지 않습니다.');
    };
  }

  async function afterUnlock() {
    S.settings = (await Vault.loadSettings()) || defaultSettings();
    S.items = await Vault.loadItems();
    await purgeTrash();
    await importInbox();
    try { if (navigator.storage && navigator.storage.persist) await navigator.storage.persist(); } catch (e) {}
    if (!location.hash || location.hash === '#') location.hash = '#/';
    route();
  }

  function lockNow() {
    Vault.lock();
    GApi.clear();
    S.items = []; S.settings = null;
    renderLock('잠겼습니다.');
  }
  document.addEventListener('visibilitychange', () => {
    clearTimeout(lockTimer);
    if (document.hidden && Vault.isUnlocked()) {
      lockTimer = setTimeout(lockNow, (CFG.autoLockMinutes || 5) * 60000);
    }
  });

  async function purgeTrash() {
    const limit = Date.now() - (S.settings.trashDays || 30) * 864e5;
    for (const it of S.items.filter(i => i.deleted && i.deletedAt < limit)) await Vault.deleteItem(it.id);
    S.items = S.items.filter(i => !(i.deleted && i.deletedAt < limit));
  }

  // 공유 시트로 받은 내용 → 암호화된 기록으로 옮기고 임시 보관함 비우기
  async function importInbox() {
    const entries = await Vault.inboxAll();
    if (!entries.length) return;
    let n = 0;
    for (const e of entries) {
      const files = (e.files || []).filter(f => f && f.blob);
      const base = {
        source: '공유', created: Date.now(), tags: [],
        title: e.title || (e.text || '').split('\n')[0].slice(0, 40) || '공유된 항목',
        body: [e.text, e.url].filter(Boolean).join('\n')
      };
      if (!files.length) { const it = Object.assign({ id: uid() }, base); autoCategorize(it); await saveItem(it); n++; }
      for (const f of files) {
        const it = Object.assign({ id: uid() }, base);
        if ((f.type || '').startsWith('image/')) it.image = await resizeImage(f.blob);
        if (!e.title && !e.text) it.title = f.name || '공유된 사진';
        autoCategorize(it); await saveItem(it); n++;
      }
    }
    await Vault.inboxClear();
    toast(`공유받은 ${n}건을 저장했습니다.`);
  }

  function resizeImage(blob, max) {
    max = max || 1600;
    return new Promise((res, rej) => {
      const url = URL.createObjectURL(blob);
      const img = new Image();
      img.onload = () => {
        const s = Math.min(1, max / Math.max(img.width, img.height));
        const c = document.createElement('canvas');
        c.width = Math.round(img.width * s); c.height = Math.round(img.height * s);
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
        URL.revokeObjectURL(url);
        res(c.toDataURL('image/jpeg', 0.85));
      };
      img.onerror = () => { URL.revokeObjectURL(url); rej(new Error('이미지를 읽을 수 없습니다.')); };
      img.src = url;
    });
  }

  // ---------- 라우터 ----------
  function parseHash() {
    const h = location.hash.replace(/^#\/?/, '');
    const [path, qs] = h.split('?');
    const parts = path.split('/').filter(Boolean).map(decodeURIComponent);
    return { parts, q: new URLSearchParams(qs || '') };
  }
  function route() {
    if (!Vault.isUnlocked() || !S.settings) return;
    const { parts, q } = parseHash();
    window.scrollTo(0, 0);
    switch (parts[0]) {
      case 'cat': return viewCategory(parts[1]);
      case 'item': return viewEdit(parts[1]);
      case 'new': return viewEdit(null, q.get('cat'));
      case 'search': return viewSearch(q.get('q') || '', q.get('c') || '');
      case 'rules': return viewRules();
      case 'settings': return viewSettings();
      case 'trash': return viewTrash();
      case 'gevent': return viewGEvent(parts[1], q.get('date'));
      case 'gtask': return viewGTask(parts[1]);
      default: return viewHome();
    }
  }
  window.addEventListener('hashchange', route);
  const topbar = (title, backHref) => `
    <header class="topbar">
      <a class="icon-btn" href="${backHref || '#/'}" aria-label="뒤로">${ICON.back}</a>
      <h1>${esc(title)}</h1>
    </header>`;

  // ---------- 홈 ----------
  // 화면 순서: 빠른 기록 → 오늘 일정 → 할 일 → 날씨 → 오늘의 영단어 → 오늘의 명언 → 주요 뉴스 → 카테고리
  let wordIdx = null; // 앱을 새로 열 때(새로고침)마다 다른 단어
  function pickWord() {
    let n;
    do { n = Math.floor(Math.random() * WORDS.length); } while (WORDS.length > 1 && n === wordIdx);
    wordIdx = n;
  }
  function wordHtml() {
    if (wordIdx == null) pickWord();
    const w = WORDS[wordIdx];
    return `<div class="card-head"><span class="label">오늘의 영단어</span>
      <button type="button" class="sm" data-act="word">${ICON.refresh}<span>다른 단어</span></button></div>
      <div class="row wrap gap8 baseline"><span class="word">${esc(w.w)}</span><span class="muted small">${esc(w.pos)} · ${esc(w.m)}</span></div>`;
  }
  function bindWord() {
    const b = document.querySelector('#word [data-act="word"]');
    if (b) b.onclick = () => { pickWord(); document.getElementById('word').innerHTML = wordHtml(); bindWord(); };
  }

  // 오늘의 명언도 앱을 새로 열 때마다, 그리고 '다른 명언' 버튼으로 바뀜
  let quoteIdx = null;
  function pickQuote() {
    let n;
    do { n = Math.floor(Math.random() * QUOTES.length); } while (QUOTES.length > 1 && n === quoteIdx);
    quoteIdx = n;
  }
  function quoteHtml() {
    if (quoteIdx == null) pickQuote();
    const q = QUOTES[quoteIdx];
    return `<div class="card-head"><span class="label">오늘의 명언</span>
      <button type="button" class="sm" data-act="quote">${ICON.refresh}<span>다른 명언</span></button></div>
      <p class="quote">${esc(q.text)}</p>
      <div class="muted small">${esc(q.by)}</div>`;
  }
  function bindQuote() {
    const b = document.querySelector('#quote [data-act="quote"]');
    if (b) b.onclick = () => { pickQuote(); document.getElementById('quote').innerHTML = quoteHtml(); bindQuote(); };
  }

  function viewHome() {
    const d = new Date();
    const wd = '일월화수목금토'[d.getDay()];
    const sched = catBySys('schedule'), todo = catBySys('todo');
    const t = today();
    // 일정: 앱 기록 + 구글 캘린더(표시하도록 고른 모든 캘린더의 마지막 동기화 사본)
    const evRows = live().filter(i => i.catId === sched.id && (i.date || '').slice(0, 10) === t)
      .map(e => ({ time: (e.date || '').length > 10 ? e.date.slice(11, 16) : '종일', title: e.title || '(제목 없음)', href: `#/item/${e.id}`, g: false }))
      .concat(gEvents().filter(e => evOnDay(e, t)).map(e => ({ time: evTime(e), title: e.title, href: `#/gevent/${encodeURIComponent(e.gid)}`, g: true, color: e.color, calName: e.calName })))
      .sort((a, b) => (a.time === '종일' ? '00' : a.time).localeCompare(b.time === '종일' ? '00' : b.time));
    // 할 일: 앱 기록 + Google Tasks (미완료 전부 + 오늘 완료한 것)
    const doneToday = ts => ts && new Date(ts).toLocaleDateString('sv-SE') === t;
    const todos = live().filter(i => i.catId === todo.id && (!i.done || doneToday(i.doneAt)))
      .map(i => ({ id: i.id, title: i.title || '(제목 없음)', done: !!i.done, due: (i.date || '').slice(0, 10), href: `#/item/${i.id}`, g: false }))
      .concat(gTasks().filter(x => !x.done || doneToday(x.completedAt))
        .map(x => ({ id: x.gid, title: x.title, done: x.done, due: x.due || '', href: `#/gtask/${encodeURIComponent(x.gid)}`, g: true })))
      .sort((a, b) => (a.done ? 1 : 0) - (b.done ? 1 : 0) || (a.due || '9').localeCompare(b.due || '9'));
    const doneN = todos.filter(i => i.done).length;
    const g = G();
    const gStatus = !gOn() ? '<p class="muted tiny"><a class="accent" href="#/settings">설정 → 구글 연결</a>에서 구글 캘린더·할 일을 연결할 수 있습니다.</p>'
      : `<p class="muted tiny gline">구글 ${g.cache ? hm(g.cache.at) + ' 동기화' : '아직 동기화 전'}${GApi.hasToken() ? '' : ' · 연결 만료(할 일의 동기화 버튼으로 다시 연결)'}${shownCals().length > 1 ? ` · 캘린더 ${shownCals().length}개` : ''}</p>`;
    const btnCats = cats().filter(c => c.sys !== 'schedule' && c.sys !== 'todo');

    $app.innerHTML = `
    <main class="screen home">
      <header class="home-head">
        <div><div class="muted small">${d.getMonth() + 1}월 ${d.getDate()}일 ${wd}요일</div>
          <div class="row gap8"><h1>나만의비서</h1><a class="quick-add" href="#/new" aria-label="빠른 기록(사진·메모)" title="빠른 기록">${ICON.plus}</a></div></div>
        <nav class="row gap8">
          <a class="icon-btn" href="#/search" aria-label="검색">${ICON.search}</a>
          <a class="icon-btn" href="#/settings" aria-label="설정">${ICON.gear}</a>
          <button class="icon-btn" type="button" data-act="lock" aria-label="잠금">${ICON.lock}</button>
        </nav>
      </header>

      <section class="card bold-edge" aria-label="오늘 일정">
        <div class="card-head"><h2>오늘 일정</h2><a class="small accent" href="${gOn() ? '#/gevent/new' : `#/new?cat=${sched.id}`}">+ 추가</a></div>
        ${evRows.length ? evRows.map(e => `
          <a class="event" href="${e.href}"><span class="time">${esc(e.time)}</span><span class="grow">${esc(e.title)}</span>${e.g ? `<span class="calname" title="${esc(e.calName || '구글 캘린더')}">${dot(e.color)}</span>` : ''}</a>`).join('')
          : '<p class="muted small">오늘 일정이 없습니다.</p>'}
        ${gStatus}
      </section>

      <section class="card bold-edge" aria-label="할 일">
        <div class="card-head"><h2>할 일</h2>
          <span class="row gap8"><span class="muted small">${todos.length ? `${doneN}/${todos.length} 완료` : ''}</span>
          ${gOn() ? `<button type="button" class="sm" data-act="gsync">${ICON.refresh}<span>${GApi.hasToken() ? '동기화' : '구글 연결'}</span></button>` : ''}</span></div>
        ${todos.length ? todos.map((i, n) => `
          <div class="todo ${i.done ? 'done' : ''}">
            <input type="checkbox" id="td-${n}" data-act="${i.g ? 'gtoggle' : 'toggle'}" data-id="${esc(i.id)}" ${i.done ? 'checked' : ''}>
            <label for="td-${n}">${esc(i.title)}${i.due && i.due < t && !i.done ? ' <span class="late">지남</span>' : ''}</label>
            <a class="tiny muted" href="${i.href}">편집</a>
          </div>`).join('') : '<p class="muted small">할 일이 없습니다.</p>'}
        <form class="row gap8" id="f-quicktodo">
          <label class="sr" for="qt">새 할 일</label>
          <input id="qt" type="text" placeholder="새 할 일 입력" autocomplete="off">
          <button type="submit">추가</button>
        </form>
      </section>

      <a class="card wx" id="weather" href="${WX_SITE}" target="_blank" rel="noopener noreferrer" aria-label="날씨 자세히 보기(기상청 날씨누리)">${weatherHtml()}</a>

      <section class="card" id="word" aria-label="오늘의 영단어">${wordHtml()}</section>

      <section class="card" id="quote" aria-label="오늘의 명언">${quoteHtml()}</section>

      <section class="card" id="news" aria-label="주요 뉴스">${newsHtml()}</section>

      <section aria-label="카테고리">
        <h2 class="section-title">카테고리</h2>
        <div class="grid4">
          ${btnCats.map(c => `<a class="cat-btn" href="#/cat/${c.id}"><span>${esc(c.name)}</span><span class="tiny muted">${live().filter(i => i.catId === c.id).length}</span></a>`).join('')}
          <a class="cat-btn dashed" href="#/rules"><span>분류 규칙</span></a>
        </div>
      </section>
    </main>`;

    $app.querySelector('[data-act="lock"]').onclick = lockNow;
    bindWord(); bindQuote(); bindNews();
    $app.querySelectorAll('[data-act="toggle"]').forEach(el => {
      el.onchange = async () => {
        const it = S.items.find(x => x.id === el.dataset.id);
        it.done = el.checked; it.doneAt = el.checked ? Date.now() : null;
        await saveItem(it); viewHome();
      };
    });
    $app.querySelectorAll('[data-act="gtoggle"]').forEach(el => {
      el.onchange = async () => {
        const x = gTasks().find(k => k.gid === el.dataset.id);
        const done = el.checked;
        try {
          const r = await gRun(() => GApi.patchTask(G().listId, x.gid, done ? { status: 'completed' } : { status: 'needsAction', completed: null }));
          await gCachePut('tasks', normTask(r));
        } catch (err) { toast(err.message); el.checked = !done; return; }
        viewHome();
      };
    });
    document.getElementById('f-quicktodo').onsubmit = async e => {
      e.preventDefault();
      const v = document.getElementById('qt').value.trim();
      if (!v) return;
      if (gOn()) {
        try {
          const r = await gRun(async () => { if (!G().listId) await gSync(); return GApi.insertTask(G().listId, { title: v }); });
          await gCachePut('tasks', normTask(r));
          toast('Google Tasks에 추가했습니다.');
        } catch (err) { toast(err.message); return; }
      } else {
        await saveItem({ id: uid(), catId: todo.id, catBy: 'manual', title: v, source: '메모', created: Date.now(), tags: [] });
      }
      viewHome();
    };
    const gs = $app.querySelector('[data-act="gsync"]');
    if (gs) gs.onclick = async () => {
      try {
        if (!GApi.hasToken()) await gConnect(false);
        gs.disabled = true; gs.lastChild.textContent = '동기화 중…';
        if (await gSync()) toast('구글과 동기화했습니다.');
      } catch (err) { toast(err.message); }
      if (!parseHash().parts.length) viewHome();
    };
    gPreload();
    if (gOn() && GApi.hasToken() && (!G().cache || Date.now() - G().cache.at > 5 * 60000)) {
      gSync().then(ok => { if (ok && !parseHash().parts.length) viewHome(); });
    }
    loadWeather(); loadNews();
  }

  // ---------- 구글 일정 편집 ----------
  const primaryCal = () => (G().calendars || []).find(c => c.primary) || { id: 'primary', name: '기본 캘린더', color: '', edit: true };
  function viewGEvent(gid, dateParam) {
    const isNew = !gid || gid === 'new';
    const e0 = isNew ? null : gEvents().find(e => e.gid === gid);
    if (!isNew && !e0) { toast('일정을 찾을 수 없습니다. 동기화 후 다시 열어 주세요.'); location.hash = '#/'; return; }
    const now = new Date(); now.setMinutes(0, 0, 0); now.setHours(now.getHours() + 1);
    const base = dateParam ? new Date(dateParam + 'T09:00') : now;
    const ev = e0 || { title: '', allDay: false, start: base.toISOString(), end: new Date(base.getTime() + 3600000).toISOString(), location: '', desc: '' };
    // 2단계에서 저장된 사본(캘린더 정보 없음)은 기본 캘린더로 취급
    const calId = e0 ? (e0.cal || 'primary') : null, eid = e0 ? (e0.eid || e0.gid) : null;
    const ro = e0 && e0.canEdit === false;
    const choices = writableCals().length ? writableCals() : [primaryCal()];
    const sVal = ev.allDay ? ev.start : localDT(new Date(ev.start));
    const eVal = ev.allDay ? addDays(ev.end, -1) : localDT(new Date(ev.end));
    const dis = ro ? 'disabled' : '';
    $app.innerHTML = `
    <main class="screen">
      ${topbar(isNew ? '새 구글 일정' : ro ? '구글 일정 (읽기 전용)' : '구글 일정 편집')}
      <form id="f-gev" class="stack">
        ${isNew ? `<label>캘린더<select id="g-cal">${choices.map(c => `<option value="${esc(c.id)}" ${c.primary ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</select></label>`
          : `<p class="small row gap8">${dot(e0.color)}<span>${esc(e0.calName || '기본 캘린더')}</span></p>`}
        ${ro ? '<p class="small muted">공휴일·구독 캘린더처럼 편집 권한이 없는 캘린더의 일정은 앱에서 바꿀 수 없습니다.</p>' : ''}
        <label>제목<input id="g-title" type="text" value="${esc(ev.title === '(제목 없음)' ? '' : ev.title)}" required ${dis}></label>
        <label class="row"><input type="checkbox" id="g-all" ${ev.allDay ? 'checked' : ''} ${dis}> 종일</label>
        <label>시작<input id="g-start" type="${ev.allDay ? 'date' : 'datetime-local'}" value="${esc(sVal)}" required ${dis}></label>
        <label>끝<input id="g-end" type="${ev.allDay ? 'date' : 'datetime-local'}" value="${esc(eVal)}" ${dis}></label>
        <label>장소<input id="g-loc" type="text" value="${esc(ev.location)}" ${dis}></label>
        <label>메모<textarea id="g-desc" rows="5" ${dis}>${esc(ev.desc)}</textarea></label>
        ${ro ? '' : `<div class="row gap8">
          <button class="primary grow" type="submit">${isNew ? '구글 캘린더에 추가' : '저장'}</button>
          ${isNew ? '' : '<button type="button" class="danger" data-act="gdel">삭제</button>'}
        </div>`}
        ${ev.link ? `<a class="small accent" href="${esc(ev.link)}" target="_blank" rel="noopener noreferrer">구글 캘린더에서 열기</a>` : ''}
        <p class="tiny muted">반복 일정은 이 회차만 바뀝니다. 참석자·알림 설정과 캘린더 옮기기는 구글 캘린더에서 해 주세요.</p>
      </form>
    </main>`;
    if (ro) return;
    const all = document.getElementById('g-all'), si = document.getElementById('g-start'), ei = document.getElementById('g-end');
    all.onchange = () => {
      const s = si.value, e = ei.value;
      si.type = ei.type = all.checked ? 'date' : 'datetime-local';
      si.value = all.checked ? s.slice(0, 10) : (s ? s.slice(0, 10) + 'T09:00' : '');
      ei.value = all.checked ? e.slice(0, 10) : (e ? e.slice(0, 10) + 'T10:00' : '');
    };
    gPreload();
    document.getElementById('f-gev').onsubmit = async e => {
      e.preventDefault();
      const body = evBody(document.getElementById('g-title').value.trim(), all.checked, si.value, ei.value,
        document.getElementById('g-loc').value, document.getElementById('g-desc').value);
      const target = isNew ? document.getElementById('g-cal').value : calId;
      try {
        const r = await gRun(() => isNew ? GApi.insertEvent(target, body) : GApi.patchEvent(calId, eid, body));
        if (!isNew && e0.gid !== `${calId}::${eid}`) await gCachePut('events', { gid: e0.gid }, true); // 예전 형식 사본 정리
        await gCachePut('events', normEv(r, calById(target) || (target === 'primary' ? primaryCal() : { id: target, name: '', color: '', edit: true })));
        toast(isNew ? '구글 캘린더에 추가했습니다.' : '저장했습니다.');
        location.hash = '#/';
      } catch (err) { toast(err.message); }
    };
    const d = $app.querySelector('[data-act="gdel"]');
    if (d) d.onclick = async () => {
      if (!confirm('구글 캘린더에서 이 일정을 삭제할까요? (구글 캘린더 휴지통에 30일 보관)')) return;
      try {
        await gRun(() => GApi.deleteEvent(calId, eid));
        await gCachePut('events', { gid: e0.gid }, true);
        toast('삭제했습니다.'); location.hash = '#/';
      } catch (err) { toast(err.message); }
    };
  }

  // ---------- 구글 할 일 편집 ----------
  function viewGTask(gid) {
    const isNew = !gid || gid === 'new';
    const x = isNew ? { title: '', notes: '', due: null, done: false } : gTasks().find(k => k.gid === gid);
    if (!x) { toast('할 일을 찾을 수 없습니다. 동기화 후 다시 열어 주세요.'); location.hash = '#/'; return; }
    $app.innerHTML = `
    <main class="screen">
      ${topbar(isNew ? '새 할 일 (Google Tasks)' : '할 일 편집 (Google Tasks)')}
      <form id="f-gt" class="stack">
        <label>제목<input id="t-title" type="text" value="${esc(x.title === '(제목 없음)' ? '' : x.title)}" required></label>
        <label>날짜<input id="t-due" type="date" value="${esc(x.due || '')}"></label>
        <p class="tiny muted">Google Tasks는 날짜만 저장하고 시각은 저장하지 않습니다.</p>
        ${isNew ? '' : `<label class="row"><input type="checkbox" id="t-done" ${x.done ? 'checked' : ''}> 완료</label>`}
        <label>메모<textarea id="t-notes" rows="5">${esc(x.notes)}</textarea></label>
        <div class="row gap8">
          <button class="primary grow" type="submit">저장</button>
          ${isNew ? '' : '<button type="button" class="danger" data-act="tdel">삭제</button>'}
        </div>
        <p class="tiny muted">목록: ${esc(G().listName || '기본 목록')}</p>
      </form>
    </main>`;
    gPreload();
    document.getElementById('f-gt').onsubmit = async e => {
      e.preventDefault();
      const due = document.getElementById('t-due').value;
      const body = { title: document.getElementById('t-title').value.trim(), notes: document.getElementById('t-notes').value,
        due: due ? due + 'T00:00:00.000Z' : null };
      const dn = document.getElementById('t-done');
      if (dn) Object.assign(body, dn.checked ? { status: 'completed' } : { status: 'needsAction', completed: null });
      try {
        const r = await gRun(async () => {
          if (!G().listId) await gSync();
          return isNew ? GApi.insertTask(G().listId, body) : GApi.patchTask(G().listId, gid, body);
        });
        await gCachePut('tasks', normTask(r));
        toast('저장했습니다.'); location.hash = '#/';
      } catch (err) { toast(err.message); }
    };
    const d = $app.querySelector('[data-act="tdel"]');
    if (d) d.onclick = async () => {
      if (!confirm('Google Tasks에서 이 할 일을 삭제할까요?')) return;
      try {
        await gRun(() => GApi.deleteTask(G().listId, gid));
        await gCachePut('tasks', { gid }, true);
        toast('삭제했습니다.'); location.hash = '#/';
      } catch (err) { toast(err.message); }
    };
  }

  // ---------- 날씨 (Open-Meteo, API 키 불필요) ----------
  // 홈에는 한 줄 요약만, 누르면 기상청 날씨누리로 이동
  const WX_SITE = 'https://www.weather.go.kr/w/index.do';
  const WMO = c => c === 0 ? '맑음' : c <= 2 ? '구름 조금' : c === 3 ? '흐림' : c <= 48 ? '안개' : c <= 57 ? '이슬비' : c <= 67 ? '비' : c <= 77 ? '눈' : c <= 82 ? '소나기' : c <= 86 ? '눈보라' : '뇌우';
  function weatherHtml() {
    const w = S.weather;
    const tail = '<span class="wx-go" aria-hidden="true">›</span>';
    if (!w) return `<span class="wx-temp">…</span><span class="grow small muted">날씨 불러오는 중</span>${tail}`;
    if (w.error) return `<span class="grow small muted">${esc(w.error)} · 눌러서 기상청에서 보기</span>${tail}`;
    return `<span class="wx-temp">${Math.round(w.temp)}°</span>
      <span class="grow"><span class="small"><b>${esc(WMO(w.code))}</b> · 최고 ${Math.round(w.max)}° 최저 ${Math.round(w.min)}°${w.pop != null ? ` · 강수 ${w.pop}%` : ''}</span>
      <span class="tiny muted">${esc(w.place)} · 자세히: 기상청 날씨누리</span></span>${tail}`;
  }
  async function loadWeather() {
    if (S.weather && !S.weather.error && Date.now() - S.weather.at < 30 * 60000) return;
    const loc = await getLocation();
    try {
      const u = `https://api.open-meteo.com/v1/forecast?latitude=${loc.lat}&longitude=${loc.lon}&current=temperature_2m,weather_code&daily=temperature_2m_max,temperature_2m_min,precipitation_probability_max&timezone=auto&forecast_days=1`;
      const r = await fetch(u);
      if (!r.ok) throw new Error();
      const j = await r.json();
      S.weather = { at: Date.now(), place: loc.name, temp: j.current.temperature_2m, code: j.current.weather_code,
        max: j.daily.temperature_2m_max[0], min: j.daily.temperature_2m_min[0], pop: j.daily.precipitation_probability_max ? j.daily.precipitation_probability_max[0] : null };
    } catch (e) { S.weather = { error: '날씨를 불러오지 못했습니다' }; }
    const el = document.getElementById('weather');
    if (el) el.innerHTML = weatherHtml();
  }
  function getLocation() {
    if (S.settings.location) return Promise.resolve(S.settings.location);
    const def = CFG.defaultLocation || { name: '서울', lat: 37.5665, lon: 126.978 };
    if (!navigator.geolocation) return Promise.resolve(def);
    return new Promise(res => {
      // 위치 허용 창에 답하지 않아도 10초 뒤 기본 위치로 진행
      const t = setTimeout(() => res(def), 10000);
      navigator.geolocation.getCurrentPosition(p => {
        clearTimeout(t);
        res({ name: '현재 위치', lat: p.coords.latitude.toFixed(3), lon: p.coords.longitude.toFixed(3) });
      }, () => { clearTimeout(t); res(def); }, { timeout: 8000, maximumAge: 3600000 });
    });
  }

  // ---------- 뉴스 (GitHub Actions가 30분마다 만든 news.json) ----------
  // 국내: 주요(연합뉴스TV) · 조경 · 엔지니어링 탭, 해외: BBC World
  let newsTab = 'main';
  function newsHtml() {
    const n = S.news;
    const head = upd => `<div class="card-head"><h2>주요 뉴스</h2><span class="row gap8">
      <span class="muted tiny">${upd ? `${hm(upd)} 수집` : ''}</span>
      <button type="button" class="sm" data-act="newsre" aria-label="뉴스 새로고침">${ICON.refresh}<span>새로고침</span></button></span></div>`;
    if (!n) return head() + '<p class="muted small">불러오는 중…</p>';
    if (n.error) return head() + `<p class="muted small">${esc(n.error)}</p>`;
    const tabs = [{ key: 'main', label: '주요', data: n.domestic }]
      .concat((n.domesticTabs || []).map(x => ({ key: x.key, label: x.label, data: x })));
    if (!tabs.some(x => x.key === newsTab)) newsTab = 'main';
    const cur = tabs.find(x => x.key === newsTab).data;
    const list = (s, label) => !s ? '' : `
      <div class="news-src">${esc(label)}${s.source ? ` <span class="muted tiny">· ${esc(s.source)}</span>` : ''}</div>
      ${(s.items || []).length ? `<ol class="news">${s.items.slice(0, 5).map(a => `<li><a href="${esc(a.link)}" target="_blank" rel="noopener noreferrer">${esc(a.title)}</a></li>`).join('')}</ol>` : ''}
      ${s.error ? `<p class="muted tiny">${esc(s.error)}</p>` : (s.items || []).length ? '' : '<p class="muted small">기사가 없습니다.</p>'}`;
    return head(n.updated ? new Date(n.updated) : null) + `
      <div class="tabs" role="group" aria-label="국내 뉴스 분야">
        ${tabs.map(x => `<button type="button" class="tab ${x.key === newsTab ? 'on' : ''}" data-tab="${esc(x.key)}" aria-pressed="${x.key === newsTab}">${esc(x.label)}</button>`).join('')}
      </div>
      ${list(cur, '국내 · ' + (newsTab === 'main' ? '주요' : tabs.find(x => x.key === newsTab).label))}
      <hr>${list(n.world, '해외')}`;
  }
  function bindNews() {
    const el = document.getElementById('news');
    if (!el) return;
    el.querySelectorAll('[data-tab]').forEach(b => { b.onclick = () => { newsTab = b.dataset.tab; el.innerHTML = newsHtml(); bindNews(); }; });
    const re = el.querySelector('[data-act="newsre"]');
    if (re) re.onclick = async () => {
      re.disabled = true;
      const before = S.news && S.news.updated;
      await loadNews(true);
      const after = S.news && S.news.updated;
      toast(S.news && S.news.error ? S.news.error
        : after && after !== before ? `새 뉴스를 불러왔습니다(${hm(new Date(after))} 수집).`
          : '최신 수집본입니다. 뉴스는 30분마다 자동 수집됩니다.');
    };
  }
  async function loadNews(force) {
    if (!force && S.news && !S.news.error && Date.now() - S.news.at < 15 * 60000) return;
    try {
      const r = await fetch('./news.json', { cache: force ? 'no-store' : 'no-cache' });
      if (!r.ok) throw new Error();
      S.news = Object.assign(await r.json(), { at: Date.now() });
    } catch (e) { S.news = { error: '뉴스 파일이 아직 없습니다. 자동 수집이 처음 실행되면 표시됩니다.' }; }
    const el = document.getElementById('news');
    if (el) { el.innerHTML = newsHtml(); bindNews(); }
  }

  // ---------- 카테고리 목록 (+ 선택 이동) ----------
  function viewCategory(id, selecting) {
    const c = catById(id);
    if (!c) { location.hash = '#/'; return; }
    const list = live().filter(i => i.catId === id).sort((a, b) => (b.updated || 0) - (a.updated || 0));
    $app.innerHTML = `
    <main class="screen">
      ${topbar(c.name)}
      <div class="row between">
        <span class="muted small">${list.length}건</span>
        <div class="row gap8">
          ${list.length ? `<button type="button" data-act="select">${selecting ? '선택 취소' : '선택'}</button>` : ''}
          <a class="primary sm" href="#/new?cat=${c.id}">+ 기록</a>
        </div>
      </div>
      <ul class="list">
        ${list.map(i => `<li class="item">
          ${selecting ? `<input type="checkbox" class="sel" value="${i.id}" aria-label="${esc(i.title || '기록')} 선택">` : ''}
          <a href="#/item/${i.id}">
            ${i.image ? `<img src="${i.image}" alt="" class="thumb">` : ''}
            <span class="grow"><span class="t">${esc(i.title || '(제목 없음)')}</span>
            <span class="tiny muted">${esc(fmtDate(i.date) || new Date(i.created || i.updated).toLocaleDateString('ko-KR'))}${i.amount ? ' · ' + won(i.amount) : ''}${i.catBy === 'rule' ? ' · 규칙 분류' : i.catBy === 'auto' ? ' · 자동 분류' : ''}</span></span>
          </a></li>`).join('') || '<li class="muted small">아직 기록이 없습니다.</li>'}
      </ul>
      ${selecting ? `<div class="sticky-bar card row gap8">
        <label class="sr" for="mv-to">이동할 카테고리</label>
        <select id="mv-to">${cats().filter(x => x.id !== id).map(x => `<option value="${x.id}">${esc(x.name)}</option>`).join('')}</select>
        <button class="primary" type="button" data-act="move">선택 이동</button>
      </div>` : ''}
    </main>`;
    const sel = $app.querySelector('[data-act="select"]');
    if (sel) sel.onclick = () => viewCategory(id, !selecting);
    const mv = $app.querySelector('[data-act="move"]');
    if (mv) mv.onclick = () => {
      const ids = [...$app.querySelectorAll('.sel:checked')].map(x => x.value);
      if (!ids.length) { toast('옮길 기록을 선택하세요.'); return; }
      bulkMove(ids, document.getElementById('mv-to').value).then(() => viewCategory(id));
    };
  }

  async function bulkMove(ids, toCatId) {
    const prev = ids.map(id => { const it = S.items.find(x => x.id === id); return { id, catId: it.catId, catBy: it.catBy }; });
    for (const id of ids) { const it = S.items.find(x => x.id === id); it.catId = toCatId; it.catBy = 'manual'; await saveItem(it); }
    toast(`${ids.length}건을 ${catName(toCatId)}(으)로 옮겼습니다.`, {
      label: '되돌리기', fn: async () => {
        for (const p of prev) { const it = S.items.find(x => x.id === p.id); it.catId = p.catId; it.catBy = p.catBy; await saveItem(it); }
        toast('되돌렸습니다.'); route();
      }
    });
  }

  // ---------- 기록 편집 ----------
  function viewEdit(id, catParam) {
    const isNew = !id;
    const it = isNew ? { id: uid(), catId: catParam || '', tags: [], source: '메모', created: Date.now() } : S.items.find(x => x.id === id);
    if (!it) { location.hash = '#/'; return; }
    const c = catById(it.catId);
    const sys = c ? c.sys : null;
    const dateType = sys === 'schedule' ? 'datetime-local' : 'date';
    $app.innerHTML = `
    <main class="screen">
      ${topbar(isNew ? '새 기록' : '기록 편집', c ? `#/cat/${c.id}` : '#/')}
      <form id="f-edit" class="stack">
        <label>카테고리
          <select id="e-cat">
            ${isNew && !catParam ? '<option value="">자동 분류</option>' : ''}
            ${cats().map(x => `<option value="${x.id}" ${x.id === it.catId ? 'selected' : ''}>${esc(x.name)}</option>`).join('')}
          </select>
        </label>
        <label>제목<input id="e-title" type="text" value="${esc(it.title || '')}"></label>
        <label>${sys === 'schedule' ? '날짜·시간' : sys === 'todo' ? '마감일' : '날짜'}<input id="e-date" type="${dateType}" value="${esc(sys === 'schedule' ? (it.date || '').slice(0, 16) : (it.date || '').slice(0, 10))}"></label>
        <label id="amt-wrap" ${(c && c.name === '재무') || it.amount != null ? '' : 'hidden'}>금액(원)<input id="e-amt" type="number" inputmode="numeric" value="${it.amount != null ? esc(it.amount) : ''}"></label>
        <button type="button" id="amt-add" class="sm add-field" ${(c && c.name === '재무') || it.amount != null ? 'hidden' : ''}>+ 금액 추가</button>
        ${sys === 'todo' ? `<label class="row"><input type="checkbox" id="e-done" ${it.done ? 'checked' : ''}> 완료</label>` : ''}
        <label>내용<textarea id="e-body" rows="7">${esc(it.body || '')}</textarea></label>
        <label>태그(쉼표로 구분)<input id="e-tags" type="text" value="${esc((it.tags || []).join(', '))}" placeholder="예: 현장, 출장"></label>
        <div class="card stack">
          <div class="row between"><b>사진</b><button type="button" id="e-rmimg" ${it.image ? '' : 'hidden'}>사진 삭제</button></div>
          <img id="e-photo" src="${it.image || ''}" alt="첨부 사진" class="photo" ${it.image ? '' : 'hidden'}>
          <label class="file-btn">사진 찍기·선택<input id="e-img" type="file" accept="image/*" class="sr"></label>
          <p class="tiny muted">사진 속 글자 자동 인식(OCR)은 3단계 업데이트에서 추가됩니다.</p>
        </div>
        ${!isNew ? `<p class="tiny muted">입력 경로: ${esc(it.source || '-')} · 분류: ${it.catBy === 'rule' ? '사용자 규칙' : it.catBy === 'auto' ? '자동' : it.catBy === 'manual' ? '직접 지정' : '미분류'}</p>` : ''}
        ${!isNew && gOn() ? `<button type="button" data-act="tocal">구글 캘린더에 일정으로 등록${it.gEventId ? ' (다시)' : ''}</button>` : ''}
        <div class="row gap8">
          <button class="primary grow" type="submit">저장</button>
          ${!isNew ? '<button type="button" class="danger" data-act="del">삭제</button>' : ''}
        </div>
      </form>
    </main>`;
    let newImage = it.image || null;
    document.getElementById('e-cat').onchange = e => {
      const nc = catById(e.target.value);
      // 재무로 바꾸면 금액 칸을 보여 주고, 다른 분류에서는 이미 금액을 넣었거나 '+ 금액 추가'를 누른 경우에만 보임
      const aw = document.getElementById('amt-wrap'), ab = document.getElementById('amt-add');
      if (nc && nc.name === '재무') { aw.hidden = false; ab.hidden = true; }
      else if (document.getElementById('e-amt').value === '' && !aw.dataset.user) { aw.hidden = true; ab.hidden = false; }
      const di = document.getElementById('e-date'), v = di.value;
      const wantDT = !!(nc && nc.sys === 'schedule');
      if (wantDT !== (di.type === 'datetime-local')) {
        di.type = wantDT ? 'datetime-local' : 'date';
        di.value = wantDT ? (v ? v.slice(0, 10) + 'T09:00' : '') : v.slice(0, 10);
      }
    };
    document.getElementById('amt-add').onclick = () => {
      const aw = document.getElementById('amt-wrap');
      aw.hidden = false; aw.dataset.user = '1';
      document.getElementById('amt-add').hidden = true;
      document.getElementById('e-amt').focus();
    };
    const photo = document.getElementById('e-photo'), rmBtn = document.getElementById('e-rmimg');
    document.getElementById('e-img').onchange = async e => {
      const f = e.target.files[0]; if (!f) return;
      try {
        newImage = await resizeImage(f);
        if (isNew) it.source = '사진';
        photo.src = newImage; photo.hidden = false; rmBtn.hidden = false;
      } catch (err) { toast(err.message); }
    };
    rmBtn.onclick = () => { newImage = null; photo.hidden = true; photo.removeAttribute('src'); rmBtn.hidden = true; };
    const tocal = $app.querySelector('[data-act="tocal"]');
    if (tocal) { gPreload(); tocal.onclick = async () => {
      const dv = document.getElementById('e-date').value;
      if (!dv) { toast('먼저 날짜를 입력하세요.'); return; }
      const title = document.getElementById('e-title').value.trim() || '(제목 없음)';
      const body = evBody(title, dv.length <= 10, dv, '', '', document.getElementById('e-body').value);
      try {
        const pc = primaryCal();
        const r = await gRun(() => GApi.insertEvent(pc.id, body));
        await gCachePut('events', normEv(r, pc));
        it.gEventId = r.id; await saveItem(it);
        toast(`${fmtDate(dv)} 구글 캘린더에 등록했습니다.`);
      } catch (err) { toast(err.message); }
    }; }
    const del = $app.querySelector('[data-act="del"]');
    if (del) del.onclick = async () => {
      if (!confirm('휴지통으로 옮길까요? 30일 뒤 완전히 삭제됩니다.')) return;
      it.deleted = true; it.deletedAt = Date.now(); await saveItem(it);
      toast('휴지통으로 옮겼습니다.', { label: '되돌리기', fn: async () => { it.deleted = false; await saveItem(it); route(); } });
      location.hash = c ? `#/cat/${c.id}` : '#/';
    };
    function collect() {
      it.title = document.getElementById('e-title').value;
      it.body = document.getElementById('e-body').value;
      it.tags = document.getElementById('e-tags').value.split(',').map(s => s.trim().replace(/^#/, '')).filter(Boolean);
      it.date = document.getElementById('e-date').value || null;
      const sc = document.getElementById('e-cat').value; it.catId = sc;
      const a = document.getElementById('e-amt').value; it.amount = a === '' ? null : Number(a);
      const dn = document.getElementById('e-done'); if (dn) it.done = dn.checked;
    }
    document.getElementById('f-edit').onsubmit = async e => {
      e.preventDefault();
      const wasCat = it.catId;
      collect();
      if (!it.catId) {
        const r = autoCategorize(it);
        toast(r.by === 'rule' ? `사용자 규칙으로 '${catName(it.catId)}'에 분류했습니다.` : r.by === 'auto' ? `'${catName(it.catId)}'(으)로 자동 분류했습니다.` : '분류 단서가 없어 미분류에 두었습니다.');
      } else if (isNew || it.catId !== wasCat) { it.catBy = 'manual'; }
      if (catName(it.catId) === '재무' && it.amount == null) { const a = Classifier.extractAmount(Classifier.textOf(it)); if (a) it.amount = a; }
      if (it.done && !it.doneAt) it.doneAt = Date.now();
      if (!it.done) it.doneAt = null;
      it.image = newImage;
      await saveItem(it);
      location.hash = `#/cat/${it.catId}`;
    };
  }
  // ---------- 통합 검색 ----------
  function viewSearch(q, catFilter) {
    // 구글 일정·할 일(마지막 동기화 사본)도 함께 검색
    const at = G().cache ? G().cache.at : 0;
    const gItems = gEvents().map(e => ({ id: 'ge-' + e.gid, title: e.title, body: [e.location, e.desc, e.calName].filter(Boolean).join('\n'),
      catId: catBySys('schedule').id, date: e.allDay ? e.start : localDT(new Date(e.start)), updated: at, tags: [], _href: `#/gevent/${encodeURIComponent(e.gid)}`, _g: true }))
      .concat(gTasks().map(x => ({ id: 'gt-' + x.gid, title: x.title, body: x.notes, catId: catBySys('todo').id, date: x.due,
        updated: at, tags: [], _href: `#/gtask/${encodeURIComponent(x.gid)}`, _g: true })));
    const res = Classifier.search(S.items.concat(gItems), q);
    const counts = {};
    res.forEach(r => { counts[r.item.catId] = (counts[r.item.catId] || 0) + 1; });
    const shown = catFilter ? res.filter(r => r.item.catId === catFilter) : res;
    $app.innerHTML = `
    <main class="screen">
      <header class="topbar">
        <a class="icon-btn" href="#/" aria-label="뒤로">${ICON.back}</a>
        <form id="f-search" class="search-box grow" role="search">
          <label class="sr" for="sq">검색어</label>
          ${ICON.search}<input id="sq" type="search" value="${esc(q)}" placeholder="모든 기록에서 검색" autocomplete="off">
        </form>
      </header>
      ${q ? `<div class="chips">
        <a class="chip ${catFilter ? '' : 'on'}" href="#/search?q=${encodeURIComponent(q)}">전체 ${res.length}</a>
        ${cats().filter(c => counts[c.id]).map(c => `<a class="chip ${catFilter === c.id ? 'on' : ''}" href="#/search?q=${encodeURIComponent(q)}&c=${c.id}">${esc(c.name)} ${counts[c.id]}</a>`).join('')}
      </div>
      <p class="tiny muted">제목·내용·태그·사진 속 글자·녹취록${gOn() ? '과 구글 일정(지난 30일~앞으로 60일)·할 일' : ''}에서 찾습니다.</p>
      <ul class="list">${shown.map(r => `
        <li><a class="result" href="${r.item._href || '#/item/' + r.item.id}">
          <span class="row between"><span class="tag">${esc(catName(r.item.catId))}${r.item._g ? ' · 구글' : ''}</span><span class="tiny muted">${esc(fmtDate(r.item.date) || new Date(r.item.updated).toLocaleDateString('ko-KR'))}</span></span>
          <span class="t">${highlight(r.item.title || '(제목 없음)', q)}</span>
          ${r.snippet ? `<span class="small muted">${esc(r.where)}: ${highlight(r.snippet, q)}</span>` : ''}
        </a></li>`).join('') || '<li class="muted small">찾는 기록이 없습니다.</li>'}</ul>` : '<p class="muted small">검색어를 입력하세요. 여러 단어는 모두 포함된 기록만 찾습니다.</p>'}
    </main>`;
    const inp = document.getElementById('sq');
    if (!q) inp.focus();
    document.getElementById('f-search').onsubmit = e => { e.preventDefault(); location.hash = '#/search?q=' + encodeURIComponent(inp.value.trim()); };
  }

  // ---------- 분류 관리: 카테고리 편집 · 규칙 · 일괄 이동 ----------
  function viewRules() {
    const rules = S.settings.rules.slice().sort((a, b) => a.priority - b.priority);
    const SOURCES = ['', '메모', '사진', '공유'];
    $app.innerHTML = `
    <main class="screen">
      ${topbar('분류 관리')}

      <section class="card stack" aria-label="카테고리">
        <div class="card-head"><h2>카테고리</h2><button type="button" data-act="addcat">+ 추가</button></div>
        ${cats().map((c, i) => `<div class="row between cat-row">
          <span>${esc(c.name)} <span class="tiny muted">${live().filter(x => x.catId === c.id).length}건${c.sys ? ' · 기본' : ''}</span></span>
          <span class="row gap4">
            <button type="button" class="sm" data-act="up" data-i="${i}" aria-label="${esc(c.name)} 위로" ${i === 0 ? 'disabled' : ''}>↑</button>
            <button type="button" class="sm" data-act="down" data-i="${i}" aria-label="${esc(c.name)} 아래로" ${i === cats().length - 1 ? 'disabled' : ''}>↓</button>
            <button type="button" class="sm" data-act="ren" data-id="${c.id}">이름</button>
            ${c.sys ? '' : `<button type="button" class="sm danger" data-act="delcat" data-id="${c.id}">삭제</button>`}
          </span></div>`).join('')}
        <p class="tiny muted">카테고리를 지우면 그 기록은 ‘미분류’로 옮겨집니다. 일정·할 일·미분류는 홈 화면에 쓰여 지울 수 없고 이름만 바꿀 수 있습니다.</p>
      </section>

      <section class="card stack" aria-label="자동 분류 규칙">
        <div class="card-head"><h2>자동 분류 규칙</h2></div>
        <p class="tiny muted">위 규칙부터 차례로 검사해 처음 맞는 규칙의 카테고리로 분류합니다. 맞는 규칙이 없으면 기본 단서(영수증·일정·책 등)로 분류합니다.</p>
        ${rules.map((r, i) => `<div class="rule ${r.enabled === false ? 'off' : ''}">
          <div class="tiny muted">규칙 ${i + 1}${r.enabled === false ? ' · 꺼짐' : ''}</div>
          <div>${ruleText(r)}</div>
          <div class="row gap4">
            <button type="button" class="sm" data-act="rup" data-id="${r.id}" ${i === 0 ? 'disabled' : ''}>↑</button>
            <button type="button" class="sm" data-act="rdown" data-id="${r.id}" ${i === rules.length - 1 ? 'disabled' : ''}>↓</button>
            <button type="button" class="sm" data-act="rtoggle" data-id="${r.id}">${r.enabled === false ? '켜기' : '끄기'}</button>
            <button type="button" class="sm danger" data-act="rdel" data-id="${r.id}">삭제</button>
          </div></div>`).join('') || '<p class="muted small">아직 규칙이 없습니다.</p>'}
        <details ${rules.length ? '' : 'open'}><summary>+ 새 규칙</summary>
          <form id="f-rule" class="stack">
            <label>이 단어 중 하나라도 포함(쉼표로 구분)<input id="r-words" type="text" placeholder="예: 합계, 승인번호"></label>
            <label>그리고 이 태그가 붙어 있으면(선택)<input id="r-tag" type="text" placeholder="예: 현장"></label>
            <label>그리고 입력 경로가(선택)
              <select id="r-src">${SOURCES.map(s => `<option value="${s}">${s || '상관없음'}</option>`).join('')}</select></label>
            <label>→ 이 카테고리로<select id="r-cat">${cats().map(c => `<option value="${c.id}">${esc(c.name)}</option>`).join('')}</select></label>
            <button class="primary" type="submit">규칙 추가</button>
          </form>
        </details>
        <button type="button" data-act="reapply">규칙을 기존 기록에 다시 적용</button>
        <p class="tiny muted">다시 적용은 직접 카테고리를 지정한 기록은 건드리지 않습니다.</p>
      </section>

      <section class="card stack strong" aria-label="일괄 이동">
        <h2>일괄 이동</h2>
        <label>어디에서<select id="b-from"><option value="">모든 카테고리</option>${cats().map(c => `<option value="${c.id}">${esc(c.name)}</option>`).join('')}</select></label>
        <label>이 글자가 포함된(선택)<input id="b-text" type="text" placeholder="예: 영수증"></label>
        <label>이 태그가 붙은(선택)<input id="b-tag" type="text" placeholder="예: 현장"></label>
        <p class="small" id="b-preview" aria-live="polite"></p>
        <label>이동할 곳<select id="b-to">${cats().map(c => `<option value="${c.id}">${esc(c.name)}</option>`).join('')}</select></label>
        <button class="primary" type="button" data-act="bulk">이동</button>
        <p class="tiny muted">이동 후 10초 안에 ‘되돌리기’를 누르면 원래대로 돌아갑니다.</p>
      </section>
    </main>`;

    const on = (act, fn) => $app.querySelectorAll(`[data-act="${act}"]`).forEach(b => { b.onclick = () => fn(b.dataset); });
    on('addcat', async () => {
      const n = (prompt('새 카테고리 이름') || '').trim();
      if (!n) return;
      if (cats().some(c => c.name === n)) { toast('같은 이름이 있습니다.'); return; }
      const unsorted = cats().findIndex(c => c.sys === 'unsorted');
      cats().splice(unsorted, 0, { id: uid(), name: n, sys: null });
      await saveSettings(); viewRules();
    });
    on('ren', async d => {
      const c = catById(d.id);
      const n = (prompt('새 이름', c.name) || '').trim();
      if (!n || n === c.name) return;
      if (cats().some(x => x.name === n)) { toast('같은 이름이 있습니다.'); return; }
      c.name = n; await saveSettings(); viewRules();
    });
    on('up', async d => { const i = +d.i; [cats()[i - 1], cats()[i]] = [cats()[i], cats()[i - 1]]; await saveSettings(); viewRules(); });
    on('down', async d => { const i = +d.i; [cats()[i + 1], cats()[i]] = [cats()[i], cats()[i + 1]]; await saveSettings(); viewRules(); });
    on('delcat', async d => {
      const c = catById(d.id);
      const n = S.items.filter(x => x.catId === c.id).length;
      if (!confirm(`'${c.name}'을(를) 삭제할까요? 기록 ${n}건은 미분류로 옮겨집니다.`)) return;
      const un = catBySys('unsorted').id;
      for (const it of S.items.filter(x => x.catId === c.id)) { it.catId = un; it.catBy = 'none'; await saveItem(it); }
      S.settings.rules = S.settings.rules.filter(r => r.catId !== c.id);
      S.settings.categories = cats().filter(x => x.id !== c.id);
      await saveSettings(); viewRules();
    });
    const renumber = () => S.settings.rules.sort((a, b) => a.priority - b.priority).forEach((r, i) => { r.priority = i; });
    const swapRule = async (id, dir) => {
      renumber();
      const arr = S.settings.rules; const i = arr.findIndex(r => r.id === id); const j = i + dir;
      if (j < 0 || j >= arr.length) return;
      [arr[i].priority, arr[j].priority] = [arr[j].priority, arr[i].priority];
      await saveSettings(); viewRules();
    };
    on('rup', d => swapRule(d.id, -1));
    on('rdown', d => swapRule(d.id, 1));
    on('rtoggle', async d => { const r = S.settings.rules.find(x => x.id === d.id); r.enabled = r.enabled === false; await saveSettings(); viewRules(); });
    on('rdel', async d => { if (!confirm('이 규칙을 삭제할까요?')) return; S.settings.rules = S.settings.rules.filter(x => x.id !== d.id); await saveSettings(); viewRules(); });
    document.getElementById('f-rule').onsubmit = async e => {
      e.preventDefault();
      const words = document.getElementById('r-words').value.split(',').map(s => s.trim()).filter(Boolean);
      const tag = document.getElementById('r-tag').value.trim().replace(/^#/, '');
      const source = document.getElementById('r-src').value;
      if (!words.length && !tag && !source) { toast('단어·태그·입력 경로 중 하나는 정해야 합니다.'); return; }
      renumber();
      S.settings.rules.push({ id: uid(), words, tag, source, catId: document.getElementById('r-cat').value, enabled: true, priority: S.settings.rules.length });
      await saveSettings(); toast('규칙을 추가했습니다.'); viewRules();
    };
    on('reapply', async () => {
      const targets = live().filter(i => i.catBy !== 'manual');
      const changes = [];
      for (const it of targets) {
        const copy = Object.assign({}, it);
        autoCategorize(copy);
        if (copy.catId !== it.catId) changes.push({ it, to: copy.catId, by: copy.catBy, amount: copy.amount });
      }
      if (!changes.length) { toast('바뀌는 기록이 없습니다.'); return; }
      if (!confirm(`${changes.length}건의 카테고리가 바뀝니다. 진행할까요?`)) return;
      const prev = changes.map(c => ({ id: c.it.id, catId: c.it.catId, catBy: c.it.catBy }));
      for (const c of changes) { c.it.catId = c.to; c.it.catBy = c.by; if (c.amount != null && c.it.amount == null) c.it.amount = c.amount; await saveItem(c.it); }
      toast(`${changes.length}건을 다시 분류했습니다.`, { label: '되돌리기', fn: async () => {
        for (const p of prev) { const it = S.items.find(x => x.id === p.id); it.catId = p.catId; it.catBy = p.catBy; await saveItem(it); }
        toast('되돌렸습니다.'); viewRules();
      } });
      viewRules();
    });

    // 일괄 이동 미리보기
    const pick = () => {
      const from = document.getElementById('b-from').value;
      const text = document.getElementById('b-text').value.trim().toLowerCase();
      const tag = document.getElementById('b-tag').value.trim().replace(/^#/, '').toLowerCase();
      return live().filter(i => (!from || i.catId === from)
        && (!text || Classifier.textOf(i).toLowerCase().includes(text))
        && (!tag || (i.tags || []).map(t => t.toLowerCase()).includes(tag)));
    };
    const preview = () => {
      const list = pick();
      const filtered = document.getElementById('b-from').value || document.getElementById('b-text').value.trim() || document.getElementById('b-tag').value.trim();
      document.getElementById('b-preview').innerHTML = !filtered ? '<span class="muted">조건을 하나 이상 정하세요.</span>'
        : `해당 기록 <b>${list.length}건</b>${list.length ? ': ' + list.slice(0, 3).map(i => esc(i.title || '(제목 없음)')).join(', ') + (list.length > 3 ? ' 외' : '') : ''}`;
    };
    ['b-from', 'b-text', 'b-tag'].forEach(id => { document.getElementById(id).oninput = preview; });
    preview();
    on('bulk', async () => {
      const filtered = document.getElementById('b-from').value || document.getElementById('b-text').value.trim() || document.getElementById('b-tag').value.trim();
      if (!filtered) { toast('조건을 하나 이상 정하세요.'); return; }
      const list = pick();
      const to = document.getElementById('b-to').value;
      const ids = list.filter(i => i.catId !== to).map(i => i.id);
      if (!ids.length) { toast('옮길 기록이 없습니다.'); return; }
      if (!confirm(`${ids.length}건을 '${catName(to)}'(으)로 옮길까요?`)) return;
      await bulkMove(ids, to); viewRules();
    });
  }
  function ruleText(r) {
    const parts = [];
    if (r.words && r.words.length) parts.push(`글자에 ${r.words.map(w => `<b>‘${esc(w)}’</b>`).join(' 또는 ')} 포함`);
    if (r.tag) parts.push(`태그 <b>#${esc(r.tag)}</b>`);
    if (r.source) parts.push(`입력 경로 <b>${esc(r.source)}</b>`);
    return parts.join(' 이고 ') + ` → <b class="accent">${esc(catName(r.catId))}</b>`;
  }

  // ---------- 휴지통 ----------
  function viewTrash() {
    const list = S.items.filter(i => i.deleted).sort((a, b) => b.deletedAt - a.deletedAt);
    $app.innerHTML = `
    <main class="screen">
      ${topbar('휴지통', '#/settings')}
      <p class="tiny muted">${S.settings.trashDays}일이 지나면 완전히 삭제됩니다.</p>
      <ul class="list">${list.map(i => `<li class="item row between">
        <span class="grow"><span class="t">${esc(i.title || '(제목 없음)')}</span><span class="tiny muted">${esc(catName(i.catId))} · ${new Date(i.deletedAt).toLocaleDateString('ko-KR')} 삭제</span></span>
        <span class="row gap4"><button type="button" class="sm" data-act="restore" data-id="${i.id}">복원</button>
        <button type="button" class="sm danger" data-act="purge" data-id="${i.id}">완전 삭제</button></span></li>`).join('') || '<li class="muted small">비어 있습니다.</li>'}</ul>
    </main>`;
    $app.querySelectorAll('[data-act="restore"]').forEach(b => { b.onclick = async () => { const it = S.items.find(x => x.id === b.dataset.id); it.deleted = false; await saveItem(it); viewTrash(); }; });
    $app.querySelectorAll('[data-act="purge"]').forEach(b => { b.onclick = async () => {
      if (!confirm('완전히 삭제합니다. 되돌릴 수 없습니다.')) return;
      await Vault.deleteItem(b.dataset.id); S.items = S.items.filter(x => x.id !== b.dataset.id); viewTrash();
    }; });
  }

  // ---------- 설정 ----------
  const onSettings = () => parseHash().parts[0] === 'settings';
  const reSettings = () => { if (onSettings()) viewSettings(); };
  async function viewSettings() {
    let persisted = '확인 불가', usage = '';
    try { if (navigator.storage && navigator.storage.persisted) persisted = (await navigator.storage.persisted()) ? '허용됨' : '허용 안 됨(앱을 홈 화면에 설치하면 허용될 가능성이 높습니다)'; } catch (e) {}
    try { if (navigator.storage && navigator.storage.estimate) { const e = await navigator.storage.estimate(); usage = `${(e.usage / 1048576).toFixed(1)}MB 사용`; } } catch (e) {}
    $app.innerHTML = `
    <main class="screen">
      ${topbar('설정')}
      <section class="card stack" id="gsec"><h2>구글 캘린더·할 일 연결</h2>
        ${!gOn() ? `
        <p class="small muted">구글 클라우드에서 발급받은 <b>웹 클라이언트 ID</b>를 붙여 넣으세요. 발급 방법은 안내문을 참고하세요. 클라이언트 ID는 비밀번호가 아니며, 이 폰에만 암호화되어 저장됩니다.</p>
        <form id="f-gcid" class="stack">
          <label>클라이언트 ID<input id="gcid" type="text" autocomplete="off" spellcheck="false" placeholder="123456789012-xxxx.apps.googleusercontent.com" required></label>
          <button class="primary" type="submit">저장하고 연결</button>
        </form>` : `
        <p class="small">상태: <b>${GApi.hasToken() ? '연결됨' : '연결 만료(버튼을 누르면 다시 연결)'}</b>${G().cache ? ` · 마지막 동기화 ${hm(G().cache.at)}` : ''}</p>
        <p class="tiny muted">클라이언트 ID: ${esc(G().clientId.slice(0, 12))}…</p>
        <div class="row gap8 wrap">
          <button class="primary" type="button" data-act="gconnect">${GApi.hasToken() ? '지금 동기화' : '구글 연결'}</button>
          <button type="button" data-act="glists">할 일 목록 선택</button>
        </div>
        <p class="small">할 일 목록: ${esc(G().listName || '(첫 동기화 때 기본 목록으로 지정)')}</p>
        <div id="glist-box"></div>
        <fieldset class="cals"><legend class="small"><b>홈에 표시할 캘린더</b></legend>
          ${(G().calendars || []).length ? G().calendars.map((c, i) => `<label class="row cal-row">
            <input type="checkbox" data-cal="${i}" ${c.show ? 'checked' : ''}>${dot(c.color)}<span class="grow">${esc(c.name)}</span>
            <span class="tiny muted">${c.primary ? '기본' : c.edit ? '' : '읽기 전용'}</span></label>`).join('')
            : '<p class="tiny muted">동기화하면 구글 캘린더 목록(기본·직접 만든·공유·구독 캘린더)이 여기에 나옵니다.</p>'}
        </fieldset>
        <details><summary>연결 해제·클라이언트 ID 변경</summary>
          <div class="stack">
            <p class="tiny muted">연결을 해제하면 이 앱의 구글 권한을 취소하고, 폰에 있는 구글 일정·할 일 사본을 지웁니다. 구글 캘린더의 원본은 그대로 남습니다.</p>
            <button type="button" class="danger" data-act="gdisconnect">연결 해제</button>
          </div>
        </details>
        <p class="tiny muted">보안상 구글 접속 권한(토큰)은 저장하지 않습니다. 약 1시간마다, 그리고 앱을 잠근 뒤에는 '구글 연결'을 한 번 눌러야 새로 동기화됩니다. 그 사이에도 마지막 동기화 내용은 홈에 보입니다.</p>`}
      </section>
      <section class="card stack"><h2>백업</h2>
        <p class="small muted">암호화된 상태 그대로 파일로 저장합니다. 파일만으로는 내용을 볼 수 없고, 복원할 때 비밀번호(또는 복구 코드)가 필요합니다. 구글 드라이브나 PC에 보관하세요.</p>
        <button class="primary" type="button" data-act="export">백업 파일 내보내기</button>
        <label class="file-btn">백업 파일로 복원<input type="file" id="imp" accept="application/json,.json" class="sr"></label>
      </section>
      <section class="card stack"><h2>비밀번호 변경</h2>
        <form id="f-pw" class="stack">
          <label>현재 비밀번호<input type="password" id="opw" autocomplete="current-password" required></label>
          <label>새 비밀번호 (8자 이상)<input type="password" id="npw2" autocomplete="new-password" minlength="8" required></label>
          <button type="submit">변경</button>
        </form>
        <p class="tiny muted">복구 코드는 바뀌지 않습니다.</p>
      </section>
      <section class="card stack"><h2>날씨 위치</h2>
        <p class="small">${S.settings.location ? `고정: ${esc(S.settings.location.name)}` : '폰 위치 사용(거부 시 ' + esc((CFG.defaultLocation || {}).name || '서울') + ')'}</p>
        <div class="row gap8"><button type="button" data-act="loc-seoul">서울로 고정</button><button type="button" data-act="loc-auto">폰 위치 사용</button></div>
      </section>
      <section class="card stack"><h2>저장 공간</h2>
        <p class="small">영구 저장: ${esc(persisted)}${usage ? ' · ' + esc(usage) : ''}</p>
        <a href="#/trash">휴지통 보기</a>
      </section>
      <p class="tiny muted center">나만의비서 2단계 · 암호화 AES-256-GCM, 비밀번호 열쇠 PBKDF2-SHA256 ${Vault.PBKDF2_ITER.toLocaleString()}회</p>
    </main>`;
    $app.querySelector('[data-act="export"]').onclick = async () => {
      const data = await Vault.exportBackup();
      const blob = new Blob([JSON.stringify(data)], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `나만의비서-백업-${today()}.json`;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 5000);
      toast('백업 파일을 저장했습니다.');
    };
    document.getElementById('imp').onchange = restoreFromFile;
    gPreload();
    const fc = document.getElementById('f-gcid');
    if (fc) {
      // 붙여넣기만 하면 되도록 미리 구글 도구를 불러 둠
      GApi.load().catch(() => {});
      fc.onsubmit = async e => {
        e.preventDefault();
        const v = document.getElementById('gcid').value.trim();
        if (!/^[0-9]+-[a-z0-9]+\.apps\.googleusercontent\.com$/.test(v)) {
          toast('형식이 맞지 않습니다. 숫자-문자.apps.googleusercontent.com 형태의 "클라이언트 ID"를 넣어 주세요(보안 비밀번호가 아님).'); return;
        }
        G().clientId = v; G().listId = ''; G().listName = ''; G().cache = null;
        await saveSettings();
        try { await gConnect(true); await gSync(); toast('구글과 연결했습니다.'); }
        catch (err) { toast(err.message); }
        reSettings();
      };
    }
    const gc = $app.querySelector('[data-act="gconnect"]');
    if (gc) gc.onclick = async () => {
      try {
        if (!GApi.hasToken()) await gConnect(false);
        gc.disabled = true; gc.textContent = '동기화 중…';
        if (await gSync()) toast('구글과 동기화했습니다.');
      } catch (err) { toast(err.message); }
      reSettings();
    };
    $app.querySelectorAll('[data-cal]').forEach(cb => {
      cb.onchange = async () => {
        const c = G().calendars[Number(cb.dataset.cal)];
        c.show = cb.checked; c.userSet = true;
        // 숨긴 캘린더의 사본은 바로 빼고, 새로 고른 캘린더는 동기화로 가져옴
        if (!c.show && G().cache) G().cache.events = G().cache.events.filter(e => e.cal !== c.id);
        await saveSettings();
        if (c.show) {
          try { if (!GApi.hasToken()) await gConnect(false); if (await gSync()) toast(`'${c.name}' 일정을 가져왔습니다.`); }
          catch (err) { toast(err.message); }
        }
      };
    });
    const gl = $app.querySelector('[data-act="glists"]');
    if (gl) gl.onclick = async () => {
      try {
        const ls = await gRun(() => GApi.lists());
        const box = document.getElementById('glist-box');
        box.innerHTML = `<label>목록<select id="glist">${ls.map(l => `<option value="${esc(l.id)}" ${l.id === G().listId ? 'selected' : ''}>${esc(l.title)}</option>`).join('')}</select></label>
          <button type="button" class="primary" id="glist-ok">이 목록 사용</button>`;
        document.getElementById('glist-ok').onclick = async () => {
          const sel = document.getElementById('glist');
          G().listId = sel.value; G().listName = sel.options[sel.selectedIndex].text;
          await saveSettings(); await gSync(); toast('할 일 목록을 바꿨습니다.'); reSettings();
        };
      } catch (err) { toast(err.message); }
    };
    const gd = $app.querySelector('[data-act="gdisconnect"]');
    if (gd) gd.onclick = async () => {
      if (!confirm('구글 연결을 해제할까요?')) return;
      GApi.revoke();
      S.settings.google = { clientId: '', listId: '', listName: '', cache: null };
      await saveSettings(); toast('연결을 해제했습니다.'); reSettings();
    };
    document.getElementById('f-pw').onsubmit = async e => {
      e.preventDefault();
      const n = document.getElementById('npw2').value;
      if (n.length < 8) { toast('8자 이상 입력하세요.'); return; }
      toast('변경 중…');
      toast((await Vault.changePassword(document.getElementById('opw').value, n)) ? '비밀번호를 바꿨습니다.' : '현재 비밀번호가 맞지 않습니다.');
    };
    $app.querySelector('[data-act="loc-seoul"]').onclick = async () => { S.settings.location = CFG.defaultLocation || { name: '서울', lat: 37.5665, lon: 126.978 }; S.weather = null; await saveSettings(); reSettings(); };
    $app.querySelector('[data-act="loc-auto"]').onclick = async () => { S.settings.location = null; S.weather = null; await saveSettings(); reSettings(); };
  }

  async function restoreFromFile(e) {
    const f = e.target.files[0]; if (!f) return;
    if (!confirm('이 폰의 현재 데이터를 백업 파일 내용으로 바꿉니다. 계속할까요?')) return;
    try {
      await Vault.importBackup(JSON.parse(await f.text()));
      S.items = []; S.settings = null;
      renderLock('복원했습니다. 백업 당시 비밀번호로 여세요.');
    } catch (err) { toast(err.message || '복원하지 못했습니다.'); }
  }

  start();
})();
