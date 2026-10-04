// Synthesizer de Efectos de Sonido Habbo Retro usando Web Audio API
(function () {
  'use strict';

  let audioCtx = null;
  let enabled = localStorage.getItem('shein_sound_enabled') !== 'false';

  function getAudioContext() {
    if (!audioCtx) {
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      if (AudioContextClass) {
        audioCtx = new AudioContextClass();
      }
    }
    if (audioCtx && audioCtx.state === 'suspended') {
      audioCtx.resume().catch(() => {});
    }
    return audioCtx;
  }

  function playTone(freq, type, startTime, duration, gainValue = 0.1) {
    const ctx = getAudioContext();
    if (!ctx) return;

    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = type;
    osc.frequency.setValueAtTime(freq, startTime);

    gain.gain.setValueAtTime(gainValue, startTime);
    gain.gain.exponentialRampToValueAtTime(0.001, startTime + duration);

    osc.connect(gain);
    gain.connect(ctx.destination);

    osc.start(startTime);
    osc.stop(startTime + duration);
  }

  const sounds = {
    // 1. Timbre de consola Habbo (Notificación / Timer)
    console() {
      const ctx = getAudioContext();
      if (!ctx) return;
      const now = ctx.currentTime;
      playTone(587.33, 'sine', now, 0.08, 0.12); // D5
      playTone(880.0, 'sine', now + 0.09, 0.16, 0.15); // A5
    },

    // 2. Ascenso de rango / Fanfarria de nivel
    levelUp() {
      const ctx = getAudioContext();
      if (!ctx) return;
      const now = ctx.currentTime;
      playTone(523.25, 'triangle', now, 0.1, 0.14); // C5
      playTone(659.25, 'triangle', now + 0.1, 0.1, 0.14); // E5
      playTone(783.99, 'triangle', now + 0.2, 0.1, 0.16); // G5
      playTone(1046.5, 'triangle', now + 0.3, 0.28, 0.18); // C6
    },

    // 3. Monedas / Créditos Habbo (Ventas y Pagas)
    coin() {
      const ctx = getAudioContext();
      if (!ctx) return;
      const now = ctx.currentTime;
      playTone(987.77, 'square', now, 0.07, 0.06); // B5
      playTone(1318.51, 'square', now + 0.08, 0.22, 0.08); // E6
    },

    // 4. Clic táctil de interfaz
    click() {
      const ctx = getAudioContext();
      if (!ctx) return;
      const now = ctx.currentTime;
      playTone(350, 'sine', now, 0.03, 0.05);
    }
  };

  function play(name) {
    if (!enabled) return;
    try {
      if (sounds[name]) {
        sounds[name]();
      }
    } catch {
      // Ignorar si el audio no está permitido por el navegador aún
    }
  }

  function setEnabled(value) {
    enabled = Boolean(value);
    localStorage.setItem('shein_sound_enabled', enabled ? 'true' : 'false');
    updateUi();
  }

  function toggle() {
    setEnabled(!enabled);
    if (enabled) {
      play('console');
    }
    return enabled;
  }

  function updateUi() {
    const buttons = document.querySelectorAll('.sound-toggle-btn, #btnToggleSound');
    buttons.forEach((btn) => {
      btn.textContent = enabled ? '🔊' : '🔇';
      btn.setAttribute('title', enabled ? 'Efectos de sonido Habbo: Activados' : 'Efectos de sonido Habbo: Silenciados');
      btn.classList.toggle('muted', !enabled);
    });
  }

  // Desbloqueo automático en primer clic del usuario
  document.addEventListener('click', function unlockAudio() {
    getAudioContext();
    document.removeEventListener('click', unlockAudio);
  }, { once: true });

  window.habboSound = {
    play,
    toggle,
    setEnabled,
    isEnabled: () => enabled,
    updateUi
  };

  document.addEventListener('DOMContentLoaded', updateUi);
})();
