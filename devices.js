'use strict';

(() => {
  const tokenKey = 'movlyDownloadToken';
  const pageSize = 50;
  const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
  const jsonContentTypes = new Set(['application/json', 'application/json; charset=utf-8']);
  const elements = {
    loginPanel: document.getElementById('loginPanel'),
    loginForm: document.getElementById('loginForm'),
    username: document.getElementById('username'),
    password: document.getElementById('password'),
    loginStatus: document.getElementById('loginStatus'),
    managementPanel: document.getElementById('managementPanel'),
    accountName: document.getElementById('accountName'),
    refreshButton: document.getElementById('refreshButton'),
    deviceList: document.getElementById('deviceList'),
    deviceCount: document.getElementById('deviceCount'),
    deviceStatus: document.getElementById('deviceStatus'),
    moreDevices: document.getElementById('moreDevices'),
    removeInactiveDevices: document.getElementById('removeInactiveDevices'),
    sessionList: document.getElementById('sessionList'),
    sessionCount: document.getElementById('sessionCount'),
    sessionStatus: document.getElementById('sessionStatus'),
    moreSessions: document.getElementById('moreSessions'),
    confirmDialog: document.getElementById('confirmDialog'),
    confirmTitle: document.getElementById('confirmTitle'),
    confirmMessage: document.getElementById('confirmMessage'),
    acceptConfirm: document.getElementById('acceptConfirm'),
    deviceTemplate: document.getElementById('deviceTemplate'),
    sessionTemplate: document.getElementById('sessionTemplate'),
  };
  const missingElements = Object.entries(elements).filter(([, value]) => !value).map(([key]) => key);
  if (missingElements.length > 0) {
    throw new Error(`Stránka správy zařízení postrádá prvky: ${missingElements.join(', ')}`);
  }

  class RequestError extends Error {
    constructor(status, message) {
      super(message);
      this.status = status;
    }
  }

  let activeToken = null;
  let storageReadError = null;
  try {
    activeToken = localStorage.getItem(tokenKey);
  } catch (error) {
    storageReadError = error;
  }
  let account = null;
  let pendingDecision = null;
  const state = {
    devices: { items: new Map(), total: null, nextOffset: 0, hasMore: false, loading: false },
    sessions: { items: new Map(), total: null, nextOffset: 0, hasMore: false, loading: false },
  };

  function exactKeys(value, required, optional = []) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
    const keys = Object.keys(value);
    return required.every((key) => Object.prototype.hasOwnProperty.call(value, key))
      && keys.every((key) => required.includes(key) || optional.includes(key));
  }

  function showStatus(element, message, kind = '') {
    element.textContent = message;
    element.dataset.kind = kind;
    element.classList.remove('hidden');
    element.setAttribute('role', kind === 'error' ? 'alert' : 'status');
  }

  function clearStatus(element) {
    element.textContent = '';
    element.dataset.kind = '';
    element.classList.add('hidden');
    element.setAttribute('role', 'status');
  }

  function setButtonBusy(button, busy, busyLabel = 'Pracuji…') {
    if (!button.dataset.idleLabel) button.dataset.idleLabel = button.textContent;
    button.disabled = busy;
    button.textContent = busy ? busyLabel : button.dataset.idleLabel;
  }

  async function api(path, options = {}) {
    const {
      method = 'GET', body, authenticated = true, expectedStatus = 200,
    } = options;
    const headers = { Accept: 'application/json' };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (authenticated) {
      if (typeof activeToken !== 'string' || !/^[!-~]{16,512}$/.test(activeToken)) {
        throw new RequestError(401, 'Přihlas se Movly účtem.');
      }
      headers.Authorization = `Bearer ${activeToken}`;
    }

    let response;
    try {
      response = await fetch(path, { method, headers, ...(body === undefined ? {} : { body }) });
    } catch (error) {
      throw new RequestError(0, `Web Movly teď není dostupný (${error.message}).`);
    }
    const raw = await response.text();
    const contentType = response.headers.get('content-type');

    if (response.status === 204) {
      if (response.status !== expectedStatus || raw !== '' || contentType !== null) {
        throw new RequestError(502, `Web Movly nepotvrdil prázdnou odpověď ${expectedStatus}.`);
      }
      return null;
    }

    let payload = null;
    if (raw !== '') {
      if (typeof contentType !== 'string' || !jsonContentTypes.has(contentType.toLowerCase())) {
        throw new RequestError(502, `Web Movly vrátil neplatný Content-Type (${response.status}).`);
      }
      try {
        payload = JSON.parse(raw);
      } catch {
        throw new RequestError(502, `Web Movly vrátil nečitelný JSON (${response.status}).`);
      }
    }
    if (!response.ok) {
      const message = payload && typeof payload.message === 'string'
        ? payload.message
        : `Požadavek selhal (${response.status}).`;
      if (response.status === 429) {
        const retryAfter = response.headers.get('retry-after');
        if (typeof retryAfter !== 'string' || !/^[1-9]\d*$/.test(retryAfter)) {
          throw new RequestError(502, 'Web Movly neposlal platný Retry-After.');
        }
        throw new RequestError(429, `${message} Zkus to znovu za ${retryAfter} s.`);
      }
      throw new RequestError(response.status, message);
    }
    if (response.status !== expectedStatus || payload === null) {
      throw new RequestError(502, `Web Movly vrátil neočekávaný stav ${response.status}.`);
    }
    return payload;
  }

  function validateSession(payload, requireToken) {
    const required = ['account', 'hasDownloadAccess', 'accessLabel'];
    const optional = requireToken ? ['token'] : [];
    if (!exactKeys(payload, required, optional)
        || typeof payload.hasDownloadAccess !== 'boolean'
        || typeof payload.accessLabel !== 'string' || payload.accessLabel !== payload.accessLabel.trim()
        || !exactKeys(payload.account, ['username', 'email', 'displayName', 'coins'])) {
      throw new RequestError(502, 'Web Movly vrátil neplatný kontrakt účtu.');
    }
    const { username, email, displayName, coins } = payload.account;
    if (typeof username !== 'string' || !username || username !== username.trim()
        || (email !== null && (typeof email !== 'string' || !email || email !== email.trim()))
        || (displayName !== null && (typeof displayName !== 'string' || !displayName || displayName !== displayName.trim()))
        || !Number.isSafeInteger(coins) || coins < 0) {
      throw new RequestError(502, 'Web Movly vrátil neplatné údaje účtu.');
    }
    if (requireToken && (typeof payload.token !== 'string' || !/^[!-~]{16,512}$/.test(payload.token))) {
      throw new RequestError(502, 'Web Movly nevrátil platný přihlašovací token.');
    }
    return { name: displayName || username, token: requireToken ? payload.token : null };
  }

  function strictTimestamp(value, label) {
    if (typeof value !== 'string' || value !== value.trim()) {
      throw new RequestError(502, `Neplatný čas ${label}.`);
    }
    const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,9}))?(?:Z|([+-])(\d{2}):(\d{2}))$/.exec(value);
    if (!match) throw new RequestError(502, `Neplatný čas ${label}.`);
    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    const hour = Number(match[4]);
    const minute = Number(match[5]);
    const second = Number(match[6]);
    const offsetHour = match[9] === undefined ? 0 : Number(match[9]);
    const offsetMinute = match[10] === undefined ? 0 : Number(match[10]);
    const probe = new Date(Date.UTC(year, month - 1, day, hour, minute, second));
    const parseable = match[7] && match[7].length > 3
      ? value.replace(`.${match[7]}`, `.${match[7].slice(0, 3)}`)
      : value;
    if (month < 1 || month > 12 || day < 1 || hour > 23 || minute > 59 || second > 59
        || offsetHour > 23 || offsetMinute > 59
        || (match[8] === '-' && offsetHour === 0 && offsetMinute === 0)
        || probe.getUTCFullYear() !== year || probe.getUTCMonth() !== month - 1 || probe.getUTCDate() !== day
        || !Number.isFinite(Date.parse(parseable))) {
      throw new RequestError(502, `Neplatný čas ${label}.`);
    }
    return value;
  }

  function strictText(value, label, maximum) {
    if (typeof value !== 'string' || value !== value.trim() || Array.from(value).length < 1
        || Array.from(value).length > maximum || /\p{Cc}/u.test(value)) {
      throw new RequestError(502, `Neplatné pole ${label}.`);
    }
    return value;
  }

  function strictUUID(value, label) {
    if (typeof value !== 'string' || !uuidPattern.test(value)) {
      throw new RequestError(502, `Neplatné ${label}.`);
    }
    return value;
  }

  function normalizeDevice(value) {
    const required = ['id', 'display_name', 'platform', 'device_type', 'created_at', 'last_seen_at', 'is_current'];
    const optional = ['app_version', 'os_version', 'model', 'revoked_at'];
    if (!exactKeys(value, required, optional) || typeof value.is_current !== 'boolean') {
      throw new RequestError(502, 'Web Movly vrátil neplatné zařízení.');
    }
    const device = {
      id: strictUUID(value.id, 'ID zařízení'),
      display_name: strictText(value.display_name, 'display_name', 100),
      platform: strictText(value.platform, 'platform', 24),
      device_type: strictText(value.device_type, 'device_type', 24),
      created_at: strictTimestamp(value.created_at, 'created_at'),
      last_seen_at: strictTimestamp(value.last_seen_at, 'last_seen_at'),
      is_current: value.is_current,
    };
    for (const [key, maximum] of [['app_version', 32], ['os_version', 64], ['model', 100]]) {
      if (Object.prototype.hasOwnProperty.call(value, key)) device[key] = strictText(value[key], key, maximum);
    }
    if (Object.prototype.hasOwnProperty.call(value, 'revoked_at')) {
      device.revoked_at = strictTimestamp(value.revoked_at, 'revoked_at');
    }
    return device;
  }

  function normalizeSession(value) {
    const required = [
      'id', 'created_at', 'last_seen_at', 'idle_expires_at', 'absolute_expires_at', 'is_active', 'is_current',
    ];
    const optional = ['device_id', 'device_name', 'device_type', 'revoked_at'];
    if (!exactKeys(value, required, optional)
        || typeof value.is_active !== 'boolean' || typeof value.is_current !== 'boolean') {
      throw new RequestError(502, 'Web Movly vrátil neplatnou session.');
    }
    const session = {
      id: strictUUID(value.id, 'ID session'),
      created_at: strictTimestamp(value.created_at, 'created_at'),
      last_seen_at: strictTimestamp(value.last_seen_at, 'last_seen_at'),
      idle_expires_at: strictTimestamp(value.idle_expires_at, 'idle_expires_at'),
      absolute_expires_at: strictTimestamp(value.absolute_expires_at, 'absolute_expires_at'),
      is_active: value.is_active,
      is_current: value.is_current,
    };
    if (Object.prototype.hasOwnProperty.call(value, 'device_id')) session.device_id = strictUUID(value.device_id, 'ID zařízení session');
    if (Object.prototype.hasOwnProperty.call(value, 'device_name')) session.device_name = strictText(value.device_name, 'device_name', 100);
    if (Object.prototype.hasOwnProperty.call(value, 'device_type')) session.device_type = strictText(value.device_type, 'device_type', 24);
    if (Object.prototype.hasOwnProperty.call(value, 'revoked_at')) session.revoked_at = strictTimestamp(value.revoked_at, 'revoked_at');
    return session;
  }

  function normalizePage(payload, key, normalizer) {
    if (!exactKeys(payload, [key, 'total', 'limit', 'offset', 'has_more']) || !Array.isArray(payload[key])
        || !Number.isSafeInteger(payload.total) || payload.total < 0
        || !Number.isSafeInteger(payload.limit) || payload.limit < 1 || payload.limit > 200
        || !Number.isSafeInteger(payload.offset) || payload.offset < 0 || payload.offset > 10000
        || typeof payload.has_more !== 'boolean' || payload[key].length > payload.limit) {
      throw new RequestError(502, `Web Movly vrátil neplatnou stránku ${key}.`);
    }
    const items = payload[key].map(normalizer);
    if (new Set(items.map((item) => item.id)).size !== items.length
        || payload.has_more !== (payload.offset + items.length < payload.total)
        || (payload.has_more && items.length === 0)) {
      throw new RequestError(502, `Web Movly vrátil nekonzistentní stránku ${key}.`);
    }
    return { items, total: payload.total, limit: payload.limit, offset: payload.offset, hasMore: payload.has_more };
  }

  const inactiveAfterMs = 30 * 24 * 60 * 60 * 1000;

  // Kandidát na „Odstranit neaktivní": odpojené nebo 30+ dní nepoužité, ne aktuální.
  function isInactiveDevice(device) {
    if (device.is_current) return false;
    if (device.revoked_at) return true;
    const seen = Date.parse(device.last_seen_at.replace(/\.(\d{3})\d+/, '.$1'));
    return Number.isFinite(seen) && seen < Date.now() - inactiveAfterMs;
  }

  function inactiveDevices() {
    return [...state.devices.items.values()].filter(isInactiveDevice);
  }

  function formatDate(value) {
    const parseable = value.replace(/\.(\d{3})\d+/, '.$1');
    return new Intl.DateTimeFormat('cs-CZ', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(parseable));
  }

  function showLogin(message = '', kind = 'error') {
    account = null;
    elements.managementPanel.classList.add('hidden');
    elements.loginPanel.classList.remove('hidden');
    if (message) showStatus(elements.loginStatus, message, kind);
    else clearStatus(elements.loginStatus);
  }

  function showManagement() {
    elements.loginPanel.classList.add('hidden');
    elements.managementPanel.classList.remove('hidden');
    elements.accountName.textContent = account.name;
    clearStatus(elements.loginStatus);
  }

  function emptyState(message) {
    const paragraph = document.createElement('p');
    paragraph.className = 'empty-state';
    paragraph.textContent = message;
    return paragraph;
  }

  function renderDevices() {
    elements.deviceList.replaceChildren();
    elements.deviceCount.textContent = state.devices.total === null
      ? '—'
      : `${state.devices.items.size}/${state.devices.total}`;
    if (state.devices.items.size === 0) {
      elements.deviceList.append(emptyState(state.devices.loading ? 'Načítám zařízení…' : 'Účet zatím nemá žádné evidované zařízení.'));
    }
    for (const device of state.devices.items.values()) {
      const fragment = elements.deviceTemplate.content.cloneNode(true);
      const item = fragment.querySelector('.managed-item');
      item.dataset.id = device.id;
      fragment.querySelector('[data-field="name"]').textContent = device.display_name;
      fragment.querySelector('[data-field="current"]').classList.toggle('hidden', !device.is_current);
      fragment.querySelector('[data-field="revoked"]').classList.toggle('hidden', !device.revoked_at);
      fragment.querySelector('[data-field="summary"]').textContent = [device.platform, device.device_type, device.model].filter(Boolean).join(' · ');
      fragment.querySelector('[data-field="lastSeen"]').textContent = formatDate(device.last_seen_at);
      fragment.querySelector('[data-field="created"]').textContent = formatDate(device.created_at);
      const version = [device.app_version, device.os_version].filter(Boolean).join(' · ');
      fragment.querySelector('[data-field="versionRow"]').classList.toggle('hidden', version === '');
      fragment.querySelector('[data-field="version"]').textContent = version;
      const renameForm = fragment.querySelector('[data-field="renameForm"]');
      const renameInput = fragment.querySelector('[data-field="renameInput"]');
      const renameLabel = fragment.querySelector('[data-field="renameLabel"]');
      const renameID = `rename-${device.id}`;
      renameInput.id = renameID;
      renameInput.value = device.display_name;
      renameLabel.htmlFor = renameID;
      const renameButton = fragment.querySelector('[data-action="rename"]');
      const revokeButton = fragment.querySelector('[data-action="revoke"]');
      const removeButton = fragment.querySelector('[data-action="remove"]');
      renameButton.disabled = Boolean(device.revoked_at);
      revokeButton.disabled = Boolean(device.revoked_at);
      removeButton.disabled = device.is_current;
      removeButton.addEventListener('click', () => requestRevoke('devices', device, 'purge'));
      renameButton.addEventListener('click', () => {
        renameForm.classList.remove('hidden');
        renameInput.focus();
        renameInput.select();
      });
      fragment.querySelector('[data-action="cancelRename"]').addEventListener('click', () => {
        renameInput.value = device.display_name;
        renameForm.classList.add('hidden');
      });
      renameForm.addEventListener('submit', (event) => renameDevice(event, device, renameForm, renameInput));
      revokeButton.addEventListener('click', () => requestRevoke('devices', device));
      elements.deviceList.append(fragment);
    }
    elements.moreDevices.classList.toggle('hidden', !state.devices.hasMore);
    elements.moreDevices.disabled = state.devices.loading;
    const inactiveCount = inactiveDevices().length;
    elements.removeInactiveDevices.disabled = state.devices.loading || inactiveCount === 0;
    elements.removeInactiveDevices.textContent = inactiveCount > 0
      ? `Odstranit neaktivní (${inactiveCount})`
      : 'Odstranit neaktivní';
  }

  function renderSessions() {
    elements.sessionList.replaceChildren();
    elements.sessionCount.textContent = state.sessions.total === null
      ? '—'
      : `${state.sessions.items.size}/${state.sessions.total}`;
    if (state.sessions.items.size === 0) {
      elements.sessionList.append(emptyState(state.sessions.loading ? 'Načítám přihlášení…' : 'Účet nemá žádnou evidovanou session.'));
    }
    for (const session of state.sessions.items.values()) {
      const fragment = elements.sessionTemplate.content.cloneNode(true);
      const item = fragment.querySelector('.managed-item');
      item.dataset.id = session.id;
      fragment.querySelector('[data-field="name"]').textContent = session.device_name || 'Nepojmenované přihlášení';
      fragment.querySelector('[data-field="current"]').classList.toggle('hidden', !session.is_current);
      fragment.querySelector('[data-field="inactive"]').classList.toggle('hidden', session.is_active);
      fragment.querySelector('[data-field="summary"]').textContent = [session.device_type, session.device_id].filter(Boolean).join(' · ') || 'Session bez přiřazeného zařízení';
      fragment.querySelector('[data-field="lastSeen"]').textContent = formatDate(session.last_seen_at);
      fragment.querySelector('[data-field="expires"]').textContent = formatDate(session.absolute_expires_at);
      const revokeButton = fragment.querySelector('[data-action="revoke"]');
      revokeButton.disabled = !session.is_active;
      revokeButton.addEventListener('click', () => requestRevoke('sessions', session));
      elements.sessionList.append(fragment);
    }
    elements.moreSessions.classList.toggle('hidden', !state.sessions.hasMore);
    elements.moreSessions.disabled = state.sessions.loading;
  }

  async function loadCollection(key, reset) {
    const collection = state[key];
    const isDevices = key === 'devices';
    const statusElement = isDevices ? elements.deviceStatus : elements.sessionStatus;
    if (collection.loading) {
      throw new RequestError(409, `Seznam ${key} se už načítá.`);
    }
    collection.loading = true;
    if (reset) {
      collection.items.clear();
      collection.total = null;
      collection.nextOffset = 0;
      collection.hasMore = false;
    }
    (isDevices ? renderDevices : renderSessions)();
    showStatus(statusElement, 'Načítám aktuální data…');
    try {
      const expectedOffset = collection.nextOffset;
      const payload = await api(`/api/${key}?limit=${pageSize}&offset=${expectedOffset}`);
      const page = normalizePage(payload, key, isDevices ? normalizeDevice : normalizeSession);
      if (page.offset !== expectedOffset || page.limit !== pageSize) {
        throw new RequestError(502, `Web Movly vrátil jinou stránku ${key}, než byla požadována.`);
      }
      if (!reset && collection.total !== page.total) {
        throw new RequestError(409, `Seznam ${key} se během stránkování změnil. Použij Obnovit vše.`);
      }
      for (const item of page.items) {
        if (collection.items.has(item.id)) {
          throw new RequestError(502, `Stránky ${key} se překrývají na ID ${item.id}.`);
        }
        collection.items.set(item.id, item);
      }
      collection.total = page.total;
      collection.nextOffset = page.offset + page.items.length;
      collection.hasMore = page.hasMore;
      clearStatus(statusElement);
    } catch (error) {
      showStatus(statusElement, error.message, 'error');
      throw error;
    } finally {
      collection.loading = false;
      (isDevices ? renderDevices : renderSessions)();
    }
  }

  async function refreshAll() {
    setButtonBusy(elements.refreshButton, true, 'Obnovuji…');
    const results = await Promise.allSettled([
      loadCollection('devices', true),
      loadCollection('sessions', true),
    ]);
    setButtonBusy(elements.refreshButton, false);
    const unauthorized = results.find((result) => result.status === 'rejected' && result.reason?.status === 401);
    if (unauthorized) {
      activeToken = null;
      showLogin('Přihlášení vypršelo. Přihlas se znovu.');
    }
  }

  function validateRequestedDisplayName(value) {
    if (typeof value !== 'string' || value !== value.trim() || Array.from(value).length < 1
        || Array.from(value).length > 100 || /\p{Cc}/u.test(value)) {
      throw new RequestError(400, 'Název musí mít 1–100 znaků bez okrajových mezer a řídicích znaků.');
    }
    return value;
  }

  async function renameDevice(event, device, form, input) {
    event.preventDefault();
    const status = form.querySelector('[data-field="renameStatus"]');
    const saveButton = form.querySelector('[data-action="saveRename"]');
    clearStatus(status);
    try {
      const displayName = validateRequestedDisplayName(input.value);
      setButtonBusy(saveButton, true, 'Ukládám…');
      const payload = await api(`/api/devices/${device.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ display_name: displayName }),
      });
      const renamed = normalizeDevice(payload);
      if (renamed.id !== device.id) throw new RequestError(502, 'Web Movly vrátil jiné zařízení po přejmenování.');
      state.devices.items.set(renamed.id, renamed);
      renderDevices();
      showStatus(elements.deviceStatus, `Zařízení bylo přejmenováno na „${renamed.display_name}“.`, 'ok');
    } catch (error) {
      showStatus(status, error.message, 'error');
    } finally {
      setButtonBusy(saveButton, false);
    }
  }

  // mode: 'revoke' (odpojit), 'purge' (odstranit ze seznamu), 'purgeInactive' (hromadně).
  function requestRevoke(kind, item, mode = 'revoke') {
    if (typeof elements.confirmDialog.showModal !== 'function') {
      const targetStatus = kind === 'devices' ? elements.deviceStatus : elements.sessionStatus;
      showStatus(targetStatus, 'Tento prohlížeč nepodporuje bezpečný potvrzovací dialog. Odpojení nebylo provedeno.', 'error');
      return;
    }
    pendingDecision = { kind, item, mode };
    const isDevice = kind === 'devices';
    if (mode === 'purgeInactive') {
      elements.confirmTitle.textContent = 'Odstranit neaktivní zařízení?';
      elements.confirmMessage.textContent = `${item.length} odpojených nebo 30+ dní nepoužitých zařízení bude odpojeno a odstraněno ze seznamu. Historie pro synchronizaci zůstane zachována.`;
      elements.acceptConfirm.textContent = `Odstranit ${item.length} zařízení`;
    } else if (mode === 'purge') {
      elements.confirmTitle.textContent = 'Odstranit zařízení?';
      elements.confirmMessage.textContent = `Zařízení „${item.display_name}“ bude odpojeno a odstraněno ze seznamu. Po dalším přihlášení z tohoto zařízení se v seznamu znovu objeví.`;
      elements.acceptConfirm.textContent = 'Odstranit zařízení';
    } else {
      elements.confirmTitle.textContent = isDevice ? 'Odpojit zařízení?' : 'Ukončit session?';
      elements.confirmMessage.textContent = isDevice
        ? `Zařízení „${item.display_name}“ a jeho aktivní relace budou odpojeny. Tuto akci je nutné potvrdit.`
        : `Session „${item.device_name || item.id}“ bude okamžitě ukončena. Tuto akci je nutné potvrdit.`;
      elements.acceptConfirm.textContent = isDevice ? 'Odpojit zařízení' : 'Ukončit session';
    }
    elements.confirmDialog.returnValue = '';
    elements.confirmDialog.showModal();
  }

  async function purgeInactiveConfirmed(devices) {
    showStatus(elements.deviceStatus, `Odstraňuji ${devices.length} neaktivních zařízení…`);
    let removed = 0;
    const failures = [];
    for (const device of devices) {
      try {
        await api(`/api/devices/${device.id}?purge=true`, { method: 'DELETE', expectedStatus: 204 });
        removed += 1;
      } catch (error) {
        failures.push(`${device.display_name}: ${error.message}`);
      }
    }
    await refreshAll();
    if (failures.length === 0) {
      showStatus(elements.deviceStatus, `Odstraněno ${removed} neaktivních zařízení.`, 'ok');
    } else {
      showStatus(elements.deviceStatus, `Odstraněno ${removed} zařízení, ${failures.length} se nepodařilo: ${failures.join('; ')}`, 'error');
    }
  }

  async function revokeConfirmed(decision) {
    const { kind, item, mode } = decision;
    if (mode === 'purgeInactive') {
      await purgeInactiveConfirmed(item);
      return;
    }
    const targetStatus = kind === 'devices' ? elements.deviceStatus : elements.sessionStatus;
    const purge = mode === 'purge';
    showStatus(targetStatus, purge ? 'Odstraňuji zařízení…' : kind === 'devices' ? 'Odpojuji zařízení…' : 'Ukončuji session…');
    try {
      await api(`/api/${kind}/${item.id}${purge ? '?purge=true' : ''}`, { method: 'DELETE', expectedStatus: 204 });
      if (item.is_current) {
        activeToken = null;
        let removalFailed = null;
        try {
          localStorage.removeItem(tokenKey);
        } catch (error) {
          removalFailed = error;
        }
        showLogin(
          removalFailed
            ? `Aktuální přihlášení bylo ukončeno, ale prohlížeč odmítl odstranit lokální token (${removalFailed.message}). Zavři tuto stránku a vymaž její úložiště.`
            : 'Aktuální přihlášení bylo úspěšně ukončeno. Pro další správu se přihlas znovu.',
          removalFailed ? 'error' : 'ok',
        );
        return;
      }
      await refreshAll();
      const refreshedStatus = kind === 'devices' ? elements.deviceStatus : elements.sessionStatus;
      showStatus(
        refreshedStatus,
        purge ? 'Zařízení bylo odstraněno ze seznamu.' : kind === 'devices' ? 'Zařízení bylo odpojeno.' : 'Session byla ukončena.',
        'ok',
      );
    } catch (error) {
      showStatus(targetStatus, error.message, 'error');
    }
  }

  elements.confirmDialog.addEventListener('close', () => {
    const decision = pendingDecision;
    pendingDecision = null;
    if (elements.confirmDialog.returnValue === 'confirm' && decision) {
      revokeConfirmed(decision);
    }
  });

  elements.loginForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    clearStatus(elements.loginStatus);
    const username = elements.username.value;
    const password = elements.password.value;
    if (!username || username !== username.trim() || !password) {
      showStatus(elements.loginStatus, 'Vyplň uživatelské jméno/e-mail bez okrajových mezer a heslo.', 'error');
      return;
    }
    const button = elements.loginForm.querySelector('button[type="submit"]');
    setButtonBusy(button, true, 'Přihlašuji…');
    try {
      const payload = await api('/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({ username, password }),
        authenticated: false,
      });
      const session = validateSession(payload, true);
      try {
        localStorage.setItem(tokenKey, session.token);
      } catch (error) {
        throw new RequestError(500, `Prohlížeč odmítl bezpečně uložit přihlášení (${error.message}).`);
      }
      activeToken = session.token;
      account = { name: session.name };
      elements.password.value = '';
      showManagement();
      await refreshAll();
    } catch (error) {
      showLogin(error.message, 'error');
    } finally {
      setButtonBusy(button, false);
    }
  });

  elements.refreshButton.addEventListener('click', () => refreshAll());
  elements.removeInactiveDevices.addEventListener('click', () => {
    const candidates = inactiveDevices();
    if (candidates.length === 0) {
      showStatus(elements.deviceStatus, 'Žádná neaktivní zařízení k odstranění.', 'ok');
      return;
    }
    requestRevoke('devices', candidates, 'purgeInactive');
  });
  elements.moreDevices.addEventListener('click', () => loadCollection('devices', false).catch((error) => {
    console.error('[Movly devices] Načtení další stránky zařízení selhalo:', error);
  }));
  elements.moreSessions.addEventListener('click', () => loadCollection('sessions', false).catch((error) => {
    console.error('[Movly devices] Načtení další stránky sessions selhalo:', error);
  }));

  async function initialize() {
    if (storageReadError) {
      showLogin(`Prohlížeč odmítl načíst lokální přihlášení (${storageReadError.message}).`, 'error');
      return;
    }
    if (!activeToken) {
      showLogin('', '');
      return;
    }
    try {
      const session = validateSession(await api('/api/auth/me'), false);
      account = { name: session.name };
      showManagement();
      await refreshAll();
    } catch (error) {
      if (error.status === 401) activeToken = null;
      showLogin(error.status === 401 ? 'Přihlášení vypršelo. Přihlas se znovu.' : error.message, 'error');
    }
  }

  initialize().catch((error) => showLogin(error.message || 'Správu zařízení se nepodařilo inicializovat.', 'error'));
})();
