(() => {
  const api = window.SheinApi;
  if (!api) return;

  const roleLabels = { owner:'Dueño', admin:'Administrador', supervisor:'Supervisor', member:'Miembro', pending:'Pendiente' };
  const statusLabels = { active:'Activo', away:'Ausente', inactive:'Inactivo', pending:'Pendiente', blocked:'Bloqueado' };
  let currentPage = 1;
  let searchTimer;

  function notify(message) {
    const toast = document.querySelector('#toast');
    if (!toast) return;
    toast.textContent = message;
    toast.classList.add('show');
    window.setTimeout(() => toast.classList.remove('show'), 2600);
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

  function applyIdentity(user) {
    document.querySelectorAll('.mini-user strong').forEach((node) => { node.textContent = user.username; });
    document.querySelectorAll('.mini-user small').forEach((node) => { node.textContent = roleLabels[user.role] || user.role; });
    const heading = document.querySelector('#viewTitle');
    if (heading?.textContent.includes('Buenos')) heading.textContent = `Buenos días, ${user.username} ✦`;
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
    row.innerHTML = `<td><span class="member-person"><span class="habbo-avatar">${member.username[0]}</span><b></b></span></td><td><span class="role ${member.role}"></span></td><td><span class="status ${member.status === 'active' ? 'online' : 'away'}"></span></td><td></td><td><button class="row-menu" aria-label="Opciones de usuario">•••</button></td>`;
    row.querySelector('.member-person b').append(document.createTextNode(member.username));
    const sub = document.createElement('small');
    sub.textContent = member.department || 'Sin departamento';
    row.querySelector('.member-person b').append(sub);
    row.querySelector('.role').textContent = roleLabels[member.role] || member.role;
    row.querySelector('.status').textContent = `● ${statusLabels[member.status] || member.status}`;
    row.children[3].textContent = lastActivity;
    window.HabboAvatars?.register(member.username);
    return row;
  }

  async function loadMembers(page = 1) {
    const table = document.querySelector('#membersTable');
    if (!table) return;
    table.setAttribute('aria-busy', 'true');
    const search = document.querySelector('#memberSearch')?.value.trim() || '';
    try {
      const data = await api.request(`/members?page=${page}&limit=10&search=${encodeURIComponent(search)}`);
      table.replaceChildren(...data.items.map(memberRow));
      if (!data.items.length) {
        const empty = document.createElement('tr');
        empty.className = 'empty-row';
        empty.innerHTML = '<td colspan="5">No encontramos miembros con esos filtros.</td>';
        table.append(empty);
      }
      currentPage = data.page;
      renderPagination(data);
      window.HabboAvatars?.enhance(table);
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
            await Promise.all([loadRequests(), loadDashboard()]);
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
    applyIdentity(session.user);
    applyPermissions(session.allowedViews);
    if (session.demoMode) {
      modeBanner('demo', 'Modo demostración · acceso y operaciones simuladas con datos de muestra.');
      document.querySelector('#logoutButton')?.addEventListener('click', async () => {
        try { await api.request('/auth/logout', { method:'POST' }); } finally { location.replace('index.html'); }
      });
      return;
    }
    await Promise.all([loadMembers(), loadDashboard(), loadRequests(), loadSettings()]);
    const search = document.querySelector('#memberSearch');
    search?.addEventListener('input', () => {
      window.clearTimeout(searchTimer);
      searchTimer = window.setTimeout(() => loadMembers(1), 280);
    });
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
