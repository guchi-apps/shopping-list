'use strict';

const CATEGORIES = ['食品', '消耗品', '日用品', '趣味', 'その他'];
const PRIORITIES = ['高', '中', '低'];
const PRIORITY_CLASS = { 高: 'high', 中: 'mid', 低: 'low' };

const state = {
  items: [],
  filter: 'all',
  sort: 'added',
  loading: true,
  error: null,
  addDraft: { name: '', memo: '', category: '食品', priority: null },
  editId: null,
  editDraft: { name: '', memo: '', category: '食品', priority: null },
};

const el = {
  loginScreen: document.getElementById('loginScreen'),
  loginButton: document.getElementById('loginButton'),
  loginError: document.getElementById('loginError'),
  appRoot: document.getElementById('appRoot'),
  profileWrap: document.getElementById('profileWrap'),
  profileButton: document.getElementById('profileButton'),
  profileMenu: document.getElementById('profileMenu'),
  profileEmail: document.getElementById('profileEmail'),
  logoutButton: document.getElementById('logoutButton'),
  filterTabs: document.getElementById('filterTabs'),
  sortToggle: document.getElementById('sortToggle'),
  list: document.getElementById('list'),
  fabAdd: document.getElementById('fabAdd'),
  addOverlay: document.getElementById('addOverlay'),
  addName: document.getElementById('addName'),
  addMemo: document.getElementById('addMemo'),
  addCategoryChips: document.getElementById('addCategoryChips'),
  addPriorityChips: document.getElementById('addPriorityChips'),
  addSubmit: document.getElementById('addSubmit'),
  addClose: document.getElementById('addClose'),
  editOverlay: document.getElementById('editOverlay'),
  editName: document.getElementById('editName'),
  editMemo: document.getElementById('editMemo'),
  editCategoryChips: document.getElementById('editCategoryChips'),
  editPriorityChips: document.getElementById('editPriorityChips'),
  editSave: document.getElementById('editSave'),
  editDelete: document.getElementById('editDelete'),
  editClose: document.getElementById('editClose'),
  toast: document.getElementById('toast'),
  versionBadge: document.getElementById('versionBadge'),
  changelogOverlay: document.getElementById('changelogOverlay'),
  changelogList: document.getElementById('changelogList'),
  changelogClose: document.getElementById('changelogClose'),
  confirmOverlay: document.getElementById('confirmOverlay'),
  confirmMessage: document.getElementById('confirmMessage'),
  confirmCancel: document.getElementById('confirmCancel'),
  confirmOk: document.getElementById('confirmOk'),
};

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

// ---- API ----
async function apiRequest(path, options) {
  const headers = {
    'Content-Type': 'application/json',
    ...(await ShoppingListAuth.authHeaders()),
  };
  const res = await fetch(path, { headers, ...options });
  if (!res.ok) {
    let message = `リクエストに失敗しました (${res.status})`;
    try {
      const body = await res.json();
      if (body.error) message = body.error;
    } catch {
      // ignore
    }
    const err = new Error(message);
    err.status = res.status;
    throw err;
  }
  if (res.status === 204) return null;
  return res.json();
}

const fetchItems = () => apiRequest('api/items').then((d) => d.items);
const createItemApi = (input) =>
  apiRequest('api/items', { method: 'POST', body: JSON.stringify(input) }).then((d) => d.item);
const updateItemApi = (id, input) =>
  apiRequest(`api/items/${id}`, { method: 'PATCH', body: JSON.stringify(input) }).then((d) => d.item);
const deleteItemApi = (id) => apiRequest(`api/items/${id}`, { method: 'DELETE' });

// ---- auth screens ----
// 画面の出し分け（showLogin/showApp）とエラーメッセージ表示（setLoginError）は分離する。
// onAuthStateChangeはsubscribe直後の初回発火やsignOut()呼び出しのたびに再度発火するため、
// ここで画面切り替えのついでにメッセージまで毎回リセットすると、直前にセットした
// エラー内容（403の理由など）が即座に空で上書きされてしまう。
function showLogin() {
  el.appRoot.hidden = true;
  el.profileWrap.hidden = true;
  closeProfileMenu();
  el.loginScreen.hidden = false;
}

function showApp(session) {
  el.loginScreen.hidden = true;
  el.loginError.hidden = true;
  el.appRoot.hidden = false;
  el.profileWrap.hidden = false;
  el.profileEmail.textContent = session?.user?.email || '';
}

// ---- profile menu ----
function openProfileMenu() {
  el.profileMenu.hidden = false;
  el.profileButton.setAttribute('aria-expanded', 'true');
}
function closeProfileMenu() {
  el.profileMenu.hidden = true;
  el.profileButton.setAttribute('aria-expanded', 'false');
}
function toggleProfileMenu() {
  if (el.profileMenu.hidden) openProfileMenu();
  else closeProfileMenu();
}

function setLoginError(message) {
  if (message) {
    el.loginError.textContent = message;
    el.loginError.hidden = false;
  } else {
    el.loginError.hidden = true;
  }
}

function consumeAuthErrorParam() {
  const params = new URLSearchParams(window.location.search);
  if (params.get('authError') !== 'forbidden') return null;
  history.replaceState({}, '', window.location.pathname);
  return 'ログインに失敗しました。もう一度お試しください。';
}

// ---- toast ----
let toastTimer;
function showToast(message) {
  el.toast.textContent = message;
  el.toast.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.toast.hidden = true; }, 2500);
}

// ---- confirm dialog ----
let confirmResolve = null;
function confirmDialog(message) {
  el.confirmMessage.textContent = message;
  el.confirmOverlay.hidden = false;
  return new Promise((resolve) => { confirmResolve = resolve; });
}
function closeConfirmDialog(result) {
  el.confirmOverlay.hidden = true;
  if (confirmResolve) {
    const resolve = confirmResolve;
    confirmResolve = null;
    resolve(result);
  }
}

// ---- sorting ----
function sortItems(items) {
  const arr = [...items];
  if (state.sort === 'name') {
    arr.sort((a, b) => a.name.localeCompare(b.name, 'ja'));
  }
  arr.sort((a, b) => (a.bought === b.bought ? 0 : a.bought ? 1 : -1));
  return arr;
}

// ---- rendering: header controls ----
function renderFilterTabs() {
  const counts = { all: state.items.length };
  for (const c of CATEGORIES) counts[c] = state.items.filter((it) => it.category === c).length;
  const tabs = [['all', 'すべて'], ...CATEGORIES.map((c) => [c, c])];
  el.filterTabs.innerHTML = '';
  for (const [key, label] of tabs) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'tab-pill' + (state.filter === key ? ' active' : '');
    btn.textContent = `${label} ${counts[key] ?? 0}`;
    btn.addEventListener('click', () => { state.filter = key; render(); });
    el.filterTabs.appendChild(btn);
  }
}

function renderSortToggle() {
  el.sortToggle.textContent = `並び替え：${state.sort === 'added' ? '追加順' : '名前順'}`;
}

// ---- rendering: list ----
function priorityDotHtml(priority) {
  if (!priority) return '';
  const cls = PRIORITY_CLASS[priority];
  if (!cls) return '';
  return `<span class="priority-dot ${cls}" title="優先度: ${priority}"></span>`;
}

function renderItemRow(item) {
  const row = document.createElement('div');
  row.className = 'item-row';
  row.innerHTML = `
    <div class="item-check ${item.bought ? 'checked' : ''}">${item.bought ? '✓' : ''}</div>
    ${priorityDotHtml(item.priority)}
    <div class="item-main">
      <div class="item-name ${item.bought ? 'bought' : ''}"></div>
      ${item.memo ? '<div class="item-memo"></div>' : ''}
    </div>
  `;
  row.querySelector('.item-name').textContent = item.name;
  if (item.memo) row.querySelector('.item-memo').textContent = item.memo;
  row.querySelector('.item-check').addEventListener('click', (e) => {
    e.stopPropagation();
    toggleBought(item);
  });
  row.addEventListener('click', () => openEdit(item.id));
  return row;
}

function renderList() {
  el.list.innerHTML = '';

  if (state.loading) {
    el.list.innerHTML = '<div class="state-message">読み込み中…</div>';
    return;
  }
  if (state.error) {
    el.list.innerHTML = `<div class="state-message">${escapeHtml(state.error)}</div>`;
    return;
  }

  const groups = state.filter === 'all' ? CATEGORIES : [state.filter];

  for (const category of groups) {
    const items = sortItems(state.items.filter((it) => it.category === category));
    const section = document.createElement('div');
    section.className = 'section';

    if (state.filter === 'all') {
      const header = document.createElement('div');
      header.className = 'section-header';
      header.textContent = `${category} · ${items.length}`;
      section.appendChild(header);
    }

    if (items.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'empty-state';
      empty.textContent = 'アイテムはありません';
      section.appendChild(empty);
    } else {
      const list = document.createElement('div');
      list.className = 'item-list';
      for (const item of items) list.appendChild(renderItemRow(item));
      section.appendChild(list);
    }

    el.list.appendChild(section);
  }
}

function render() {
  renderFilterTabs();
  renderSortToggle();
  renderList();
}

// ---- item actions ----
async function toggleBought(item) {
  const prev = item.bought;
  item.bought = !prev;
  render();
  try {
    await updateItemApi(item.id, { bought: item.bought });
  } catch (err) {
    item.bought = prev;
    render();
    showToast(err.message);
  }
}

function findItem(id) {
  return state.items.find((it) => it.id === id);
}

// ---- chip group helper ----
function renderChipGroup(container, options, selected, onSelect) {
  container.innerHTML = '';
  for (const opt of options) {
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'chip' + (selected === opt.value ? ' active' : '');
    chip.textContent = opt.label;
    chip.addEventListener('click', () => onSelect(opt.value));
    container.appendChild(chip);
  }
}

const priorityOptions = [{ value: null, label: '未設定' }, ...PRIORITIES.map((p) => ({ value: p, label: p }))];
const categoryOptions = CATEGORIES.map((c) => ({ value: c, label: c }));

// ---- add sheet ----
function renderAddSheet() {
  el.addName.value = state.addDraft.name;
  el.addMemo.value = state.addDraft.memo;
  renderChipGroup(el.addCategoryChips, categoryOptions, state.addDraft.category, (v) => {
    state.addDraft.category = v;
    renderAddSheet();
  });
  renderChipGroup(el.addPriorityChips, priorityOptions, state.addDraft.priority, (v) => {
    state.addDraft.priority = v;
    renderAddSheet();
  });
}

function openAdd() {
  state.addDraft = { name: '', memo: '', category: '食品', priority: null };
  el.addOverlay.hidden = false;
  renderAddSheet();
  el.addName.focus();
}
function closeAdd() {
  el.addOverlay.hidden = true;
}

async function submitAdd() {
  const name = el.addName.value.trim();
  if (!name) { el.addName.focus(); return; }
  const memo = el.addMemo.value.trim();
  const { category, priority } = state.addDraft;
  el.addSubmit.disabled = true;
  try {
    const item = await createItemApi({ name, memo, category, priority });
    state.items.push(item);
    closeAdd();
    render();
    showToast('追加しました');
  } catch (err) {
    showToast(err.message);
  } finally {
    el.addSubmit.disabled = false;
  }
}

// ---- edit sheet ----
function renderEditSheet() {
  el.editName.value = state.editDraft.name;
  el.editMemo.value = state.editDraft.memo;
  renderChipGroup(el.editCategoryChips, categoryOptions, state.editDraft.category, (v) => {
    state.editDraft.category = v;
    renderEditSheet();
  });
  renderChipGroup(el.editPriorityChips, priorityOptions, state.editDraft.priority, (v) => {
    state.editDraft.priority = v;
    renderEditSheet();
  });
}

function openEdit(id) {
  const item = findItem(id);
  if (!item) return;
  state.editId = id;
  state.editDraft = {
    name: item.name,
    memo: item.memo || '',
    category: item.category,
    priority: item.priority,
  };
  el.editOverlay.hidden = false;
  renderEditSheet();
}
function closeEdit() {
  state.editId = null;
  el.editOverlay.hidden = true;
}

async function submitEditSave() {
  const id = state.editId;
  const name = el.editName.value.trim();
  if (!name) { el.editName.focus(); return; }
  const memo = el.editMemo.value.trim();
  const { category, priority } = state.editDraft;
  el.editSave.disabled = true;
  try {
    const updated = await updateItemApi(id, { name, memo, category, priority });
    const idx = state.items.findIndex((it) => it.id === id);
    if (idx !== -1) state.items[idx] = updated;
    closeEdit();
    render();
    showToast('保存しました');
  } catch (err) {
    showToast(err.message);
  } finally {
    el.editSave.disabled = false;
  }
}

async function submitEditDelete() {
  const id = state.editId;
  if (!id) return;
  if (!(await confirmDialog('このアイテムを削除しますか？'))) return;
  el.editDelete.disabled = true;
  try {
    await deleteItemApi(id);
    state.items = state.items.filter((it) => it.id !== id);
    closeEdit();
    render();
    showToast('削除しました');
  } catch (err) {
    showToast(err.message);
  } finally {
    el.editDelete.disabled = false;
  }
}

// ---- changelog ----
function renderVersionBadge() {
  el.versionBadge.textContent = `v${APP_VERSION}`;
}
function openChangelog() {
  el.changelogList.innerHTML = '';
  for (const entry of APP_CHANGELOG) {
    const block = document.createElement('div');
    block.className = 'changelog-entry';
    const items = entry.changes.map((c) => `<li>${escapeHtml(c)}</li>`).join('');
    block.innerHTML = `
      <div class="changelog-version">v${escapeHtml(entry.version)}</div>
      <div class="changelog-date">${escapeHtml(entry.date)}</div>
      <ul>${items}</ul>
    `;
    el.changelogList.appendChild(block);
  }
  el.changelogOverlay.hidden = false;
}
function closeChangelog() {
  el.changelogOverlay.hidden = true;
}

// ---- wiring ----
function bindEvents() {
  el.loginButton.addEventListener('click', async () => {
    el.loginButton.disabled = true;
    const { error } = await ShoppingListAuth.signInWithGoogle();
    if (error) {
      setLoginError('Googleログインに失敗しました');
      el.loginButton.disabled = false;
    }
  });

  el.profileButton.addEventListener('click', (e) => {
    e.stopPropagation();
    toggleProfileMenu();
  });
  document.addEventListener('click', (e) => {
    if (!el.profileMenu.hidden && !el.profileWrap.contains(e.target)) closeProfileMenu();
  });

  el.logoutButton.addEventListener('click', () => {
    closeProfileMenu();
    ShoppingListAuth.signOut();
  });

  el.sortToggle.addEventListener('click', () => {
    state.sort = state.sort === 'added' ? 'name' : 'added';
    render();
  });

  el.fabAdd.addEventListener('click', openAdd);
  el.addClose.addEventListener('click', closeAdd);
  el.addOverlay.addEventListener('click', (e) => { if (e.target === el.addOverlay) closeAdd(); });
  el.addSubmit.addEventListener('click', submitAdd);
  el.addName.addEventListener('input', () => { state.addDraft.name = el.addName.value; });
  el.addMemo.addEventListener('input', () => { state.addDraft.memo = el.addMemo.value; });

  el.editClose.addEventListener('click', closeEdit);
  el.editOverlay.addEventListener('click', (e) => { if (e.target === el.editOverlay) closeEdit(); });
  el.editSave.addEventListener('click', submitEditSave);
  el.editDelete.addEventListener('click', submitEditDelete);
  el.editName.addEventListener('input', () => { state.editDraft.name = el.editName.value; });
  el.editMemo.addEventListener('input', () => { state.editDraft.memo = el.editMemo.value; });

  el.versionBadge.addEventListener('click', () => {
    closeProfileMenu();
    openChangelog();
  });
  el.changelogClose.addEventListener('click', closeChangelog);
  el.changelogOverlay.addEventListener('click', (e) => { if (e.target === el.changelogOverlay) closeChangelog(); });

  el.confirmCancel.addEventListener('click', () => closeConfirmDialog(false));
  el.confirmOk.addEventListener('click', () => closeConfirmDialog(true));
  el.confirmOverlay.addEventListener('click', (e) => { if (e.target === el.confirmOverlay) closeConfirmDialog(false); });

  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    if (!el.confirmOverlay.hidden) closeConfirmDialog(false);
    else if (!el.editOverlay.hidden) closeEdit();
    else if (!el.addOverlay.hidden) closeAdd();
    else if (!el.changelogOverlay.hidden) closeChangelog();
    else if (!el.profileMenu.hidden) closeProfileMenu();
  });
}

function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;

  navigator.serviceWorker.register('sw.js').then((registration) => {
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') registration.update();
    });
  }).catch(() => {});

  // 新しいService Workerが有効化されたら、再インストールなしで最新版を使えるように
  // ページを自動リロードする（初回のcontrollerchangeでも発火するが、その場合は
  // 読み込み直後の再読み込みになるだけで実害はない）。
  let reloadingForUpdate = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (reloadingForUpdate) return;
    reloadingForUpdate = true;
    window.location.reload();
  });
}

async function loadItems() {
  state.loading = true;
  state.error = null;
  render();
  try {
    state.items = await fetchItems();
    state.loading = false;
  } catch (err) {
    state.loading = false;
    if (err.status === 401 || err.status === 403) {
      await ShoppingListAuth.signOut();
      showLogin();
      setLoginError(
        err.status === 403 ? 'このGoogleアカウントではログインできません' : undefined
      );
      return;
    }
    state.error = err.message || '読み込みに失敗しました';
  }
  render();
}

async function init() {
  renderVersionBadge();
  bindEvents();
  render();

  const initialAuthError = consumeAuthErrorParam();

  const session = await ShoppingListAuth.getSession();
  if (session) {
    showApp(session);
    await loadItems();
  } else {
    showLogin();
    setLoginError(initialAuthError);
  }

  ShoppingListAuth.onAuthStateChange((nextSession, event) => {
    // INITIAL_SESSION はsubscribe直後に必ず1回発火し、上のgetSession()分岐と重複するため無視する
    if (event === 'INITIAL_SESSION') return;
    if (nextSession) {
      showApp(nextSession);
      loadItems();
    } else {
      showLogin();
    }
  });

  registerServiceWorker();
}

init();
