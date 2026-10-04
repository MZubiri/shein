(function () {
  'use strict';

  let localTimers = [];

  function formatDuration(totalSeconds) {
    const s = Math.max(0, Math.floor(totalSeconds));
    const hours = Math.floor(s / 3600);
    const minutes = Math.floor((s % 3600) / 60);
    const seconds = s % 60;
    const pad = (n) => String(n).padStart(2, '0');
    return `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`;
  }

  function updateClock() {
    const now = new Date();
    const clockEl = document.getElementById('kioskClock');
    const dateEl = document.getElementById('kioskDate');
    if (clockEl) {
      clockEl.textContent = now.toLocaleTimeString('es-ES', { hour12: false });
    }
    if (dateEl) {
      dateEl.textContent = now.toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'short', year: 'numeric' });
    }
  }

  async function fetchKioskData() {
    try {
      const res = await fetch('/api/kiosk/live');
      if (!res.ok) return;
      const data = await res.json();
      renderKiosk(data);
    } catch (err) {
      console.error('Error fetching kiosk data:', err);
    }
  }

  function renderKiosk(data) {
    // 1. Timers
    localTimers = (data.timers || []).map((t) => {
      const started = new Date(t.started_at).getTime();
      const baseSec = Number(t.accumulated_seconds || 0);
      const isRunning = t.status === 'active';
      return {
        ...t,
        clientStart: Date.now(),
        clientBase: isRunning ? baseSec + Math.max(0, Math.floor((Date.now() - started) / 1000) - baseSec) : baseSec
      };
    });

    const timersCountEl = document.getElementById('kioskTimersCount');
    if (timersCountEl) {
      timersCountEl.textContent = `${localTimers.length} ACTIVOS`;
    }

    renderTimersUi();

    // 2. Attendance session
    const session = data.session;
    const banner = document.getElementById('kioskAttBanner');
    const badge = document.getElementById('kioskSessionBadge');
    const shiftName = document.getElementById('kioskShiftName');
    const shiftMeta = document.getElementById('kioskShiftMeta');
    const presentCount = document.getElementById('kioskAttPresentCount');

    if (session) {
      if (banner) banner.classList.remove('closed');
      if (badge) {
        badge.textContent = 'ABIERTO';
        badge.className = 'kiosk-tag active';
      }
      if (shiftName) shiftName.textContent = session.shift_name;
      if (shiftMeta) shiftMeta.textContent = `Iniciado por ${session.creator_name || 'Dirección'}`;
      if (presentCount) presentCount.textContent = session.counts?.present || 0;
    } else {
      if (banner) banner.classList.add('closed');
      if (badge) {
        badge.textContent = 'EN ESPERA';
        badge.className = 'kiosk-tag';
      }
      if (shiftName) shiftName.textContent = 'Sin pase de lista abierto';
      if (shiftMeta) shiftMeta.textContent = 'Próximo turno programado: 22:00 (España)';
      if (presentCount) presentCount.textContent = '0';
    }

    // 3. Recent Promotions
    const promosEl = document.getElementById('kioskPromotionsList');
    if (promosEl && data.recentPromotions) {
      if (!data.recentPromotions.length) {
        promosEl.innerHTML = '<p style="color:#888;text-align:center;padding:12px;">Sin ascensos recientes registrados.</p>';
      } else {
        promosEl.innerHTML = data.recentPromotions.map((p) => {
          const avatarUrl = `https://www.habbo.es/habbo-imaging/avatarimage?user=${encodeURIComponent(p.username)}&head_direction=2&headonly=1&size=m`;
          const d = new Date(p.created_at);
          const timeStr = d.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });
          return `
            <div class="kiosk-promo-item">
              <div style="display:flex;align-items:center;gap:10px;">
                <img src="${avatarUrl}" alt="${p.username}" style="width:36px;height:36px;border-radius:50%;background:#252320;" onerror="this.style.display='none'" />
                <div>
                  <strong style="color:#fff;font-size:14px;">${p.username}</strong>
                  <small style="color:var(--yellow);display:block;font-size:12px;">${p.new_mission}</small>
                </div>
              </div>
              <div style="text-align:right;">
                <small style="color:#a8a096;font-size:11px;">por ${p.promoter_name}</small>
                <div style="color:#888;font-size:10px;">${timeStr}</div>
              </div>
            </div>
          `;
        }).join('');
      }
    }

    // 4. Top active in base
    const topEl = document.getElementById('kioskTopActiveList');
    if (topEl && data.topActive) {
      topEl.innerHTML = data.topActive.map((u, i) => {
        const hours = (Number(u.accumulated_time_seconds || 0) / 3600).toFixed(1);
        const avatarUrl = `https://www.habbo.es/habbo-imaging/avatarimage?user=${encodeURIComponent(u.username)}&head_direction=2&headonly=1&size=s`;
        return `
          <div class="kiosk-promo-item">
            <div style="display:flex;align-items:center;gap:10px;">
              <span style="font-weight:700;color:var(--yellow);width:16px;">#${i + 1}</span>
              <img src="${avatarUrl}" alt="${u.username}" style="width:28px;height:28px;border-radius:50%;background:#252320;" onerror="this.style.display='none'" />
              <div>
                <strong style="color:#fff;font-size:13px;">${u.username}</strong>
                <small style="color:#888;font-size:11px;display:block;">${u.rank_name || 'Agente'}</small>
              </div>
            </div>
            <strong style="color:var(--yellow);font-family:monospace;font-size:14px;">${hours}h</strong>
          </div>
        `;
      }).join('');
    }
  }

  function renderTimersUi() {
    const listEl = document.getElementById('kioskTimersList');
    if (!listEl) return;

    if (!localTimers.length) {
      listEl.innerHTML = '<p style="color:#888;text-align:center;padding:24px;">No hay cronómetros activos en este momento.</p>';
      return;
    }

    listEl.innerHTML = localTimers.map((t) => {
      const elapsed = t.status === 'active'
        ? t.clientBase + Math.floor((Date.now() - t.clientStart) / 1000)
        : t.clientBase;

      const avatarUrl = `https://www.habbo.es/habbo-imaging/avatarimage?user=${encodeURIComponent(t.username)}&head_direction=2&headonly=1&size=m`;
      return `
        <div class="kiosk-timer-row">
          <div class="kiosk-timer-user">
            <img src="${avatarUrl}" alt="${t.username}" style="width:40px;height:40px;border-radius:50%;background:#1a1918;" onerror="this.style.display='none'" />
            <div>
              <strong>${t.username}</strong>
              <small>${t.rank_name || 'Agente'} · Ubicación: <b style="color:#ede8e3;">${t.location}</b></small>
            </div>
          </div>
          <div class="kiosk-timer-time" data-timer-id="${t.id}">${formatDuration(elapsed)}</div>
        </div>
      `;
    }).join('');
  }

  // Ticker que corre cada segundo para fluidez total del cronómetro
  function tickTimers() {
    updateClock();
    if (!localTimers.length) return;
    localTimers.forEach((t) => {
      if (t.status === 'active') {
        const el = document.querySelector(`.kiosk-timer-time[data-timer-id="${t.id}"]`);
        if (el) {
          const elapsed = t.clientBase + Math.floor((Date.now() - t.clientStart) / 1000);
          el.textContent = formatDuration(elapsed);
        }
      }
    });
  }

  // Pantalla Completa
  document.getElementById('btnToggleFullscreen')?.addEventListener('click', () => {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen().catch(() => {});
    } else {
      document.exitFullscreen().catch(() => {});
    }
  });

  // Inicialización
  setInterval(tickTimers, 1000);
  setInterval(fetchKioskData, 10000);

  updateClock();
  fetchKioskData();
})();
