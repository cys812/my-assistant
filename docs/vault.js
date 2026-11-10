// 암호화 저장소: Web Crypto(AES-256-GCM) + IndexedDB
// - 마스터 열쇠(무작위 256비트)로 모든 기록을 암호화합니다.
// - 마스터 열쇠는 '비밀번호용'과 '복구 코드용' 두 자물쇠로 각각 감싸 저장합니다.
// - 비밀번호 → 열쇠 변환: PBKDF2-HMAC-SHA256 600,000회 (OWASP 권고치)
(function () {
  const PBKDF2_ITER = 600000;
  const DB_NAME = 'life-assistant';
  const DB_VER = 1;
  const te = new TextEncoder();
  const td = new TextDecoder();

  // ---------- IndexedDB ----------
  let dbp = null;
  function db() {
    if (!dbp) {
      dbp = new Promise((res, rej) => {
        const r = indexedDB.open(DB_NAME, DB_VER);
        r.onupgradeneeded = () => {
          const d = r.result;
          if (!d.objectStoreNames.contains('kv')) d.createObjectStore('kv');
          if (!d.objectStoreNames.contains('items')) d.createObjectStore('items', { keyPath: 'id' });
          if (!d.objectStoreNames.contains('inbox')) d.createObjectStore('inbox', { keyPath: 'id', autoIncrement: true });
        };
        r.onsuccess = () => res(r.result);
        r.onerror = () => rej(r.error);
      });
    }
    return dbp;
  }
  function tx(store, mode, fn) {
    return db().then(d => new Promise((res, rej) => {
      const t = d.transaction(store, mode);
      const s = t.objectStore(store);
      let out;
      Promise.resolve(fn(s)).then(v => { out = v; });
      t.oncomplete = () => res(out);
      t.onerror = () => rej(t.error);
      t.onabort = () => rej(t.error);
    }));
  }
  const req = r => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
  const kvGet = k => tx('kv', 'readonly', s => req(s.get(k)));
  const kvSet = (k, v) => tx('kv', 'readwrite', s => { s.put(v, k); });

  // ---------- 인코딩 ----------
  function toB64(buf) {
    const bytes = new Uint8Array(buf);
    let s = '';
    for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return btoa(s);
  }
  function fromB64(b64) {
    const s = atob(b64);
    const out = new Uint8Array(s.length);
    for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
    return out;
  }
  const rand = n => crypto.getRandomValues(new Uint8Array(n));

  // ---------- 열쇠 ----------
  async function deriveWrapKey(secret, salt) {
    const base = await crypto.subtle.importKey('raw', te.encode(secret), 'PBKDF2', false, ['deriveKey']);
    return crypto.subtle.deriveKey(
      { name: 'PBKDF2', hash: 'SHA-256', salt, iterations: PBKDF2_ITER },
      base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  }
  async function wrapRaw(raw, secret) {
    const salt = rand(16), iv = rand(12);
    const k = await deriveWrapKey(secret, salt);
    const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, k, raw);
    return { salt: toB64(salt), iv: toB64(iv), ct: toB64(ct), iter: PBKDF2_ITER };
  }
  async function unwrapRaw(w, secret) {
    const k = await deriveWrapKey(secret, fromB64(w.salt));
    return crypto.subtle.decrypt({ name: 'AES-GCM', iv: fromB64(w.iv) }, k, fromB64(w.ct));
  }
  const importMaster = raw => crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt']);

  function makeRecoveryCode() {
    // 혼동되는 글자(0/O, 1/I/L)를 뺀 32자에서 20자 → 약 100비트
    const abc = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
    const b = rand(20);
    let s = '';
    for (let i = 0; i < 20; i++) s += abc[b[i] % abc.length];
    return s.match(/.{1,5}/g).join('-');
  }
  const normCode = c => String(c || '').toUpperCase().replace(/[^A-Z0-9]/g, '').match(/.{1,5}/g)?.join('-') || '';

  // ---------- 금고 ----------
  let master = null;

  async function isSetUp() { return !!(await kvGet('vault')); }

  async function setup(password) {
    const raw = rand(32);
    const code = makeRecoveryCode();
    const vault = { v: 1, pw: await wrapRaw(raw, password), rc: await wrapRaw(raw, code), created: Date.now() };
    await kvSet('vault', vault);
    master = await importMaster(raw);
    return code;
  }

  async function unlock(password) {
    const v = await kvGet('vault');
    try { master = await importMaster(await unwrapRaw(v.pw, password)); return true; }
    catch (e) { return false; }
  }

  async function unlockWithRecovery(code, newPassword) {
    const v = await kvGet('vault');
    let raw;
    try { raw = await unwrapRaw(v.rc, normCode(code)); } catch (e) { return false; }
    v.pw = await wrapRaw(raw, newPassword);
    await kvSet('vault', v);
    master = await importMaster(raw);
    return true;
  }

  async function changePassword(oldPw, newPw) {
    const v = await kvGet('vault');
    let raw;
    try { raw = await unwrapRaw(v.pw, oldPw); } catch (e) { return false; }
    v.pw = await wrapRaw(raw, newPw);
    await kvSet('vault', v);
    return true;
  }

  function lock() { master = null; }
  const isUnlocked = () => !!master;

  async function encObj(obj) {
    const iv = rand(12);
    const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, master, te.encode(JSON.stringify(obj)));
    return { iv: toB64(iv), ct: toB64(ct) };
  }
  async function decObj(rec) {
    const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: fromB64(rec.iv) }, master, fromB64(rec.ct));
    return JSON.parse(td.decode(pt));
  }

  // 설정(카테고리·규칙 등)은 암호화된 레코드 하나로 저장
  async function loadSettings() {
    const rec = await kvGet('settings');
    return rec ? decObj(rec) : null;
  }
  async function saveSettings(obj) { await kvSet('settings', await encObj(obj)); }

  async function loadItems() {
    const recs = await tx('items', 'readonly', s => req(s.getAll()));
    const out = [];
    for (const r of recs) out.push(Object.assign(await decObj(r), { id: r.id }));
    return out;
  }
  async function saveItem(item) {
    const rec = Object.assign({ id: item.id }, await encObj(item));
    await tx('items', 'readwrite', s => { s.put(rec); });
  }
  async function deleteItem(id) { await tx('items', 'readwrite', s => { s.delete(id); }); }

  // 공유 시트로 들어온 파일(서비스 워커가 잠금 해제 전에 임시 보관)
  const inboxAll = () => tx('inbox', 'readonly', s => req(s.getAll()));
  const inboxClear = () => tx('inbox', 'readwrite', s => { s.clear(); });

  // 백업: 금고(감싼 열쇠) + 암호화된 레코드를 그대로 내보냄 → 파일만으로는 내용 확인 불가
  async function exportBackup() {
    const vault = await kvGet('vault');
    const settings = await kvGet('settings');
    const items = await tx('items', 'readonly', s => req(s.getAll()));
    return { app: 'life-assistant', format: 1, exported: new Date().toISOString(), vault, settings, items };
  }
  async function importBackup(data) {
    if (!data || data.app !== 'life-assistant' || !data.vault) throw new Error('이 앱의 백업 파일이 아닙니다.');
    await kvSet('vault', data.vault);
    if (data.settings) await kvSet('settings', data.settings);
    await tx('items', 'readwrite', s => { s.clear(); data.items.forEach(r => s.put(r)); });
    lock();
  }

  window.Vault = {
    isSetUp, setup, unlock, unlockWithRecovery, changePassword, lock, isUnlocked,
    loadSettings, saveSettings, loadItems, saveItem, deleteItem,
    inboxAll, inboxClear, exportBackup, importBackup, normCode, PBKDF2_ITER
  };
})();
