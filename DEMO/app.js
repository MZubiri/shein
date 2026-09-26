const nav = document.querySelector('.main-nav');
const menuToggle = document.querySelector('.menu-toggle');
const modalBackdrop = document.querySelector('#modalBackdrop');
const modalTitle = document.querySelector('#modalTitle');
const modalCopy = document.querySelector('#modalCopy');
const modalInput = document.querySelector('#modalHabboUser');
const modalSubmit = document.querySelector('#modalSubmit');
const formError = document.querySelector('#formError');
const demoForm = document.querySelector('#demoForm');
let modalMode = '';
let selectedMembership = '';
let previousFocus = null;

function setMenu(open) {
  nav.classList.toggle('open', open);
  menuToggle.setAttribute('aria-expanded', String(open));
  menuToggle.setAttribute('aria-label', open ? 'Cerrar menú' : 'Abrir menú');
}

menuToggle.addEventListener('click', () => setMenu(!nav.classList.contains('open')));
document.querySelectorAll('.main-nav a').forEach((link) => link.addEventListener('click', () => setMenu(false)));
document.addEventListener('click', (event) => {
  if (nav.classList.contains('open') && !event.target.closest('.topbar')) setMenu(false);
});

function openModal(mode, membership = '') {
  previousFocus = document.activeElement;
  modalMode = mode;
  selectedMembership = membership;
  formError.textContent = '';
  modalInput.removeAttribute('aria-invalid');
  modalInput.value = '';

  const content = {
    register: ['Únete a la comunidad.', 'Crea tu acceso y verifica tu usuario de Habbo en tres pasos sencillos.', 'Empezar registro'],
    login: ['Bienvenido de vuelta.', 'Introduce tu usuario para entrar al panel privado de esta demo.', 'Acceder al panel'],
    membership: [`Membresía ${membership}.`, 'Identifícate para iniciar la solicitud. La administración revisará tu petición antes de activarla.', 'Solicitar membresía']
  }[mode];

  modalTitle.textContent = content[0];
  modalCopy.textContent = content[1];
  modalSubmit.innerHTML = `${content[2]} <span aria-hidden="true">↗</span>`;
  modalBackdrop.hidden = false;
  document.body.style.overflow = 'hidden';
  window.setTimeout(() => modalInput.focus(), 0);
}

function closeModal() {
  modalBackdrop.hidden = true;
  document.body.style.overflow = '';
  if (previousFocus) previousFocus.focus();
}

document.querySelectorAll('[data-modal]').forEach((button) => button.addEventListener('click', () => openModal(button.dataset.modal)));
document.querySelectorAll('[data-membership]').forEach((button) => button.addEventListener('click', () => openModal('membership', button.dataset.membership)));
document.querySelector('.modal-close').addEventListener('click', closeModal);
modalBackdrop.addEventListener('click', (event) => {
  if (event.target === modalBackdrop) closeModal();
});

document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') {
    if (!modalBackdrop.hidden) closeModal();
    setMenu(false);
  }
  if (event.key === 'Tab' && !modalBackdrop.hidden) {
    const focusable = [...modalBackdrop.querySelectorAll('button, input')];
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  }
});

demoForm.addEventListener('submit', (event) => {
  event.preventDefault();
  const username = modalInput.value.trim();
  if (username.length < 2) {
    formError.textContent = 'Escribe un usuario de Habbo válido.';
    modalInput.setAttribute('aria-invalid', 'true');
    modalInput.focus();
    return;
  }
  const params = new URLSearchParams({ user: username });
  if (selectedMembership) params.set('membership', selectedMembership);
  if (modalMode === 'login') params.set('mode', 'login');
  window.location.href = `registro.html?${params}`;
});
modalInput.addEventListener('input', () => {
  formError.textContent = '';
  modalInput.removeAttribute('aria-invalid');
});

if (new URLSearchParams(location.search).get('login') === 'required') openModal('login');

const countryTimes = {
  España: { label: 'España', time: '22:00' },
  Canarias: { label: 'España (Islas Canarias)', time: '21:00' },
  Argentina: { label: 'Argentina', time: '17:00' },
  Chile: { label: 'Chile', time: '17:00' },
  Colombia: { label: 'Colombia', time: '15:00' },
  México: { label: 'México (Ciudad de México)', time: '14:00' },
  Perú: { label: 'Perú', time: '15:00' }
};
const countrySelect = document.querySelector('#country');
const timeRows = [...document.querySelectorAll('#timeList > div')];
const nextPayout = document.querySelector('.next-payout strong');

function updateCountry() {
  const selected = countryTimes[countrySelect.value];
  nextPayout.textContent = `Hoy · ${selected.time}`;
  timeRows.forEach((row) => row.classList.toggle('selected', row.querySelector('span').textContent === selected.label));
}
countrySelect.addEventListener('change', updateCountry);

const playRadio = document.querySelector('#playRadio');
const playLabel = document.querySelector('#playLabel');
const radioStatus = document.querySelector('#radioStatus');
const radioTrack = document.querySelector('#radioTrack');
const radioVisual = document.querySelector('.radio-visual');
let radioPlaying = false;
playRadio.addEventListener('click', () => {
  radioPlaying = !radioPlaying;
  playRadio.setAttribute('aria-pressed', String(radioPlaying));
  playLabel.textContent = radioPlaying ? 'Pausar radio' : 'Escuchar radio';
  radioStatus.textContent = radioPlaying ? 'REPRODUCIENDO DEMO' : 'AGENCIA SHEIN RADIO';
  radioTrack.textContent = radioPlaying ? 'Sesión Shein en directo' : 'Tu comunidad, tu música';
  playRadio.querySelector('.play-icon').textContent = radioPlaying ? 'Ⅱ' : '▶';
  radioVisual.classList.toggle('playing', radioPlaying);
});

const sections = [...document.querySelectorAll('main section[id]')];
const navLinks = [...document.querySelectorAll('.main-nav a')];
if ('IntersectionObserver' in window) {
  const sectionObserver = new IntersectionObserver((entries) => {
    const visible = entries.filter((entry) => entry.isIntersecting).sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
    if (!visible) return;
    navLinks.forEach((link) => link.classList.toggle('active', link.hash === `#${visible.target.id}`));
  }, { rootMargin: '-30% 0px -55%', threshold: [0, .2, .5] });
  sections.forEach((section) => sectionObserver.observe(section));
}
