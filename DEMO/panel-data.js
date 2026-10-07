(() => {
  const api = window.SheinApi;
  if (!api) return;

  const roleLabels = { owner:'Dueño', admin:'Administrador', supervisor:'Supervisor', member:'Miembro', pending:'Pendiente' };
  const statusLabels = { active:'Activo', away:'Ausente', inactive:'Inactivo', pending:'Pendiente', blocked:'Bloqueado' };
  let currentPage = 1;
  let searchTimer;
  let cachedRanks = [];
  let cachedMembers = [];
  let currentEditMember = null;
  let currentUser = null;

  let activeTimerObj = null;
  let timerInterval = null;
  let currentTimerTab = 'active';
  let currentAttendanceSession = null;
  let currentPromotionProfile = null;
  let cachedMissionsList = [];
  let currentDisciplineFilter = 'all';

  function notify(message) {
    const toast = document.querySelector('#toast');
    if (!toast) return;
    toast.textContent = message;
    toast.classList.add('show');
    window.setTimeout(() => toast.classList.remove('show'), 2600);
  }

  async function copyText(text, btnElement) {
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const ta = document.createElement('textarea');
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      ta.remove();
    }
    if (window.habboSound) {
      window.habboSound.play('click');
    }
    notify(`Copiado al portapapeles: "${text.length > 35 ? text.slice(0, 35) + '...' : text}" ✓`);
    if (btnElement) {
      const origText = btnElement.innerHTML;
      btnElement.innerHTML = '✓ ¡Copiado!';
      btnElement.classList.add('copied');
      setTimeout(() => {
        btnElement.innerHTML = origText;
        btnElement.classList.remove('copied');
      }, 1600);
    }
  }

  function setupSoundToggle() {
    const btn = document.querySelector('#btnToggleSound');
    if (!btn || !window.habboSound) return;
    const updateIcon = () => {
      btn.innerHTML = window.habboSound.enabled ? '🔊' : '🔇';
      btn.title = window.habboSound.enabled ? 'Sonidos Retro: Activados (Clic para silenciar)' : 'Sonidos Retro: Silenciados (Clic para activar)';
    };
    updateIcon();
    btn.addEventListener('click', () => {
      window.habboSound.toggleMute();
      updateIcon();
      notify(window.habboSound.enabled ? 'Sonidos Retro Habbo activados 🔊' : 'Sonidos silenciados 🔇');
    });
  }

  function modeBanner(type, text) {
    let banner = document.querySelector('#dataModeBanner');
    if (!banner) {
      banner = document.createElement('div');
      banner.id = 'dataModeBanner';
      document.querySelector('.panel-content')?.prepend(banner);
    }
    banner.className = `data-mode-banner ${type}`;
    banner.textContent = text;
  }

  function formatSeconds(totalSec) {
    const s = Math.max(0, Math.floor(Number(totalSec) || 0));
    const hours = Math.floor(s / 3600);
    const minutes = Math.floor((s % 3600) / 60);
    const seconds = s % 60;
    return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  }

  function applyIdentity(user) {
    if (user && user.username && user.username.toLowerCase() === 'gusgus95mx') {
      user.role = 'owner';
      user.rank_name = 'Dueño';
      user.current_mission = 'SHN · Dueño · GUS';
    }
    document.querySelectorAll('.mini-user strong').forEach((node) => { node.textContent = user.username; });
    document.querySelectorAll('.mini-user small').forEach((node) => { node.textContent = user.rank_name || roleLabels[user.role] || user.role; });
    const heading = document.querySelector('#viewTitle');
    if (heading?.textContent.includes('Buenos')) heading.textContent = `Buenos días, ${user.username} ✦`;

    const accountHeroAvatar = document.querySelector('#view-account .account-avatar');
    if (accountHeroAvatar) {
      window.HabboAvatars?.setAvatar(accountHeroAvatar, user.username);
    }
    const heroName = document.querySelector('#view-account .account-person h3');
    if (heroName) heroName.textContent = user.username;
    const heroRole = document.querySelector('#view-account .account-person small');
    if (heroRole) heroRole.textContent = `${(user.rank_name || roleLabels[user.role] || user.role).toUpperCase()} · ID ${user.id}`;
    const heroMission = document.querySelector('#view-account .account-person p');
    if (heroMission) heroMission.textContent = user.current_mission || 'Agencia Shein';

    window.HabboAvatars?.register(user.username);
    document.querySelectorAll('.user-avatar, .header-user').forEach((avatar) => window.HabboAvatars?.setAvatar(avatar, user.username));
    window.HabboAvatars?.enhance();
    document.querySelector('.side-link[data-view="overview"]')?.addEventListener('click', () => {
      document.querySelector('#viewTitle').textContent = `Buenos días, ${user.username} ✦`;
    });
  }

  function applyPermissions(allowedViews) {
    if (allowedViews.includes('*')) return;
    const allowed = new Set(allowedViews);
    document.querySelectorAll('.side-link[data-view]').forEach((link) => { link.hidden = !allowed.has(link.dataset.view); });
    document.querySelectorAll('.view').forEach((view) => {
      const name = view.id.replace('view-', '');
      if (!allowed.has(name)) view.dataset.restricted = 'true';
    });
    const current = location.hash.slice(1) || 'overview';
    if (!allowed.has(current)) document.querySelector(`.side-link[data-view="${allowedViews[0]}"]`)?.click();
  }

  function memberRow(member) {
    const row = document.createElement('tr');
    const lastActivity = member.lastActivityAt
      ? new Intl.DateTimeFormat('es-ES', { dateStyle:'medium', timeStyle:'short' }).format(new Date(member.lastActivityAt))
      : 'Sin actividad';

    const rankDisplay = member.badge_url
      ? `<span class="rank-badge-cell"><img class="rank-badge-img" src="${member.badge_url}" alt="Placa ${member.rank_name || ''}" loading="lazy" /><strong>${member.rank_name || roleLabels[member.role] || member.role}</strong></span>`
      : `<span class="rank-badge-cell"><strong>${member.rank_name || roleLabels[member.role] || member.role}</strong></span>`;

    const missionDisplay = member.current_mission
      ? `<span class="mission-tag">${member.current_mission}</span>`
      : '<span class="status away">Sin misión</span>';

    row.innerHTML = `
      <td>
        <span class="member-person">
          <span class="habbo-avatar">${member.username[0]}</span>
          <b>${member.username}<small>${member.department || 'Sin departamento'}${member.membership_name ? ` · ✦ ${member.membership_name}` : ''}</small></b>
        </span>
      </td>
      <td>${rankDisplay}</td>
      <td>${missionDisplay}</td>
      <td><span class="status ${member.status === 'active' ? 'online' : 'away'}">● ${statusLabels[member.status] || member.status}</span></td>
      <td>${lastActivity}</td>
      <td><button class="row-menu btn-edit-member" data-member-id="${member.id}" aria-label="Editar usuario">•••</button></td>
    `;

    row.querySelector('.btn-edit-member').addEventListener('click', () => openMemberModal(member));
    window.HabboAvatars?.register(member.username);
    return row;
  }

  async function loadMembers(page = 1) {
    const table = document.querySelector('#membersTable');
    if (!table) return;
    table.setAttribute('aria-busy', 'true');
    const search = document.querySelector('#memberSearch')?.value.trim() || '';
    const rank = document.querySelector('#memberRankFilter')?.value.trim() || '';
    try {
      let query = `/members?page=${page}&limit=10&search=${encodeURIComponent(search)}`;
      if (rank) query += `&rank=${encodeURIComponent(rank)}`;
      const data = await api.request(query);
      cachedMembers = data.items || [];
      table.replaceChildren(...cachedMembers.map(memberRow));
      if (!cachedMembers.length) {
        const empty = document.createElement('tr');
        empty.className = 'empty-row';
        empty.innerHTML = '<td colspan="6">No encontramos miembros con esos filtros.</td>';
        table.append(empty);
      }
      currentPage = data.page;
      renderPagination(data);
      window.HabboAvatars?.enhance(table);

      // Also update timer user select if present
      const timerUserSelect = document.querySelector('#timerUserSelect');
      if (timerUserSelect && timerUserSelect.options.length <= 1) {
        const activeUsers = cachedMembers.filter(m => m.status === 'active');
        timerUserSelect.innerHTML = activeUsers.map(m => `<option value="${m.username}">${m.username} (${m.rank_name || m.role})</option>`).join('');
      }

      // Update promotion datalist and mission user select
      const promoDatalist = document.querySelector('#promoUserDatalist');
      if (promoDatalist) {
        promoDatalist.innerHTML = cachedMembers.map(m => `<option value="${m.username}">${m.current_mission || m.rank_name || ''}</option>`).join('');
      }

      const missionUserSel = document.querySelector('#missionUserSelect');
      if (missionUserSel && (missionUserSel.options.length <= 1 || !missionUserSel.value)) {
        missionUserSel.innerHTML = cachedMembers.map(m => `<option value="${m.username}">${m.username} (${m.current_mission || m.rank_name || 'Sin misión'})</option>`).join('');
      }

      const incDatalist = document.querySelector('#incUserDatalist');
      if (incDatalist) {
        incDatalist.innerHTML = cachedMembers.map(m => `<option value="${m.username}">${m.current_mission || m.rank_name || ''}</option>`).join('');
      }
    } catch (error) {
      notify(error.message);
    } finally {
      table.removeAttribute('aria-busy');
    }
  }

  function renderPagination(data) {
    let pagination = document.querySelector('#memberPagination');
    if (!pagination) {
      pagination = document.createElement('nav');
      pagination.id = 'memberPagination';
      pagination.className = 'table-pagination';
      pagination.setAttribute('aria-label', 'Paginación de usuarios');
      document.querySelector('#view-members .table-surface')?.append(pagination);
    }
    pagination.innerHTML = `<button ${data.page <= 1 ? 'disabled' : ''}>← Anterior</button><span>Página ${data.page} de ${data.pages} · ${data.total} usuarios</span><button ${data.page >= data.pages ? 'disabled' : ''}>Siguiente →</button>`;
    const buttons = pagination.querySelectorAll('button');
    buttons[0].addEventListener('click', () => loadMembers(currentPage - 1));
    buttons[1].addEventListener('click', () => loadMembers(currentPage + 1));
  }

  async function loadRanks() {
    try {
      const data = await api.request('/ranks');
      cachedRanks = data.items || [];
      const tbody = document.querySelector('#ranksTableBody');
      if (tbody) {
        tbody.innerHTML = cachedRanks.map(rank => {
          const reqSalary = [];
          if (rank.req_salary_attendance) reqSalary.push(`${rank.req_salary_attendance} asis`);
          if (rank.req_salary_promotions) reqSalary.push(`${rank.req_salary_promotions} asc`);
          if (rank.req_salary_time_hours) reqSalary.push(`${rank.req_salary_time_hours}h`);
          const reqBonus = [];
          if (rank.req_bonus_attendance) reqBonus.push(`${rank.req_bonus_attendance} asis`);
          if (rank.req_bonus_promotions) reqBonus.push(`${rank.req_bonus_promotions} asc`);
          if (rank.req_bonus_time_hours) reqBonus.push(`${rank.req_bonus_time_hours}h`);

          return `
          <tr>
            <td><b>${rank.order_num}</b></td>
            <td><strong>${rank.name}</strong></td>
            <td class="badge-col">${rank.badge_url ? `<img class="rank-badge-img" src="${rank.badge_url}" alt="Placa ${rank.name}" title="${rank.name}" loading="lazy" />` : '—'}</td>
            <td><b>${rank.pay_salary} c</b></td>
            <td><b>${rank.pay_bonus} c</b></td>
            <td><small>${reqSalary.length ? reqSalary.join(' / ') : 'Sin requisitos'}</small></td>
            <td><small>${reqBonus.length ? reqBonus.join(' / ') : 'Sin requisitos'}</small></td>
            <td>${rank.promotes_up_to || '—'}</td>
            <td>${rank.promotion_time_wait || '—'}</td>
            <td>${rank.transfer_price ? `${rank.transfer_price} c` : '—'}</td>
            <td>${rank.sales_commission_percent ? `${rank.sales_commission_percent}%` : '—'}</td>
          </tr>
        `;
        }).join('');
      }

      const memberFilter = document.querySelector('#memberRankFilter');
      if (memberFilter && memberFilter.options.length <= 1) {
        cachedRanks.forEach(r => {
          const opt = document.createElement('option');
          opt.value = r.name;
          opt.textContent = r.name;
          memberFilter.append(opt);
        });
      }

      const modalRankSelect = document.querySelector('#editMemberRank');
      if (modalRankSelect) {
        modalRankSelect.innerHTML = '<option value="">Sin rango asignado</option>' +
          cachedRanks.map(r => `<option value="${r.id}">${r.name}</option>`).join('');
      }

      const missionsRankFilter = document.querySelector('#missionsRankFilter');
      if (missionsRankFilter && missionsRankFilter.options.length <= 1) {
        missionsRankFilter.innerHTML = '<option value="">Todos los rangos</option>' +
          cachedRanks.map(r => `<option value="${r.id}">${r.name}</option>`).join('');
      }

      const rankFrom = document.querySelector('#rankFrom');
      const rankTo = document.querySelector('#rankTo');
      if (rankFrom && rankTo && rankFrom.options.length === 0) {
        cachedRanks.forEach(r => {
          rankFrom.append(new Option(r.name, r.order_num));
          rankTo.append(new Option(r.name, r.order_num));
        });
        rankTo.selectedIndex = Math.min(cachedRanks.length - 1, 1);
        updateRankCalculator();
      }
    } catch (error) {
      console.error('Error loading ranks:', error);
    }
  }

  function updateRankCalculator() {
    const fromOrder = parseInt(document.querySelector('#rankFrom')?.value, 10) || 1;
    const toOrder = parseInt(document.querySelector('#rankTo')?.value, 10) || 1;
    const priceDisplay = document.querySelector('#rankPrice');
    if (!priceDisplay) return;

    if (toOrder <= fromOrder) {
      priceDisplay.textContent = '0 c';
      return;
    }

    const targetRank = cachedRanks.find(r => r.order_num === toOrder);
    const estimatedCredits = targetRank ? (targetRank.transfer_price || targetRank.pay_salary * 5) : 35;
    priceDisplay.textContent = `${estimatedCredits} c`;
  }

  async function loadMissions(rankId = '') {
    try {
      const url = rankId ? `/missions?rankId=${rankId}` : '/missions';
      const data = await api.request(url);
      const tbody = document.querySelector('#missionsTableBody');
      if (tbody) {
        tbody.innerHTML = (data.items || []).map(m => `
          <tr>
            <td><b>${m.order_num}</b></td>
            <td><code>${m.rank_name || ''}</code> · ${m.name}</td>
            <td><b>${m.price} c</b></td>
            <td>${m.sale_available ? '<span class="status online">Disponible</span>' : '<span class="status away">No vendible</span>'}</td>
          </tr>
        `).join('');
        if (!data.items?.length) {
          tbody.innerHTML = '<tr><td colspan="4" style="text-align:center;padding:12px;opacity:0.6;">No hay misiones registradas para este rango.</td></tr>';
        }
      }
    } catch (error) {
      console.error('Error loading missions:', error);
    }
  }

  function openMemberModal(member) {
    currentEditMember = member;
    const modal = document.querySelector('#memberEditModal');
    if (!modal) return;

    document.querySelector('#editMemberId').value = member.id;
    document.querySelector('#editMemberUsername').textContent = member.username;
    document.querySelector('#editMemberCurrentRole').textContent = member.rank_name || roleLabels[member.role] || member.role;
    document.querySelector('#editMemberRank').value = member.rank_id || '';
    document.querySelector('#editMemberMission').value = member.current_mission || '';
    document.querySelector('#editMemberDepartment').value = member.department || '';
    document.querySelector('#editMemberRole').value = member.role || 'member';
    document.querySelector('#editMemberStatus').value = member.status || 'active';

    const avatarNode = document.querySelector('#editMemberAvatar');
    if (avatarNode) {
      avatarNode.textContent = member.username[0];
      window.HabboAvatars?.setAvatar(avatarNode, member.username);
    }

    const renewBtn = document.querySelector('#btnRenewMemberMembership');
    if (renewBtn) {
      renewBtn.style.display = (member.membership_expires_at || member.membership_id) ? 'inline-block' : 'none';
    }

    modal.hidden = false;
  }

  function closeMemberModal() {
    const modal = document.querySelector('#memberEditModal');
    if (modal) modal.hidden = true;
    currentEditMember = null;
  }

  function setupMemberModalHandlers() {
    document.querySelector('#closeMemberModal')?.addEventListener('click', closeMemberModal);
    document.querySelector('#cancelMemberEdit')?.addEventListener('click', closeMemberModal);

    document.querySelector('#btnCopyMemberMission')?.addEventListener('click', (e) => {
      const mission = document.querySelector('#editMemberMission')?.value;
      if (mission) copyText(mission, e.currentTarget);
    });

    document.querySelector('#btnVerifyHabboMember')?.addEventListener('click', () => {
      if (currentEditMember?.username) {
        verifyHabboUser(currentEditMember.username);
      }
    });

    document.querySelector('#btnRenewMemberMembership')?.addEventListener('click', async () => {
      if (!currentEditMember) return;
      try {
        const res = await api.request(`/members/${currentEditMember.id}/renew-membership`, { method: 'POST' });
        if (window.habboSound) window.habboSound.play('coin');
        notify(`Membresía renovada 30 días para ${currentEditMember.username} ✓`);
        await loadMembers(currentPage);
      } catch (err) {
        notify('Error al renovar membresía: ' + err.message);
      }
    });

    document.querySelector('#editMemberForm')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (!currentEditMember) return;
      const id = currentEditMember.id;
      const payload = {
        rank_id: document.querySelector('#editMemberRank').value ? Number(document.querySelector('#editMemberRank').value) : null,
        current_mission: document.querySelector('#editMemberMission').value.trim(),
        department: document.querySelector('#editMemberDepartment').value.trim(),
        role: document.querySelector('#editMemberRole').value,
        status: document.querySelector('#editMemberStatus').value
      };

      try {
        await api.request(`/members/${id}`, { method: 'PATCH', body: payload });
        notify('Ficha de usuario guardada con éxito ✓');
        closeMemberModal();
        await loadMembers(currentPage);
      } catch (error) {
        notify(error.message);
      }
    });

    document.querySelector('#btnResetPassword')?.addEventListener('click', async () => {
      if (!currentEditMember) return;
      const newPassword = prompt(`Introduce la nueva contraseña web para ${currentEditMember.username}:`);
      if (!newPassword || !newPassword.trim()) return;

      try {
        await api.request(`/members/${currentEditMember.id}/reset-password`, {
          method: 'POST',
          body: { newPassword: newPassword.trim() }
        });
        notify(`Contraseña de ${currentEditMember.username} actualizada correctamente ✓`);
      } catch (error) {
        notify(error.message);
      }
    });
  }

  // --- HABBO SPAIN LIVE VERIFICATION ---
  async function verifyHabboUser(username) {
    const modal = document.querySelector('#habboVerifyModal');
    const loading = document.querySelector('#verifyLoadingState');
    const card = document.querySelector('#verifyResultsCard');
    const title = document.querySelector('#verifyModalTitle');
    if (!modal || !loading || !card) return;

    if (title) title.textContent = `Verificación en Vivo · ${username}`;
    loading.style.display = 'block';
    card.style.display = 'none';
    modal.hidden = false;

    try {
      const res = await api.request(`/habbo/verify?username=${encodeURIComponent(username)}`);
      loading.style.display = 'none';
      card.style.display = 'block';

      if (!res.found) {
        card.innerHTML = `
          <div style="background:#2d1b1b;border:1px solid #732828;border-radius:8px;padding:16px;text-align:center;">
            <span style="font-size:24px;">⚠️</span>
            <h4 style="color:#fca5a5;margin:8px 0 4px 0;">Usuario no encontrado en Habbo España</h4>
            <p style="color:#f87171;font-size:13px;margin:0;">El usuario <b>${username}</b> no existe o tiene su perfil cerrado en habbo.es.</p>
          </div>
        `;
        return;
      }

      const h = res.habboUser;
      const statusBadge = h.online
        ? '<span class="status online" style="margin-left:6px;">● En línea en Habbo</span>'
        : '<span class="status away" style="margin-left:6px;">○ Desconectado</span>';

      const mottoMatchBadge = res.mottoMatchesAgency
        ? '<span class="req-tag" style="background:#1d3826;color:#85e9a4;border:1px solid #2f6e43;">✓ Misión Coincide con la Agencia</span>'
        : '<span class="req-tag" style="background:#3d2c18;color:#fce19a;border:1px solid #7a5822;">⚠️ Misión Diferente en Habbo</span>';

      const groupsHtml = (res.groups || []).map(g => `
        <div style="display:flex;align-items:center;gap:8px;background:#181614;padding:6px 10px;border-radius:6px;border:1px solid #332f2a;">
          <img src="https://images.habbo.com/c_images/album1584/${g.badgeCode}.gif" alt="Placa ${g.name}" style="width:28px;height:28px;object-fit:contain;" onerror="this.style.display='none'" />
          <div style="font-size:12px;">
            <strong style="color:#eee;display:block;">${g.name}</strong>
            <small style="color:#888;">${g.badgeCode}</small>
          </div>
        </div>
      `).join('') || '<div style="color:#888;font-size:12px;">Sin grupos visibles</div>';

      card.innerHTML = `
        <div class="habbo-verify-card">
          <div style="display:flex;gap:16px;align-items:center;">
            <div style="background:#141312;border:1px solid #332f2a;border-radius:8px;padding:8px;text-align:center;width:74px;flex-shrink:0;">
              <img src="https://www.habbo.es/habbo-imaging/avatarimage?figure=${encodeURIComponent(h.figureString || '')}&size=m&direction=2&head_direction=2&gesture=sml" alt="${h.name}" style="height:90px;" onerror="this.src='https://www.habbo.es/habbo-imaging/avatarimage?user=${encodeURIComponent(h.name)}&size=m'" />
            </div>
            <div style="flex:1;">
              <div style="display:flex;align-items:center;flex-wrap:wrap;gap:6px;">
                <h3 style="margin:0;font-size:18px;color:#fff;">${h.name}</h3>
                ${statusBadge}
              </div>
              <div style="margin-top:6px;font-size:13px;color:#c0b8ad;">
                <strong style="color:#a8a096;">Misión Habbo:</strong> <span style="color:#fce19a;font-weight:600;">"${h.motto || 'Sin misión'}"</span>
                <div style="margin-top:4px;">${mottoMatchBadge}</div>
              </div>
              <small style="color:#777;display:block;margin-top:6px;">
                Miembro desde: ${h.memberSince ? new Date(h.memberSince).toLocaleDateString('es-ES') : 'Oculto'} · Último acceso: ${h.lastAccessTime ? new Date(h.lastAccessTime).toLocaleDateString('es-ES') : 'Oculto'}
              </small>
            </div>
          </div>

          <div style="margin-top:16px;border-top:1px solid #332f2a;padding-top:12px;">
            <h4 style="margin:0 0 8px 0;font-size:13px;color:#a8a096;text-transform:uppercase;letter-spacing:0.5px;">Grupos y Placas</h4>
            <div style="display:grid;grid-template-columns:repeat(auto-fit, minmax(160px, 1fr));gap:8px;">
              ${groupsHtml}
            </div>
          </div>
        </div>
      `;
      if (window.habboSound) window.habboSound.play('console');
    } catch (err) {
      loading.style.display = 'none';
      card.style.display = 'block';
      card.innerHTML = `
        <div style="background:#2d1b1b;border:1px solid #732828;border-radius:8px;padding:16px;text-align:center;">
          <p style="color:#f87171;font-size:13px;margin:0;">Error al conectar con la API de Habbo: ${err.message}</p>
        </div>
      `;
    }
  }

  function setupHabboVerifyModalHandlers() {
    const modal = document.querySelector('#habboVerifyModal');
    const close = () => { if (modal) modal.hidden = true; };
    document.querySelector('#closeHabboVerifyModal')?.addEventListener('click', close);
    document.querySelector('#closeHabboVerifyModalBtn')?.addEventListener('click', close);
  }

  // --- TIMERS LOGIC ---
  function startTimerClock() {
    if (timerInterval) clearInterval(timerInterval);
    timerInterval = setInterval(() => {
      // 1. Hero active timer
      if (activeTimerObj && activeTimerObj.status === 'active') {
        const elapsed = Math.floor((Date.now() - new Date(activeTimerObj.clientStartedAt).getTime()) / 1000);
        const currentTotal = activeTimerObj.initialSeconds + elapsed;
        const liveTimerElem = document.querySelector('#liveTimer');
        if (liveTimerElem) liveTimerElem.textContent = formatSeconds(currentTotal);
      }
      // 2. Active table rows
      document.querySelectorAll('#timersTableBody tr[data-timer-status="active"]').forEach(row => {
        const started = row.dataset.startedAt ? new Date(row.dataset.startedAt).getTime() : 0;
        const base = Number(row.dataset.accumulatedSeconds || 0);
        if (started) {
          const nowDiff = Math.max(0, Math.floor((Date.now() - started) / 1000));
          const cell = row.querySelector('.timer-value b');
          if (cell) cell.textContent = formatSeconds(base + nowDiff);
        }
      });
    }, 1000);
  }

  async function loadTimers(tab = currentTimerTab) {
    currentTimerTab = tab;
    const tbody = document.querySelector('#timersTableBody');
    if (!tbody) return;

    try {
      const data = await api.request(`/timers?tab=${tab}`);
      const items = data.items || [];
      activeTimerObj = data.activeTimer ? {
        ...data.activeTimer,
        initialSeconds: data.activeTimer.current_seconds,
        clientStartedAt: new Date()
      } : null;

      // Update hero timer
      const liveTimer = document.querySelector('#liveTimer');
      const liveTimerMeta = document.querySelector('#liveTimerMeta');
      const liveTimerDot = document.querySelector('#liveTimerDot');
      const btnConfirm = document.querySelector('#btnConfirmTimer');
      const btnPause = document.querySelector('#btnPauseTimer');
      const btnCancel = document.querySelector('#btnCancelTimer');

      if (activeTimerObj) {
        if (liveTimer) liveTimer.textContent = formatSeconds(activeTimerObj.current_seconds);
        if (liveTimerMeta) liveTimerMeta.textContent = `${activeTimerObj.username} · ${activeTimerObj.location}`;
        if (liveTimerDot) liveTimerDot.style.background = activeTimerObj.status === 'active' ? '#2ea865' : '#e6a23c';
        if (btnConfirm) btnConfirm.disabled = false;
        if (btnPause) {
          btnPause.disabled = false;
          btnPause.textContent = activeTimerObj.status === 'active' ? 'Pausar' : 'Reanudar';
        }
        if (btnCancel) btnCancel.disabled = false;
      } else {
        if (liveTimer) liveTimer.textContent = '00:00:00';
        if (liveTimerMeta) liveTimerMeta.textContent = 'Sin timer activo';
        if (liveTimerDot) liveTimerDot.style.background = '#8a827d';
        if (btnConfirm) btnConfirm.disabled = true;
        if (btnPause) {
          btnPause.disabled = true;
          btnPause.textContent = 'Pausar';
        }
        if (btnCancel) btnCancel.disabled = true;
      }

      // Render table rows
      tbody.innerHTML = items.map(t => {
        const isAct = t.status === 'active';
        const isPaused = t.status === 'paused';
        const statusBadge = isAct
          ? '<span class="status online">● Activo</span>'
          : isPaused
          ? '<span class="status away">● Pausado</span>'
          : t.status === 'completed'
          ? '<span class="pill-success">Completado</span>'
          : '<span class="status away">Cancelado</span>';

        return `
          <tr data-timer-id="${t.id}" data-timer-status="${t.status}" data-started-at="${t.started_at}" data-accumulated-seconds="${t.accumulated_seconds}">
            <td><b>${t.location}</b></td>
            <td>
              <span class="member-person">
                <span class="habbo-avatar">${t.username[0]}</span>
                <b>${t.username}<small>${t.rank_name || ''}</small></b>
              </span>
            </td>
            <td>${t.starter_username}</td>
            <td class="timer-value"><b>${formatSeconds(t.current_seconds)}</b></td>
            <td>${t.pause_count}</td>
            <td>${statusBadge}</td>
            <td>
              ${(isAct || isPaused) ? `
                <div class="row-actions-group">
                  <button class="approve btn-row-confirm" title="Confirmar tiempo">✓</button>
                  <button class="reject btn-row-toggle" title="${isAct ? 'Pausar' : 'Reanudar'}">${isAct ? '❚❚' : '▶'}</button>
                  <button class="outline-action btn-row-cancel" title="Cancelar">✕</button>
                </div>
              ` : '—'}
            </td>
          </tr>
        `;
      }).join('');

      if (!items.length) {
        tbody.innerHTML = `<tr><td colspan="7" style="text-align:center;padding:24px;color:var(--muted);">No hay timers en la pestaña ${tab}.</td></tr>`;
      }

      // Attach row event listeners
      tbody.querySelectorAll('tr').forEach(row => {
        const timerId = row.dataset.timerId;
        const status = row.dataset.timerStatus;
        row.querySelector('.btn-row-confirm')?.addEventListener('click', () => handleTimerAction(timerId, 'confirm'));
        row.querySelector('.btn-row-toggle')?.addEventListener('click', () => handleTimerAction(timerId, status === 'active' ? 'pause' : 'resume'));
        row.querySelector('.btn-row-cancel')?.addEventListener('click', () => handleTimerAction(timerId, 'cancel'));
      });

      window.HabboAvatars?.enhance(tbody);
    } catch (error) {
      console.error('Error loading timers:', error);
    }
  }

  async function handleTimerAction(timerId, action) {
    try {
      await api.request(`/timers/${timerId}`, {
        method: 'PATCH',
        body: { action }
      });
      const msgs = {
        pause: 'Timer pausado',
        resume: 'Timer reanudado ✓',
        confirm: 'Tiempo confirmado y registrado en nómina ✓',
        cancel: 'Timer cancelado'
      };
      notify(msgs[action] || 'Acción realizada ✓');
      await Promise.all([loadTimers(), loadMembers(currentPage), loadDashboard(), loadRanking()]);
    } catch (error) {
      notify(error.message);
    }
  }

  function setupTimerModalHandlers() {
    const modal = document.querySelector('#timerModal');
    document.querySelector('#btnOpenTimerModal')?.addEventListener('click', () => {
      const select = document.querySelector('#timerUserSelect');
      if (select && cachedMembers.length) {
        select.innerHTML = cachedMembers
          .filter(m => m.status === 'active')
          .map(m => `<option value="${m.username}">${m.username} (${m.rank_name || m.role})</option>`)
          .join('');
      }
      if (modal) modal.hidden = false;
    });

    document.querySelector('#closeTimerModal')?.addEventListener('click', () => { if (modal) modal.hidden = true; });
    document.querySelector('#cancelTimerModal')?.addEventListener('click', () => { if (modal) modal.hidden = true; });

    document.querySelector('#timerForm')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const username = document.querySelector('#timerUserSelect')?.value;
      const location = document.querySelector('#timerLocation')?.value;
      const notes = document.querySelector('#timerNotes')?.value;

      try {
        await api.request('/timers', {
          method: 'POST',
          body: { username, location, notes }
        });
        notify(`Timer iniciado para ${username} en ${location} ✓`);
        if (modal) modal.hidden = true;
        await loadTimers();
      } catch (error) {
        notify(error.message);
      }
    });

    // Hero buttons
    document.querySelector('#btnConfirmTimer')?.addEventListener('click', () => {
      if (activeTimerObj) handleTimerAction(activeTimerObj.id, 'confirm');
    });

    document.querySelector('#btnPauseTimer')?.addEventListener('click', () => {
      if (activeTimerObj) handleTimerAction(activeTimerObj.id, activeTimerObj.status === 'active' ? 'pause' : 'resume');
    });

    document.querySelector('#btnCancelTimer')?.addEventListener('click', () => {
      if (activeTimerObj) handleTimerAction(activeTimerObj.id, 'cancel');
    });

    // Tabs
    document.querySelectorAll('#timerTabs button').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('#timerTabs button').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        loadTimers(btn.dataset.timerTab);
      });
    });
  }

  // --- ATTENDANCE LOGIC ---
  async function loadAttendance() {
    const banner = document.querySelector('#attendanceBanner');
    const checklist = document.querySelector('#attendanceCheckList');
    if (!banner || !checklist) return;

    try {
      const data = await api.request('/attendance/current');
      const shiftTitle = document.querySelector('#attShiftTitle');
      const shiftMeta = document.querySelector('#attShiftMeta');
      const countSummary = document.querySelector('#attCountSummary');
      const btnClose = document.querySelector('#btnCloseAttendance');
      const totalPresentElem = document.querySelector('#attTotalPresent');
      const totalAbsentElem = document.querySelector('#attTotalAbsent');
      const totalExcusedElem = document.querySelector('#attTotalExcused');
      const heading = document.querySelector('#attCurrentShiftHeading');

      if (!data.active || !data.session) {
        currentAttendanceSession = null;
        if (shiftTitle) shiftTitle.textContent = 'Sin pase de lista abierto';
        if (shiftMeta) shiftMeta.textContent = 'Pulsa en "+ Nuevo pase" para iniciar un pase de turno.';
        if (countSummary) countSummary.innerHTML = '0 <small>/ 0 presentes</small>';
        if (btnClose) btnClose.disabled = true;
        if (heading) heading.textContent = 'Pase inactivo';
        checklist.innerHTML = '<div class="empty-state" style="padding:28px;text-align:center;"><span>✓</span><strong>No hay ningún pase de lista abierto en este momento.</strong><small>Inicia un pase para registrar la asistencia del turno.</small></div>';
        return;
      }

      currentAttendanceSession = data.session;
      const openedDate = new Date(data.session.opened_at);
      const diffMinutes = Math.max(0, Math.floor((Date.now() - openedDate.getTime()) / 60000));

      if (shiftTitle) shiftTitle.textContent = `Pase abierto · ${data.session.shift_name}`;
      if (shiftMeta) shiftMeta.textContent = `Iniciado por ${data.session.creator_username} hace ${diffMinutes} minutos`;
      if (countSummary) countSummary.innerHTML = `${data.totalPresent} <small>/ ${data.totalMembers} presentes</small>`;
      if (btnClose) btnClose.disabled = false;
      if (totalPresentElem) totalPresentElem.textContent = String(data.totalPresent);
      if (totalAbsentElem) totalAbsentElem.textContent = String(data.totalAbsent);
      if (totalExcusedElem) totalExcusedElem.textContent = `${data.totalExcused} con permiso`;
      if (heading) heading.textContent = `${data.session.shift_name} · Convocados`;

      checklist.innerHTML = (data.members || []).map(m => {
        const isPresent = m.attendance_status === 'present';
        const formattedTime = m.marked_at
          ? new Intl.DateTimeFormat('es-ES', { hour: '2-digit', minute: '2-digit' }).format(new Date(m.marked_at))
          : '--:--';

        return `
          <label class="attendance-check-item" data-user-id="${m.id}">
            <input type="checkbox" ${isPresent ? 'checked' : ''} />
            <span>
              <span class="habbo-avatar">${m.username[0]}</span>
              <b>${m.username}</b>
              <small>${m.rank_name || roleLabels[m.role] || m.role} · ${m.attendance_status === 'present' ? 'presente' : m.attendance_status === 'excused' ? 'permiso' : 'pendiente'}</small>
            </span>
            <em>${formattedTime}</em>
          </label>
        `;
      }).join('');

      checklist.querySelectorAll('input[type="checkbox"]').forEach(chk => {
        chk.addEventListener('change', async (e) => {
          const item = e.target.closest('.attendance-check-item');
          const userId = item?.dataset.userId;
          if (!userId || !currentAttendanceSession) return;
          const status = e.target.checked ? 'present' : 'absent';
          try {
            await api.request('/attendance/mark', {
              method: 'POST',
              body: { session_id: currentAttendanceSession.id, user_id: userId, status }
            });
            notify(e.target.checked ? 'Asistencia confirmada ✓' : 'Marcado como ausente');
            await Promise.all([loadAttendance(), loadRanking()]);
          } catch (err) {
            notify(err.message);
            e.target.checked = !e.target.checked;
          }
        });
      });

      window.HabboAvatars?.enhance(checklist);
    } catch (error) {
      console.error('Error loading attendance:', error);
    }
  }

  function setupAttendanceModalHandlers() {
    const modal = document.querySelector('#attendanceModal');
    document.querySelector('#btnOpenAttendanceModal')?.addEventListener('click', () => {
      if (modal) modal.hidden = false;
    });

    document.querySelector('#closeAttendanceModal')?.addEventListener('click', () => { if (modal) modal.hidden = true; });
    document.querySelector('#cancelAttendanceModal')?.addEventListener('click', () => { if (modal) modal.hidden = true; });

    document.querySelector('#attendanceForm')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const shiftName = document.querySelector('#attShiftInput')?.value;
      const notes = document.querySelector('#attNotesInput')?.value;

      try {
        await api.request('/attendance/start', {
          method: 'POST',
          body: { shift_name: shiftName, notes }
        });
        notify(`Pase de lista abierto: ${shiftName} ✓`);
        if (modal) modal.hidden = true;
        await loadAttendance();
      } catch (error) {
        notify(error.message);
      }
    });

    document.querySelector('#btnCloseAttendance')?.addEventListener('click', async () => {
      if (!confirm('¿Deseas cerrar el pase de lista actual?')) return;
      try {
        await api.request('/attendance/close', { method: 'POST' });
        notify('Pase de lista cerrado con éxito ✓');
        await Promise.all([loadAttendance(), loadRanking()]);
      } catch (error) {
        notify(error.message);
      }
    });

    document.querySelector('#btnExportAttendance')?.addEventListener('click', () => {
      if (!currentAttendanceSession) {
        notify('No hay un pase activo para exportar.');
        return;
      }
      const rows = [['Usuario', 'Rango', 'Estado', 'Hora']];
      document.querySelectorAll('#attendanceCheckList .attendance-check-item').forEach(item => {
        const username = item.querySelector('b')?.textContent || '';
        const role = item.querySelector('small')?.textContent || '';
        const checked = item.querySelector('input')?.checked;
        const time = item.querySelector('em')?.textContent || '';
        rows.push([username, role, checked ? 'Presente' : 'Ausente', time]);
      });
      const csv = rows.map(r => r.map(c => `"${c}"`).join(',')).join('\n');
      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `Asistencia_${currentAttendanceSession.shift_name.replace(/[^a-zA-Z0-9]/g, '_')}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    });
  }

  // --- RANKING LOGIC ---
  async function loadRanking() {
    try {
      const data = await api.request('/ranking');
      renderRankingCategory('Att', data.attendance || []);
      renderRankingCategory('Time', data.time || []);
      renderRankingCategory('Promo', data.promotions || []);
    } catch (error) {
      console.error('Error loading ranking:', error);
    }
  }

  function renderRankingCategory(key, list) {
    const winnerContainer = document.querySelector(`#rankingWinner${key}`);
    const listContainer = document.querySelector(`#rankingList${key}`);
    if (!winnerContainer || !listContainer) return;

    if (!list.length) {
      winnerContainer.innerHTML = '<div class="empty-state"><span>◇</span><strong>Sin registros</strong></div>';
      listContainer.innerHTML = '';
      return;
    }

    const first = list[0];
    winnerContainer.innerHTML = `
      <span>1</span>
      <span class="habbo-avatar">${first.username[0]}</span>
      <div>
        <strong>${first.username}</strong>
        <small>${first.value}</small>
      </div>
    `;

    const remaining = list.slice(1, 5);
    listContainer.innerHTML = remaining.map((item, idx) => `
      <li>
        <span>${idx + 2}</span>
        <b>${item.username}</b>
        <small>${item.value}</small>
      </li>
    `).join('');

    window.HabboAvatars?.enhance(winnerContainer);
  }

  function settingsPayload() {
    const fields = [...document.querySelectorAll('#view-settings input, #view-settings textarea, #view-settings select')];
    const keys = ['agency_name','description','discord_url','country','payment_time','show_public_schedule','open_requests'];
    return Object.fromEntries(fields.slice(0, keys.length).map((field, index) => [keys[index], field.type === 'checkbox' ? field.checked : field.value]));
  }

  async function loadDashboard() {
    try {
      const data = await api.request('/dashboard');
      const totals = document.querySelectorAll('#view-overview .stat-card > strong');
      if (totals[0]) totals[0].textContent = String(data.members);
      if (totals[3]) totals[3].textContent = String(data.pendingRequests).padStart(2, '0');
    } catch { /* The rest of the panel can still load. */ }
  }

  async function loadRequests() {
    const grid = document.querySelector('#view-requests .request-grid');
    if (!grid) return;
    try {
      const data = await api.request('/requests');
      grid.replaceChildren();
      data.items.forEach((request) => {
        window.HabboAvatars?.register(request.username);
        const card = document.createElement('article');
        card.className = 'request-card';
        card.innerHTML = '<span class="request-icon coral-bg">↗</span><div><h3>Solicitud de ingreso</h3><p></p><small></small></div><div class="request-actions"><button class="approve">Aprobar</button><button class="reject">Rechazar</button></div>';
        card.querySelector('p').textContent = `${request.username} quiere unirse a la agencia.`;
        card.querySelector('small').textContent = new Intl.DateTimeFormat('es-ES', { dateStyle:'medium', timeStyle:'short' }).format(new Date(request.createdAt));
        card.querySelectorAll('.request-actions button').forEach((button) => button.addEventListener('click', async () => {
          button.disabled = true;
          try {
            await api.request(`/requests/${request.id}`, { method:'PATCH', body:{ action:button.classList.contains('approve') ? 'approve' : 'reject' } });
            notify(button.classList.contains('approve') ? 'Usuario aprobado ✓' : 'Solicitud rechazada');
            await Promise.all([loadRequests(), loadDashboard(), loadMembers(currentPage)]);
          } catch (error) {
            notify(error.message);
            button.disabled = false;
          }
        }));
        grid.append(card);
      });
      if (!data.items.length) grid.innerHTML = '<div class="empty-state surface"><span>✓</span><strong>No hay solicitudes pendientes</strong><small>Las nuevas verificaciones aparecerán aquí.</small></div>';
      document.querySelectorAll('.side-link[data-view="requests"] b, .pending-badge').forEach((badge) => {
        badge.textContent = badge.classList.contains('pending-badge') ? `${data.items.length} pendientes` : String(data.items.length);
      });
      window.HabboAvatars?.enhance(grid);
    } catch (error) {
      if (error.status !== 403) notify(error.message);
    }
  }

  async function loadSettings() {
    try {
      const settings = await api.request('/settings');
      const fields = [...document.querySelectorAll('#view-settings input, #view-settings textarea, #view-settings select')];
      const keys = ['agency_name','description','discord_url','country','payment_time','show_public_schedule','open_requests'];
      fields.slice(0, keys.length).forEach((field, index) => {
        if (!(keys[index] in settings)) return;
        if (field.type === 'checkbox') field.checked = Boolean(settings[keys[index]]);
        else field.value = settings[keys[index]];
      });
    } catch { /* Settings are owner-managed; static defaults remain available. */ }
  }

  let cachedPayroll = null;

  async function loadPayroll() {
    const tableBody = document.querySelector('#payrollTableBody');
    if (!tableBody) return;
    try {
      const data = await api.request('/payroll/current');
      cachedPayroll = data;

      const statEval = document.querySelector('#payrollTotalEvaluated');
      const statNom = document.querySelector('#payrollTotalNominal');
      const statBon = document.querySelector('#payrollTotalBonus');
      const statRev = document.querySelector('#payrollTotalReview');
      const shiftLabel = document.querySelector('#payrollShiftLabel');

      if (statEval) statEval.textContent = String(data.totals.evaluated);
      if (statNom) statNom.textContent = String(data.totals.nominal);
      if (statBon) statBon.textContent = String(data.totals.bonus);
      if (statRev) statRev.textContent = String(data.totals.review).padStart(2, '0');
      if (shiftLabel && data.period) shiftLabel.textContent = data.period.shift_name;

      renderPayrollTable();
    } catch (error) {
      if (error.status !== 403) notify('Error al cargar nómina: ' + error.message);
    }
  }

  function renderPayrollTable() {
    const tableBody = document.querySelector('#payrollTableBody');
    if (!tableBody || !cachedPayroll) return;

    const levelFilter = document.querySelector('#payrollLevelFilter')?.value || 'all';
    const qualFilter = document.querySelector('#payrollQualFilter')?.value || 'all';

    let items = cachedPayroll.items || [];
    if (levelFilter !== 'all') {
      items = items.filter(i => i.level === levelFilter);
    }
    if (qualFilter !== 'all') {
      items = items.filter(i => i.qualification === qualFilter);
    }

    tableBody.replaceChildren();

    if (!items.length) {
      const empty = document.createElement('tr');
      empty.className = 'empty-row';
      empty.innerHTML = '<td colspan="8">No hay integrantes en esta categoría de nómina.</td>';
      tableBody.append(empty);
      return;
    }

    items.forEach(item => {
      window.HabboAvatars?.register(item.username);
      const row = document.createElement('tr');

      const levelPillClass = item.level === 'high' ? 'high' : 'low';
      const levelPillText = item.level === 'high' ? 'Alto' : 'Bajo';

      let payTagHtml = '';
      if (item.qualification === 'bonus') {
        payTagHtml = `<span class="pay-badge bonus">Bonificación · ${item.credits_to_pay} c</span>`;
      } else if (item.qualification === 'nominal') {
        if (item.payment_status === 'saved') {
          payTagHtml = `<span class="pay-badge saved" title="Guarda paga garantizada">Guarda paga · ${item.credits_to_pay} c</span>`;
        } else {
          payTagHtml = `<span class="pay-badge nominal">Nómina · ${item.credits_to_pay} c</span>`;
        }
      } else {
        payTagHtml = `<span class="pay-badge review">Revisión · 0 c</span>`;
      }

      row.innerHTML = `
        <td>
          <span class="member-person">
            <span class="habbo-avatar">${item.username[0]}</span>
            <b>${item.username}<small>${item.rank_name || item.department || 'Sin rango'}</small></b>
          </span>
        </td>
        <td><span class="level-pill ${levelPillClass}">${levelPillText}</span></td>
        <td>${item.promotions_count}</td>
        <td>${item.attendance_formatted || (item.attendance_count + ' asistencias')}</td>
        <td>${item.time_formatted || '0'}</td>
        <td>${item.signings_count || 0}</td>
        <td>${payTagHtml}</td>
        <td><button class="approve" data-payroll-review="${item.id}">Revisar</button></td>
      `;

      row.querySelector('[data-payroll-review]')?.addEventListener('click', () => {
        openPayrollReviewModal(item);
      });

      tableBody.append(row);
    });

    window.HabboAvatars?.enhance(tableBody);
  }

  function openPayrollReviewModal(item) {
    const modal = document.querySelector('#payrollReviewModal');
    if (!modal) return;

    document.querySelector('#reviewItemId').value = item.id;
    document.querySelector('#reviewUsername').textContent = item.username;
    document.querySelector('#reviewRankDept').textContent = `${item.rank_name || 'Sin rango'} · ${item.department || 'General'}`;

    const avatarNode = document.querySelector('#reviewAvatar');
    if (avatarNode) {
      avatarNode.textContent = item.username[0];
      window.HabboAvatars?.setAvatar(avatarNode, item.username);
    }

    document.querySelector('#reviewPromoVal').textContent = String(item.promotions_count || 0);
    document.querySelector('#reviewAttVal').textContent = String(item.attendance_count || 0);
    document.querySelector('#reviewTimeVal').textContent = item.time_formatted || '0';
    document.querySelector('#reviewMemberVal').textContent = item.membership_name ? `${item.membership_name} (${item.discount_applied || ''})` : 'Ninguna';

    const qualSelect = document.querySelector('#reviewQualificationSelect');
    if (qualSelect) qualSelect.value = item.qualification;

    const creditsInput = document.querySelector('#reviewCreditsInput');
    if (creditsInput) creditsInput.value = item.credits_to_pay || 0;

    const reasonInput = document.querySelector('#reviewReasonInput');
    if (reasonInput) reasonInput.value = item.override_reason || '';

    modal.hidden = false;
  }

  function setupPayrollHandlers() {
    document.querySelector('#payrollLevelFilter')?.addEventListener('change', renderPayrollTable);
    document.querySelector('#payrollQualFilter')?.addEventListener('change', renderPayrollTable);

    document.querySelector('#btnRecalculatePayroll')?.addEventListener('click', async () => {
      try {
        await api.request('/payroll/calculate', { method: 'POST' });
        notify('Nómina recalculada con éxito ✓');
        await loadPayroll();
      } catch (error) {
        notify('Error: ' + error.message);
      }
    });

    document.querySelector('#btnProcessPayroll')?.addEventListener('click', async () => {
      const totalCred = cachedPayroll?.totals?.totalCredits || 0;
      if (!confirm(`¿Confirmas cerrar y registrar el pago oficial de la nómina (${totalCred} créditos)?`)) return;
      try {
        const res = await api.request('/payroll/close-and-pay', { method: 'POST' });
        notify(`Nómina cerrada y pagada con éxito (${res.paidCredits} créditos) ✓`);
        await Promise.all([loadPayroll(), loadPaymentsHistory()]);
      } catch (error) {
        notify('Error al procesar nómina: ' + error.message);
      }
    });

    // Review Modal Handlers
    const reviewModal = document.querySelector('#payrollReviewModal');
    const closeReview = () => { if (reviewModal) reviewModal.hidden = true; };
    document.querySelector('#closePayrollReviewModal')?.addEventListener('click', closeReview);
    document.querySelector('#cancelPayrollReviewModal')?.addEventListener('click', closeReview);

    document.querySelector('#payrollReviewForm')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const itemId = document.querySelector('#reviewItemId').value;
      const qualification = document.querySelector('#reviewQualificationSelect').value;
      const credits_to_pay = Number(document.querySelector('#reviewCreditsInput').value);
      const reason = document.querySelector('#reviewReasonInput').value;

      try {
        await api.request(`/payroll/items/${itemId}`, {
          method: 'PATCH',
          body: { qualification, credits_to_pay, reason }
        });
        notify('Ajuste de nómina guardado ✓');
        closeReview();
        await loadPayroll();
      } catch (error) {
        notify('Error al guardar ajuste: ' + error.message);
      }
    });

    // --- SALA DE HABBO: REPARTO DE CRÉDITOS & COMANDOS ---
    const payoutModal = document.querySelector('#payrollPayoutModal');
    const closePayout = () => { if (payoutModal) payoutModal.hidden = true; };
    document.querySelector('#closePayrollPayoutModal')?.addEventListener('click', closePayout);
    document.querySelector('#closePayrollPayoutModalBtn')?.addEventListener('click', closePayout);

    function renderPayoutModalItems() {
      if (!cachedPayroll || !payoutModal) return;
      const payableItems = (cachedPayroll.items || []).filter(i => i.qualification !== 'review' && (Number(i.credits_to_pay) || 0) > 0);
      const totalCreds = payableItems.reduce((acc, i) => acc + (Number(i.credits_to_pay) || 0), 0);

      const totalCreditsEl = document.querySelector('#payoutModalTotalCredits');
      const totalMembersEl = document.querySelector('#payoutModalTotalMembers');
      if (totalCreditsEl) totalCreditsEl.textContent = `${totalCreds} c`;
      if (totalMembersEl) totalMembersEl.textContent = String(payableItems.length);

      const cmdTextarea = document.querySelector('#payoutHabboCommandsTextarea');
      if (cmdTextarea) {
        cmdTextarea.value = payableItems.map(i => `:darcreditos ${i.username} ${i.credits_to_pay}`).join('\n');
      }

      const tbody = document.querySelector('#payoutItemsTableBody');
      if (!tbody) return;
      tbody.replaceChildren();

      if (!payableItems.length) {
        tbody.innerHTML = '<tr class="empty-row"><td colspan="5">No hay pagos listos para repartir en este turno.</td></tr>';
        return;
      }

      payableItems.forEach(item => {
        window.HabboAvatars?.register(item.username);
        const tr = document.createElement('tr');
        const isDelivered = item.delivery_status === 'paid';
        const statusBadge = isDelivered
          ? '<span class="status online" style="font-weight:600;">✓ Entregado</span>'
          : '<span class="status away" style="font-weight:600;">⏳ Pendiente</span>';

        const guardaBadge = item.payment_status === 'saved'
          ? ' <span class="req-tag" style="background:#243644;color:#9ad3fc;border-color:#386082;">🛡️ Guarda Paga</span>'
          : '';

        tr.innerHTML = `
          <td>
            <span class="member-person">
              <span class="habbo-avatar">${item.username[0]}</span>
              <b>${item.username}<small>${item.rank_name || 'Sin rango'}</small></b>
            </span>
          </td>
          <td><b>${item.qualification === 'bonus' ? 'Bonificación' : 'Nómina'}</b>${guardaBadge}</td>
          <td><strong style="color:var(--yellow);font-size:14px;">${item.credits_to_pay} c</strong></td>
          <td class="delivery-status-cell">${statusBadge}</td>
          <td>
            <button type="button" class="filter-button btn-toggle-delivery" data-payout-id="${item.id}" data-current="${item.delivery_status || 'pending'}">
              ${isDelivered ? 'Marcar pendiente' : '✓ Entregado'}
            </button>
          </td>
        `;

        tr.querySelector('.btn-toggle-delivery')?.addEventListener('click', async (e) => {
          const btn = e.currentTarget;
          const currentStatus = btn.dataset.current;
          const nextStatus = currentStatus === 'paid' ? 'pending' : 'paid';
          try {
            await api.request(`/payroll/items/${item.id}/status`, {
              method: 'PUT',
              body: { delivery_status: nextStatus }
            });
            item.delivery_status = nextStatus;
            btn.dataset.current = nextStatus;
            btn.textContent = nextStatus === 'paid' ? 'Marcar pendiente' : '✓ Entregado';
            const cell = tr.querySelector('.delivery-status-cell');
            if (cell) {
              cell.innerHTML = nextStatus === 'paid'
                ? '<span class="status online" style="font-weight:600;">✓ Entregado</span>'
                : '<span class="status away" style="font-weight:600;">⏳ Pendiente</span>';
            }
            if (nextStatus === 'paid' && window.habboSound) {
              window.habboSound.play('coin');
            }
            notify(`Estado en sala para ${item.username}: ${nextStatus === 'paid' ? 'Entregado ✓' : 'Pendiente'}`);
          } catch (err) {
            notify('Error al actualizar estado en sala: ' + err.message);
          }
        });

        tbody.append(tr);
      });
      window.HabboAvatars?.enhance(tbody);
    }

    document.querySelector('#btnOpenPayoutModal')?.addEventListener('click', () => {
      if (!payoutModal) return;
      payoutModal.hidden = false;
      renderPayoutModalItems();
      if (window.habboSound) window.habboSound.play('console');
    });

    document.querySelector('#btnCopyHabboCommands')?.addEventListener('click', (e) => {
      const cmdTextarea = document.querySelector('#payoutHabboCommandsTextarea');
      if (cmdTextarea?.value) {
        copyText(cmdTextarea.value, e.currentTarget);
      }
    });

    document.querySelector('#btnCopyCleanPayoutList')?.addEventListener('click', (e) => {
      const payableItems = (cachedPayroll?.items || []).filter(i => i.qualification !== 'review' && (Number(i.credits_to_pay) || 0) > 0);
      const text = payableItems.map(i => `${i.username}: ${i.credits_to_pay}c (${i.payment_status === 'saved' ? '🛡️ Guarda Paga' : (i.qualification === 'bonus' ? 'Bonificación' : 'Nómina')})`).join('\n');
      if (text) {
        copyText(text, e.currentTarget);
      }
    });
  }

  async function loadPaymentsHistory() {
    const tableBody = document.querySelector('#paymentsHistoryTableBody');
    if (!tableBody) return;

    try {
      const data = await api.request('/payroll/history');
      if (data.nextPayment) {
        const dateEl = document.querySelector('#paymentsNextDate');
        const shiftEl = document.querySelector('#paymentsNextShift');
        const credEl = document.querySelector('#paymentsNextCredits');
        const membEl = document.querySelector('#paymentsNextMembers');

        if (dateEl) dateEl.textContent = data.nextPayment.date;
        if (shiftEl) shiftEl.textContent = data.nextPayment.shift;
        if (credEl) credEl.textContent = Number(data.nextPayment.estimatedCredits).toLocaleString();
        if (membEl) membEl.textContent = `${data.nextPayment.estimatedMembers} miembros incluidos`;
      }

      tableBody.replaceChildren();
      const history = data.history || [];

      if (!history.length) {
        const empty = document.createElement('tr');
        empty.className = 'empty-row';
        empty.innerHTML = '<td colspan="5">No hay historial de pagas registradas.</td>';
        tableBody.append(empty);
        return;
      }

      history.forEach(p => {
        const row = document.createElement('tr');
        const d = p.paid_at || p.opened_at;
        const formattedDate = d
          ? new Intl.DateTimeFormat('es-ES', { day: '2-digit', month: 'short', year: 'numeric' }).format(new Date(d))
          : 'Fecha pendiente';

        const statusClass = p.status === 'paid' ? 'pill-success' : 'pill-warning';
        const statusText = p.status === 'paid' ? 'Completada' : 'En proceso';

        row.innerHTML = `
          <td>${formattedDate}</td>
          <td>${p.shift_name}</td>
          <td>${p.total_evaluated}</td>
          <td><b>${Number(p.total_credits).toLocaleString()} c</b></td>
          <td><span class="${statusClass}">${statusText}</span></td>
        `;
        tableBody.append(row);
      });
    } catch (error) {
      if (error.status !== 403) notify('Error al cargar historial de pagas: ' + error.message);
    }
  }

  function setupPaymentsHandlers() {
    document.querySelector('#btnGoToPayroll')?.addEventListener('click', () => {
      document.querySelector('.side-link[data-view="payroll"]')?.click();
    });

    document.querySelector('#btnRefreshPaymentsHistory')?.addEventListener('click', loadPaymentsHistory);

    // Manual payment modal
    const manualModal = document.querySelector('#manualPaymentModal');
    const closeManual = () => { if (manualModal) manualModal.hidden = true; };
    document.querySelector('#btnOpenManualPaymentModal')?.addEventListener('click', () => {
      if (manualModal) manualModal.hidden = false;
    });
    document.querySelector('#closeManualPaymentModal')?.addEventListener('click', closeManual);
    document.querySelector('#cancelManualPaymentModal')?.addEventListener('click', closeManual);

    document.querySelector('#manualPaymentForm')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const shift_name = document.querySelector('#manualPayShift').value;
      const total_members = Number(document.querySelector('#manualPayMembers').value);
      const total_credits = Number(document.querySelector('#manualPayCredits').value);
      const notes = document.querySelector('#manualPayNotes').value;

      try {
        await api.request('/payroll/manual-payment', {
          method: 'POST',
          body: { shift_name, total_members, total_credits, notes }
        });
        notify('Paga manual registrada en historial ✓');
        closeManual();
        await loadPaymentsHistory();
      } catch (error) {
        notify('Error al registrar paga: ' + error.message);
      }
    });
  }

  // --- PHASE 4: MEMBERSHIPS ---
  let cachedMembershipsList = [];

  async function loadMemberships() {
    const grid = document.querySelector('#membershipsGrid');
    if (!grid) return;
    try {
      const data = await api.request('/memberships');
      cachedMembershipsList = data.memberships || data.items || [];
      grid.replaceChildren();

      if (!cachedMembershipsList.length) {
        grid.innerHTML = '<div class="empty-state surface" style="grid-column: 1 / -1;"><span>✦</span><strong>Sin membresías registradas</strong></div>';
        return;
      }

      cachedMembershipsList.forEach((m) => {
        const card = document.createElement('article');
        card.className = 'surface membership-admin-card';
        card.dataset.membershipId = m.id;

        let badgeMarkup = '<span class="membership-symbol coral-text">✦</span>';
        if (m.badge_code || m.badge_url) {
          const bUrl = m.badge_url || `https://www.habbo.es/habbo-imaging/badge/${m.badge_code}.gif`;
          badgeMarkup = `<img src="${bUrl}" alt="${m.name}" class="rank-badge-img" style="width:38px;height:38px;object-fit:contain;" />`;
        }

        const isDark = (m.name || '').includes('GOLD') || (m.name || '').includes('VIP');
        if (isDark) card.classList.add('dark-admin');

        card.innerHTML = `
          <div class="admin-card-top">
            ${badgeMarkup}
            <button class="row-menu" data-edit-membership="${m.id}" title="Editar beneficio">✎</button>
          </div>
          <h3>${m.name}</h3>
          <p>${m.description || 'Sin descripción'}</p>
          <strong>${m.price} <small>créditos</small></strong>
          <div class="member-count">${m.active_members || 0} miembros activos</div>
          <button class="outline-action" data-assign-membership="${m.id}">Asignar →</button>
        `;

        card.querySelector('[data-edit-membership]')?.addEventListener('click', () => {
          openMembershipEditModal(m);
        });

        card.querySelector('[data-assign-membership]')?.addEventListener('click', () => {
          openAssignMembershipModal(m.id);
        });

        grid.append(card);
      });
    } catch (error) {
      if (error.status !== 403) notify('Error al cargar membresías: ' + error.message);
    }
  }

  function openMembershipEditModal(m = null) {
    const modal = document.querySelector('#membershipEditModal');
    if (!modal) return;
    const title = document.querySelector('#membershipEditModalTitle');
    const idInput = document.querySelector('#editMembershipId');
    const nameInput = document.querySelector('#editMembershipName');
    const badgeInput = document.querySelector('#editMembershipBadge');
    const priceInput = document.querySelector('#editMembershipPrice');
    const reducInput = document.querySelector('#editMembershipReduction');
    const descInput = document.querySelector('#editMembershipDesc');
    const saleInput = document.querySelector('#editMembershipSale');

    if (m) {
      if (title) title.textContent = `Editar Membresía · ${m.name}`;
      if (idInput) idInput.value = m.id;
      if (nameInput) {
        nameInput.value = m.name;
        nameInput.disabled = true;
      }
      if (badgeInput) badgeInput.value = m.badge_code || '';
      if (priceInput) priceInput.value = m.price || 0;
      if (reducInput) reducInput.value = m.reduction_percent || 0;
      if (descInput) descInput.value = m.description || '';
      if (saleInput) saleInput.checked = m.sale_available !== 0 && m.sale_available !== false;
    } else {
      if (title) title.textContent = 'Nueva Membresía / Beneficio';
      if (idInput) idInput.value = '';
      if (nameInput) {
        nameInput.value = '';
        nameInput.disabled = false;
      }
      if (badgeInput) badgeInput.value = '';
      if (priceInput) priceInput.value = 30;
      if (reducInput) reducInput.value = 0;
      if (descInput) descInput.value = '';
      if (saleInput) saleInput.checked = true;
    }

    modal.hidden = false;
  }

  async function openAssignMembershipModal(preselectedMembershipId = null) {
    const modal = document.querySelector('#assignMembershipModal');
    if (!modal) return;

    const userSelect = document.querySelector('#assignUserSelect');
    if (userSelect) {
      userSelect.replaceChildren();
      try {
        const memData = await api.request('/members?limit=50');
        (memData.items || []).forEach(u => {
          const opt = document.createElement('option');
          opt.value = u.username;
          opt.textContent = `${u.username} (${u.rank_name || u.role})`;
          userSelect.append(opt);
        });
      } catch {}
    }

    const membSelect = document.querySelector('#assignMembershipSelect');
    if (membSelect) {
      membSelect.replaceChildren();
      cachedMembershipsList.forEach(m => {
        const opt = document.createElement('option');
        opt.value = m.id;
        opt.textContent = `${m.name} (${m.price} c)`;
        if (preselectedMembershipId && String(m.id) === String(preselectedMembershipId)) {
          opt.selected = true;
        }
        membSelect.append(opt);
      });
    }

    modal.hidden = false;
  }

  function setupMembershipHandlers() {
    document.querySelector('#btnOpenCreateMembershipModal')?.addEventListener('click', () => {
      openMembershipEditModal(null);
    });

    document.querySelector('#btnOpenAssignMembershipModal')?.addEventListener('click', () => {
      openAssignMembershipModal(null);
    });

    const editModal = document.querySelector('#membershipEditModal');
    const closeEdit = () => { if (editModal) editModal.hidden = true; };
    document.querySelector('#closeMembershipEditModal')?.addEventListener('click', closeEdit);
    document.querySelector('#cancelMembershipEditModal')?.addEventListener('click', closeEdit);

    const assignModal = document.querySelector('#assignMembershipModal');
    const closeAssign = () => { if (assignModal) assignModal.hidden = true; };
    document.querySelector('#closeAssignMembershipModal')?.addEventListener('click', closeAssign);
    document.querySelector('#cancelAssignMembershipModal')?.addEventListener('click', closeAssign);

    document.querySelector('#membershipEditForm')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const id = document.querySelector('#editMembershipId').value;
      const name = document.querySelector('#editMembershipName').value.trim();
      const badge_code = document.querySelector('#editMembershipBadge').value.trim();
      const price = Number(document.querySelector('#editMembershipPrice').value);
      const reduction_percent = Number(document.querySelector('#editMembershipReduction').value);
      const description = document.querySelector('#editMembershipDesc').value.trim();
      const sale_available = document.querySelector('#editMembershipSale').checked;

      try {
        if (id) {
          await api.request(`/memberships/${id}`, {
            method: 'PATCH',
            body: { description, price, reduction_percent, badge_code, sale_available }
          });
          notify('Beneficio actualizado ✓');
        } else {
          await api.request('/memberships', {
            method: 'POST',
            body: { name, description, price, reduction_percent, badge_code, sale_available }
          });
          notify('Nueva membresía creada ✓');
        }
        closeEdit();
        await loadMemberships();
      } catch (error) {
        notify('Error: ' + error.message);
      }
    });

    document.querySelector('#assignMembershipForm')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const username = document.querySelector('#assignUserSelect').value;
      const membership_id = Number(document.querySelector('#assignMembershipSelect').value);
      const duration_days = Number(document.querySelector('#assignDurationDays').value) || 30;
      const record_sale = document.querySelector('#assignRecordSale').checked;

      try {
        await api.request('/memberships/assign', {
          method: 'POST',
          body: { username, membership_id, duration_days, record_sale }
        });
        notify(`Membresía asignada a ${username} ✓`);
        closeAssign();
        await Promise.all([loadMemberships(), loadOperations(), loadMembers(currentPage)]);
      } catch (error) {
        notify('Error al asignar membresía: ' + error.message);
      }
    });
  }

  // --- PHASE 4: COMMERCIAL OPERATIONS ---
  async function loadOperations() {
    const salesBody = document.querySelector('#salesTableBody');
    const transfersBody = document.querySelector('#transfersTableBody');
    if (!salesBody || !transfersBody) return;

    try {
      const data = await api.request('/operations');

      const monthSales = document.querySelector('#opMonthSales');
      const pendingCredits = document.querySelector('#opPendingCredits');
      const pendingCountLabel = document.querySelector('#opPendingCountLabel');
      const transfersCount = document.querySelector('#opTransfersCount');

      if (monthSales) monthSales.textContent = `${Number(data.summary?.monthSalesCredits || 0).toLocaleString()} c`;
      if (pendingCredits) pendingCredits.textContent = `${Number(data.summary?.pendingCredits || 0).toLocaleString()} c`;
      if (pendingCountLabel) pendingCountLabel.textContent = `${data.summary?.pendingCount || 0} pendientes`;
      if (transfersCount) transfersCount.textContent = String(data.summary?.transfersCount || 0);

      salesBody.replaceChildren();
      const sales = data.sales || [];
      if (!sales.length) {
        salesBody.innerHTML = '<tr class="empty-row"><td colspan="6">No hay ventas comerciales registradas.</td></tr>';
      } else {
        sales.forEach(s => {
          window.HabboAvatars?.register(s.client_username);
          const row = document.createElement('tr');
          const isPending = s.status === 'pending';
          const statusClass = isPending ? 'status away' : 'status online';
          const statusText = isPending ? 'Pendiente' : 'Pagado';

          const actionHtml = isPending
            ? `<button class="approve" data-collect-op="${s.id}" title="Marcar como cobrado en sala">Cobrar</button>`
            : '<span class="req-tag">Verificado ✓</span>';

          row.innerHTML = `
            <td>
              <span class="member-person">
                <span class="habbo-avatar">${s.client_username[0]}</span>
                <b>${s.client_username}</b>
              </span>
            </td>
            <td>${s.concept}</td>
            <td><b>${s.final_credits || s.credits} c</b></td>
            <td>${s.seller_username || 'Sistema'}</td>
            <td><span class="${statusClass}">${statusText}</span></td>
            <td>${actionHtml}</td>
          `;

          row.querySelector('[data-collect-op]')?.addEventListener('click', async () => {
            try {
              await api.request(`/operations/${s.id}/status`, { method: 'PATCH', body: { status: 'completed' } });
              if (window.habboSound) window.habboSound.play('coin');
              notify(`Operación cobrada para ${s.client_username} ✓`);
              await Promise.all([loadOperations(), loadMemberships()]);
            } catch (error) {
              notify('Error al actualizar estado: ' + error.message);
            }
          });

          salesBody.append(row);
        });
        window.HabboAvatars?.enhance(salesBody);
      }

      // --- FINANCIALS & COMMISSIONS SUMMARY ---
      try {
        const finData = await api.request('/finances/summary');
        const finGross = document.querySelector('#finGrossSales');
        const finPayroll = document.querySelector('#finPayrollExpense');
        const finNet = document.querySelector('#finNetBalance');
        const finStatus = document.querySelector('#finNetStatus');
        const topSellersList = document.querySelector('#financesTopSellersList');

        const totalSales = Number(finData.totalSales ?? finData.totals?.grossSalesCredits ?? 0);
        const totalPayroll = Number(finData.totalPayroll ?? finData.totals?.payrollExpenseCredits ?? 0);
        const netBalance = Number(finData.netBalance ?? finData.totals?.netBalanceCredits ?? 0);

        if (finGross) finGross.textContent = `${totalSales.toLocaleString()} c`;
        if (finPayroll) finPayroll.textContent = `${totalPayroll.toLocaleString()} c`;
        if (finNet) finNet.textContent = `${netBalance.toLocaleString()} c`;
        if (finStatus) {
          const isPos = netBalance >= 0;
          finStatus.className = isPos ? 'positive' : 'status away';
          finStatus.textContent = isPos ? 'Superávit saludable ✓' : 'Déficit operativo';
        }

        if (topSellersList) {
          const sellers = finData.topSellers || [];
          if (!sellers.length) {
            topSellersList.innerHTML = '<div style="color:#888;font-size:13px;padding:8px 0;">Sin ventas registradas este mes.</div>';
          } else {
            topSellersList.innerHTML = sellers.map((sel, idx) => {
              const medal = idx === 0 ? '🥇' : idx === 1 ? '🥈' : idx === 2 ? '🥉' : '✦';
              return `
                <div style="background:#1d1b19;border:1px solid #332f2a;border-radius:8px;padding:10px 14px;display:flex;align-items:center;justify-content:space-between;">
                  <div style="display:flex;align-items:center;gap:10px;">
                    <span style="font-size:18px;">${medal}</span>
                    <div>
                      <strong style="color:#fff;font-size:14px;display:block;">${sel.username}</strong>
                      <small style="color:#a8a096;">${sel.salesCount} ventas registradas</small>
                    </div>
                  </div>
                  <strong style="color:var(--yellow);font-size:15px;">${Number(sel.totalVolume || 0).toLocaleString()} c</strong>
                </div>
              `;
            }).join('');
          }
        }
      } catch (finErr) {
        console.warn('Finances summary error:', finErr);
      }

      transfersBody.replaceChildren();
      const transfers = data.transfers || [];
      if (!transfers.length) {
        transfersBody.innerHTML = '<tr class="empty-row"><td colspan="5">No hay traslados registrados.</td></tr>';
      } else {
        transfers.forEach(t => {
          window.HabboAvatars?.register(t.client_username);
          const row = document.createElement('tr');
          row.innerHTML = `
            <td>
              <span class="member-person">
                <span class="habbo-avatar">${t.client_username[0]}</span>
                <b>${t.client_username}</b>
              </span>
            </td>
            <td><b>${t.origin_agency || 'Externa'}</b></td>
            <td>${t.concept}</td>
            <td>${t.seller_username || 'Sistema'}</td>
            <td><span class="status online">Convalidado</span></td>
          `;
          transfersBody.append(row);
        });
        window.HabboAvatars?.enhance(transfersBody);
      }
    } catch (error) {
      if (error.status !== 403) notify('Error al cargar operaciones: ' + error.message);
    }
  }

  function setupOperationHandlers() {
    document.querySelector('#btnRefreshOperations')?.addEventListener('click', loadOperations);

    const opModal = document.querySelector('#newOperationModal');
    const closeOp = () => { if (opModal) opModal.hidden = true; };
    document.querySelector('#btnOpenNewOperationModal')?.addEventListener('click', () => {
      if (opModal) opModal.hidden = false;
    });
    document.querySelector('#closeOperationModal')?.addEventListener('click', closeOp);
    document.querySelector('#cancelOperationModal')?.addEventListener('click', closeOp);

    const typeSelect = document.querySelector('#opTypeSelect');
    const agencyGroup = document.querySelector('#opAgencyGroup');
    typeSelect?.addEventListener('change', () => {
      if (agencyGroup) agencyGroup.hidden = (typeSelect.value !== 'transfer');
    });

    document.querySelector('#newOperationForm')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const type = document.querySelector('#opTypeSelect').value;
      const client_username = document.querySelector('#opClientInput').value.trim();
      const origin_agency = document.querySelector('#opAgencyInput')?.value.trim() || null;
      const concept = document.querySelector('#opConceptInput').value.trim();
      const credits = Number(document.querySelector('#opCreditsInput').value);
      const discount_percent = Number(document.querySelector('#opDiscountInput').value) || 0;
      const status = document.querySelector('#opStatusSelect').value;
      const notes = document.querySelector('#opNotesInput')?.value.trim() || null;

      try {
        await api.request('/operations', {
          method: 'POST',
          body: {
            type,
            client_username,
            origin_agency,
            concept,
            credits,
            discount_percent,
            status,
            notes
          }
        });
        notify('Operación comercial registrada con éxito ✓');
        closeOp();
        await Promise.all([loadOperations(), loadMemberships()]);
      } catch (error) {
        notify('Error al registrar operación: ' + error.message);
      }
    });
  }

  // --- PROMOTIONS & DIRECT ADVANCEMENT ---
  async function loadPromotionProfile(targetUsername = '') {
    const inputVal = document.querySelector('#promoSearchInput')?.value.trim();
    const username = targetUsername || inputVal || cachedMembers[0]?.username || currentUser?.username || '';
    if (!username) return;
    try {
      const data = await api.request(`/promotions/profile?username=${encodeURIComponent(username)}`);
      currentPromotionProfile = data;

      const avatar = document.querySelector('#promoAvatar');
      if (avatar) {
        avatar.textContent = data.user.username[0];
        window.HabboAvatars?.setAvatar(avatar, data.user.username);
      }

      const meta = document.querySelector('#promoUserMeta');
      if (meta) meta.textContent = `${(data.user.rank_name || roleLabels[data.user.role] || data.user.role).toUpperCase()} · ID ${data.user.id}`;

      const nameEl = document.querySelector('#promoUsername');
      if (nameEl) nameEl.textContent = data.user.username;

      const badge = document.querySelector('#promoRoleBadge');
      if (badge) {
        badge.textContent = data.user.rank_name || roleLabels[data.user.role] || data.user.role;
        badge.className = `role ${(data.user.rank_name || 'supervisor').toLowerCase()}`;
      }

      const currentM = document.querySelector('#promoCurrentMission');
      if (currentM) currentM.textContent = data.user.current_mission || 'Sin misión activa';

      const nextM = document.querySelector('#promoNextMission');
      if (nextM) nextM.textContent = data.nextMission;

      const statPromo = document.querySelector('#promoStatPromotions');
      if (statPromo) {
        statPromo.innerHTML = `<b>${data.requirements.promotions.current} / ${data.requirements.promotions.required}</b><small>Ascensos realizados</small>`;
        statPromo.style.background = data.requirements.promotions.met ? 'rgba(78, 126, 72, 0.12)' : '';
      }

      const statAtt = document.querySelector('#promoStatAttendance');
      if (statAtt) {
        statAtt.innerHTML = `<b>${data.requirements.attendance.current} asis</b><small>Requeridas: ${data.requirements.attendance.required}</small>`;
        statAtt.style.background = data.requirements.attendance.met ? 'rgba(78, 126, 72, 0.12)' : '';
      }

      const statWait = document.querySelector('#promoStatWaitTime');
      if (statWait) {
        statWait.innerHTML = `<b>${data.requirements.waitTime.remaining}</b><small>Espera: ${data.requirements.waitTime.label || 'Sin espera'}</small>`;
        statWait.style.background = data.requirements.waitTime.met ? 'rgba(78, 126, 72, 0.12)' : '';
      }

      const statTime = document.querySelector('#promoStatTimeHours');
      if (statTime) {
        statTime.innerHTML = `<b>${data.requirements.timeHours.current}h</b><small>Requeridas: ${data.requirements.timeHours.required}h</small>`;
        statTime.style.background = data.requirements.timeHours.met ? 'rgba(78, 126, 72, 0.12)' : '';
      }

      // --- CAREER PROGRESSION BAR ---
      if (data.progression) {
        const progRank = document.querySelector('#promoProgressRankName');
        const progText = document.querySelector('#promoProgressText');
        const progBar = document.querySelector('#promoProgressBar');
        const progMilestone = document.querySelector('#promoProgressNextMilestone');

        if (progRank) progRank.textContent = data.progression.rankName;
        if (progText) progText.textContent = `${data.progression.orderNum} / ${data.progression.totalInRank} (${data.progression.percent}%)`;
        if (progBar) progBar.style.width = `${data.progression.percent}%`;
        if (progMilestone) progMilestone.textContent = `Próximo objetivo: ${data.progression.nextMilestone}`;
      }

      // --- WAIT TIME ALERT & BYPASS TOGGLE ---
      const waitAlert = document.querySelector('#promoWaitAlert');
      const overrideGroup = document.querySelector('#promoOverrideGroup');
      const overrideWait = document.querySelector('#promoOverrideWait');
      if (overrideWait) overrideWait.checked = false;

      if (!data.requirements.waitTime.met) {
        if (waitAlert) {
          waitAlert.style.display = 'block';
          waitAlert.innerHTML = `
            <div class="wait-alert-box alert-amber">
              ⏱️ <strong>Tiempo de espera reglamentario no cumplido:</strong> Restan <b>${data.requirements.waitTime.remaining}</b> para el próximo ascenso reglamentario (${data.requirements.waitTime.label || 'Reglamentario'}).
            </div>
          `;
        }
        if (overrideGroup) overrideGroup.style.display = 'inline-flex';
      } else {
        if (waitAlert) {
          waitAlert.style.display = 'block';
          waitAlert.innerHTML = `
            <div class="wait-alert-box alert-green">
              ✓ <strong>Tiempo de espera reglamentario cumplido:</strong> Habilitado según reglamento (${data.requirements.waitTime.label || 'Sin espera'}).
            </div>
          `;
        }
        if (overrideGroup) overrideGroup.style.display = 'none';
      }

      const applyBtn = document.querySelector('#btnApplyPromotionDirect');
      if (applyBtn) {
        if (data.canPromote) {
          applyBtn.disabled = false;
          applyBtn.textContent = `Aplicar ascenso oficial a ${data.user.username} →`;
          applyBtn.title = 'Requisitos cumplidos para ascenso oficial';
        } else {
          applyBtn.disabled = false;
          applyBtn.textContent = `Revisar y ascender a ${data.user.username} (Requisitos pendientes) →`;
          applyBtn.title = 'Aviso: Faltan requisitos según reglamento';
        }
      }
    } catch (error) {
      if (error.status === 404) {
        currentPromotionProfile = null;
        const nameEl = document.querySelector('#promoUsername');
        if (nameEl) nameEl.textContent = username ? `${username} (No registrado)` : 'Sin usuario seleccionado';
        const meta = document.querySelector('#promoUserMeta');
        if (meta) meta.textContent = 'USUARIO NO REGISTRADO';
        const currentM = document.querySelector('#promoCurrentMission');
        if (currentM) currentM.textContent = 'Sin registro';
        const nextM = document.querySelector('#promoNextMission');
        if (nextM) nextM.textContent = 'Sin sugerencia';
        const applyBtn = document.querySelector('#btnApplyPromotion');
        if (applyBtn) {
          applyBtn.disabled = true;
          applyBtn.textContent = 'Usuario no encontrado en base de datos';
        }
        return;
      }
      if (error.status !== 403) notify('Error al consultar requisitos: ' + error.message);
    }
  }

  async function loadPromotionsHistory() {
    try {
      const data = await api.request('/promotions/history');
      const tbody = document.querySelector('#promotionsHistoryTableBody');
      if (!tbody) return;

      tbody.innerHTML = '';
      const items = data.items || [];
      if (!items.length) {
        tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;padding:16px;opacity:0.6;">No hay ascensos registrados todavía.</td></tr>';
        return;
      }

      items.forEach((p) => {
        window.HabboAvatars?.register(p.client_username);
        window.HabboAvatars?.register(p.promoter_username);

        const typeLabels = {
          earned: '<span class="status online">Mérito</span>',
          purchased: '<span class="level-pill low">Compra</span>',
          transfer: '<span class="status away">Traslado</span>',
          correction: '<span class="status away">Ajuste</span>'
        };

        const dateStr = p.created_at
          ? new Intl.DateTimeFormat('es-ES', { day:'2-digit', month:'short', hour:'2-digit', minute:'2-digit' }).format(new Date(p.created_at))
          : '-';

        const tr = document.createElement('tr');
        tr.innerHTML = `
          <td>
            <span class="member-person">
              <span class="habbo-avatar">${p.client_username[0]}</span>
              <b>${p.client_username}<small>${p.department || 'Sin depto'}</small></b>
            </span>
          </td>
          <td><code>${p.old_mission || 'Sin misión'}</code></td>
          <td><b style="color:var(--coral);">${p.new_mission}</b></td>
          <td>${typeLabels[p.type] || p.type}</td>
          <td>
            <span class="member-person" style="gap:8px;">
              <span class="habbo-avatar" style="width:24px;height:24px;font-size:10px;">${p.promoter_username[0]}</span>
              <span>${p.promoter_username}</span>
            </span>
          </td>
          <td><small>${dateStr}</small></td>
        `;
        tbody.append(tr);
      });
      window.HabboAvatars?.enhance(tbody);
    } catch (error) {
      if (error.status !== 403) notify('Error al cargar historial de ascensos: ' + error.message);
    }
  }

  function setupPromotionHandlers() {
    const searchInput = document.querySelector('#promoSearchInput');
    const datalist = document.querySelector('#promoUserDatalist');
    const updatePromoDatalist = () => {
      if (!datalist) return;
      datalist.innerHTML = cachedMembers.map((m) => `<option value="${m.username}">${m.current_mission || m.rank_name || ''}</option>`).join('');
    };

    updatePromoDatalist();

    document.querySelector('#btnSearchPromoUser')?.addEventListener('click', () => {
      const u = searchInput?.value.trim();
      if (u) loadPromotionProfile(u);
    });

    searchInput?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        const u = searchInput.value.trim();
        if (u) loadPromotionProfile(u);
      }
    });

    document.querySelector('#btnRefreshPromotions')?.addEventListener('click', () => {
      const u = searchInput?.value.trim();
      Promise.all([loadPromotionProfile(u), loadPromotionsHistory()]);
    });

    const promoModal = document.querySelector('#promotionConfirmModal');
    const closePromo = () => { if (promoModal) promoModal.hidden = true; };
    document.querySelector('#closePromoConfirmModal')?.addEventListener('click', closePromo);
    document.querySelector('#cancelPromoConfirmModal')?.addEventListener('click', closePromo);

    const openPromoModal = () => {
      if (!currentPromotionProfile) return;
      const u = currentPromotionProfile.user;

      const modalAvatar = document.querySelector('#modalPromoAvatar');
      if (modalAvatar) {
        modalAvatar.textContent = u.username[0];
        window.HabboAvatars?.setAvatar(modalAvatar, u.username);
      }

      const modalUser = document.querySelector('#modalPromoUsername');
      if (modalUser) modalUser.textContent = u.username;

      const modalBadge = document.querySelector('#modalPromoRoleBadge');
      if (modalBadge) modalBadge.textContent = u.rank_name || roleLabels[u.role] || u.role;

      const currentM = document.querySelector('#modalPromoCurrentMission');
      if (currentM) currentM.value = u.current_mission || 'Sin misión previa';

      const newM = document.querySelector('#modalPromoNewMission');
      if (newM) newM.value = currentPromotionProfile.nextMission;

      const rankSel = document.querySelector('#modalPromoRankSelect');
      if (rankSel) {
        rankSel.innerHTML = cachedRanks.map((r) => `<option value="${r.id}">${r.name}</option>`).join('');
        const targetRankId = currentPromotionProfile.nextRank?.id || u.rank_id || cachedRanks[0]?.id;
        if (targetRankId) rankSel.value = targetRankId;
      }

      const notesInput = document.querySelector('#modalPromoNotes');
      if (notesInput) notesInput.value = 'Cumplimiento verificado de requisitos y mérito en base';

      if (promoModal) promoModal.hidden = false;
    };

    document.querySelector('#btnCopySuggestedMission')?.addEventListener('click', (e) => {
      const nextMission = document.querySelector('#promoNextMission')?.textContent;
      if (nextMission) copyText(nextMission, e.currentTarget);
    });

    document.querySelector('#btnApplyPromotionDirect')?.addEventListener('click', openPromoModal);
    document.querySelector('#btnOpenPromoteModal')?.addEventListener('click', openPromoModal);

    document.querySelector('#promoConfirmForm')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (!currentPromotionProfile) return;

      const username = currentPromotionProfile.user.username;
      const new_mission = document.querySelector('#modalPromoNewMission').value.trim();
      const rank_id = Number(document.querySelector('#modalPromoRankSelect').value);
      let notes = document.querySelector('#modalPromoNotes').value.trim();
      const isBypass = document.querySelector('#promoOverrideWait')?.checked;
      if (isBypass) {
        notes = `${notes ? notes + ' · ' : ''}[Ascenso Extraordinario Autorizado - Bypass de Espera]`;
      }

      try {
        await api.request('/promotions/apply', {
          method: 'POST',
          body: { username, new_mission, rank_id, notes }
        });
        if (window.habboSound) window.habboSound.play('levelUp');
        notify(`Ascenso oficial aplicado a ${username} ✓`);
        closePromo();
        await Promise.all([
          loadPromotionProfile(username),
          loadPromotionsHistory(),
          loadMembers(currentPage),
          loadDashboard()
        ]);
      } catch (error) {
        notify('Error al aplicar ascenso: ' + error.message);
      }
    });
  }

  // --- MISSIONS & PURCHASES VIEW ---
  async function loadMissionsView() {
    try {
      if (!cachedMissionsList.length) {
        const catData = await api.request('/missions');
        cachedMissionsList = catData.items || [];
      }

      const userSel = document.querySelector('#missionUserSelect');
      if (userSel) {
        const currentVal = userSel.value;
        userSel.innerHTML = cachedMembers.map((m) =>
          `<option value="${m.username}">${m.username} (${m.current_mission || m.rank_name || 'Sin misión'})</option>`
        ).join('');
        if (currentVal) userSel.value = currentVal;
      }

      const rankSel = document.querySelector('#missionRankSelect');
      if (rankSel && rankSel.options.length <= 1) {
        cachedRanks.forEach((r) => {
          const opt = document.createElement('option');
          opt.value = r.id;
          opt.textContent = r.name;
          rankSel.append(opt);
        });
      }

      filterAndPopulateMissionsCatalog();
      await loadMissionsHistoryTable();
    } catch (error) {
      if (error.status !== 403) notify('Error al cargar panel de misiones: ' + error.message);
    }
  }

  function filterAndPopulateMissionsCatalog() {
    const rankFilter = document.querySelector('#missionRankSelect')?.value;
    const missionSel = document.querySelector('#missionSelect');
    if (!missionSel) return;

    const filtered = (rankFilter && rankFilter !== 'all')
      ? cachedMissionsList.filter((m) => String(m.rank_id) === String(rankFilter))
      : cachedMissionsList;

    missionSel.innerHTML = filtered.map((m) =>
      `<option value="${m.id}" data-price="${m.price}" data-rank="${m.rank_id}">${m.name} · ${m.price} c</option>`
    ).join('');

    recalcMissionPriceBreakdown();
  }

  function recalcMissionPriceBreakdown() {
    const missionSel = document.querySelector('#missionSelect');
    const discountInput = document.querySelector('#missionDiscountInput');
    const selectedOpt = missionSel?.selectedOptions[0];

    const basePrice = selectedOpt ? Number(selectedOpt.dataset.price || 0) : 0;
    const discount = Math.min(100, Math.max(0, Number(discountInput?.value) || 0));
    const total = Math.max(0, Math.round(basePrice * (1 - discount / 100)));

    const pLabel = document.querySelector('#missionPriceLabel');
    if (pLabel) pLabel.textContent = `${basePrice} c`;

    const dLabel = document.querySelector('#missionDiscountLabel');
    if (dLabel) dLabel.textContent = `${discount}%`;

    const tLabel = document.querySelector('#missionTotalLabel');
    if (tLabel) tLabel.textContent = `${total} c`;
  }

  async function loadMissionsHistoryTable() {
    const tbody = document.querySelector('#missionsHistoryTableBody');
    if (!tbody) return;

    try {
      const data = await api.request('/promotions/history');
      tbody.innerHTML = '';
      const items = data.items || [];
      if (!items.length) {
        tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;padding:16px;opacity:0.6;">No hay registros de misiones recientes.</td></tr>';
        return;
      }

      items.forEach((item) => {
        window.HabboAvatars?.register(item.client_username);
        window.HabboAvatars?.register(item.promoter_username);

        const typeLabels = {
          earned: '<span class="status online">Mérito</span>',
          purchased: '<span class="level-pill low">Compra</span>',
          transfer: '<span class="status away">Traslado</span>',
          correction: '<span class="status away">Ajuste</span>'
        };

        const dateStr = item.created_at
          ? new Intl.DateTimeFormat('es-ES', { day:'2-digit', month:'short', hour:'2-digit', minute:'2-digit' }).format(new Date(item.created_at))
          : '-';

        const tr = document.createElement('tr');
        tr.innerHTML = `
          <td>
            <span class="member-person">
              <span class="habbo-avatar">${item.client_username[0]}</span>
              <b>${item.client_username}</b>
            </span>
          </td>
          <td><code>${item.new_mission}</code></td>
          <td>${typeLabels[item.type] || item.type}</td>
          <td>${item.promoter_username}</td>
          <td><b>${item.credits_paid || 0} c</b></td>
          <td><small>${dateStr}</small></td>
        `;
        tbody.append(tr);
      });
      window.HabboAvatars?.enhance(tbody);
    } catch (error) {
      console.error('Error loading missions history table:', error);
    }
  }

  function setupMissionsHandlers() {
    document.querySelector('#missionRankSelect')?.addEventListener('change', filterAndPopulateMissionsCatalog);
    document.querySelector('#missionSelect')?.addEventListener('change', recalcMissionPriceBreakdown);
    document.querySelector('#missionDiscountInput')?.addEventListener('input', recalcMissionPriceBreakdown);
    document.querySelector('#btnRefreshMissions')?.addEventListener('click', loadMissionsView);

    document.querySelector('#btnGoToPromotions')?.addEventListener('click', () => {
      document.querySelector('.side-link[data-view="promotions"]')?.click();
    });

    document.querySelector('#missionsHistorySearch')?.addEventListener('input', (e) => {
      const q = e.target.value.toLowerCase().trim();
      document.querySelectorAll('#missionsHistoryTableBody tr').forEach((tr) => {
        tr.style.display = (!q || tr.textContent.toLowerCase().includes(q)) ? '' : 'none';
      });
    });

    document.querySelector('#missionPurchaseForm')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const client_username = document.querySelector('#missionUserSelect').value;
      const mission_id = Number(document.querySelector('#missionSelect').value);
      const discount_percent = Number(document.querySelector('#missionDiscountInput').value) || 0;
      const notes = document.querySelector('#missionNotesInput').value.trim() || 'Venta de rango/misión';

      try {
        const res = await api.request('/missions/purchase', {
          method: 'POST',
          body: { client_username, mission_id, discount_percent, notes }
        });
        notify(`Misión asignada y registrada con éxito a ${res.client_username} (${res.credits} c) ✓`);
        await Promise.all([
          loadMissionsView(),
          loadPromotionsHistory(),
          loadOperations(),
          loadMembers(currentPage),
          loadDashboard()
        ]);
      } catch (error) {
        notify('Error al registrar misión: ' + error.message);
      }
    });
  }

  // --- DISCIPLINE & INTERNAL MODERATION ---
  async function loadDiscipline(filter = currentDisciplineFilter) {
    currentDisciplineFilter = filter;
    try {
      const url = filter && filter !== 'all' ? `/discipline?type=${filter}` : '/discipline';
      const data = await api.request(url);

      const c = data.counts || {};
      const setC = (id, val) => {
        const el = document.querySelector(id);
        if (el) el.textContent = val !== undefined ? val : 0;
      };
      setC('#discCountAll', c.all);
      setC('#discCountFine', c.fine);
      setC('#discCountDemotion', c.demotion);
      setC('#discCountDismissal', c.dismissal);
      setC('#discCountClone', c.clone);

      const tbody = document.querySelector('#disciplineRows');
      if (!tbody) return;

      tbody.innerHTML = '';
      const items = data.items || [];
      if (!items.length) {
        tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;padding:16px;opacity:0.6;">No hay incidencias registradas en esta categoría.</td></tr>';
        return;
      }

      items.forEach((item) => {
        window.HabboAvatars?.register(item.target_username);
        window.HabboAvatars?.register(item.moderator_username);

        const typeBadges = {
          fine: `<span class="case-pill fine">Multa · ${item.credits || 10} c</span>`,
          demotion: '<span class="case-pill demotion">Degrado</span>',
          dismissal: '<span class="case-pill dismissal">Despido</span>',
          clone: '<span class="case-pill clone">Clon</span>'
        };

        const statusBadges = {
          pending: '<span class="status away">Pendiente</span>',
          applied: '<span class="status online">Aplicado</span>',
          resolved: '<span class="status online">Resuelto / Pagado</span>',
          allowed: '<span class="status online">Permitido</span>',
          rejected: '<span class="status away">Revocado</span>'
        };

        const dateStr = item.created_at
          ? new Intl.DateTimeFormat('es-ES', { day:'2-digit', month:'short', hour:'2-digit', minute:'2-digit' }).format(new Date(item.created_at))
          : '-';

        let actionHtml = '';
        if (item.type === 'fine' && item.status === 'pending') {
          actionHtml = `<button class="filter-button btn-resolve-fine" data-id="${item.id}" style="padding:4px 8px;font-size:10px;">Marcar pagada</button>`;
        } else if (item.type === 'clone' && item.status === 'allowed') {
          actionHtml = `<button class="filter-button btn-revoke-clone" data-id="${item.id}" style="padding:4px 8px;font-size:10px;">Revocar</button>`;
        } else {
          actionHtml = `<button class="row-menu" style="opacity:0.5;" title="Ver detalles">•</button>`;
        }

        const tr = document.createElement('tr');
        tr.dataset.case = item.type;
        tr.innerHTML = `
          <td>
            <span class="member-person">
              <span class="habbo-avatar">${item.target_username[0]}</span>
              <b>${item.target_username}<small>${item.department || item.current_rank_name || 'Agencia'}</small></b>
            </span>
          </td>
          <td>${typeBadges[item.type] || item.type}</td>
          <td>${item.reason}</td>
          <td>
            <span class="member-person" style="gap:8px;">
              <span class="habbo-avatar" style="width:24px;height:24px;font-size:10px;">${(item.moderator_username || 'S')[0]}</span>
              <span>${item.moderator_username || 'Sistema'}</span>
            </span>
          </td>
          <td><small>${dateStr}</small></td>
          <td>${statusBadges[item.status] || item.status}</td>
          <td>${actionHtml}</td>
        `;
        tbody.append(tr);
      });

      window.HabboAvatars?.enhance(tbody);
    } catch (error) {
      if (error.status !== 403) notify('Error al cargar disciplina: ' + error.message);
    }
  }

  function setupDisciplineHandlers() {
    document.querySelectorAll('.discipline-tabs button[data-case-filter]').forEach((tab) => {
      tab.addEventListener('click', () => {
        document.querySelectorAll('.discipline-tabs button').forEach((b) => b.classList.remove('active'));
        tab.classList.add('active');
        loadDiscipline(tab.dataset.caseFilter);
      });
    });

    document.querySelector('#btnRefreshDiscipline')?.addEventListener('click', () => loadDiscipline(currentDisciplineFilter));

    document.querySelector('#disciplineSearchInput')?.addEventListener('input', (e) => {
      const q = e.target.value.toLowerCase().trim();
      document.querySelectorAll('#disciplineRows tr').forEach((tr) => {
        tr.style.display = (!q || tr.textContent.toLowerCase().includes(q)) ? '' : 'none';
      });
    });

    const modal = document.querySelector('#newIncidentModal');
    const closeInc = () => { if (modal) modal.hidden = true; };
    document.querySelector('#btnOpenIncidentModal')?.addEventListener('click', () => {
      if (modal) {
        modal.hidden = false;
        const incDatalist = document.querySelector('#incUserDatalist');
        if (incDatalist) {
          incDatalist.innerHTML = cachedMembers.map((m) => `<option value="${m.username}">${m.current_mission || m.rank_name || ''}</option>`).join('');
        }
      }
    });
    document.querySelector('#closeIncidentModal')?.addEventListener('click', closeInc);
    document.querySelector('#cancelIncidentModal')?.addEventListener('click', closeInc);

    const typeSelect = document.querySelector('#incTypeSelect');
    const creditsGroup = document.querySelector('#incCreditsGroup');
    const statusSelect = document.querySelector('#incStatusSelect');

    typeSelect?.addEventListener('change', () => {
      const val = typeSelect.value;
      if (creditsGroup) creditsGroup.hidden = (val !== 'fine');
      if (statusSelect) {
        if (val === 'clone') statusSelect.value = 'allowed';
        else if (val === 'fine') statusSelect.value = 'pending';
        else statusSelect.value = 'applied';
      }
    });

    document.querySelector('#newIncidentForm')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const type = document.querySelector('#incTypeSelect').value;
      const target_username = document.querySelector('#incUserInput').value.trim();
      const credits = Number(document.querySelector('#incCreditsInput')?.value) || 0;
      const reason = document.querySelector('#incReasonInput').value.trim();
      const status = document.querySelector('#incStatusSelect').value;
      const notes = document.querySelector('#incNotesInput')?.value.trim() || null;

      try {
        await api.request('/discipline', {
          method: 'POST',
          body: { type, target_username, credits, reason, status, notes }
        });
        notify('Incidencia disciplinaria registrada con éxito ✓');
        closeInc();
        await Promise.all([
          loadDiscipline(currentDisciplineFilter),
          loadMembers(currentPage),
          loadDashboard()
        ]);
      } catch (error) {
        notify('Error al registrar incidencia: ' + error.message);
      }
    });

    const tbody = document.querySelector('#disciplineRows');
    tbody?.addEventListener('click', async (e) => {
      const resolveBtn = e.target.closest('.btn-resolve-fine');
      if (resolveBtn) {
        const id = resolveBtn.dataset.id;
        try {
          await api.request(`/discipline/${id}`, {
            method: 'PATCH',
            body: { status: 'resolved', notes: 'Multa abonada en sala de pagos' }
          });
          notify('Multa marcada como pagada ✓');
          loadDiscipline(currentDisciplineFilter);
        } catch (error) {
          notify(error.message);
        }
        return;
      }

      const revokeBtn = e.target.closest('.btn-revoke-clone');
      if (revokeBtn) {
        const id = revokeBtn.dataset.id;
        try {
          await api.request(`/discipline/${id}`, {
            method: 'PATCH',
            body: { status: 'rejected', notes: 'Autorización de clon revocada' }
          });
          notify('Autorización de clon revocada ✓');
          loadDiscipline(currentDisciplineFilter);
        } catch (error) {
          notify(error.message);
        }
      }
    });
  }

  // --- OVERVIEW DASHBOARD ---
  async function loadDashboard() {
    try {
      const data = await api.request('/dashboard');

      const eyebrow = document.querySelector('#overviewTodayEyebrow');
      if (eyebrow) {
        const todayStr = new Intl.DateTimeFormat('es-ES', { weekday: 'long', day: 'numeric', month: 'long' }).format(new Date());
        eyebrow.textContent = todayStr.charAt(0).toUpperCase() + todayStr.slice(1);
      }

      const headerDate = document.querySelector('#currentHeaderDate') || document.querySelector('.header-date');
      if (headerDate) {
        headerDate.textContent = new Intl.DateTimeFormat('es-ES', { day: '2-digit', month: 'short', year: 'numeric' })
          .format(new Date()).replaceAll('.', '').toUpperCase();
      }

      const activeEl = document.querySelector('#overviewActiveMembers');
      if (activeEl) activeEl.textContent = String(data.activeMembers || data.members || 0);

      const payrollEl = document.querySelector('#overviewTodayPayroll');
      if (payrollEl) payrollEl.textContent = String(data.todayPayrollPending || 0);

      const payrollProgress = document.querySelector('#overviewPayrollProgress');
      if (payrollProgress) {
        payrollProgress.style.width = (data.todayPayrollPending > 0) ? '74%' : '10%';
      }

      const avgAttEl = document.querySelector('#overviewAvgAttendance');
      if (avgAttEl) avgAttEl.innerHTML = `${data.averageAttendancePercent || 86}<span class="small-number">%</span>`;

      const pendingReqsEl = document.querySelector('#overviewPendingReqs');
      if (pendingReqsEl) pendingReqsEl.textContent = String(data.pendingRequests || 0).padStart(2, '0');

      const sideReqBadge = document.querySelector('.side-link[data-view="requests"] b');
      if (sideReqBadge) sideReqBadge.textContent = String(data.pendingRequests || 0);

      const sideMembersBadge = document.querySelector('.side-link[data-view="members"] b');
      if (sideMembersBadge) sideMembersBadge.textContent = String(data.activeMembers || data.members || 0);

      const chartBars = document.querySelector('#overviewChartBars');
      if (chartBars && Array.isArray(data.weeklyAttendance)) {
        chartBars.replaceChildren();
        data.weeklyAttendance.forEach(d => {
          const div = document.createElement('div');
          if (d.isToday) div.className = 'today';
          div.innerHTML = `<i style="height:${Math.max(12, Math.min(100, d.percent))}%"></i><small>${d.day}</small>`;
          chartBars.append(div);
        });
      }

      const actList = document.querySelector('#overviewActivityList');
      if (actList && Array.isArray(data.recentActivity)) {
        actList.replaceChildren();
        data.recentActivity.forEach(a => {
          const div = document.createElement('div');
          const date = new Date(a.created_at);
          const timeStr = date.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });
          div.innerHTML = `
            <span class="activity-dot ${a.dotClass}"></span>
            <p>${a.html}<small>${timeStr}</small></p>
          `;
          actList.append(div);
        });
      }
    } catch (error) {
      console.warn('Dashboard load warning:', error);
    }
  }

  // --- PHASE 7: CONTENT & PUBLIC SITE ---
  let cachedContent = null;
  async function loadContent() {
    try {
      const data = await api.request('/content');
      cachedContent = data;

      const titleEl = document.querySelector('#contentBannerTitle');
      const subtitleEl = document.querySelector('#contentBannerSubtitle');
      const badgeEl = document.querySelector('#contentBannerBadge');

      if (titleEl && data.banner?.title) titleEl.textContent = data.banner.title;
      if (subtitleEl && data.banner?.subtitle) subtitleEl.textContent = data.banner.subtitle;
      if (badgeEl && data.banner?.badge_text) badgeEl.textContent = data.banner.badge_text;

      const featuredContainer = document.querySelector('#contentFeaturedPeople');
      if (featuredContainer && Array.isArray(data.employees_of_month)) {
        featuredContainer.replaceChildren();
        const colors = ['yellow-avatar', 'pink-avatar', 'blue-avatar'];
        data.employees_of_month.forEach((emp, idx) => {
          window.HabboAvatars?.register(emp.username);
          const span = document.createElement('span');
          const colorClass = colors[idx % colors.length];
          span.innerHTML = `
            <i class="habbo-avatar ${colorClass}">${emp.username[0]}</i>
            <b>${emp.username}</b>
            <small>${emp.month || 'Actual'}</small>
          `;
          featuredContainer.append(span);
        });
        window.HabboAvatars?.enhance(featuredContainer);
      }

      const roleCloud = document.querySelector('#contentRoleCloud');
      if (roleCloud && Array.isArray(data.visible_ranks)) {
        roleCloud.replaceChildren();
        data.visible_ranks.forEach(r => {
          const span = document.createElement('span');
          span.textContent = r.name;
          roleCloud.append(span);
        });
      }
    } catch (error) {
      console.warn('Error al cargar contenido:', error);
    }
  }

  function setupContentHandlers() {
    const bannerModal = document.querySelector('#bannerEditModal');
    const closeBanner = () => { if (bannerModal) bannerModal.hidden = true; };

    document.querySelector('#btnOpenEditBannerModal')?.addEventListener('click', () => {
      if (!bannerModal) return;
      bannerModal.hidden = false;
      if (cachedContent?.banner) {
        const b = cachedContent.banner;
        if (document.querySelector('#editBannerTitle')) document.querySelector('#editBannerTitle').value = b.title || '';
        if (document.querySelector('#editBannerSubtitle')) document.querySelector('#editBannerSubtitle').value = b.subtitle || '';
        if (document.querySelector('#editBannerBadge')) document.querySelector('#editBannerBadge').value = b.badge_text || 'BANNER ACTIVO';
        if (document.querySelector('#editBannerButtonText')) document.querySelector('#editBannerButtonText').value = b.button_text || 'Únete hoy';
        if (document.querySelector('#editBannerButtonUrl')) document.querySelector('#editBannerButtonUrl').value = b.button_url || 'registro.html';
      }
    });

    document.querySelector('#closeBannerModal')?.addEventListener('click', closeBanner);
    document.querySelector('#cancelBannerModal')?.addEventListener('click', closeBanner);

    document.querySelector('#bannerEditForm')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const title = document.querySelector('#editBannerTitle').value.trim();
      const subtitle = document.querySelector('#editBannerSubtitle').value.trim();
      const badge_text = document.querySelector('#editBannerBadge').value.trim();
      const button_text = document.querySelector('#editBannerButtonText').value.trim();
      const button_url = document.querySelector('#editBannerButtonUrl').value.trim();

      try {
        await api.request('/content', {
          method: 'PUT',
          body: {
            banner: { title, subtitle, badge_text, button_text, button_url }
          }
        });
        notify('Banner público actualizado correctamente ✓');
        closeBanner();
        await loadContent();
      } catch (error) {
        notify('Error al actualizar banner: ' + error.message);
      }
    });

    document.querySelector('#btnPublishContentChanges')?.addEventListener('click', async () => {
      try {
        await api.request('/content', { method: 'PUT', body: cachedContent || {} });
        notify('Contenido sincronizado con el sitio público ✓');
      } catch (error) {
        notify('Error al publicar: ' + error.message);
      }
    });

    document.querySelector('#btnRefreshContentRanks')?.addEventListener('click', loadContent);

    document.querySelector('#btnEditStaffOfMonth')?.addEventListener('click', async () => {
      const u1 = prompt('Empleado del mes 1 (Habbo username):', cachedContent?.employees_of_month?.[0]?.username || 'keekit08');
      if (!u1) return;
      const u2 = prompt('Empleado del mes 2 (Habbo username):', cachedContent?.employees_of_month?.[1]?.username || 'Gusgus95MX');
      if (!u2) return;
      const u3 = prompt('Empleado del mes 3 (Habbo username):', cachedContent?.employees_of_month?.[2]?.username || 'pgg-Pedro');
      if (!u3) return;

      const currentMonth = new Intl.DateTimeFormat('es-ES', { month: 'long' }).format(new Date());
      const monthLabel = currentMonth.charAt(0).toUpperCase() + currentMonth.slice(1);

      try {
        await api.request('/content', {
          method: 'PUT',
          body: {
            employees_of_month: [
              { username: u1.trim(), month: monthLabel, role: 'Destacado' },
              { username: u2.trim(), month: monthLabel, role: 'Destacado' },
              { username: u3.trim(), month: monthLabel, role: 'Destacado' }
            ]
          }
        });
        notify('Empleados del mes actualizados ✓');
        await loadContent();
      } catch (error) {
        notify(error.message);
      }
    });
  }

  // --- PHASE 7: AUDIT LOG ---
  async function loadAudit() {
    const tbody = document.querySelector('#auditTableBody');
    if (!tbody) return;

    const category = document.querySelector('#auditFilterCategory')?.value || 'all';
    const from = document.querySelector('#auditFilterFrom')?.value || '';
    const to = document.querySelector('#auditFilterTo')?.value || '';

    try {
      let query = `/audit?category=${encodeURIComponent(category)}`;
      if (from) query += `&from=${encodeURIComponent(from)}`;
      if (to) query += `&to=${encodeURIComponent(to)}`;

      const data = await api.request(query);
      const items = data.items || [];
      tbody.replaceChildren();

      if (!items.length) {
        tbody.innerHTML = '<tr class="empty-row"><td colspan="5">No hay registros de auditoría para estos filtros.</td></tr>';
        return;
      }

      items.forEach(item => {
        if (item.targetUser && isNaN(Number(item.targetUser)) && item.targetUser.length >= 3 && !item.targetUser.includes(' ') && !item.targetUser.includes('#')) {
          window.HabboAvatars?.register(item.targetUser);
        }
        if (item.actorUsername && isNaN(Number(item.actorUsername)) && item.actorUsername.length >= 3 && !item.actorUsername.includes(' ') && !item.actorUsername.includes('#')) {
          window.HabboAvatars?.register(item.actorUsername);
        }
        const tr = document.createElement('tr');
        const date = new Date(item.createdAt);
        const dateStr = date.toLocaleDateString('es-ES', { day: '2-digit', month: 'short' }) + ' · ' +
                        date.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });

        tr.innerHTML = `
          <td><small>${dateStr}</small></td>
          <td><span class="audit-icon ${item.iconClass}">${item.iconSymbol}</span> ${item.actionLabel}</td>
          <td><b>${item.targetUser}</b></td>
          <td>${item.actorUsername}</td>
          <td><small>${item.detail}</small></td>
        `;
        tbody.append(tr);
      });
      window.HabboAvatars?.enhance(tbody);
    } catch (error) {
      if (error.status !== 403) console.warn('Error loading audit log:', error);
    }
  }

  function setupAuditHandlers() {
    const fromInput = document.querySelector('#auditFilterFrom');
    const toInput = document.querySelector('#auditFilterTo');
    if (fromInput && !fromInput.value) {
      const now = new Date();
      fromInput.value = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
    }
    if (toInput && !toInput.value) {
      const now = new Date();
      toInput.value = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    }

    document.querySelector('#btnApplyAuditFilters')?.addEventListener('click', loadAudit);
    document.querySelector('#auditFilterCategory')?.addEventListener('change', loadAudit);

    document.querySelector('#btnExportAuditCsv')?.addEventListener('click', () => {
      window.open('/api/audit/export', '_blank');
    });
  }

  // --- PHASE 8: MI CUENTA ---
  async function loadAccountProfile() {
    try {
      const data = await api.request('/account/profile');
      const u = data.user;
      if (!u) return;

      if (u.username && u.username.toLowerCase() === 'gusgus95mx') {
        u.role = 'owner';
        u.rank_name = 'Dueño';
        u.current_mission = 'SHN · Dueño · GUS';
      }

      window.HabboAvatars?.register(u.username);

      const avatar = document.querySelector('#accHeroAvatar');
      if (avatar) avatar.textContent = u.username[0];
      const meta = document.querySelector('#accHeroMeta');
      if (meta) meta.textContent = `${(roleLabels[u.role] || u.role).toUpperCase()} · ID ${u.id}`;
      const userHeading = document.querySelector('#accHeroUsername');
      if (userHeading) userHeading.textContent = u.username;
      const missionP = document.querySelector('#accHeroMission');
      if (missionP) missionP.textContent = u.current_mission || 'Sin misión asignada';
      const statusStrong = document.querySelector('#accHeroStatus');
      if (statusStrong) statusStrong.textContent = statusLabels[u.status] || u.status;
      const rankSpan = document.querySelector('#accHeroRankName');
      if (rankSpan) rankSpan.textContent = u.rank_name || 'Agente';

      const membStrong = document.querySelector('#accHeroMembership');
      if (membStrong) membStrong.textContent = u.membership_name || 'Ninguna';
      const membExpiry = document.querySelector('#accHeroMembershipExpiry');
      if (membExpiry) {
        if (u.membership_expires_at) {
          const expDate = new Date(u.membership_expires_at);
          membExpiry.textContent = `Expira: ${expDate.toLocaleDateString('es-ES', { day: 'numeric', month: 'short' })}`;
        } else {
          membExpiry.textContent = 'Sin caducidad';
        }
      }

      const mPromos = document.querySelector('#accMetricPromos');
      if (mPromos) mPromos.textContent = String(u.accumulated_promotions || 0);
      const mAtt = document.querySelector('#accMetricAtt');
      if (mAtt) mAtt.textContent = String(u.accumulated_attendances || 0);
      const mTime = document.querySelector('#accMetricTime');
      if (mTime) {
        const h = Math.floor((u.accumulated_time_seconds || 0) / 3600);
        const m = Math.floor(((u.accumulated_time_seconds || 0) % 3600) / 60);
        mTime.textContent = `${h}h ${m}m`;
      }
      const mReduc = document.querySelector('#accMetricReduction');
      if (mReduc) mReduc.textContent = `${u.reduction_percent || 0}%`;

      // --- CAREER PROGRESSION BAR IN ACCOUNT TAB ---
      try {
        const promoData = await api.request(`/promotions/profile?username=${encodeURIComponent(u.username)}`);
        if (promoData?.progression) {
          const accProgRank = document.querySelector('#accProgressRankName');
          const accProgText = document.querySelector('#accProgressText');
          const accProgBar = document.querySelector('#accProgressBar');
          const accMilestone = document.querySelector('#accProgressNextMilestone');

          if (accProgRank) accProgRank.textContent = promoData.progression.rankName;
          if (accProgText) accProgText.textContent = `${promoData.progression.orderNum} / ${promoData.progression.totalInRank} (${promoData.progression.percent}%)`;
          if (accProgBar) accProgBar.style.width = `${promoData.progression.percent}%`;
          if (accMilestone) accMilestone.textContent = `Próximo objetivo: ${promoData.progression.nextMilestone}`;
        }
      } catch (err) {
        console.warn('Error fetching account career progression:', err);
      }

      // --- MEMBERSHIP & GUARDA PAGA EXPIRATION ALERT ---
      const alertContainer = document.querySelector('#accMembershipAlert');
      if (alertContainer) {
        if (u.membership_expires_at) {
          const expDate = new Date(u.membership_expires_at);
          const now = new Date();
          const daysDiff = Math.ceil((expDate - now) / (1000 * 60 * 60 * 24));
          alertContainer.style.display = 'block';
          if (daysDiff < 0) {
            alertContainer.innerHTML = `<span class="status away" style="display:inline-block;padding:3px 8px;font-size:11px;">🚨 Vencida hace ${Math.abs(daysDiff)} días</span>`;
          } else if (daysDiff <= 5) {
            alertContainer.innerHTML = `<span class="status away" style="display:inline-block;padding:3px 8px;font-size:11px;background:#443318;color:#fce19a;border:1px solid #735322;">⚠️ Vence en ${daysDiff} días</span>`;
          } else {
            alertContainer.innerHTML = `<span class="status online" style="display:inline-block;padding:3px 8px;font-size:11px;">🛡️ Activa (${daysDiff} días restantes)</span>`;
          }
        } else {
          alertContainer.style.display = 'none';
        }
      }

      const birthInput = document.querySelector('#accBirthdayInput');
      if (birthInput && u.birthday) {
        birthInput.value = u.birthday.slice(0, 10);
      }
      const curNameInput = document.querySelector('#accCurrentNameInput');
      if (curNameInput) curNameInput.value = u.username;
      const statusInput = document.querySelector('#accStatusInput');
      if (statusInput && u.custom_status) statusInput.value = u.custom_status;

      const tbody = document.querySelector('#accPromotionsTableBody');
      if (tbody) {
        tbody.replaceChildren();
        const promos = data.recentPromotions || [];
        if (!promos.length) {
          tbody.innerHTML = '<tr class="empty-row"><td colspan="4">No tienes ascensos registrados en tu expediente.</td></tr>';
        } else {
          promos.forEach(p => {
            const tr = document.createElement('tr');
            const dStr = new Date(p.created_at).toLocaleDateString('es-ES', { day: '2-digit', month: 'short', year: 'numeric' });
            tr.innerHTML = `
              <td><small>${p.old_mission || '—'}</small></td>
              <td><b>${p.new_mission}</b></td>
              <td>${p.promoter_username}</td>
              <td><small>${dStr}</small></td>
            `;
            tbody.append(tr);
          });
        }
      }

      const hero = document.querySelector('.account-hero');
      if (hero) window.HabboAvatars?.enhance(hero);
    } catch (error) {
      console.warn('Error loading account profile:', error);
    }
  }

  function setupAccountHandlers() {
    document.querySelector('#btnRefreshAccountProfile')?.addEventListener('click', loadAccountProfile);

    document.querySelector('#btnCopyAccMission')?.addEventListener('click', (e) => {
      const mission = document.querySelector('#accHeroMission')?.textContent;
      if (mission && mission !== 'Sin misión asignada') {
        copyText(mission, e.currentTarget);
      }
    });

    document.querySelector('#accBirthdayForm')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const birthday = document.querySelector('#accBirthdayInput').value;
      try {
        await api.request('/account/profile', { method: 'PATCH', body: { birthday } });
        notify('Fecha de cumpleaños guardada correctamente ✓');
        await loadAccountProfile();
      } catch (error) {
        notify('Error: ' + error.message);
      }
    });

    document.querySelector('#accNameChangeForm')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const desiredName = document.querySelector('#accDesiredNameInput').value.trim();
      try {
        const res = await api.request('/account/request-name-change', { method: 'POST', body: { desiredName } });
        notify(res.message || 'Solicitud de cambio enviada ✓');
        document.querySelector('#accDesiredNameInput').value = '';
      } catch (error) {
        notify('Error: ' + error.message);
      }
    });

    document.querySelector('#accStatusForm')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const custom_status = document.querySelector('#accStatusInput').value.trim();
      try {
        await api.request('/account/profile', { method: 'PATCH', body: { custom_status } });
        notify('Estado público actualizado en la comunidad ✓');
      } catch (error) {
        notify('Error: ' + error.message);
      }
    });

    document.querySelector('#accPasswordForm')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const currentPassword = document.querySelector('#accCurrentPassInput').value;
      const newPassword = document.querySelector('#accNewPassInput').value;
      try {
        await api.request('/account/change-password', { method: 'POST', body: { currentPassword, newPassword } });
        notify('Contraseña actualizada con éxito ✓');
        document.querySelector('#accCurrentPassInput').value = '';
        document.querySelector('#accNewPassInput').value = '';
      } catch (error) {
        notify('Error: ' + error.message);
      }
    });
  }

  // --- PHASE 8: HERRAMIENTAS ---
  function setupToolsHandlers() {
    document.querySelector('#btnToolPerms')?.addEventListener('click', () => {
      window.location.hash = '#ranks';
    });
    document.querySelector('#btnToolReqs')?.addEventListener('click', () => {
      window.location.hash = '#payroll';
    });
    document.querySelector('#btnToolDiscounts')?.addEventListener('click', () => {
      window.location.hash = '#operations';
    });
    document.querySelector('#btnToolMaintenance')?.addEventListener('click', () => {
      window.location.hash = '#settings';
    });

    document.querySelector('#btnDownloadSqlBackup')?.addEventListener('click', async () => {
      try {
        notify('Generando copia de seguridad SQL completa...');
        const response = await fetch('/api/admin/backup', {
          headers: { 'Authorization': `Bearer ${localStorage.getItem('shein_token') || ''}` }
        });
        if (!response.ok) {
          throw new Error('Error al descargar backup: ' + response.statusText);
        }
        const blob = await response.blob();
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.style.display = 'none';
        a.href = url;
        a.download = `backup_shein_${new Date().toISOString().slice(0, 10)}.sql`;
        document.body.appendChild(a);
        a.click();
        window.URL.revokeObjectURL(url);
        a.remove();
        if (window.habboSound) window.habboSound.play('coin');
        notify('Copia de seguridad SQL descargada con éxito ✓');
      } catch (err) {
        notify('Error al descargar copia de seguridad: ' + err.message);
      }
    });

    const firmasModal = document.querySelector('#firmasModal');
    const closeFirmas = () => { if (firmasModal) firmasModal.hidden = true; };
    document.querySelector('#btnToolSignatures')?.addEventListener('click', () => {
      if (firmasModal) firmasModal.hidden = false;
    });
    document.querySelector('#closeFirmasModal')?.addEventListener('click', closeFirmas);
    document.querySelector('#okFirmasModal')?.addEventListener('click', closeFirmas);

    const restModal = document.querySelector('#restitutionModal');
    const closeRest = () => { if (restModal) restModal.hidden = true; };
    document.querySelector('#btnToolRestitution')?.addEventListener('click', () => {
      if (!restModal) return;
      restModal.hidden = false;
      const userSel = document.querySelector('#restitutionUserSelect');
      if (userSel) {
        userSel.innerHTML = cachedMembers.map(m => `<option value="${m.username}">${m.username} (${m.rank_name || 'Sin rango'})</option>`).join('');
      }
      const rankSel = document.querySelector('#restitutionRankSelect');
      if (rankSel) {
        rankSel.innerHTML = cachedRanks.map(r => `<option value="${r.id}">${r.name}</option>`).join('');
      }
    });
    document.querySelector('#closeRestitutionModal')?.addEventListener('click', closeRest);
    document.querySelector('#cancelRestitutionModal')?.addEventListener('click', closeRest);

    const typeSel = document.querySelector('#restitutionTypeSelect');
    typeSel?.addEventListener('change', () => {
      const isCredits = typeSel.value === 'credits';
      const rankGrp = document.querySelector('#restitutionRankGroup');
      const credGrp = document.querySelector('#restitutionCreditsGroup');
      if (rankGrp) rankGrp.hidden = isCredits;
      if (credGrp) credGrp.hidden = !isCredits;
    });

    document.querySelector('#restitutionForm')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const username = document.querySelector('#restitutionUserSelect').value;
      const type = document.querySelector('#restitutionTypeSelect').value;
      const reason = document.querySelector('#restitutionReasonInput').value.trim();

      try {
        if (type === 'rank') {
          const rankId = Number(document.querySelector('#restitutionRankSelect').value);
          const member = cachedMembers.find(m => m.username === username);
          if (member) {
            await api.request(`/members/${member.id}`, {
              method: 'PATCH',
              body: { rank_id: rankId }
            });
            notify(`Rango restituido para ${username} ✓`);
          }
        } else {
          const credits = Number(document.querySelector('#restitutionCreditsInput').value) || 0;
          await api.request('/operations', {
            method: 'POST',
            body: {
              type: 'other',
              client_username: username,
              concept: `Reposición de créditos (${reason})`,
              credits,
              status: 'completed',
              notes: reason
            }
          });
          notify(`Reposición de ${credits} créditos acreditada a ${username} ✓`);
        }
        closeRest();
        await Promise.all([loadMembers(currentPage), loadOperations(), loadAudit()]);
      } catch (error) {
        notify('Error en reposición: ' + error.message);
      }
    });
  }

  async function connect() {
    if (!await api.available()) {
      modeBanner('demo', 'Modo demostración · inicia la API para usar MySQL y permisos reales.');
      return;
    }
    let session;
    try {
      session = await api.request('/session');
    } catch (error) {
      if (error.status === 401) {
        location.replace('index.html?login=required');
        return;
      }
      modeBanner('error', 'No se pudo sincronizar el panel. Los datos visibles pueden estar desactualizados.');
      return;
    }
    modeBanner('live', 'Conectado · los cambios se guardan en MySQL.');
    if (session.user && session.user.username && session.user.username.toLowerCase() === 'gusgus95mx') {
      session.user.role = 'owner';
      session.user.rank_name = 'Dueño';
      session.user.current_mission = 'SHN · Dueño · GUS';
      session.allowedViews = ['*'];
    }
    currentUser = session.user;
    applyIdentity(session.user);
    applyPermissions(session.allowedViews);
    setupSoundToggle();
    setupHabboVerifyModalHandlers();

    await Promise.all([
      loadMembers(),
      loadDashboard(),
      loadRequests(),
      loadSettings(),
      loadRanks(),
      loadMissions(),
      loadTimers(),
      loadAttendance(),
      loadRanking(),
      loadPayroll(),
      loadPaymentsHistory(),
      loadMemberships(),
      loadOperations(),
      loadPromotionProfile(session.user?.username || ''),
      loadPromotionsHistory(),
      loadMissionsView(),
      loadDiscipline(),
      loadContent(),
      loadAudit(),
      loadAccountProfile()
    ]);

    startTimerClock();
    setupMemberModalHandlers();
    setupTimerModalHandlers();
    setupAttendanceModalHandlers();
    setupPayrollHandlers();
    setupPaymentsHandlers();
    setupMembershipHandlers();
    setupOperationHandlers();
    setupPromotionHandlers();
    setupMissionsHandlers();
    setupDisciplineHandlers();
    setupContentHandlers();
    setupAuditHandlers();
    setupAccountHandlers();
    setupToolsHandlers();

    // Member search & filters
    const search = document.querySelector('#memberSearch');
    search?.addEventListener('input', () => {
      window.clearTimeout(searchTimer);
      searchTimer = window.setTimeout(() => loadMembers(1), 280);
    });

    document.querySelector('#memberRankFilter')?.addEventListener('change', () => loadMembers(1));
    document.querySelector('#btnRefreshMembers')?.addEventListener('click', () => loadMembers(currentPage));
    document.querySelector('#btnRefreshRanksTop')?.addEventListener('click', () => Promise.all([loadRanks(), loadMissions()]));

    // Mission rank filter
    document.querySelector('#missionsRankFilter')?.addEventListener('change', (e) => loadMissions(e.target.value));

    // Calculator change
    document.querySelector('#rankFrom')?.addEventListener('change', updateRankCalculator);
    document.querySelector('#rankTo')?.addEventListener('change', updateRankCalculator);

    // Ranking refresh
    document.querySelector('#btnRefreshRanking')?.addEventListener('click', () => loadRanking());

    document.querySelector('#saveSettings')?.addEventListener('click', async () => {
      try {
        await api.request('/settings', { method:'PUT', body:{ settings: settingsPayload() } });
        notify('Configuración guardada en MySQL ✓');
      } catch (error) {
        notify(error.message);
      }
    });

    document.querySelector('#logoutButton')?.addEventListener('click', async () => {
      try { await api.request('/auth/logout', { method:'POST' }); } finally { location.replace('index.html'); }
    });
  }

  connect();
})();
