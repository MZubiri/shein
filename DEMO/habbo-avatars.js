(() => {
  const users = [
    'MitsunoNakae087', 'HabboLover_22', 'MatteoMessina.', 'Lunita_Shein',
    'elmodeloaseguir', 'ChanelStyles', 'Gusgus95MX', 'SaulSoprano',
    'melany1999', 'Rocanroler_', 'ALEXgrande121', 'AndresLgan',
    'buenasaseds', 'keekit08', 'AxelHabbo', 'pgg-Pedro', 'Santig.f',
    ':Mariee!_', 'NeferTaryD', 'RosalBoy', 'R3belde', 'Ailin:0',
    '-Yorel.', '4karen', 'Berna.', 'Renzz', '-spcy', 'Jo.C'
  ];
  const normalizedUsers = new Map(users.map((name) => [name.toLocaleLowerCase('es'), name]));
  const escapedUsers = [...users].sort((a, b) => b.length - a.length).map((name) => name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  let userPattern = new RegExp(`(?<=^|[^a-zA-Z0-9_])(${escapedUsers.join('|')})(?=$|[^a-zA-Z0-9_])`, 'giu');
  let scheduled = false;

  function avatarUrl(username, size = 'm') {
    const query = new URLSearchParams({
      user: username,
      direction: '2',
      head_direction: '3',
      gesture: 'sml',
      action: 'std',
      size
    });
    return `https://www.habbo.es/habbo-imaging/avatarimage?${query}`;
  }

  function createPhoto(username, className = 'habbo-photo') {
    const image = document.createElement('img');
    image.className = className;
    image.src = avatarUrl(username);
    image.alt = `Avatar de ${username}`;
    image.loading = 'lazy';
    image.referrerPolicy = 'no-referrer';
    image.addEventListener('error', () => image.classList.add('is-unavailable'), { once:true });
    return image;
  }

  function createInlineName(username) {
    const wrapper = document.createElement('span');
    wrapper.className = 'habbo-name';
    wrapper.dataset.habbo = username;
    const fallback = document.createElement('span');
    fallback.className = 'habbo-name-fallback';
    fallback.textContent = username.slice(0, 1).toUpperCase();
    const label = document.createElement('span');
    label.textContent = username;
    wrapper.append(createPhoto(username), fallback, label);
    return wrapper;
  }

  function findUser(text) {
    const lowered = text.toLocaleLowerCase('es');
    return users.find((name) => lowered.includes(name.toLocaleLowerCase('es')));
  }

  function hydrateExistingAvatars(root) {
    root.querySelectorAll?.('.habbo-avatar:not(.has-photo), .user-avatar:not(.has-photo), .header-user:not(.has-photo), .account-avatar:not(.has-photo)').forEach((avatar) => {
      let username = avatar.classList.contains('header-user') ? 'Gusgus95MX' : findUser(avatar.parentElement?.textContent || '');
      if (!username && avatar.classList.contains('user-avatar')) username = 'Gusgus95MX';
      if (!username) return;
      avatar.textContent = '';
      avatar.append(createPhoto(username, ''));
      avatar.classList.add('has-photo');
      avatar.setAttribute('aria-label', `Avatar de ${username}`);
    });
  }

  function decorateSelects(root) {
    root.querySelectorAll?.('select:not(.habbo-select-ready)').forEach((select) => {
      const knownOptions = [...select.options].filter((option) => normalizedUsers.has(option.text.trim().toLocaleLowerCase('es')));
      if (!knownOptions.length) return;
      select.classList.add('habbo-select-ready', 'habbo-user-select');
      const update = () => {
        const username = normalizedUsers.get(select.selectedOptions[0]?.text.trim().toLocaleLowerCase('es'));
        select.style.backgroundImage = username ? `url("${avatarUrl(username, 's')}")` : '';
      };
      select.addEventListener('change', update);
      update();

      if (knownOptions.length !== select.options.length || select.multiple) return;
      const combobox = document.createElement('div');
      combobox.className = 'habbo-combobox';
      const trigger = document.createElement('button');
      trigger.type = 'button';
      trigger.className = 'habbo-combobox-trigger';
      trigger.setAttribute('aria-haspopup', 'listbox');
      trigger.setAttribute('aria-expanded', 'false');
      const list = document.createElement('div');
      list.className = 'habbo-combobox-list';
      list.setAttribute('role', 'listbox');
      list.hidden = true;

      function paintTrigger() {
        const option = select.selectedOptions[0];
        const username = normalizedUsers.get(option.text.trim().toLocaleLowerCase('es')) || option.text;
        trigger.replaceChildren(createPhoto(username), document.createTextNode(username));
        trigger.setAttribute('aria-label', `Usuario seleccionado: ${username}`);
      }

      [...select.options].forEach((option, index) => {
        const username = normalizedUsers.get(option.text.trim().toLocaleLowerCase('es')) || option.text;
        const item = document.createElement('button');
        item.type = 'button';
        item.className = 'habbo-combobox-option';
        item.setAttribute('role', 'option');
        item.setAttribute('aria-selected', String(option.selected));
        item.append(createPhoto(username), document.createTextNode(username));
        item.addEventListener('click', () => {
          select.selectedIndex = index;
          select.dispatchEvent(new Event('change', { bubbles:true }));
          list.querySelectorAll('[role="option"]').forEach((node, itemIndex) => node.setAttribute('aria-selected', String(itemIndex === index)));
          paintTrigger();
          list.hidden = true;
          trigger.setAttribute('aria-expanded', 'false');
          trigger.focus();
        });
        list.append(item);
      });
      trigger.addEventListener('click', () => {
        const open = list.hidden;
        list.hidden = !open;
        trigger.setAttribute('aria-expanded', String(open));
        if (open) list.querySelector('[aria-selected="true"]')?.focus();
      });
      combobox.addEventListener('keydown', (event) => {
        if (event.key !== 'Escape') return;
        list.hidden = true;
        trigger.setAttribute('aria-expanded', 'false');
        trigger.focus();
      });
      select.classList.add('habbo-select-native');
      select.after(combobox);
      combobox.append(trigger, list);
      paintTrigger();
    });
  }

  function decorateText(root) {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        if (!node.nodeValue.trim() || !userPattern.test(node.nodeValue)) {
          userPattern.lastIndex = 0;
          return NodeFilter.FILTER_REJECT;
        }
        userPattern.lastIndex = 0;
        const parent = node.parentElement;
        if (!parent || parent.closest('.habbo-name,.habbo-avatar,.user-avatar,.header-user,.account-avatar,.habbo-combobox,.member-person,.featured-people,.mini-user,.account-person,.profile-identity,.ranking-winner,.team-row,[data-no-avatar],option,script,style,textarea,.chart,.chart-y,.chart-bars,.header-date,#currentHeaderDate,.stat-card strong,.stat-card small,.activity-list small,table td small')) return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_ACCEPT;
      }
    });
    const nodes = [];
    while (walker.nextNode()) nodes.push(walker.currentNode);
    nodes.forEach((node) => {
      const fragment = document.createDocumentFragment();
      let cursor = 0;
      node.nodeValue.replace(userPattern, (match, _capture, offset) => {
        if (offset > cursor) fragment.append(document.createTextNode(node.nodeValue.slice(cursor, offset)));
        const canonical = normalizedUsers.get(match.toLocaleLowerCase('es')) || match;
        fragment.append(createInlineName(canonical));
        cursor = offset + match.length;
        return match;
      });
      if (cursor < node.nodeValue.length) fragment.append(document.createTextNode(node.nodeValue.slice(cursor)));
      node.replaceWith(fragment);
      userPattern.lastIndex = 0;
    });
  }

  function enhance(root = document.body) {
    if (!root) return;
    hydrateExistingAvatars(root);
    decorateSelects(root);
    decorateText(root);
  }

  function scheduleEnhance() {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(() => {
      scheduled = false;
      enhance();
    });
  }

  window.HabboAvatars = { enhance, avatarUrl, setAvatar(element, username) {
    if (!element || !username) return;
    element.replaceChildren(createPhoto(username, ''));
    element.classList.add('has-photo');
    element.setAttribute('aria-label', `Avatar de ${username}`);
  }, register(username) {
    if (!username || typeof username !== 'string') return;
    const clean = username.trim();
    if (clean.length < 3 || /^\d+$/.test(clean) || !/^[a-zA-Z0-9_\-=.:!?@]+$/.test(clean)) return;
    if (normalizedUsers.has(clean.toLocaleLowerCase('es'))) return;
    users.push(clean);
    normalizedUsers.set(clean.toLocaleLowerCase('es'), clean);
    const escaped = [...users].sort((a, b) => b.length - a.length).map((name) => name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
    userPattern = new RegExp(`(?<=^|[^a-zA-Z0-9_])(${escaped.join('|')})(?=$|[^a-zA-Z0-9_])`, 'giu');
    scheduleEnhance();
  } };

  enhance();
  new MutationObserver(scheduleEnhance).observe(document.body, { childList:true, subtree:true, characterData:true });
  document.addEventListener('click', (event) => {
    document.querySelectorAll('.habbo-combobox-list:not([hidden])').forEach((list) => {
      if (list.parentElement.contains(event.target)) return;
      list.hidden = true;
      list.previousElementSibling?.setAttribute('aria-expanded', 'false');
    });
  });
})();
