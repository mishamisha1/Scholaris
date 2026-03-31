const SESSION_KEY = 'scholaris_session_v1';

let publicPapers = [];
let modPapers = [];
let currentUser = JSON.parse(localStorage.getItem(SESSION_KEY) || 'null');
let isAdmin = false;
let activeTag = '';
let activeType = '';
let activeYear = '';
let activeSort = 'new';
let currentModTab = 'pending';
let currentPaperId = null;

async function api(path, options = {}) {
  const res = await fetch(path, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || `HTTP_${res.status}`);
  return res.json();
}

async function loadData() {
  publicPapers = await api('/api/papers/public');
  modPapers = await api('/api/papers/moderation');
  refreshDashboardStats();
  filterPapers();
}

async function refreshDashboardStats() {
  const stats = await api('/api/stats');
  document.getElementById('totalCount').textContent = stats.total;
  document.getElementById('authorsCount').textContent = stats.authors;
  document.getElementById('fieldsCount').textContent = stats.fields;
  document.getElementById('todayUploads').textContent = Number(stats.todayUploads).toLocaleString('ru');
  document.getElementById('totalViews').textContent = Number(stats.views).toLocaleString('ru');
  document.getElementById('reviewCount').textContent = stats.pending;

  document.getElementById('yearAllCount').textContent = stats.total;
  ['2026', '2025', '2024', '2023'].forEach((y) => {
    const el = document.getElementById(`year${y}Count`);
    if (el) el.textContent = stats.byYear[y] || 0;
  });

  updatePendingCount();
}

function sortPapers(list) {
  const sorted = [...list];
  if (activeSort === 'popular') sorted.sort((a, b) => (b.views || 0) - (a.views || 0));
  else if (activeSort === 'cited') sorted.sort((a, b) => (b.citations || 0) - (a.citations || 0));
  else sorted.sort((a, b) => Number(b.year) - Number(a.year));
  return sorted;
}

function renderPapers(list) {
  const el = document.getElementById('papersList');
  if (!list.length) {
    el.innerHTML = '<div style="text-align:center;padding:60px;color:var(--muted);font-family:\'IBM Plex Mono\',monospace;font-size:14px">Статьи не найдены</div>';
    return;
  }

  el.innerHTML = list.map(p => `
    <div class="paper-card" onclick="openPaper(${p.id})" style="position:relative">
      <div class="paper-badge ${p.type==='featured'?'badge-featured':'badge-community'}">${p.type==='featured'?'Редакция':'Сообщество'}</div>
      <div class="paper-meta-top"><span class="paper-category">${p.category}</span><span class="paper-dot">·</span><span class="paper-year">${p.year}</span></div>
      <div class="paper-title">${p.title}</div>
      <div class="paper-authors">${p.authors}</div>
      <div class="paper-abstract">${p.abstract}</div>
      <div class="paper-footer">
        <span class="paper-stat">👁 ${(p.views||0).toLocaleString('ru')}</span>
        <span class="paper-stat">📥 ${(p.downloads||0).toLocaleString('ru')}</span>
        <span class="paper-stat">📖 ${p.citations||0} цитирований</span>
        <div class="paper-tags">${(p.tags||[]).map(t=>`<span class="tag">${t}</span>`).join('')}</div>
      </div>
    </div>
  `).join('');
}

function filterPapers() {
  const q = document.getElementById('searchInput').value.toLowerCase();
  const list = sortPapers(publicPapers.filter(p => {
    const match = !q || p.title.toLowerCase().includes(q) || p.authors.toLowerCase().includes(q) || p.abstract.toLowerCase().includes(q) || (p.keywords||'').toLowerCase().includes(q);
    const tagMatch = !activeTag || p.category.includes(activeTag) || (p.tags||[]).some(t=>t.toLowerCase().includes(activeTag.toLowerCase()));
    const typeMatch = !activeType || p.type === activeType;
    const yearMatch = !activeYear || String(p.year) === activeYear;
    return match && tagMatch && typeMatch && yearMatch;
  }));
  renderPapers(list);
}

function filterByTag(el, tag) {
  document.querySelectorAll('.sidebar .filter-tag').forEach(e => { if (e.closest('.sidebar-section') === el.closest('.sidebar-section')) e.classList.remove('active'); });
  el.classList.add('active');
  activeTag = tag;
  filterPapers();
}

function filterByType(el, type) {
  document.querySelectorAll('.sidebar .filter-tag').forEach(e => { if (e.closest('.sidebar-section') === el.closest('.sidebar-section')) e.classList.remove('active'); });
  el.classList.add('active');
  activeType = type;
  filterPapers();
}

function setYearFilter(el, year) {
  document.querySelectorAll('.year-item').forEach(e => e.classList.remove('active'));
  el.classList.add('active');
  activeYear = year;
  filterPapers();
}

function openPaper(id) {
  const p = [...publicPapers, ...modPapers].find(x => x.id === id);
  if (!p) return;
  currentPaperId = id;
  document.getElementById('mCategory').textContent = p.category;
  document.getElementById('mTitle').textContent = p.title;
  document.getElementById('mAuthors').textContent = p.authors;
  document.getElementById('mAffiliation').textContent = p.affiliation || '';
  document.getElementById('mAbstract').textContent = p.abstract;
  document.getElementById('mJournal').textContent = p.journal || '—';
  document.getElementById('mYear').textContent = p.year;
  document.getElementById('mDoi').textContent = p.doi || '—';
  document.getElementById('mKeywords').textContent = p.keywords || '—';
  showModal('paperModal');
}

function downloadCurrentPaper() { if (currentPaperId) showToast('Скачивание демо-PDF запущено (mock).'); }
function copyCitation() {
  if (!currentPaperId) return;
  const p = [...publicPapers, ...modPapers].find(x => x.id === currentPaperId);
  const text = `${p.authors} (${p.year}). ${p.title}. ${p.journal}. DOI: ${p.doi}`;
  navigator.clipboard?.writeText(text);
  showToast('Цитата скопирована в буфер обмена.');
}
function sharePaper() {
  if (!currentPaperId) return;
  navigator.clipboard?.writeText(`https://scholaris.local/papers/${currentPaperId}`);
  showToast('Ссылка скопирована (демо).');
}

async function submitPaper() {
  if (!currentUser) { showToast('Сначала войдите в аккаунт, чтобы отправить статью.', true); showModal('loginModal'); return; }

  const payload = {
    title: document.getElementById('upTitle').value.trim(),
    authors: document.getElementById('upAuthors').value.trim(),
    category: document.getElementById('upCat').value,
    abstract: document.getElementById('upAbstract').value.trim(),
    year: document.getElementById('upYear').value,
    affiliation: document.getElementById('upAffil').value.trim(),
    journal: document.getElementById('upJournal').value.trim(),
    keywords: document.getElementById('upKeywords').value.trim(),
    userEmail: currentUser.email,
  };

  if (!payload.title || !payload.authors || !payload.category || !payload.abstract) {
    showToast('⚠️ Заполните обязательные поля', true);
    return;
  }

  try {
    await api('/api/papers', { method: 'POST', body: JSON.stringify(payload) });
    closeModal('uploadModal');
    showToast('📨 Статья отправлена на модерацию.');
    ['upTitle','upAuthors','upAffil','upAbstract','upKeywords','upJournal'].forEach(id => document.getElementById(id).value = '');
    document.getElementById('upCat').value = '';
    document.getElementById('fileInfo').style.display = 'none';
    await loadData();
  } catch {
    showToast('Ошибка отправки статьи', true);
  }
}

async function registerUser() {
  const payload = {
    name: document.getElementById('regName').value.trim(),
    email: document.getElementById('regEmail').value.trim().toLowerCase(),
    password: document.getElementById('regPassword').value,
  };

  try {
    currentUser = await api('/api/auth/register', { method: 'POST', body: JSON.stringify(payload) });
    localStorage.setItem(SESSION_KEY, JSON.stringify(currentUser));
    closeModal('registerModal');
    updateAuthUI();
    showToast('Аккаунт создан. Добро пожаловать!');
  } catch (e) {
    showToast(e.message === 'email_exists' ? 'Пользователь уже существует.' : 'Ошибка регистрации.', true);
  }
}

async function loginUser() {
  const payload = {
    email: document.getElementById('loginEmail').value.trim().toLowerCase(),
    password: document.getElementById('loginPassword').value,
  };

  try {
    currentUser = await api('/api/auth/login', { method: 'POST', body: JSON.stringify(payload) });
    localStorage.setItem(SESSION_KEY, JSON.stringify(currentUser));
    closeModal('loginModal');
    updateAuthUI();
    showToast(`С возвращением, ${currentUser.name}!`);
  } catch {
    showToast('Неверный email или пароль.', true);
  }
}

async function loginWithGoogleDemo() {
  const email = prompt('Google OAuth demo: введите Gmail адрес', 'researcher@gmail.com');
  if (!email) return;

  try {
    currentUser = await api('/api/auth/google-demo', { method: 'POST', body: JSON.stringify({ email }) });
    localStorage.setItem(SESSION_KEY, JSON.stringify(currentUser));
    closeModal('loginModal');
    updateAuthUI();
    showToast('Вход через Google (демо) выполнен. Для реального OAuth нужен backend + Client ID.');
  } catch {
    showToast('Для демо укажите корректный адрес Gmail.', true);
  }
}

function logoutUser() {
  currentUser = null;
  localStorage.removeItem(SESSION_KEY);
  updateAuthUI();
  showToast('Вы вышли из аккаунта.');
}

function updateAuthUI() {
  const chip = document.getElementById('userChip');
  const loginBtn = document.getElementById('loginBtn');
  const registerBtn = document.getElementById('registerBtn');

  if (currentUser) {
    chip.style.display = 'flex';
    chip.innerHTML = `<span>Пользователь: <strong>${currentUser.name}</strong></span><button onclick="logoutUser()">выйти</button>`;
    loginBtn.style.display = 'none';
    registerBtn.style.display = 'none';
  } else {
    chip.style.display = 'none';
    loginBtn.style.display = 'inline-block';
    registerBtn.style.display = 'inline-block';
  }
}

function showAdminLogin() { showModal('adminLoginModal'); }

async function adminLogin() {
  const payload = {
    username: document.getElementById('adminUser').value.trim(),
    password: document.getElementById('adminPass').value,
  };

  try {
    await api('/api/admin/login', { method: 'POST', body: JSON.stringify(payload) });
    isAdmin = true;
    closeModal('adminLoginModal');
    document.getElementById('adminBar').style.display = 'flex';
    showToast('✅ Вы вошли как администратор');
    renderModContent();
  } catch {
    showToast('❌ Неверный логин или пароль', true);
  }
}

function adminLogout() {
  isAdmin = false;
  document.getElementById('adminBar').style.display = 'none';
  showToast('Вы вышли из режима администратора');
}

function updatePendingCount() {
  const n = modPapers.filter((p) => p.status === 'pending').length;
  document.getElementById('pendingCount').textContent = n;
  document.getElementById('modPendingBadge').textContent = n;
}

function switchModTab(tab, el) {
  document.querySelectorAll('.mod-tab').forEach(t => t.classList.remove('active'));
  el.classList.add('active');
  currentModTab = tab;
  renderModContent();
}

function renderModContent() {
  const el = document.getElementById('modContent');
  const list = modPapers.filter((p) => p.status === currentModTab);

  if (!list.length) {
    el.innerHTML = `<div class="mod-empty">${currentModTab==='pending' ? '✅ Нет статей на рассмотрении' : currentModTab==='approved' ? 'Нет одобренных статей' : 'Нет отклонённых статей'}</div>`;
    return;
  }

  el.innerHTML = list.map(p => `
    <div class="mod-card"><div class="mod-card-header"><div style="flex:1"><div style="display:flex;align-items:center;gap:10px;margin-bottom:6px">
      <span class="${p.status==='pending'?'mod-pending-badge':p.status==='approved'?'mod-approved-badge':'mod-rejected-badge'}">${p.status==='pending'?'На рассмотрении':p.status==='approved'?'Одобрено':'Отклонено'}</span>
      <span style="font-family:'IBM Plex Mono',monospace;font-size:11px;color:var(--muted)">${p.category} · ${p.year}</span></div>
      <div class="mod-card-title">${p.title}</div><div class="mod-card-meta">${p.authors}${p.affiliation?' · '+p.affiliation:''}</div><div class="mod-card-abstract">${p.abstract}</div></div>
      <div class="mod-submitted">${p.submittedAt||'—'}</div></div><div class="mod-card-actions">
      ${p.status==='pending' ? `<button class="btn-approve" onclick="moderatePaper(${p.id},'approved')">✓ Одобрить</button><button class="btn-reject" onclick="moderatePaper(${p.id},'rejected')">✕ Отклонить</button><button class="btn-preview" onclick="openPaper(${p.id})">Просмотр</button>` : p.status==='approved' ? `<button class="btn-reject" onclick="moderatePaper(${p.id},'rejected')" style="font-size:11px">Отозвать публикацию</button>` : `<button class="btn-approve" onclick="moderatePaper(${p.id},'approved')">Одобрить повторно</button>`}
      </div></div>`).join('');
}

async function moderatePaper(id, status) {
  try {
    await api(`/api/papers/${id}/status`, { method: 'PATCH', body: JSON.stringify({ status }) });
    showToast(status === 'approved' ? '✅ Статья опубликована!' : '🗂 Статья отклонена');
    await loadData();
    renderModContent();
  } catch {
    showToast('Не удалось изменить статус статьи', true);
  }
}

function showModal(id) {
  if (id === 'modModal') renderModContent();
  document.getElementById(id).classList.add('active');
  document.body.style.overflow = 'hidden';
}

function closeModal(id) {
  document.getElementById(id).classList.remove('active');
  document.body.style.overflow = '';
}

document.querySelectorAll('.modal-overlay').forEach(el => {
  el.addEventListener('click', e => { if (e.target === el) closeModal(el.id); });
});

const dropzone = document.getElementById('dropzone');
dropzone.addEventListener('click', () => document.getElementById('fileInput').click());
dropzone.addEventListener('dragover', e => { e.preventDefault(); dropzone.style.borderColor = 'var(--accent2)'; });
dropzone.addEventListener('dragleave', () => { dropzone.style.borderColor = 'var(--border)'; });
dropzone.addEventListener('drop', e => {
  e.preventDefault(); dropzone.style.borderColor = 'var(--border)';
  const file = e.dataTransfer.files[0];
  if (file) showFileInfo(file);
});

function handleFileSelect(e) { const f = e.target.files[0]; if(f) showFileInfo(f); }
function showFileInfo(file) {
  const el = document.getElementById('fileInfo');
  el.style.display = 'block';
  el.textContent = `✅ Файл выбран: ${file.name} (${(file.size/1024/1024).toFixed(2)} МБ)`;
}

function showToast(msg, error) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.style.background = error ? 'var(--accent)' : 'var(--success)';
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 3500);
}

document.querySelectorAll('.sort-btn').forEach(btn => {
  btn.addEventListener('click', function() {
    document.querySelectorAll('.sort-btn').forEach(b => b.classList.remove('active'));
    this.classList.add('active');
    activeSort = this.textContent.includes('Популярные') ? 'popular' : this.textContent.includes('Цитируемые') ? 'cited' : 'new';
    filterPapers();
  });
});

document.querySelectorAll('nav a').forEach(link => {
  link.addEventListener('click', e => {
    e.preventDefault();
    document.querySelectorAll('nav a').forEach(a => a.classList.remove('active'));
    link.classList.add('active');
    const txt = link.textContent.trim();
    const map = {'Все статьи':'','Физика':'Физика','Биология':'Биология','Химия':'Химия','ИИ и CS':'ИИ','Медицина':'Медицина','Математика':'Математика','Экономика':'Экономика'};
    if (txt === 'Избранное') return showToast('Раздел "Избранное" в демо пока без backend-синхронизации.');
    activeTag = map[txt] || '';
    filterPapers();
  });
});

(async function init() {
  updateAuthUI();
  await loadData();
})();
