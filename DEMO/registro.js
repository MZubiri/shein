const form = document.querySelector('#registerForm');
const successCard = document.querySelector('#successCard');
const formTitle = document.querySelector('#formTitle');
const formCopy = document.querySelector('#formCopy');
const stepLabel = document.querySelector('#stepLabel');
const formButton = document.querySelector('#formButton');
const habboField = document.querySelector('#habboField');
const fieldError = document.querySelector('#registerError');
const stepItems = [...document.querySelectorAll('.steps span')];
const params = new URLSearchParams(window.location.search);
const purpose = params.get('mode') === 'login' ? 'login' : 'register';
const api = window.SheinApi;
let username = params.get('user') || '';
let challengeId = '';
let apiOnline = false;
let simulated = false;
let step = 1;

const initialInput = document.querySelector('#habboUser');
initialInput.value = username;
if (username) initialInput.focus();
if (purpose === 'login') {
  formTitle.textContent = 'Verifica tu acceso.';
  formCopy.textContent = 'Escribe tu usuario de Habbo. Usaremos una misión temporal para iniciar sesión sin pedirte ninguna contraseña.';
  document.querySelector('.form-foot').textContent = 'Tu contraseña de Habbo nunca se solicita ni se almacena.';
}

api?.available().then((available) => { apiOnline = available; });

function setProgress(currentStep) {
  stepItems.forEach((item, index) => {
    const number = index + 1;
    item.classList.toggle('active', number === currentStep);
    item.classList.toggle('completed', number < currentStep);
    if (number === currentStep) item.setAttribute('aria-current', 'step');
    else item.removeAttribute('aria-current');
  });
}

function setBusy(busy, label) {
  formButton.toggleAttribute('disabled', busy);
  formButton.setAttribute('aria-busy', String(busy));
  if (label) formButton.textContent = label;
}

async function copyCode() {
  const code = document.querySelector('#verificationCode').value;
  try {
    await navigator.clipboard.writeText(code);
  } catch {
    document.querySelector('#verificationCode').select();
    document.execCommand('copy');
  }
  const copyButton = document.querySelector('#copyCode');
  copyButton.textContent = 'Copiado ✓';
  window.setTimeout(() => { copyButton.textContent = 'Copiar'; }, 1800);
}

function showVerification(code, isSimulated = false) {
  simulated = isSimulated;
  step = 2;
  stepLabel.textContent = '02';
  formTitle.textContent = purpose === 'login' ? 'Confirma que eres tú.' : 'Verifica tu misión.';
  formCopy.textContent = simulated
    ? `Hola, ${username}. Esta demo simulará que la verificación de Habbo fue completada correctamente.`
    : `Hola, ${username}. Copia este código en la misión de tu perfil público de Habbo y pulsa comprobar.`;
  habboField.innerHTML = 'Código temporal<div class="copy-row"><input id="verificationCode" readonly /><button class="copy-button" id="copyCode" type="button">Copiar</button></div><p class="verification-note"></p>';
  document.querySelector('#verificationCode').value = code;
  document.querySelector('.verification-note').textContent = simulated
    ? 'Modo demostración: no necesitas modificar tu misión ni proporcionar ninguna contraseña.'
    : 'El código vence en 10 minutos. Tu contraseña de Habbo nunca se solicita.';
  document.querySelector('#copyCode').addEventListener('click', copyCode);
  formButton.innerHTML = `${simulated ? 'Completar acceso demo' : 'Comprobar misión'} <span aria-hidden="true">↗</span>`;
  fieldError.textContent = '';
  setProgress(2);
}

function completeRegistration() {
  step = 3;
  stepLabel.textContent = '03';
  setProgress(3);
  stepItems[2].classList.add('completed');
  stepItems[2].removeAttribute('aria-current');
  document.querySelector('#registeredUser').textContent = username;
  successCard.querySelector('h2').textContent = purpose === 'login' ? 'Acceso confirmado.' : 'Te esperamos dentro.';
  const message = successCard.querySelector('p:not(.eyebrow)');
  message.innerHTML = '';
  const strong = document.createElement('strong');
  strong.id = 'registeredUser';
  strong.textContent = username;
  message.append(strong, document.createTextNode(purpose === 'login' ? ' ya puede entrar a su espacio de trabajo.' : ' queda preparado para la aprobación de la administración.'));
  successCard.querySelector('a').innerHTML = `${purpose === 'login' ? 'Entrar al panel' : 'Ver panel'} <span aria-hidden="true">↗</span>`;
  form.hidden = true;
  successCard.hidden = false;
  successCard.querySelector('a').focus();
}

async function requestChallenge() {
  setBusy(true, 'Preparando código…');
  try {
    apiOnline = apiOnline || await api?.available();
    if (apiOnline) {
      const response = await api.request('/auth/challenge', { method:'POST', body:{ username, purpose } });
      challengeId = response.challengeId;
      showVerification(response.code, Boolean(response.simulated));
    } else {
      showVerification('SHEIN-DEMO', true);
      fieldError.textContent = 'Modo demostración: la API no está conectada; la verificación será simulada.';
    }
  } catch (error) {
    fieldError.textContent = error.message;
  } finally {
    setBusy(false);
    if (step === 1) formButton.innerHTML = 'Continuar <span aria-hidden="true">↗</span>';
  }
}

async function verifyChallenge() {
  setBusy(true, 'Comprobando…');
  try {
    if (apiOnline) await api.request('/auth/verify', { method:'POST', body:{ challengeId } });
    else await new Promise((resolve) => window.setTimeout(resolve, 650));
    completeRegistration();
  } catch (error) {
    fieldError.textContent = error.message;
    formButton.innerHTML = 'Volver a comprobar <span aria-hidden="true">↗</span>';
  } finally {
    setBusy(false);
  }
}

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  fieldError.textContent = '';
  if (step === 1) {
    username = document.querySelector('#habboUser').value.trim();
    if (!/^[A-Za-z0-9._:!\-]{2,32}$/.test(username)) {
      fieldError.textContent = 'Escribe un usuario de Habbo válido.';
      document.querySelector('#habboUser').setAttribute('aria-invalid', 'true');
      document.querySelector('#habboUser').focus();
      return;
    }
    await requestChallenge();
    return;
  }
  await verifyChallenge();
});

initialInput.addEventListener('input', () => {
  fieldError.textContent = '';
  initialInput.removeAttribute('aria-invalid');
});
