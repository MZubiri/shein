const sideLinks = [...document.querySelectorAll('.side-link[data-view]')];
const views = [...document.querySelectorAll('.view')];
const viewTitle = document.querySelector('#viewTitle');
const viewCrumb = document.querySelector('#viewCrumb');
const sidebar = document.querySelector('#sidebar');
const mobileMenu = document.querySelector('#mobileMenu');
const toast = document.querySelector('#toast');
const titles = {
  overview: 'Buenos días, keekit08 ✦',
  account: 'Tu espacio personal',
  ranks: 'Información de rangos',
  departments: 'Estructura de departamentos',
  promotions: 'Gestión de ascensos',
  timers: 'Control de tiempos',
  payroll: 'Cierre de nómina',
  ranking: 'Ranking de la agencia',
  members: 'Usuarios de la agencia',
  attendance: 'Control de asistencia',
  payments: 'Lista de paga',
  requests: 'Pre-registros pendientes',
  memberships: 'Catálogo de membresías',
  operations: 'Ventas y traslados',
  missions: 'Gestión de misiones',
  discipline: 'Moderación y disciplina',
  content: 'Contenido público',
  audit: 'Registro de actividad',
  tools: 'Herramientas administrativas',
  bot: 'Bot y Discord',
  settings: 'Configuración de agencia'
};
const crumbs = {
  overview: 'Resumen', account: 'Mi cuenta', ranks: 'Rangos', departments: 'Departamentos', promotions: 'Ascensos', timers: 'Tiempos',
  payroll: 'Nómina', attendance: 'Pase de lista', ranking: 'Top ranking', members: 'Usuarios',
  requests: 'Pre-registros', payments: 'Lista de paga', memberships: 'Membresías',
  operations: 'Operaciones', missions: 'Misiones', discipline: 'Disciplina', content: 'Contenido',
  audit: 'Registros', tools: 'Herramientas', bot: 'Bot y Discord', settings: 'Configuración'
};
let toastTimer;

const sidebarOverlay = document.createElement('button');
sidebarOverlay.className = 'sidebar-overlay';
sidebarOverlay.type = 'button';
sidebarOverlay.setAttribute('aria-label', 'Cerrar navegación');
document.body.append(sidebarOverlay);
toast.setAttribute('role', 'status');
toast.setAttribute('aria-live', 'polite');
mobileMenu.setAttribute('aria-label', 'Abrir navegación');
mobileMenu.setAttribute('aria-controls', 'sidebar');
mobileMenu.setAttribute('aria-expanded', 'false');

function showToast(message) {
  toast.textContent = message;
  toast.classList.add('show');
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => toast.classList.remove('show'), 2400);
}

function setSidebar(open) {
  sidebar.classList.toggle('open', open);
  sidebarOverlay.classList.toggle('open', open);
  mobileMenu.setAttribute('aria-expanded', String(open));
  mobileMenu.setAttribute('aria-label', open ? 'Cerrar navegación' : 'Abrir navegación');
}

function showView(name, updateHistory = false) {
  if (!titles[name]) name = 'overview';
  sideLinks.forEach((link) => {
    const active = link.dataset.view === name;
    link.classList.toggle('active', active);
    link.setAttribute('aria-current', active ? 'page' : 'false');
  });
  views.forEach((view) => view.classList.toggle('active', view.id === `view-${name}`));
  viewTitle.textContent = titles[name];
  viewCrumb.textContent = crumbs[name];
  setSidebar(false);
  if (updateHistory) history.pushState({ view: name }, '', `#${name}`);
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

sideLinks.forEach((link) => link.addEventListener('click', () => showView(link.dataset.view, true)));
document.querySelectorAll('[data-view-action]').forEach((button) => button.addEventListener('click', () => showView(button.dataset.viewAction, true)));
mobileMenu.addEventListener('click', () => setSidebar(!sidebar.classList.contains('open')));
sidebarOverlay.addEventListener('click', () => setSidebar(false));
window.addEventListener('popstate', () => showView(location.hash.slice(1) || 'overview'));
document.addEventListener('keydown', (event) => { if (event.key === 'Escape') setSidebar(false); });

const headerDate = document.querySelector('.header-date');
headerDate.textContent = new Intl.DateTimeFormat('es-ES', { day:'2-digit', month:'short', year:'numeric' }).format(new Date()).replaceAll('.', '').toUpperCase();

const memberSearch = document.querySelector('#memberSearch');
const memberRows = [...document.querySelectorAll('#membersTable tr')];
const emptyRow = document.createElement('tr');
emptyRow.className = 'empty-row';
emptyRow.hidden = true;
emptyRow.innerHTML = '<td colspan="5">No encontramos miembros con ese nombre.</td>';
document.querySelector('#membersTable').append(emptyRow);
memberSearch.addEventListener('input', (event) => {
  const query = event.target.value.trim().toLocaleLowerCase('es');
  let visible = 0;
  memberRows.forEach((row) => {
    const matches = row.textContent.toLocaleLowerCase('es').includes(query);
    row.hidden = !matches;
    if (matches) visible += 1;
  });
  emptyRow.hidden = visible !== 0;
});

let pendingRequests = document.querySelectorAll('.request-card').length;
function updatePendingCount() {
  document.querySelectorAll('.side-link[data-view="requests"] b, .pending-badge').forEach((badge) => {
    badge.textContent = badge.classList.contains('pending-badge') ? `${pendingRequests} pendientes` : String(pendingRequests);
  });
}

document.querySelectorAll('.request-card .approve, .request-card .reject').forEach((button) => button.addEventListener('click', () => {
  const card = button.closest('.request-card');
  if (card.classList.contains('resolved')) return;
  const approved = button.classList.contains('approve');
  card.classList.add('resolved');
  card.querySelector('.request-actions').textContent = approved ? '✓ Solicitud actualizada' : '— Solicitud descartada';
  pendingRequests = Math.max(0, pendingRequests - 1);
  updatePendingCount();
  showToast(approved ? 'Solicitud actualizada correctamente' : 'Solicitud descartada');
}));

const attendanceInputs = [...document.querySelectorAll('.check-list input')];
const attendanceTotal = document.querySelector('.attendance-banner > strong');
function updateAttendance(input) {
  if (input) {
    const label = input.closest('label');
    label.querySelector('small').textContent = input.checked ? 'Presente · actualizado ahora' : 'Miembro · pendiente';
    label.querySelector('em').textContent = input.checked ? new Date().toLocaleTimeString('es-ES', { hour:'2-digit', minute:'2-digit' }) : '--:--';
  }
  const present = 72 + attendanceInputs.filter((item) => item.checked).length;
  attendanceTotal.innerHTML = `${present} <small>/ 92 presentes</small>`;
}
attendanceInputs.forEach((input) => input.addEventListener('change', () => updateAttendance(input)));

const settingsFields = [...document.querySelectorAll('#view-settings .settings-card input, #view-settings .settings-card textarea, #view-settings .settings-card select')];
try {
  const savedSettings = JSON.parse(localStorage.getItem('shein-demo-settings') || 'null');
  if (savedSettings) settingsFields.forEach((field, index) => {
    if (field.type === 'checkbox') field.checked = savedSettings[index];
    else if (savedSettings[index] !== undefined) field.value = savedSettings[index];
  });
} catch { /* The demo works even if storage is unavailable. */ }

document.querySelector('#saveSettings').addEventListener('click', () => {
  const values = settingsFields.map((field) => field.type === 'checkbox' ? field.checked : field.value);
  try { localStorage.setItem('shein-demo-settings', JSON.stringify(values)); } catch { /* no-op */ }
  showToast('Cambios guardados en este dispositivo ✓');
});

const activeMemberships = document.createElement('div');
activeMemberships.className = 'surface table-surface membership-active-table';
activeMemberships.innerHTML = '<div class="surface-heading"><div><p class="eyebrow">Asignaciones</p><h3>Membresías activas</h3></div><div class="search-box compact-search">⌕ <input id="membershipSearch" placeholder="Buscar usuario..." /></div></div><table><thead><tr><th>MEMBRESÍA</th><th>USUARIO</th><th>ENCARGADO</th><th>INICIA</th><th>TERMINA</th><th>ESTADO</th><th></th></tr></thead><tbody id="membershipRows"><tr><td><b>Reducción</b></td><td>R3belde</td><td>keekit08</td><td>24 ago</td><td>23 sep</td><td><span class="status online">● Activa</span></td><td><button class="row-menu">•••</button></td></tr><tr><td><b>AFK</b></td><td>4karen</td><td>keekit08</td><td>24 ago</td><td>23 sep</td><td><span class="status online">● Activa</span></td><td><button class="row-menu">•••</button></td></tr><tr><td><b>Regla libre</b></td><td>Ailin:0</td><td>MatteoMessina.</td><td>31 ago</td><td>30 sep</td><td><span class="status online">● Activa</span></td><td><button class="row-menu">•••</button></td></tr></tbody></table>';
document.querySelector('#view-memberships').append(activeMemberships);
const membershipRows = [...document.querySelectorAll('#membershipRows tr')];
document.querySelector('#membershipSearch').addEventListener('input', (event) => {
  const query = event.target.value.toLocaleLowerCase('es');
  membershipRows.forEach((row) => { row.hidden = !row.textContent.toLocaleLowerCase('es').includes(query); });
});

document.querySelectorAll('.discipline-tabs button').forEach((button) => button.addEventListener('click', () => {
  document.querySelectorAll('.discipline-tabs button').forEach((item) => item.classList.toggle('active', item === button));
  document.querySelectorAll('#disciplineRows tr').forEach((row) => {
    row.hidden = button.dataset.caseFilter !== 'all' && row.dataset.case !== button.dataset.caseFilter;
  });
}));

let timerPaused = false;
document.querySelectorAll('[data-timer-action]').forEach((button) => button.addEventListener('click', () => {
  if (button.dataset.timerAction === 'pause') {
    timerPaused = !timerPaused;
    button.textContent = timerPaused ? 'Reanudar' : 'Pausar';
    document.querySelector('#liveTimer').closest('article').querySelector('.live-dot').style.background = timerPaused ? '#ba9651' : '';
    showToast(timerPaused ? 'Timer pausado' : 'Timer reanudado');
    return;
  }
  showToast('Tiempo confirmado y guardado ✓');
}));

document.querySelectorAll('[data-demo-action]').forEach((button) => button.addEventListener('click', () => {
  showToast(`${button.dataset.demoAction} · acción preparada en la demo`);
}));

document.querySelectorAll('[data-account-tab]').forEach((button) => button.addEventListener('click', () => {
  document.querySelectorAll('[data-account-tab]').forEach((item) => item.classList.toggle('active', item === button));
  document.querySelectorAll('[data-account-panel]').forEach((panel) => panel.classList.toggle('active', panel.dataset.accountPanel === button.dataset.accountTab));
}));

const rankFrom = document.querySelector('#rankFrom');
const rankTo = document.querySelector('#rankTo');
function updateRankPrice() {
  const difference = Math.max(0, Number(rankTo.value) - Number(rankFrom.value));
  document.querySelector('#rankPrice').textContent = `${difference} c`;
}
rankFrom.addEventListener('change', updateRankPrice);
rankTo.addEventListener('change', updateRankPrice);

document.querySelectorAll('.primary-action:not(#saveSettings), .dark-action, .outline-action, .filter-button').forEach((button) => {
  if (
    button.id ||
    button.closest('form') ||
    button.type === 'submit' ||
    button.hasAttribute('data-view-action') ||
    button.hasAttribute('data-demo-action') ||
    button.hasAttribute('data-timer-action') ||
    button.hasAttribute('data-account-tab') ||
    window.SheinApi
  ) return;
  button.addEventListener('click', () => showToast(`${button.textContent.trim()} · guardado`));
});

showView(location.hash.slice(1) || 'overview');
