import { createClient } from '@supabase/supabase-js';

(() => {
  const $ = (selector) => document.querySelector(selector);
  const els = {
    grid: $('#notesGrid'), search: $('#searchInput'), sort: $('#sortSelect'), count: $('#noteCount'),
    results: $('#resultsSummary'), clearSearch: $('#clearSearch'), clearFilters: $('#clearFilters'),
    empty: $('#emptyState'), emptyTitle: $('#emptyTitle'), emptyMessage: $('#emptyMessage'), emptyAction: $('#emptyAction'),
    backdrop: $('#editorBackdrop'), title: $('#titleInput'), body: $('#bodyInput'), editorDate: $('#editorDate'),
    deleteButton: $('#deleteNoteButton'), status: $('#saveStatus'), toast: $('#toast'),
    heading: $('#heading'), viewLabel: $('#viewLabel'), app: $('#appShell'), authScreen: $('#authScreen'),
    authForm: $('#authForm'), authEmail: $('#authEmail'), authPassword: $('#authPassword'),
    authHeading: $('#authHeading'), authDescription: $('#authDescription'), authError: $('#authError'),
    authSubmit: $('#authSubmit'), authSwitchText: $('#authSwitchText'), authModeButton: $('#authModeButton'),
    loggedInName: $('#loggedInName')
  };
  const config = import.meta.env.VITE_SUPABASE_URL && import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY
    ? { url: import.meta.env.VITE_SUPABASE_URL, publishableKey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY }
    : window.MOA_SUPABASE_CONFIG || {};
  const supabase = config.url && config.publishableKey ? createClient(config.url, config.publishableKey, {
    auth: { autoRefreshToken: true, persistSession: true, detectSessionInUrl: true }
  }) : null;
  let notes = [];
  let activeId = null;
  let currentUser = null;
  let favoritesOnly = false;
  let toastTimer;
  let serverReady = false;
  let syncBusy = false;
  let authMode = 'login';

  function makeId() { return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`; }
  function setStatus(message) { els.status.innerHTML = `<i></i> ${escapeHtml(message)}`; }
  function normalize(value) { return String(value || '').normalize('NFKC').toLocaleLowerCase('ko-KR'); }
  function dateLabel(iso) {
    const date = new Date(iso); const today = new Date();
    return date.toDateString() === today.toDateString()
      ? `오늘 · ${new Intl.DateTimeFormat('ko-KR', { hour: 'numeric', minute: '2-digit' }).format(date)}`
      : new Intl.DateTimeFormat('ko-KR', { month: 'short', day: 'numeric' }).format(date);
  }
  function escapeHtml(value) { return String(value).replace(/[&<>"']/g, (char) => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[char])); }
  function highlight(value, query) {
    const source = String(value); const needle = normalize(query);
    if (!needle) return escapeHtml(source);
    let folded = ''; const starts = []; const ends = [];
    for (let offset = 0; offset < source.length;) {
      const point = String.fromCodePoint(source.codePointAt(offset)); const normalized = normalize(point);
      for (let i = 0; i < normalized.length; i++) { starts.push(offset); ends.push(offset + point.length); }
      folded += normalized; offset += point.length;
    }
    let sourceCursor = 0; let foldedCursor = 0; let result = ''; let at;
    while ((at = folded.indexOf(needle, foldedCursor)) !== -1) {
      const sourceStart = starts[at]; const sourceEnd = ends[at + needle.length - 1];
      if (sourceStart < sourceCursor) { foldedCursor = at + 1; continue; }
      result += escapeHtml(source.slice(sourceCursor, sourceStart)) + `<mark>${escapeHtml(source.slice(sourceStart, sourceEnd))}</mark>`;
      sourceCursor = sourceEnd; foldedCursor = at + needle.length;
    }
    return result + escapeHtml(source.slice(sourceCursor));
  }
  function getVisibleNotes() {
    const query = normalize(els.search.value.trim());
    let result = notes.filter((note) => !favoritesOnly || note.favorite);
    if (query) result = result.filter((note) => normalize(`${note.title}\n${note.body}`).includes(query));
    const sort = els.sort.value;
    return result.sort((a, b) => sort === 'title' ? a.title.localeCompare(b.title, 'ko') : sort === 'created' ? new Date(b.createdAt) - new Date(a.createdAt) : new Date(b.updatedAt) - new Date(a.updatedAt));
  }
  function render() {
    const query = els.search.value.trim(); const visible = getVisibleNotes();
    els.count.textContent = String(notes.length);
    els.grid.innerHTML = visible.map((note, index) => `
      <article class="note-card" data-id="${escapeHtml(note.id)}" style="animation-delay:${Math.min(index * 35, 210)}ms" tabindex="0" aria-label="${escapeHtml(note.title || '제목 없는 노트')} 열기">
        <div class="note-card-top"><time class="note-date">${escapeHtml(dateLabel(note.updatedAt))}</time><button class="favorite-button ${note.favorite ? 'is-favorite' : ''}" data-favorite="${escapeHtml(note.id)}" aria-label="${note.favorite ? '즐겨찾기 해제' : '즐겨찾기 추가'}">${note.favorite ? '♥' : '♡'}</button></div>
        <h2>${highlight(note.title || '제목 없는 노트', query)}</h2><p>${highlight(note.body || '내용이 비어 있어요.', query)}</p>
        <div class="note-card-bottom"><span class="note-lines"><i></i><i></i><i></i></span><span class="card-open">열어서 편집 ↗</span></div>
      </article>`).join('');
    els.results.textContent = query ? `“${query}” 검색 결과 ${visible.length}개` : `${visible.length}개의 노트`;
    els.clearSearch.hidden = !query; els.clearFilters.hidden = !query && !favoritesOnly;
    els.empty.hidden = visible.length > 0; els.grid.hidden = visible.length === 0;
    if (!visible.length) {
      const searching = Boolean(query);
      els.emptyTitle.textContent = searching ? '검색 결과가 없어요' : favoritesOnly ? '즐겨찾기한 노트가 없어요' : '아직 노트가 없어요';
      els.emptyMessage.textContent = searching ? '다른 단어로 검색해 보세요.' : favoritesOnly ? '마음에 드는 노트의 하트를 눌러 담아 보세요.' : '첫 번째 생각을 기록해 보세요.';
      els.emptyAction.hidden = searching || favoritesOnly;
    }
  }
  function openEditor(id = null) {
    activeId = id; const note = notes.find((item) => item.id === id);
    els.title.value = note?.title || ''; els.body.value = note?.body || '';
    els.editorDate.textContent = note ? `마지막 수정 ${dateLabel(note.updatedAt)}` : '새 노트';
    els.deleteButton.hidden = !note; els.backdrop.hidden = false; document.body.style.overflow = 'hidden';
    setTimeout(() => els.title.focus(), 30);
  }
  function closeEditor() { els.backdrop.hidden = true; document.body.style.overflow = ''; activeId = null; }
  async function saveEditor() {
    if (!serverReady || !currentUser) { showToast('로그인이 필요합니다.'); return; }
    const title = els.title.value.trim(); const body = els.body.value.trim();
    if (!title && !body) { closeEditor(); return; }
    const now = new Date().toISOString(); const previous = notes; const old = notes.find((item) => item.id === activeId);
    const note = old ? { ...old, title, body, updatedAt: now } : { id: makeId(), title, body, createdAt: now, updatedAt: now, favorite: false };
    notes = old ? notes.map((item) => item.id === activeId ? note : item) : [note, ...notes];
    render(); setStatus('저장 중'); syncBusy = true;
    const { error } = await supabase.from('notes').upsert({
      id: note.id, user_id: currentUser.id, title: note.title, body: note.body,
      created_at: note.createdAt, updated_at: note.updatedAt, favorite: note.favorite
    }, { onConflict: 'user_id,id' });
    syncBusy = false;
    if (error) { notes = previous; render(); setStatus('저장 실패'); showToast(`저장하지 못했어요: ${error.message}`); return; }
    closeEditor(); render(); setStatus('모든 기기에 동기화'); showToast('노트를 저장했어요');
  }
  async function deleteCurrent() {
    if (!activeId || !currentUser) return;
    const id = activeId; const previous = notes; notes = notes.filter((item) => item.id !== id); render(); syncBusy = true;
    const { error } = await supabase.from('notes').delete().eq('id', id).eq('user_id', currentUser.id);
    syncBusy = false;
    if (error) { notes = previous; render(); showToast(`삭제하지 못했어요: ${error.message}`); return; }
    closeEditor(); render(); showToast('노트를 삭제했어요');
  }
  async function toggleFavorite(id) {
    if (!currentUser || !serverReady) return;
    const previous = notes; const note = notes.find((item) => item.id === id); if (!note) return;
    const updated = { ...note, favorite: !note.favorite, updatedAt: new Date().toISOString() };
    notes = notes.map((item) => item.id === id ? updated : item); render(); syncBusy = true;
    const { error } = await supabase.from('notes').update({ favorite: updated.favorite, updated_at: updated.updatedAt }).eq('id', id).eq('user_id', currentUser.id);
    syncBusy = false;
    if (error) { notes = previous; render(); showToast('즐겨찾기를 저장하지 못했어요.'); return; }
    setStatus('모든 기기에 동기화');
  }
  function showToast(message) {
    els.toast.textContent = message; els.toast.classList.add('visible'); clearTimeout(toastTimer);
    toastTimer = setTimeout(() => els.toast.classList.remove('visible'), 2600);
  }
  function setView(favorites) {
    favoritesOnly = favorites; $('#allNotesButton').classList.toggle('active', !favorites); $('#favoritesButton').classList.toggle('active', favorites);
    els.heading.innerHTML = `${favorites ? '즐겨찾기' : '모든 노트'}<span class="heading-period">.</span>`;
    els.viewLabel.textContent = favorites ? '즐겨찾기' : '모든 노트'; render();
  }
  function setAuthMode(mode) {
    authMode = mode; const registering = mode === 'register';
    els.authHeading.innerHTML = registering ? '모아를 시작해요<span>.</span>' : '다시 반가워요<span>.</span>';
    els.authDescription.textContent = registering ? '계정을 만들면 여러 기기에서 나만의 노트를 이어 쓸 수 있어요.' : '로그인하고 어디서든 내 노트를 이어서 살펴보세요.';
    els.authSubmit.textContent = registering ? '계정 만들기' : '로그인';
    els.authSwitchText.textContent = registering ? '이미 계정이 있으신가요?' : '아직 계정이 없으신가요?';
    els.authModeButton.textContent = registering ? '로그인' : '회원가입';
    els.authPassword.autocomplete = registering ? 'new-password' : 'current-password'; els.authError.hidden = true;
  }
  function showAuthScreen(message = '') {
    currentUser = null; serverReady = false; notes = []; render();
    if (!els.backdrop.hidden) closeEditor();
    els.app.hidden = true; els.authScreen.hidden = false;
    els.authError.textContent = message; els.authError.hidden = !message;
  }
  function showApp(user) {
    currentUser = user; serverReady = true; els.authScreen.hidden = true; els.app.hidden = false;
    els.loggedInName.textContent = user.email || ''; setStatus('모든 기기에 동기화');
  }
  function readableAuthError(error) {
    if (/invalid login credentials/i.test(error.message)) return '이메일 또는 비밀번호를 확인해 주세요.';
    if (/user already registered/i.test(error.message)) return '이미 가입된 이메일이에요. 로그인해 주세요.';
    if (/password should be at least/i.test(error.message)) return '비밀번호를 6자 이상 입력해 주세요.';
    return error.message || '요청을 처리하지 못했어요.';
  }
  async function loadAccountNotes() {
    const { data, error } = await supabase.from('notes').select('id,title,body,created_at,updated_at,favorite').order('updated_at', { ascending: false });
    if (error) throw error;
    notes = (data || []).map((row) => ({ id: row.id, title: row.title, body: row.body, createdAt: row.created_at, updatedAt: row.updated_at, favorite: row.favorite }));
    serverReady = true; render();
  }
  async function connectToServer() {
    if (!supabase) { showAuthScreen('supabase-config.js에 Supabase 프로젝트 URL과 publishable key를 입력해 주세요.'); return; }
    try {
      const { data: { session }, error } = await supabase.auth.getSession();
      if (error) throw error;
      if (!session) { showAuthScreen(); return; }
      currentUser = session.user; await loadAccountNotes(); showApp(session.user);
    } catch (error) { showAuthScreen(`Supabase 연결에 실패했어요: ${readableAuthError(error)}`); }
  }
  async function refreshFromServer() {
    if (!supabase || !serverReady || syncBusy || activeId || !currentUser) return;
    try {
      const { data, error } = await supabase.from('notes').select('id,title,body,created_at,updated_at,favorite').order('updated_at', { ascending: false });
      if (error) throw error;
      const remoteNotes = (data || []).map((row) => ({ id: row.id, title: row.title, body: row.body, createdAt: row.created_at, updatedAt: row.updated_at, favorite: row.favorite }));
      if (JSON.stringify(remoteNotes) !== JSON.stringify(notes)) { notes = remoteNotes; render(); }
      setStatus('모든 기기에 동기화');
    } catch (error) { setStatus('동기화에 실패했어요'); console.error(error); }
  }

  $('#newNoteButton').addEventListener('click', () => openEditor());
  els.emptyAction.addEventListener('click', () => openEditor());
  $('#closeEditor').addEventListener('click', closeEditor);
  $('#doneButton').addEventListener('click', saveEditor);
  els.deleteButton.addEventListener('click', deleteCurrent);
  els.backdrop.addEventListener('click', (event) => { if (event.target === els.backdrop) closeEditor(); });
  els.grid.addEventListener('click', (event) => {
    const favorite = event.target.closest('[data-favorite]');
    if (favorite) { event.stopPropagation(); toggleFavorite(favorite.dataset.favorite); return; }
    const card = event.target.closest('.note-card'); if (card) openEditor(card.dataset.id);
  });
  els.grid.addEventListener('keydown', (event) => { if ((event.key === 'Enter' || event.key === ' ') && event.target.matches('.note-card')) { event.preventDefault(); openEditor(event.target.dataset.id); } });
  els.search.addEventListener('input', render);
  els.clearSearch.addEventListener('click', () => { els.search.value = ''; render(); els.search.focus(); });
  els.clearFilters.addEventListener('click', () => { els.search.value = ''; if (favoritesOnly) setView(false); else render(); els.search.focus(); });
  els.sort.addEventListener('change', render);
  $('#allNotesButton').addEventListener('click', () => setView(false));
  $('#favoritesButton').addEventListener('click', () => setView(true));
  els.authModeButton.addEventListener('click', () => setAuthMode(authMode === 'login' ? 'register' : 'login'));
  els.authForm.addEventListener('submit', async (event) => {
    event.preventDefault(); els.authError.hidden = true;
    if (!supabase) { els.authError.textContent = '먼저 supabase-config.js를 설정해 주세요.'; els.authError.hidden = false; return; }
    els.authSubmit.disabled = true; els.authSubmit.textContent = authMode === 'register' ? '계정 만드는 중…' : '로그인 중…';
    try {
      const credentials = { email: els.authEmail.value.trim(), password: els.authPassword.value };
      const { data, error } = authMode === 'register' ? await supabase.auth.signUp(credentials) : await supabase.auth.signInWithPassword(credentials);
      if (error) throw error;
      els.authPassword.value = '';
      if (!data.session) { showAuthScreen('가입 확인 메일을 보냈어요. 이메일 인증을 완료한 뒤 로그인해 주세요.'); return; }
      currentUser = data.user; await loadAccountNotes(); showApp(data.user);
    } catch (error) { showAuthScreen(readableAuthError(error)); }
    finally { els.authSubmit.disabled = false; els.authSubmit.textContent = authMode === 'register' ? '계정 만들기' : '로그인'; }
  });
  $('#logoutButton').addEventListener('click', async () => {
    if (supabase) await supabase.auth.signOut();
    els.authPassword.value = ''; showAuthScreen(); setAuthMode('login');
  });
  $('#themeButton').addEventListener('click', () => {
    document.body.classList.toggle('dark');
    try { localStorage.setItem('moa-dark', document.body.classList.contains('dark') ? '1' : '0'); } catch { /* Theme still works for this visit. */ }
  });
  document.addEventListener('keydown', (event) => {
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k' && !els.app.hidden) { event.preventDefault(); els.search.focus(); }
    if (event.key === 'Escape' && !els.backdrop.hidden) closeEditor();
    if ((event.metaKey || event.ctrlKey) && event.key === 'Enter' && !els.backdrop.hidden) saveEditor();
  });
  if (supabase) supabase.auth.onAuthStateChange((event, session) => {
    if (event === 'SIGNED_OUT' && currentUser) showAuthScreen();
    else if (event === 'TOKEN_REFRESHED' && !session) showAuthScreen('로그인이 만료됐어요. 다시 로그인해 주세요.');
  });
  try { if (localStorage.getItem('moa-dark') === '1') document.body.classList.add('dark'); } catch { /* Use the light theme when storage is unavailable. */ }
  render(); connectToServer(); window.setInterval(refreshFromServer, 5000);
})();
