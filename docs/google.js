// 구글 캘린더·Tasks 연동 (Google Identity Services 토큰 모델, 서버 없음)
// - 액세스 토큰은 메모리에만 두고 저장하지 않습니다(잠그면 삭제).
// - 토큰은 약 1시간 유효합니다. 만료되면 '다시 연결' 버튼으로 새로 받습니다.
(function () {
  // 캘린더 목록 보기(읽기 전용) · 일정 보기/편집 · 할 일
  const SCOPES = ['https://www.googleapis.com/auth/calendar.calendarlist.readonly', 'https://www.googleapis.com/auth/calendar.events', 'https://www.googleapis.com/auth/tasks'];
  const CALS = 'https://www.googleapis.com/calendar/v3/calendars';
  const evUrl = cal => `${CALS}/${encodeURIComponent(cal || 'primary')}/events`;
  const TASKS = 'https://tasks.googleapis.com/tasks/v1';
  let token = null, exp = 0, loading = null;

  const ready = () => !!(window.google && google.accounts && google.accounts.oauth2);
  function load() {
    if (ready()) return Promise.resolve();
    if (loading) return loading;
    loading = new Promise((res, rej) => {
      const s = document.createElement('script');
      s.src = 'https://accounts.google.com/gsi/client';
      s.async = true;
      s.onload = () => res();
      s.onerror = () => { loading = null; s.remove(); rej(new Error('구글 로그인 도구를 불러오지 못했습니다(인터넷 연결 확인).')); };
      document.head.appendChild(s);
    });
    return loading;
  }

  // 버튼을 누른 순간 바로 호출해야 팝업이 막히지 않습니다. 그래서 도구를 미리 불러 둡니다(preload).
  function connect(clientId, consent) {
    const run = () => new Promise((res, rej) => {
      const tc = google.accounts.oauth2.initTokenClient({
        client_id: clientId,
        scope: SCOPES.join(' '),
        callback: r => {
          if (r.error) { rej(new Error(r.error === 'access_denied' ? '권한 허용이 취소되었습니다.' : '구글 연결 오류: ' + r.error)); return; }
          if (!google.accounts.oauth2.hasGrantedAllScopes(r, ...SCOPES)) {
            rej(new Error('캘린더 목록·일정·할 일 권한을 모두 체크해야 합니다. 다시 연결해 주세요.')); return;
          }
          token = r.access_token;
          exp = Date.now() + (Number(r.expires_in) || 3600) * 1000 - 60000;
          res();
        },
        error_callback: e => rej(new Error(
          e && e.type === 'popup_failed_to_open' ? '팝업이 차단되었습니다. 브라우저에서 이 사이트의 팝업을 허용해 주세요.'
            : e && e.type === 'popup_closed' ? '로그인 창이 닫혔습니다.' : '구글 연결에 실패했습니다.'))
      });
      tc.requestAccessToken({ prompt: consent ? 'consent' : '' });
    });
    return ready() ? run() : load().then(run);
  }

  const hasToken = () => !!token && Date.now() < exp;
  function clear() { token = null; exp = 0; }
  function revoke() {
    const t = token; clear();
    if (t && ready()) { try { google.accounts.oauth2.revoke(t, () => {}); } catch (e) { /* 무시 */ } }
  }

  async function api(method, url, body) {
    if (!hasToken()) { const e = new Error('구글 연결이 만료되었습니다. 다시 연결해 주세요.'); e.code = 'EXPIRED'; throw e; }
    let r;
    try {
      r = await fetch(url, {
        method,
        headers: Object.assign({ Authorization: 'Bearer ' + token }, body ? { 'Content-Type': 'application/json' } : {}),
        body: body ? JSON.stringify(body) : undefined
      });
    } catch (e) { throw new Error('구글에 연결하지 못했습니다(인터넷 연결 확인).'); }
    if (r.status === 401) { clear(); const e = new Error('구글 연결이 만료되었습니다. 다시 연결해 주세요.'); e.code = 'EXPIRED'; throw e; }
    if (r.status === 204) return null;
    let j = null;
    try { j = await r.json(); } catch (e) { /* 본문 없음 */ }
    if (!r.ok) {
      const m = j && j.error && j.error.message ? j.error.message : 'HTTP ' + r.status;
      const e = new Error(r.status === 403 ? '구글이 요청을 거부했습니다(API 사용 설정 확인): ' + m : '구글 요청 실패: ' + m);
      e.status = r.status; throw e;
    }
    return j;
  }
  const qs = o => Object.entries(o).filter(([, v]) => v != null).map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&');

  async function pages(urlBase, params, max) {
    let out = [], pageToken = null, n = 0;
    do {
      const j = await api('GET', `${urlBase}?${qs(Object.assign({}, params, { pageToken }))}`);
      out = out.concat(j.items || []);
      pageToken = j.nextPageToken; n++;
    } while (pageToken && n < (max || 3));
    return out;
  }

  window.GApi = {
    SCOPES, load, connect, hasToken, clear, revoke,
    calendars: () => pages('https://www.googleapis.com/calendar/v3/users/me/calendarList', { minAccessRole: 'reader', maxResults: 250 }, 2),
    listEvents: (cal, timeMin, timeMax) => pages(evUrl(cal), { timeMin, timeMax, singleEvents: 'true', orderBy: 'startTime', maxResults: 250 }, 4),
    insertEvent: (cal, ev) => api('POST', evUrl(cal), ev),
    patchEvent: (cal, id, ev) => api('PATCH', `${evUrl(cal)}/${encodeURIComponent(id)}`, ev),
    deleteEvent: (cal, id) => api('DELETE', `${evUrl(cal)}/${encodeURIComponent(id)}`),
    lists: async () => (await api('GET', `${TASKS}/users/@me/lists?maxResults=100`)).items || [],
    listTasks: listId => pages(`${TASKS}/lists/${encodeURIComponent(listId)}/tasks`, { showCompleted: 'true', showHidden: 'true', maxResults: 100 }, 5),
    insertTask: (listId, t) => api('POST', `${TASKS}/lists/${encodeURIComponent(listId)}/tasks`, t),
    patchTask: (listId, id, t) => api('PATCH', `${TASKS}/lists/${encodeURIComponent(listId)}/tasks/${encodeURIComponent(id)}`, t),
    deleteTask: (listId, id) => api('DELETE', `${TASKS}/lists/${encodeURIComponent(listId)}/tasks/${encodeURIComponent(id)}`)
  };
})();
