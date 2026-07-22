import { MAINTENANCE_LIBRARY, PHOTO_LABELS } from './maintenance-data.js';

const STORAGE_KEY = 'headsup_ai_v02';
const LEGACY_KEY = 'headsup_ai_v01';
const DAY = 86400000;
const AREAS = ['Home', 'Pool', 'Vehicle', 'Other'];

const DEFAULT_PROFILE = {
  owner: 'Josh',
  homeName: 'Rack & Splash Manor',
  city: 'Fort Worth, TX',
  homeYear: 1962,
  hasPool: true,
  tester: 'Josh',
  setupComplete: false
};

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const view = $('#view');
const taskDialog = $('#taskDialog');
const taskDialogContent = $('#taskDialogContent');
const settingsDialog = $('#settingsDialog');
const settingsContent = $('#settingsContent');

let currentTab = 'home';
let state = loadState();
let hfPipeline = null;
let embedder = null;
let taskVectors = null;
let taskVectorSignature = '';
let visionClassifier = null;
let pendingPhoto = null;

function uid(prefix = 'id') {
  return `${prefix}-${crypto.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`}`;
}

function isoDateFromDays(days) {
  return new Date(Date.now() + days * DAY).toISOString();
}

function seedAssets(profile = DEFAULT_PROFILE) {
  return [
    { id: 'asset-home', type: 'Home', name: profile.homeName || 'My Home', details: profile.homeYear ? `Built ${profile.homeYear}` : '', notes: '' },
    ...(profile.hasPool ? [{ id: 'asset-pool', type: 'Pool', name: 'Backyard Pool', details: '', notes: '' }] : []),
    { id: 'asset-vehicle-1', type: 'Vehicle', name: 'Primary Vehicle', details: '', mileage: '', notes: '' }
  ];
}

function libraryTask(lib, enabled = true) {
  const assetId = lib.area === 'Pool' ? 'asset-pool' : lib.area === 'Vehicle' ? 'asset-vehicle-1' : 'asset-home';
  return {
    id: `lib-${lib.id}`,
    source: 'library',
    libraryId: lib.id,
    title: lib.title,
    area: lib.area,
    assetId,
    assetName: lib.asset,
    enabled,
    dueDate: isoDateFromDays(Math.max(7, Math.min(lib.intervalDays || 30, 90))),
    intervalDays: lib.intervalDays || 30,
    costMin: lib.costMin || 0,
    costMax: lib.costMax || 0,
    notes: '',
    why: lib.why || '',
    steps: [...(lib.steps || [])],
    tools: lib.tools || '',
    difficulty: lib.difficulty || 'Easy',
    safety: lib.safety || 'low',
    lastDone: null
  };
}

function freshState() {
  const profile = { ...DEFAULT_PROFILE };
  const enabledIds = new Set([
    'hvac-filter', 'smoke-test', 'smoke-battery', 'dryer-vent', 'water-heater', 'gfci', 'gutters', 'roof',
    'pool-chemistry', 'pool-baskets', 'pool-filter', 'pool-valves',
    'vehicle-oil', 'vehicle-tires', 'vehicle-battery', 'vehicle-wipers'
  ]);
  return {
    version: 2,
    profile,
    assets: seedAssets(profile),
    tasks: MAINTENANCE_LIBRARY.filter(x => x.intervalDays > 0 && x.id !== 'propane-smell').map(lib => libraryTask(lib, enabledIds.has(lib.id))),
    history: [],
    feedback: [],
    selectedArea: 'All',
    installDate: new Date().toISOString(),
    aiUseCount: 0,
    photoUseCount: 0
  };
}

function migrateLegacy(legacy) {
  const next = freshState();
  next.profile = { ...next.profile, ...(legacy.profile || {}) };
  next.assets = seedAssets(next.profile);
  if (Array.isArray(legacy.tasks)) {
    next.tasks = legacy.tasks.map(old => {
      const lib = MAINTENANCE_LIBRARY.find(x => x.id === old.id);
      if (!lib) return null;
      return {
        ...libraryTask(lib, old.enabled !== false),
        dueDate: old.dueDate || isoDateFromDays(lib.intervalDays || 30),
        intervalDays: old.customIntervalDays || lib.intervalDays || 30,
        notes: old.notes || '',
        lastDone: old.lastDone || null
      };
    }).filter(Boolean);
  }
  next.history = Array.isArray(legacy.history) ? legacy.history.map(h => ({ ...h, actualCost: h.actualCost ?? h.cost ?? null })) : [];
  next.feedback = Array.isArray(legacy.feedback) ? legacy.feedback : [];
  next.aiUseCount = legacy.aiUseCount || 0;
  next.photoUseCount = legacy.photoUseCount || 0;
  next.selectedArea = legacy.selectedArea || 'All';
  return next;
}

function normalizeState(input) {
  const base = freshState();
  const next = { ...base, ...(input || {}) };
  next.version = 2;
  next.profile = { ...DEFAULT_PROFILE, ...(input?.profile || {}) };
  next.assets = Array.isArray(input?.assets) && input.assets.length ? input.assets : seedAssets(next.profile);
  next.tasks = Array.isArray(input?.tasks) ? input.tasks.map(t => normalizeTask(t)).filter(Boolean) : base.tasks;
  next.history = Array.isArray(input?.history) ? input.history : [];
  next.feedback = Array.isArray(input?.feedback) ? input.feedback : [];
  return next;
}

function normalizeTask(task) {
  if (!task) return null;
  if (task.source === 'custom' || task.title) {
    const lib = task.libraryId ? MAINTENANCE_LIBRARY.find(x => x.id === task.libraryId) : null;
    return {
      id: task.id || uid('task'),
      source: task.source || (lib ? 'library' : 'custom'),
      libraryId: task.libraryId || null,
      title: task.title || lib?.title || 'Maintenance item',
      area: task.area || lib?.area || 'Other',
      assetId: task.assetId || '',
      assetName: task.assetName || lib?.asset || '',
      enabled: task.enabled !== false,
      dueDate: task.dueDate || isoDateFromDays(30),
      intervalDays: Number(task.intervalDays || task.customIntervalDays || lib?.intervalDays || 30),
      costMin: Number(task.costMin ?? lib?.costMin ?? 0),
      costMax: Number(task.costMax ?? lib?.costMax ?? 0),
      notes: task.notes || '',
      why: task.why || lib?.why || '',
      steps: Array.isArray(task.steps) ? task.steps : [...(lib?.steps || [])],
      tools: task.tools || lib?.tools || '',
      difficulty: task.difficulty || lib?.difficulty || 'Easy',
      safety: task.safety || lib?.safety || 'low',
      lastDone: task.lastDone || null
    };
  }
  const lib = MAINTENANCE_LIBRARY.find(x => x.id === task.id);
  return lib ? { ...libraryTask(lib, task.enabled !== false), dueDate: task.dueDate || isoDateFromDays(30), intervalDays: task.customIntervalDays || lib.intervalDays, notes: task.notes || '', lastDone: task.lastDone || null } : null;
}

function loadState() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
    if (saved) return normalizeState(saved);
    const legacy = JSON.parse(localStorage.getItem(LEGACY_KEY));
    if (legacy) {
      const migrated = migrateLegacy(legacy);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(migrated));
      return migrated;
    }
  } catch (err) {
    console.warn('HeadsUp state load failed', err);
  }
  return freshState();
}

function saveState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  taskVectors = null;
  taskVectorSignature = '';
}

function escapeHtml(s = '') {
  return String(s).replace(/[&<>'\"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '\"': '&quot;' }[c]));
}

function money(n) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(Number(n) || 0);
}

function formatDate(iso) {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? 'No date' : d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

function toDateInput(iso) {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? new Date().toISOString().slice(0, 10) : d.toISOString().slice(0, 10);
}

function daysUntil(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return 99999;
  const today = new Date();
  const start = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const target = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  return Math.round((target - start) / DAY);
}

function dueInfo(task) {
  const d = daysUntil(task.dueDate);
  if (d < 0) return { label: `${Math.abs(d)}d overdue`, cls: 'due-overdue', rank: 0 };
  if (d === 0) return { label: 'Due today', cls: 'due-overdue', rank: 0 };
  if (d <= 14) return { label: `Due in ${d}d`, cls: 'due-soon', rank: 1 };
  return { label: formatDate(task.dueDate), cls: 'due-good', rank: 2 };
}

function showToast(msg) {
  const el = $('#toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => el.classList.remove('show'), 2300);
}

function greeting() {
  const h = new Date().getHours();
  return h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
}

function enabledTasks() {
  return state.tasks.filter(t => t.enabled !== false);
}

function assetFor(task) {
  return state.assets.find(a => a.id === task.assetId) || null;
}

function taskSubtitle(task) {
  const asset = assetFor(task);
  return asset?.name || task.assetName || task.area;
}

function forecastCost(days = 90) {
  const due = enabledTasks().filter(t => {
    const d = daysUntil(t.dueDate);
    return d >= 0 && d <= days;
  });
  const min = due.reduce((a, t) => a + (Number(t.costMin) || 0), 0);
  const max = due.reduce((a, t) => a + (Number(t.costMax) || 0), 0);
  return { min, max, mid: Math.round((min + max) / 2), due };
}

function taskCard(task) {
  const info = dueInfo(task);
  return `<button class="task-card" data-task="${escapeHtml(task.id)}">
    <div class="task-row">
      <div>
        <div class="task-title">${escapeHtml(task.title)}</div>
        <div class="task-meta"><span class="area-pill">${escapeHtml(task.area)} • ${escapeHtml(taskSubtitle(task))}</span> · ${money(task.costMin)}–${money(task.costMax)}</div>
      </div>
      <span class="badge ${info.cls}">${info.label}</span>
    </div>
  </button>`;
}

function wireTaskCards() {
  $$('[data-task]').forEach(el => el.onclick = () => openTask(el.dataset.task));
}

function render() {
  $$('.nav-btn').forEach(b => b.classList.toggle('active', b.dataset.tab === currentTab));
  $('#homeLabel').textContent = `${state.profile.homeName || 'My Home'} • ${state.profile.city || 'Set location'}`;
  if (currentTab === 'home') renderHome();
  else if (currentTab === 'tasks') renderTasks();
  else if (currentTab === 'ask') renderAsk();
  else if (currentTab === 'history') renderHistory();
  else renderTest();
}

$$('.nav-btn').forEach(btn => btn.onclick = () => {
  currentTab = btn.dataset.tab;
  render();
  window.scrollTo({ top: 0, behavior: 'smooth' });
});
$('#settingsBtn').onclick = openSettings;

function renderHome() {
  const tasks = enabledTasks().sort((a, b) => new Date(a.dueDate) - new Date(b.dueDate));
  const overdue = tasks.filter(t => daysUntil(t.dueDate) < 0).length;
  const next30 = tasks.filter(t => { const d = daysUntil(t.dueDate); return d >= 0 && d <= 30; }).length;
  const forecast = forecastCost(90);
  const urgent = tasks.filter(t => daysUntil(t.dueDate) <= 14).slice(0, 5);

  view.innerHTML = `
    ${!state.profile.setupComplete ? `<div class="setup-card">
      <div><div class="eyebrow">Start here</div><strong>Make this tracker yours</strong><p>Add your real vehicles/equipment, then set the dates you actually want.</p></div>
      <button class="primary-btn" id="startSetup">Set up now</button>
    </div>` : ''}
    <section class="hero">
      <div class="eyebrow">Your maintenance heads-up</div>
      <h1>${greeting()}, ${escapeHtml(state.profile.owner || 'there')}.</h1>
      <p>Track what matters, what it costs, and when it is due. Your data stays on this device unless you export it.</p>
      <div class="metrics">
        <div class="metric"><strong>${overdue}</strong><small>overdue</small></div>
        <div class="metric"><strong>${next30}</strong><small>next 30 days</small></div>
        <div class="metric"><strong>${money(forecast.mid)}</strong><small>90-day est.</small></div>
      </div>
    </section>

    <div class="section-title"><h2>Needs attention</h2><button id="seeAllTasks">See all</button></div>
    <div class="task-list">${urgent.length ? urgent.map(taskCard).join('') : `<div class="empty">Nothing due in the next two weeks.</div>`}</div>

    <div class="section-title"><h2>Use it now</h2></div>
    <div class="quick-grid">
      <button class="quick-card" id="addQuick"><div class="emoji">＋</div><strong>Add a task</strong><span class="muted">Anything you want to remember</span></button>
      <button class="quick-card" id="assetsQuick"><div class="emoji">⌂</div><strong>My stuff</strong><span class="muted">Home, pool, cars & equipment</span></button>
      <button class="quick-card" id="askQuick"><div class="emoji">✦</div><strong>Ask HeadsUp</strong><span class="muted">Grounded maintenance matcher</span></button>
      <button class="quick-card" id="historyQuick"><div class="emoji">✓</div><strong>What I did</strong><span class="muted">Costs and maintenance history</span></button>
    </div>

    <div class="section-title"><h2>90-day forecast</h2></div>
    ${forecastHtml(90)}
  `;
  wireTaskCards();
  $('#startSetup')?.addEventListener('click', openSetup);
  $('#seeAllTasks').onclick = () => { currentTab = 'tasks'; render(); };
  $('#addQuick').onclick = () => openTaskEditor();
  $('#assetsQuick').onclick = openAssets;
  $('#askQuick').onclick = () => { currentTab = 'ask'; render(); };
  $('#historyQuick').onclick = () => { currentTab = 'history'; render(); };
}

function forecastHtml(days) {
  const f = forecastCost(days);
  if (!f.due.length) return `<div class="notice">No scheduled costs in the next ${days} days.</div>`;
  return `<div class="guide"><table class="mini-table">${f.due.sort((a, b) => new Date(a.dueDate) - new Date(b.dueDate)).slice(0, 10).map(t => `<tr><td>${escapeHtml(t.title)}<br><span class="muted">${formatDate(t.dueDate)}</span></td><td>${money(t.costMin)}–${money(t.costMax)}</td></tr>`).join('')}<tr><td><strong>Possible total</strong></td><td><strong>${money(f.min)}–${money(f.max)}</strong></td></tr></table></div>`;
}

function renderTasks() {
  const selected = state.selectedArea || 'All';
  const search = state.taskSearch || '';
  let tasks = enabledTasks();
  if (selected !== 'All') tasks = tasks.filter(t => t.area === selected);
  if (search) {
    const q = search.toLowerCase();
    tasks = tasks.filter(t => `${t.title} ${t.area} ${taskSubtitle(t)} ${t.notes}`.toLowerCase().includes(q));
  }
  tasks.sort((a, b) => new Date(a.dueDate) - new Date(b.dueDate));

  view.innerHTML = `
    <div class="section-title"><h2>Maintenance</h2><button id="addTask">+ Add</button></div>
    <div class="field compact-field"><input id="taskSearch" type="search" placeholder="Search tasks, car, pool, filter…" value="${escapeHtml(search)}"></div>
    <div class="chips">${['All', ...AREAS].map(a => `<button class="chip ${a === selected ? 'active' : ''}" data-area="${a}">${a}</button>`).join('')}</div>
    <div class="task-list" style="margin-top:12px">${tasks.length ? tasks.map(taskCard).join('') : `<div class="empty">No matching maintenance items.</div>`}</div>
    <div class="button-row"><button class="ghost-btn" id="presetsBtn">Choose suggested tasks</button><button class="ghost-btn" id="assetsBtn">My stuff</button></div>
  `;
  $$('[data-area]').forEach(b => b.onclick = () => { state.selectedArea = b.dataset.area; saveState(); renderTasks(); });
  $('#taskSearch').oninput = e => { state.taskSearch = e.target.value; saveState(); renderTasks(); setTimeout(() => $('#taskSearch')?.focus(), 0); };
  $('#addTask').onclick = () => openTaskEditor();
  $('#presetsBtn').onclick = openManagePresets;
  $('#assetsBtn').onclick = openAssets;
  wireTaskCards();
}

function taskEditFields(task) {
  const assetOptions = state.assets.filter(a => task.area === 'Other' || a.type === task.area).map(a => `<option value="${escapeHtml(a.id)}" ${a.id === task.assetId ? 'selected' : ''}>${escapeHtml(a.name)}</option>`).join('');
  return `
    <div class="field"><label>Task name</label><input id="editTitle" value="${escapeHtml(task.title)}" maxlength="100"></div>
    <div class="two-col">
      <div class="field"><label>Area</label><select id="editArea">${AREAS.map(a => `<option ${a === task.area ? 'selected' : ''}>${a}</option>`).join('')}</select></div>
      <div class="field"><label>For</label><select id="editAsset"><option value="">General</option>${assetOptions}</select></div>
    </div>
    <div class="two-col">
      <div class="field"><label>Next due</label><input id="editDue" type="date" value="${toDateInput(task.dueDate)}"></div>
      <div class="field"><label>Repeat every (days)</label><input id="editInterval" type="number" min="1" max="3650" value="${Number(task.intervalDays) || 30}"></div>
    </div>
    <div class="two-col">
      <div class="field"><label>Expected cost low</label><input id="editCostMin" inputmode="decimal" type="number" min="0" step="1" value="${Number(task.costMin) || 0}"></div>
      <div class="field"><label>Expected cost high</label><input id="editCostMax" inputmode="decimal" type="number" min="0" step="1" value="${Number(task.costMax) || 0}"></div>
    </div>
    <div class="field"><label>Notes / model / filter size / part number</label><textarea id="editNotes" placeholder="Anything you want to remember…">${escapeHtml(task.notes || '')}</textarea></div>
  `;
}

function openTask(id) {
  const task = state.tasks.find(t => t.id === id);
  if (!task) return;
  const info = dueInfo(task);
  taskDialogContent.innerHTML = `<div class="sheet-inner">
    <div class="sheet-head"><div><div class="eyebrow">${escapeHtml(task.area)} • ${escapeHtml(taskSubtitle(task))}</div><h2>${escapeHtml(task.title)}</h2><span class="badge ${info.cls}">${info.label}</span></div><button class="close-btn" data-close>×</button></div>
    ${task.why ? `<div class="guide safety-${escapeHtml(task.safety)}"><h3>Why it matters</h3><div class="muted">${escapeHtml(task.why)}</div></div>` : ''}
    ${task.steps?.length ? `<details class="guide"><summary><strong>Suggested steps</strong></summary><ol>${task.steps.map(s => `<li>${escapeHtml(s)}</li>`).join('')}</ol>${task.tools ? `<div class="muted">You may need: ${escapeHtml(task.tools)}</div>` : ''}</details>` : ''}
    ${['high', 'critical'].includes(task.safety) ? `<div class="notice warning"><strong>Safety stop:</strong> This may involve serious hazards. Use manufacturer instructions and a qualified professional where appropriate.</div>` : ''}
    ${taskEditFields(task)}
    <div class="guide completion-box"><h3>Log it complete</h3><div class="field"><label>What did it actually cost? (optional)</label><input id="doneCost" type="number" min="0" step="0.01" inputmode="decimal" placeholder="0"></div><button class="primary-btn" id="markDone" style="width:100%">✓ I did it today</button></div>
    <div class="button-row"><button class="ghost-btn" id="saveTask">Save changes</button>${task.source === 'custom' ? `<button class="danger-btn" id="deleteTask">Delete</button>` : `<button class="danger-btn" id="hideTask">Stop tracking</button>`}</div>
  </div>`;
  taskDialog.showModal();
  $('[data-close]', taskDialogContent).onclick = () => taskDialog.close();
  $('#editArea').onchange = () => refreshAssetSelect($('#editArea').value, task.assetId);
  $('#saveTask').onclick = () => saveTaskForm(task);
  $('#markDone').onclick = () => { if (saveTaskForm(task, false)) completeTask(task.id, $('#doneCost').value); };
  $('#deleteTask')?.addEventListener('click', () => {
    if (confirm(`Delete “${task.title}”? History will stay saved.`)) {
      state.tasks = state.tasks.filter(t => t.id !== task.id); saveState(); taskDialog.close(); render(); showToast('Task deleted');
    }
  });
  $('#hideTask')?.addEventListener('click', () => { task.enabled = false; saveState(); taskDialog.close(); render(); showToast('Stopped tracking'); });
}

function refreshAssetSelect(area, selectedId = '') {
  const select = $('#editAsset');
  if (!select) return;
  select.innerHTML = `<option value="">General</option>${state.assets.filter(a => area === 'Other' || a.type === area).map(a => `<option value="${escapeHtml(a.id)}" ${a.id === selectedId ? 'selected' : ''}>${escapeHtml(a.name)}</option>`).join('')}`;
}

function readTaskForm(task) {
  const title = $('#editTitle').value.trim();
  if (!title) throw new Error('Give the task a name');
  const dueRaw = $('#editDue').value;
  if (!dueRaw) throw new Error('Choose a due date');
  const interval = Math.max(1, Number($('#editInterval').value) || 30);
  const costMin = Math.max(0, Number($('#editCostMin').value) || 0);
  const costMax = Math.max(costMin, Number($('#editCostMax').value) || costMin);
  task.title = title;
  task.area = $('#editArea').value;
  task.assetId = $('#editAsset').value;
  task.dueDate = new Date(`${dueRaw}T12:00:00`).toISOString();
  task.intervalDays = interval;
  task.costMin = costMin;
  task.costMax = costMax;
  task.notes = $('#editNotes').value.trim();
  task.enabled = true;
}

function saveTaskForm(task, close = true) {
  try {
    readTaskForm(task);
    saveState();
    if (close) taskDialog.close();
    render();
    showToast('Task saved');
    return true;
  } catch (err) {
    showToast(err.message || 'Check the task details');
    return false;
  }
}

function completeTask(id, costRaw = '') {
  const task = state.tasks.find(t => t.id === id);
  if (!task) return;
  const doneAt = new Date();
  const actualCost = costRaw === '' ? null : Math.max(0, Number(costRaw) || 0);
  state.history.unshift({
    id: uid('history'), taskId: id, title: task.title, area: task.area, assetName: taskSubtitle(task),
    doneAt: doneAt.toISOString(), notes: task.notes || '', actualCost, tester: state.profile.tester || state.profile.owner
  });
  task.lastDone = doneAt.toISOString();
  task.dueDate = new Date(doneAt.getTime() + Math.max(1, Number(task.intervalDays) || 30) * DAY).toISOString();
  saveState();
  taskDialog.close();
  render();
  showToast(`Logged: ${task.title}`);
}

function openTaskEditor(prefill = {}) {
  const task = normalizeTask({
    id: uid('task'), source: 'custom', title: prefill.title || '', area: prefill.area || 'Home', assetId: prefill.assetId || '', assetName: '',
    enabled: true, dueDate: prefill.dueDate || isoDateFromDays(30), intervalDays: prefill.intervalDays || 30,
    costMin: prefill.costMin || 0, costMax: prefill.costMax || 0, notes: '', why: '', steps: [], tools: '', difficulty: 'Easy', safety: 'low'
  });
  taskDialogContent.innerHTML = `<div class="sheet-inner"><div class="sheet-head"><div><div class="eyebrow">New reminder</div><h2>Add maintenance</h2></div><button class="close-btn" data-close>×</button></div>
    ${taskEditFields(task)}
    <div class="button-row"><button class="primary-btn" id="createTask">Add task</button><button class="ghost-btn" data-close2>Cancel</button></div>
  </div>`;
  taskDialog.showModal();
  $('[data-close]', taskDialogContent).onclick = () => taskDialog.close();
  $('[data-close2]', taskDialogContent).onclick = () => taskDialog.close();
  $('#editArea').onchange = () => refreshAssetSelect($('#editArea').value, '');
  $('#createTask').onclick = () => {
    try {
      readTaskForm(task);
      state.tasks.push(task);
      saveState(); taskDialog.close(); currentTab = 'tasks'; render(); showToast('Task added');
    } catch (err) { showToast(err.message || 'Check the task details'); }
  };
}

function openManagePresets() {
  const rows = MAINTENANCE_LIBRARY.filter(x => x.intervalDays > 0 && x.id !== 'propane-smell').map(lib => {
    const task = state.tasks.find(t => t.libraryId === lib.id);
    return `<label class="history-item toggle-row"><input type="checkbox" data-preset="${lib.id}" ${task?.enabled ? 'checked' : ''}><span><strong>${escapeHtml(lib.title)}</strong><br><span class="muted">${escapeHtml(lib.area)} · about every ${lib.intervalDays} days</span></span></label>`;
  }).join('');
  taskDialogContent.innerHTML = `<div class="sheet-inner"><div class="sheet-head"><div><div class="eyebrow">Suggested maintenance</div><h2>Choose what you track</h2></div><button class="close-btn" data-close>×</button></div>${rows}<button class="primary-btn" id="savePresets" style="width:100%">Save choices</button></div>`;
  taskDialog.showModal();
  $('[data-close]', taskDialogContent).onclick = () => taskDialog.close();
  $('#savePresets').onclick = () => {
    $$('[data-preset]', taskDialogContent).forEach(box => {
      const lib = MAINTENANCE_LIBRARY.find(x => x.id === box.dataset.preset);
      let task = state.tasks.find(t => t.libraryId === lib.id);
      if (!task) { task = libraryTask(lib, box.checked); state.tasks.push(task); }
      task.enabled = box.checked;
    });
    saveState(); taskDialog.close(); renderTasks(); showToast('Suggestions updated');
  };
}

function openSetup() {
  settingsContent.innerHTML = `<div class="sheet-inner"><div class="sheet-head"><div><div class="eyebrow">3-minute setup</div><h2>Make HeadsUp yours</h2></div><button class="close-btn" data-close>×</button></div>
    <div class="field"><label>Your name</label><input id="setupOwner" value="${escapeHtml(state.profile.owner)}"></div>
    <div class="field"><label>Home nickname</label><input id="setupHome" value="${escapeHtml(state.profile.homeName)}"></div>
    <div class="field"><label>City</label><input id="setupCity" value="${escapeHtml(state.profile.city)}"></div>
    <div class="field"><label>Home year</label><input id="setupYear" type="number" min="1700" max="2100" value="${state.profile.homeYear || ''}"></div>
    <label class="history-item toggle-row"><input id="setupPool" type="checkbox" ${state.profile.hasPool ? 'checked' : ''}><span><strong>I have a pool</strong><br><span class="muted">Adds a pool to My Stuff</span></span></label>
    <button class="primary-btn" id="finishSetup" style="width:100%">Save & add my stuff</button>
  </div>`;
  settingsDialog.showModal();
  $('[data-close]', settingsContent).onclick = () => settingsDialog.close();
  $('#finishSetup').onclick = () => {
    state.profile.owner = $('#setupOwner').value.trim() || 'Josh';
    state.profile.homeName = $('#setupHome').value.trim() || 'My Home';
    state.profile.city = $('#setupCity').value.trim();
    state.profile.homeYear = Number($('#setupYear').value) || null;
    state.profile.hasPool = $('#setupPool').checked;
    state.profile.setupComplete = true;
    const home = state.assets.find(a => a.type === 'Home'); if (home) { home.name = state.profile.homeName; home.details = state.profile.homeYear ? `Built ${state.profile.homeYear}` : home.details; }
    if (state.profile.hasPool && !state.assets.some(a => a.type === 'Pool')) state.assets.push({ id: uid('asset'), type: 'Pool', name: 'Backyard Pool', details: '', notes: '' });
    saveState(); settingsDialog.close(); render(); openAssets();
  };
}

function openAssets() {
  settingsContent.innerHTML = `<div class="sheet-inner"><div class="sheet-head"><div><div class="eyebrow">My stuff</div><h2>Homes, pools, vehicles & equipment</h2></div><button class="close-btn" data-close>×</button></div>
    <div class="asset-list">${state.assets.length ? state.assets.map(a => `<button class="asset-card" data-asset="${escapeHtml(a.id)}"><div><strong>${escapeHtml(a.name)}</strong><div class="task-meta">${escapeHtml(a.type)}${a.details ? ` · ${escapeHtml(a.details)}` : ''}${a.mileage ? ` · ${escapeHtml(String(a.mileage))} mi` : ''}</div></div><span>›</span></button>`).join('') : '<div class="empty">Add your first item.</div>'}</div>
    <button class="primary-btn" id="addAsset" style="width:100%;margin-top:12px">+ Add home / pool / vehicle / equipment</button>
  </div>`;
  settingsDialog.showModal();
  $('[data-close]', settingsContent).onclick = () => settingsDialog.close();
  $$('[data-asset]', settingsContent).forEach(b => b.onclick = () => openAssetEditor(b.dataset.asset));
  $('#addAsset').onclick = () => openAssetEditor(null);
}

function openAssetEditor(id) {
  const existing = state.assets.find(a => a.id === id);
  const asset = existing ? { ...existing } : { id: uid('asset'), type: 'Vehicle', name: '', details: '', mileage: '', notes: '' };
  settingsContent.innerHTML = `<div class="sheet-inner"><div class="sheet-head"><div><div class="eyebrow">${existing ? 'Edit' : 'Add'} item</div><h2>${existing ? escapeHtml(existing.name) : 'My stuff'}</h2></div><button class="close-btn" id="backAssets">←</button></div>
    <div class="field"><label>Type</label><select id="assetType">${AREAS.map(a => `<option ${a === asset.type ? 'selected' : ''}>${a}</option>`).join('')}</select></div>
    <div class="field"><label>Name</label><input id="assetName" value="${escapeHtml(asset.name)}" placeholder="2022 Ford F-550, Backyard Pool, Upstairs HVAC…"></div>
    <div class="field"><label>Details</label><input id="assetDetails" value="${escapeHtml(asset.details || '')}" placeholder="Make/model, filter size, serial number, gallons…"></div>
    <div class="field" id="mileageField"><label>Mileage (optional)</label><input id="assetMileage" type="number" min="0" value="${escapeHtml(asset.mileage || '')}"></div>
    <div class="field"><label>Notes</label><textarea id="assetNotes" placeholder="Anything useful to remember">${escapeHtml(asset.notes || '')}</textarea></div>
    <div class="button-row"><button class="primary-btn" id="saveAsset">Save</button>${existing ? `<button class="danger-btn" id="deleteAsset">Delete</button>` : ''}</div>
  </div>`;
  $('#backAssets').onclick = openAssets;
  const syncMileage = () => { $('#mileageField').hidden = $('#assetType').value !== 'Vehicle'; };
  $('#assetType').onchange = syncMileage; syncMileage();
  $('#saveAsset').onclick = () => {
    asset.type = $('#assetType').value;
    asset.name = $('#assetName').value.trim();
    asset.details = $('#assetDetails').value.trim();
    asset.mileage = $('#assetMileage').value.trim();
    asset.notes = $('#assetNotes').value.trim();
    if (!asset.name) { showToast('Give this item a name'); return; }
    if (existing) Object.assign(existing, asset); else state.assets.push(asset);
    saveState(); showToast('Saved'); openAssets();
  };
  $('#deleteAsset')?.addEventListener('click', () => {
    if (!confirm(`Delete “${asset.name}”? Tasks will stay but become General.`)) return;
    state.tasks.forEach(t => { if (t.assetId === asset.id) t.assetId = ''; });
    state.assets = state.assets.filter(a => a.id !== asset.id); saveState(); showToast('Removed'); openAssets();
  });
}

function corpusText(task) {
  return `${task.title}. Area ${task.area}. Asset ${taskSubtitle(task)}. ${task.why || ''} ${task.notes || ''} Steps: ${(task.steps || []).join(' ')}`;
}

async function getHFPipeline() {
  if (hfPipeline) return hfPipeline;
  const mod = await import('https://cdn.jsdelivr.net/npm/@huggingface/transformers@4.2.0');
  hfPipeline = mod.pipeline;
  return hfPipeline;
}

async function ensureEmbedder() {
  const tasks = enabledTasks();
  const signature = tasks.map(t => `${t.id}:${t.title}:${t.notes}`).join('|');
  if (embedder && taskVectors && signature === taskVectorSignature) return tasks;
  const status = $('#aiStatus'); const prog = $('#aiProgress');
  if (status) status.textContent = 'Loading free browser AI… first use can take a little while.';
  if (prog) prog.innerHTML = '<div class="loader"><span></span></div>';
  const pipeline = await getHFPipeline();
  embedder = embedder || await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2', { dtype: 'q8' });
  const out = await embedder(tasks.map(corpusText), { pooling: 'mean', normalize: true });
  taskVectors = out.tolist();
  taskVectorSignature = signature;
  if (status) status.textContent = 'AI ready on this device.';
  if (prog) prog.innerHTML = '';
  return tasks;
}

function cosine(a, b) { let s = 0; for (let i = 0; i < a.length; i++) s += a[i] * b[i]; return s; }
function lexicalMatches(q) {
  const tasks = enabledTasks();
  const terms = q.toLowerCase().split(/[^a-z0-9]+/).filter(x => x.length > 2);
  return tasks.map(task => {
    const hay = corpusText(task).toLowerCase();
    const score = terms.reduce((n, t) => n + (hay.includes(t) ? 1 : 0), 0) / (terms.length || 1);
    return { task, score };
  }).sort((a, b) => b.score - a.score).slice(0, 3);
}
async function semanticMatches(q) {
  const tasks = await ensureEmbedder();
  const vec = (await embedder(q, { pooling: 'mean', normalize: true })).tolist()[0];
  return tasks.map((task, i) => ({ task, score: cosine(vec, taskVectors[i]) })).sort((a, b) => b.score - a.score).slice(0, 3);
}

function renderAsk() {
  view.innerHTML = `<div class="section-title"><h2>Ask HeadsUp AI</h2></div>
    <div class="ask-box">
      <div class="eyebrow">Grounded in your tracker</div><h2 style="margin:7px 0">What’s going on?</h2>
      <div class="field"><textarea id="aiQuestion" placeholder="My pool vacuum has weak suction…\nWhen is my oil change due?\nWhat should I work on this weekend?"></textarea></div>
      <button class="primary-btn" id="askBtn" style="width:100%">✦ Find the best match</button>
      <div class="ai-status"><span class="dot"></span><span id="aiStatus">Your tracker works without AI. The free model loads only when you ask.</span></div><div id="aiProgress"></div>
    </div>
    <div id="aiAnswer"></div>
    <div class="section-title"><h2>Photo Scout <span class="badge due-soon">Experimental</span></h2></div>
    <div class="guide"><div class="notice warning">Optional. Photo AI can be a large first download and only suggests what a component might be. Do not rely on it for dangerous electrical, fuel-gas or pressurized-equipment decisions.</div>
      <div class="field"><label>Take or choose a photo</label><input id="photoInput" type="file" accept="image/*" capture="environment"></div>
      <img id="photoPreview" class="photo-preview" hidden alt="Selected maintenance item"><button class="ghost-btn" id="scanPhoto" style="width:100%" disabled>▣ Analyze photo</button><div id="photoResult"></div>
    </div>`;
  $('#askBtn').onclick = askAI;
  $('#photoInput').onchange = handlePhoto;
  $('#scanPhoto').onclick = scanPhoto;
}

async function askAI() {
  const q = $('#aiQuestion').value.trim();
  if (!q) { showToast('Type a question first'); return; }
  $('#askBtn').disabled = true; $('#aiAnswer').innerHTML = '';
  let matches; let mode = 'AI semantic match';
  try {
    matches = await semanticMatches(q); state.aiUseCount++; saveState();
  } catch (err) {
    console.warn('AI unavailable, using local matcher', err);
    matches = lexicalMatches(q); mode = 'Instant offline matcher';
    $('#aiStatus').textContent = 'The AI model did not load, so HeadsUp used its built-in matcher instead.';
    $('#aiProgress').innerHTML = '';
  }
  $('#askBtn').disabled = false;
  const best = matches[0];
  if (!best || !best.task) { $('#aiAnswer').innerHTML = `<div class="notice">I do not have enough information yet. Add the equipment/task you want to track, then try again.</div>`; return; }
  const task = best.task;
  $('#aiAnswer').innerHTML = `<div class="answer safety-${escapeHtml(task.safety)}"><div class="eyebrow">${mode}</div><h3>${escapeHtml(task.title)}</h3>
    <p><strong>Your tracker:</strong> ${dueInfo(task).label} · ${formatDate(task.dueDate)}.</p>
    ${task.why ? `<p>${escapeHtml(task.why)}</p>` : ''}
    ${task.steps?.length ? `<div class="guide"><h3>Start here</h3><ol>${task.steps.map(s => `<li>${escapeHtml(s)}</li>`).join('')}</ol></div>` : `<div class="notice">This is one of your custom reminders. Open it to see your notes and dates.</div>`}
    ${['high', 'critical'].includes(task.safety) ? `<div class="notice warning"><strong>Safety stop:</strong> Do not use this match as a substitute for manufacturer instructions or a qualified professional.</div>` : ''}
    <div class="muted" style="font-size:12px;margin-top:12px">Top matches</div>${matches.map(m => `<div class="match"><strong>${escapeHtml(m.task.title)}</strong><div class="confidence">Match ${(Math.max(0, m.score) * 100).toFixed(0)}%</div></div>`).join('')}
    <div class="button-row"><button class="ghost-btn" id="openMatched">Open task</button><button class="ghost-btn" id="rateAnswer">Rate answer</button></div></div>`;
  $('#openMatched').onclick = () => openTask(task.id);
  $('#rateAnswer').onclick = () => { currentTab = 'test'; render(); setTimeout(() => $('#feedbackNotes')?.focus(), 100); };
}

function handlePhoto(e) {
  const file = e.target.files?.[0]; if (!file) return;
  if (file.size > 12 * 1024 * 1024) { showToast('Please use a photo under 12 MB'); return; }
  pendingPhoto = file;
  const url = URL.createObjectURL(file); const img = $('#photoPreview'); img.src = url; img.hidden = false; $('#scanPhoto').disabled = false; $('#photoResult').innerHTML = '';
}
async function scanPhoto() {
  if (!pendingPhoto) return;
  $('#scanPhoto').disabled = true; $('#photoResult').innerHTML = '<div class="ai-status"><span class="dot"></span>Loading optional vision AI…</div><div class="loader"><span></span></div>';
  try {
    const pipeline = await getHFPipeline();
    if (!visionClassifier) visionClassifier = await pipeline('zero-shot-image-classification', 'Xenova/clip-vit-base-patch32', { dtype: 'q8' });
    const results = await visionClassifier(await fileToDataURL(pendingPhoto), PHOTO_LABELS);
    const top = results.slice(0, 3); state.photoUseCount++; saveState();
    const suggested = matchPhotoLabelToTask(top[0].label);
    $('#photoResult').innerHTML = `<div class="answer"><div class="eyebrow">Photo Scout guess</div><h3>${escapeHtml(top[0].label)}</h3><p>Confidence ${(top[0].score * 100).toFixed(0)}%. Treat this as a clue, not a diagnosis.</p>${suggested ? `<div class="guide"><strong>Possible tracker match: ${escapeHtml(suggested.title)}</strong><div class="task-meta">${dueInfo(suggested).label}</div></div><button class="ghost-btn" id="openPhotoTask">Open task</button>` : `<button class="ghost-btn" id="addPhotoTask">Add a reminder for this</button>`}</div>`;
    $('#openPhotoTask')?.addEventListener('click', () => openTask(suggested.id));
    $('#addPhotoTask')?.addEventListener('click', () => openTaskEditor({ title: top[0].label }));
  } catch (err) {
    console.warn(err); $('#photoResult').innerHTML = '<div class="notice warning">Photo AI could not load. The rest of HeadsUp still works normally.</div>';
  } finally { $('#scanPhoto').disabled = false; }
}
function fileToDataURL(file) { return new Promise((resolve, reject) => { const r = new FileReader(); r.onload = () => resolve(r.result); r.onerror = reject; r.readAsDataURL(file); }); }
function matchPhotoLabelToTask(label) {
  const q = label.toLowerCase();
  const keys = [['air filter', 'hvac'], ['air conditioner', 'hvac'], ['smoke', 'smoke'], ['water heater', 'water heater'], ['dryer', 'dryer'], ['roof', 'roof'], ['gutter', 'gutter'], ['pool pump', 'pool'], ['pool filter', 'pool filter'], ['skimmer', 'pool'], ['tire', 'tire'], ['battery', 'battery'], ['oil', 'oil']];
  const found = keys.find(([k]) => q.includes(k));
  return found ? enabledTasks().find(t => corpusText(t).toLowerCase().includes(found[1])) : null;
}

function renderHistory() {
  const totalSpent = state.history.reduce((sum, h) => sum + (Number(h.actualCost) || 0), 0);
  view.innerHTML = `<div class="section-title"><h2>Maintenance history</h2><button id="exportHistory">Export</button></div>
    <div class="guide"><div class="task-row"><div><strong>${state.history.length} jobs logged</strong><div class="task-meta">Actual costs you entered</div></div><strong>${money(totalSpent)}</strong></div></div>
    ${state.history.length ? state.history.map(h => `<div class="history-item"><div class="task-row"><div><strong>${escapeHtml(h.title)}</strong><div class="task-meta">${formatDate(h.doneAt)} · ${escapeHtml(h.assetName || h.area || '')}</div></div><span class="badge due-good">${h.actualCost == null ? 'Done' : money(h.actualCost)}</span></div>${h.notes ? `<div class="muted" style="margin-top:9px">${escapeHtml(h.notes)}</div>` : ''}</div>`).join('') : `<div class="empty">Complete your first task and it will appear here.</div>`}`;
  $('#exportHistory').onclick = exportData;
}

function renderTest() {
  const recent = state.feedback.slice(0, 3);
  view.innerHTML = `<div class="section-title"><h2>Family & friends test</h2></div><div class="notice">Have somebody use the app for a few minutes, then capture what felt useful, confusing or wrong.</div>
    <div class="feedback-card"><div class="field"><label>Tester name</label><input id="testerName" value="${escapeHtml(state.profile.tester || '')}" placeholder="Lola, Dad, friend…"></div>
      ${ratingRow('useful', 'Was it useful?')}${ratingRow('easy', 'Was it easy?')}${ratingRow('trust', 'Did the answer feel trustworthy?')}
      <div class="field"><label>What worked, what was wrong, or what was missing?</label><textarea id="feedbackNotes" placeholder="Be blunt. Bad feedback helps us improve it."></textarea></div><button class="primary-btn" id="saveFeedback" style="width:100%">Save test feedback</button></div>
    <div class="section-title"><h2>Prototype stats</h2></div><div class="guide"><table class="mini-table"><tr><td>AI questions asked</td><td>${state.aiUseCount || 0}</td></tr><tr><td>Photo scans</td><td>${state.photoUseCount || 0}</td></tr><tr><td>Maintenance jobs logged</td><td>${state.history.length}</td></tr><tr><td>Feedback sessions</td><td>${state.feedback.length}</td></tr></table></div>
    ${recent.length ? `<div class="section-title"><h2>Latest feedback</h2></div>${recent.map(f => `<div class="history-item"><strong>${escapeHtml(f.tester)}</strong><div class="task-meta">Useful ${f.useful}/5 · Easy ${f.easy}/5 · Trust ${f.trust}/5</div><div class="muted" style="margin-top:8px">${escapeHtml(f.notes || 'No notes')}</div></div>`).join('')}` : ''}
    <div class="button-row"><button class="ghost-btn" id="exportAll">Export test data</button></div>`;
  wireRatings(); $('#saveFeedback').onclick = saveFeedback; $('#exportAll').onclick = exportData;
}
function ratingRow(name, label) { return `<div class="field"><label>${label}</label><div class="stars" data-rating="${name}">${[1, 2, 3, 4, 5].map(n => `<button class="star-btn" data-value="${n}" type="button">★</button>`).join('')}</div></div>`; }
function wireRatings() { $$('[data-rating]').forEach(group => { group.dataset.selected = '0'; $$('.star-btn', group).forEach(btn => btn.onclick = () => { group.dataset.selected = btn.dataset.value; $$('.star-btn', group).forEach(b => b.classList.toggle('on', Number(b.dataset.value) <= Number(btn.dataset.value))); }); }); }
function saveFeedback() {
  const get = n => Number($(`[data-rating="${n}"]`).dataset.selected || 0);
  const tester = $('#testerName').value.trim() || 'Anonymous tester'; const useful = get('useful'), easy = get('easy'), trust = get('trust');
  if (!useful || !easy || !trust) { showToast('Tap a rating for all 3 questions'); return; }
  state.profile.tester = tester; state.feedback.unshift({ id: uid('feedback'), tester, useful, easy, trust, notes: $('#feedbackNotes').value.trim(), createdAt: new Date().toISOString() }); saveState(); renderTest(); showToast('Feedback saved');
}

function openSettings() {
  settingsContent.innerHTML = `<div class="sheet-inner"><div class="sheet-head"><div><div class="eyebrow">Settings</div><h2>Your HeadsUp</h2></div><button class="close-btn" data-close>×</button></div>
    <div class="field"><label>Your name</label><input id="setOwner" value="${escapeHtml(state.profile.owner)}"></div>
    <div class="field"><label>Home name</label><input id="setHome" value="${escapeHtml(state.profile.homeName)}"></div>
    <div class="field"><label>City</label><input id="setCity" value="${escapeHtml(state.profile.city)}"></div>
    <div class="field"><label>Home year</label><input id="setYear" type="number" min="1700" max="2100" value="${state.profile.homeYear || ''}"></div>
    <div class="button-row"><button class="primary-btn" id="saveSettings">Save</button><button class="ghost-btn" id="openStuff">My stuff</button></div>
    <div class="button-row"><button class="ghost-btn" id="backupSettings">Export backup</button><label class="ghost-btn file-label">Import backup<input id="importFile" type="file" accept="application/json" hidden></label></div>
    <button class="danger-btn" id="resetData" style="width:100%;margin-top:12px">Reset all local data</button>
    <div class="notice" style="margin-top:14px">Everything is stored in this browser. Export a backup before switching phones or clearing browser data.</div></div>`;
  settingsDialog.showModal();
  $('[data-close]', settingsContent).onclick = () => settingsDialog.close();
  $('#saveSettings').onclick = () => { state.profile.owner = $('#setOwner').value.trim() || 'Josh'; state.profile.homeName = $('#setHome').value.trim() || 'My Home'; state.profile.city = $('#setCity').value.trim(); state.profile.homeYear = Number($('#setYear').value) || null; state.profile.setupComplete = true; const home = state.assets.find(a => a.type === 'Home'); if (home) home.name = state.profile.homeName; saveState(); settingsDialog.close(); render(); showToast('Settings saved'); };
  $('#openStuff').onclick = openAssets; $('#backupSettings').onclick = exportData; $('#importFile').onchange = importData;
  $('#resetData').onclick = () => { if (confirm('Reset all HeadsUp data on this device?')) { localStorage.removeItem(STORAGE_KEY); localStorage.removeItem(LEGACY_KEY); state = freshState(); saveState(); settingsDialog.close(); render(); showToast('HeadsUp reset'); } };
}

function exportData() {
  const payload = { app: 'HeadsUp AI', version: '0.2', exportedAt: new Date().toISOString(), data: state };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' }); const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = `headsup-ai-${new Date().toISOString().slice(0, 10)}.json`; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); showToast('Backup exported');
}
async function importData(e) {
  try {
    const file = e.target.files?.[0]; if (!file) return; const parsed = JSON.parse(await file.text()); const incoming = parsed.data || parsed;
    if (!incoming.profile || !Array.isArray(incoming.tasks)) throw new Error('Invalid backup');
    state = normalizeState(incoming); saveState(); settingsDialog.close(); render(); showToast('Backup imported');
  } catch (err) { showToast('That file is not a valid HeadsUp backup'); }
}

window.addEventListener('click', e => { if (e.target === taskDialog) taskDialog.close(); if (e.target === settingsDialog) settingsDialog.close(); });
if ('serviceWorker' in navigator) window.addEventListener('load', () => navigator.serviceWorker.register('./sw.js').catch(err => console.warn('SW registration failed', err)));

render();
