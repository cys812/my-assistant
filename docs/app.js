// 나만의비서 — 1단계 앱 (홈·기록함·카테고리 규칙·일괄 이동·통합 검색·잠금·백업)
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
  function viewHome() {
    const d = new Date();
    const wd = '일월화수목금토'[d.getDay()];
    const quote = QUOTES[dayIndex() % QUOTES.length];
    const word = WORDS[dayIndex() % WORDS.length];
    const sched = catBySys('schedule'), todo = catBySys('todo');
    const t = today();
    const todaysEvents = live().filter(i => i.catId === sched.id && (i.date || '').slice(0, 10) === t)
      .sort((a, b) => (a.date || '').localeCompare(b.date || ''));
    const todos = live().filter(i => i.catId === todo.id && (!i.done || (i.doneAt && new Date(i.doneAt).toLocaleDateString('sv-SE') === t)))
      .sort((a, b) => (a.done ? 1 : 0) - (b.done ? 1 : 0) || (a.date || '9').localeCompare(b.date || '9'));
    const doneN = todos.filter(i => i.done).length;
    const btnCats = cats().filter(c => c.sys !== 'schedule' && c.sys !== 'todo');

    $app.innerHTML = `
    <main class="screen home">
      <header class="home-head">
        <div><div class="muted small">${d.getMonth() + 1}월 ${d.getDate()}일 ${wd}요일</div><h1>나만의비서</h1></div>
        <nav class="row gap8">
          <a class="icon-btn" href="#/search" aria-label="검색">${ICON.search}</a>
          <a class="icon-btn" href="#/settings" aria-label="설정">${ICON.gear}</a>
          <button class="icon-btn" type="button" data-act="lock" aria-label="잠금">${ICON.lock}</button>
        </nav>
      </header>

      <div class="grid2">
        <section class="card weather" id="weather" aria-label="날씨">${weatherHtml()}</section>
        <section class="card" aria-label="오늘의 영단어">
          <div class="label">오늘의 영단어</div>
          <div class="word">${esc(word.w)}</div>
          <div class="muted small">${esc(word.pos)} · ${esc(word.m)}</div>
        </section>
      </div>

      <section class="card" aria-label="오늘의 명언">
        <div class="label">오늘의 명언</div>
        <p class="quote">${esc(quote.text)}</p>
        <div class="muted small">${esc(quote.by)}</div>
      </section>

      <section class="card" aria-label="오늘 일정">
        <div class="card-head"><h2>오늘 일정</h2><a class="small" href="#/new?cat=${sched.id}">+ 추가</a></div>
        ${todaysEvents.length ? todaysEvents.map(e => `
          <a class="event" href="#/item/${e.id}"><span class="time">${esc((e.date || '').length > 10 ? e.date.slice(11, 16) : '종일')}</span><span>${esc(e.title || '(제목 없음)')}</span></a>`).join('')
          : '<p class="muted small">오늘 일정이 없습니다.</p>'}
        <p class="muted tiny">구글 캘린더 연결은 2단계 업데이트에서 추가됩니다.</p>
      </section>

      <section class="card" aria-label="할 일">
        <div class="card-head"><h2>할 일</h2><span class="muted small">${todos.length ? `${doneN}/${todos.length} 완료` : ''}</span></div>
        ${todos.length ? todos.map(i => `
          <div class="todo ${i.done ? 'done' : ''}">
            <input type="checkbox" id="td-${i.id}" data-act="toggle" data-id="${i.id}" ${i.done ? 'checked' : ''}>
            <label for="td-${i.id}">${esc(i.title || '(제목 없음)')}</label>
            <a class="tiny muted" href="#/item/${i.id}">편집</a>
          </div>`).join('') : '<p class="muted small">할 일이 없습니다.</p>'}
        <form class="row gap8" id="f-quicktodo">
          <label class="sr" for="qt">새 할 일</label>
          <input id="qt" type="text" placeholder="새 할 일 입력" autocomplete="off">
          <button type="submit">추가</button>
        </form>
      </section>

      <section class="card" id="news" aria-label="주요 뉴스">${newsHtml()}</section>

      <section aria-label="카테고리">
        <h2 class="section-title">카테고리</h2>
        <div class="grid4">
          ${btnCats.map(c => `<a class="cat-btn" href="#/cat/${c.id}"><span>${esc(c.name)}</span><span class="tiny muted">${live().filter(i => i.catId === c.id).length}</span></a>`).join('')}
          <a class="cat-btn dashed" href="#/rules"><span>분류 규칙</span></a>
        </div>
      </section>

      <a class="primary big" href="#/new">+ 빠른 기록 (사진·메모)</a>
    </main>`;

    $app.querySelector('[data-act="lock"]').onclick = lockNow;
    $app.querySelectorAll('[data-act="toggle"]').forEach(el => {
      el.onchange = async () => {
        const it = S.items.find(x => x.id === el.dataset.id);
        it.done = el.checked; it.doneAt = el.checked ? Date.now() : null;
        await saveItem(it); viewHome();
      };
    });
    document.getElementById('f-quicktodo').onsubmit = async e => {
      e.preventDefault();
      const v = document.getElementById('qt').value.trim();
      if (!v) return;
      await saveItem({ id: uid(), catId: todo.id, catBy: 'manual', title: v, source: '메모', created: Date.now(), tags: [] });
      viewHome();
    };
    loadWeather(); loadNews();
  }

  // ---------- 날씨 (Open-Meteo, API 키 불필요) ----------
  const WMO = c => c === 0 ? '맑음' : c <= 2 ? '구름 조금' : c === 3 ? '흐림' : c <= 48 ? '안개' : c <= 57 ? '이슬비' : c <= 67 ? '비' : c <= 77 ? '눈' : c <= 82 ? '소나기' : c <= 86 ? '눈보라' : '뇌우';
  function weatherHtml() {
    const w = S.weather;
    if (!w) return '<div class="label light">날씨</div><div class="temp">…</div><div class="small light">불러오는 중</div>';
    if (w.error) return `<div class="label light">날씨</div><div class="small light">${esc(w.error)}</div>`;
    return `<div class="label light">날씨 · ${esc(w.place)}</div>
      <div class="temp">${Math.round(w.temp)}°</div>
      <div class="small light">${esc(WMO(w.code))} · 최고 ${Math.round(w.max)}° / 최저 ${Math.round(w.min)}°${w.pop != null ? ` · 강수 ${w.pop}%` : ''}</div>
      <div class="tiny light">Open-Meteo</div>`;
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
    } catch (e) { S.weather = { error: '날씨를 불러오지 못했습니다(인터넷 연결 확인).' }; }
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

  // ---------- 뉴스 (GitHub Actions가 만든 news.json) ----------
  function newsHtml() {
    const n = S.news;
    if (!n) return '<div class="card-head"><h2>주요 뉴스</h2></div><p class="muted small">불러오는 중…</p>';
    if (n.error) return `<div class="card-head"><h2>주요 뉴스</h2></div><p class="muted small">${esc(n.error)}</p>`;
    const upd = n.updated ? new Date(n.updated) : null;
    const block = s => !s ? '' : `
      <div class="news-src">${esc(s.label)}</div>
      ${(s.items || []).length ? `<ol class="news">${s.items.slice(0, 5).map(a => `<li><a href="${esc(a.link)}" target="_blank" rel="noopener noreferrer">${esc(a.title)}</a></li>`).join('')}</ol>`
        : `<p class="muted small">${esc(s.error || '기사가 없습니다.')}</p>`}`;
    return `<div class="card-head"><h2>주요 뉴스</h2><span class="muted small">${upd ? `${upd.getHours()}:${String(upd.getMinutes()).padStart(2, '0')} 갱신` : ''}</span></div>
      ${block(n.domestic)}<hr>${block(n.world)}`;
  }
  async function loadNews() {
    if (S.news && !S.news.error && Date.now() - S.news.at < 15 * 60000) return;
    try {
      const r = await fetch('./news.json', { cache: 'no-cache' });
      if (!r.ok) throw new Error();
      S.news = Object.assign(await r.json(), { at: Date.now() });
    } catch (e) { S.news = { error: '뉴스 파일이 아직 없습니다. 자동 수집이 처음 실행되면 표시됩니다.' }; }
    const el = document.getElementById('news');
    if (el) el.innerHTML = newsHtml();
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
        <label id="amt-wrap" ${c && c.name === '재무' ? '' : 'hidden'}>금액(원)<input id="e-amt" type="number" inputmode="numeric" value="${it.amount != null ? esc(it.amount) : ''}"></label>
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
        <div class="row gap8">
          <button class="primary grow" type="submit">저장</button>
          ${!isNew ? '<button type="button" class="danger" data-act="del">삭제</button>' : ''}
        </div>
      </form>
    </main>`;
    let newImage = it.image || null;
    document.getElementById('e-cat').onchange = e => {
      const nc = catById(e.target.value);
      document.getElementById('amt-wrap').hidden = !(nc && nc.name === '재무');
      const di = document.getElementById('e-date'), v = di.value;
      const wantDT = !!(nc && nc.sys === 'schedule');
      if (wantDT !== (di.type === 'datetime-local')) {
        di.type = wantDT ? 'datetime-local' : 'date';
        di.value = wantDT ? (v ? v.slice(0, 10) + 'T09:00' : '') : v.slice(0, 10);
      }
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
    const res = Classifier.search(S.items, q);
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
      <p class="tiny muted">제목·내용·태그·사진 속 글자·녹취록에서 찾습니다.</p>
      <ul class="list">${shown.map(r => `
        <li><a class="result" href="#/item/${r.item.id}">
          <span class="row between"><span class="tag">${esc(catName(r.item.catId))}</span><span class="tiny muted">${esc(fmtDate(r.item.date) || new Date(r.item.updated).toLocaleDateString('ko-KR'))}</span></span>
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
  async function viewSettings() {
    let persisted = '확인 불가', usage = '';
    try { if (navigator.storage && navigator.storage.persisted) persisted = (await navigator.storage.persisted()) ? '허용됨' : '허용 안 됨(앱을 홈 화면에 설치하면 허용될 가능성이 높습니다)'; } catch (e) {}
    try { if (navigator.storage && navigator.storage.estimate) { const e = await navigator.storage.estimate(); usage = `${(e.usage / 1048576).toFixed(1)}MB 사용`; } } catch (e) {}
    $app.innerHTML = `
    <main class="screen">
      ${topbar('설정')}
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
      <p class="tiny muted center">나만의비서 1단계 · 암호화 AES-256-GCM, 비밀번호 열쇠 PBKDF2-SHA256 ${Vault.PBKDF2_ITER.toLocaleString()}회</p>
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
    document.getElementById('f-pw').onsubmit = async e => {
      e.preventDefault();
      const n = document.getElementById('npw2').value;
      if (n.length < 8) { toast('8자 이상 입력하세요.'); return; }
      toast('변경 중…');
      toast((await Vault.changePassword(document.getElementById('opw').value, n)) ? '비밀번호를 바꿨습니다.' : '현재 비밀번호가 맞지 않습니다.');
    };
    $app.querySelector('[data-act="loc-seoul"]').onclick = async () => { S.settings.location = CFG.defaultLocation || { name: '서울', lat: 37.5665, lon: 126.978 }; S.weather = null; await saveSettings(); viewSettings(); };
    $app.querySelector('[data-act="loc-auto"]').onclick = async () => { S.settings.location = null; S.weather = null; await saveSettings(); viewSettings(); };
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
