'use strict';

(() => {
  const tokenKey = 'movlyDownloadToken';
  const userCodePattern = /^[0-9A-HJKMNP-TV-Z]{5}-[0-9A-HJKMNP-TV-Z]{5}$/;
  const elements = {
    codeForm: document.getElementById('codeForm'),
    userCode: document.getElementById('userCode'),
    loginStep: document.getElementById('loginStep'),
    loginForm: document.getElementById('loginForm'),
    username: document.getElementById('username'),
    password: document.getElementById('password'),
    previewStep: document.getElementById('previewStep'),
    accountLabel: document.getElementById('accountLabel'),
    deviceName: document.getElementById('deviceName'),
    devicePlatform: document.getElementById('devicePlatform'),
    deviceType: document.getElementById('deviceType'),
    deviceModelRow: document.getElementById('deviceModelRow'),
    deviceModel: document.getElementById('deviceModel'),
    deviceVersionRow: document.getElementById('deviceVersionRow'),
    deviceVersion: document.getElementById('deviceVersion'),
    deviceExpiry: document.getElementById('deviceExpiry'),
    approveButton: document.getElementById('approveButton'),
    denyButton: document.getElementById('denyButton'),
    resultStep: document.getElementById('resultStep'),
    resultIcon: document.getElementById('resultIcon'),
    resultTitle: document.getElementById('resultTitle'),
    resultMessage: document.getElementById('resultMessage'),
    status: document.getElementById('status'),
  };
  let account = null;
  let previewedCode = null;

  class RequestError extends Error {
    constructor(status, message) {
      super(message);
      this.status = status;
    }
  }

  function showStatus(message, kind = '') {
    elements.status.textContent = message;
    elements.status.dataset.kind = kind;
    elements.status.classList.remove('hidden');
    elements.status.setAttribute('role', kind === 'error' ? 'alert' : 'status');
  }

  function clearStatus() {
    elements.status.textContent = '';
    elements.status.dataset.kind = '';
    elements.status.classList.add('hidden');
    elements.status.setAttribute('role', 'status');
  }

  function setBusy(buttons, busy) {
    for (const button of buttons) button.disabled = busy;
  }

  function requireCanonicalCode() {
    const code = elements.userCode.value;
    if (!userCodePattern.test(code)) {
      throw new RequestError(400, 'Kód musí mít přesně formát XXXXX-XXXXX a používat velká písmena.');
    }
    return code;
  }

  async function api(path, options = {}, authenticated = true) {
    const headers = { Accept: 'application/json', ...(options.headers || {}) };
    if (options.body !== undefined) headers['Content-Type'] = 'application/json';
    if (authenticated) {
      const token = localStorage.getItem(tokenKey);
      if (!token) throw new RequestError(401, 'Přihlas se Movly účtem.');
      headers.Authorization = `Bearer ${token}`;
    }
    let response;
    try {
      response = await fetch(path, { ...options, headers });
    } catch (error) {
      throw new RequestError(0, `Web Movly teď není dostupný (${error.message}).`);
    }
    const text = await response.text();
    let payload = {};
    if (text) {
      try {
        payload = JSON.parse(text);
      } catch {
        throw new RequestError(response.status, `Web Movly vrátil nečitelnou odpověď (${response.status}).`);
      }
    }
    if (!response.ok) {
      throw new RequestError(response.status, typeof payload.message === 'string' ? payload.message : `Požadavek selhal (${response.status}).`);
    }
    return payload;
  }

  function showLogin(message = '') {
    elements.loginStep.classList.remove('hidden');
    elements.previewStep.classList.add('hidden');
    previewedCode = null;
    if (message) showStatus(message, 'error');
  }

  function validateSession(payload) {
    if (!payload || typeof payload !== 'object' || !payload.account || typeof payload.account !== 'object') {
      throw new RequestError(502, 'Web Movly vrátil neplatnou přihlašovací odpověď.');
    }
    const name = payload.account.displayName || payload.account.username;
    if (typeof name !== 'string' || !name || name !== name.trim()) {
      throw new RequestError(502, 'Web Movly vrátil účet bez platného jména.');
    }
    return { name };
  }

  function validatePreview(payload) {
    const required = ['status', 'display_name', 'platform', 'device_type', 'expires_at'];
    const optional = ['app_version', 'os_version', 'model'];
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)
        || !required.every((key) => Object.prototype.hasOwnProperty.call(payload, key))
        || Object.keys(payload).some((key) => !required.includes(key) && !optional.includes(key))
        || payload.status !== 'pending') {
      throw new RequestError(502, 'Web Movly vrátil neplatný náhled zařízení.');
    }
    for (const key of ['display_name', 'platform', 'device_type']) {
      if (typeof payload[key] !== 'string' || !payload[key] || payload[key] !== payload[key].trim()) {
        throw new RequestError(502, `Náhled zařízení obsahuje neplatné pole ${key}.`);
      }
    }
    const expiresAt = new Date(payload.expires_at);
    if (!Number.isFinite(expiresAt.getTime())) throw new RequestError(502, 'Náhled zařízení obsahuje neplatnou expiraci.');
    for (const key of optional) {
      if (Object.prototype.hasOwnProperty.call(payload, key)
          && (typeof payload[key] !== 'string' || !payload[key] || payload[key] !== payload[key].trim())) {
        throw new RequestError(502, `Náhled zařízení obsahuje neplatné pole ${key}.`);
      }
    }
    return { ...payload, expiresAt };
  }

  function renderPreview(payload, code) {
    const preview = validatePreview(payload);
    elements.loginStep.classList.add('hidden');
    elements.previewStep.classList.remove('hidden');
    elements.accountLabel.textContent = `Přihlášený účet: ${account.name}`;
    elements.deviceName.textContent = preview.display_name;
    elements.devicePlatform.textContent = preview.platform;
    elements.deviceType.textContent = preview.device_type;
    elements.deviceExpiry.textContent = new Intl.DateTimeFormat('cs-CZ', { dateStyle: 'medium', timeStyle: 'short' }).format(preview.expiresAt);
    elements.deviceModelRow.classList.toggle('hidden', !preview.model);
    elements.deviceModel.textContent = preview.model || '';
    elements.deviceVersionRow.classList.toggle('hidden', !preview.app_version);
    elements.deviceVersion.textContent = preview.app_version || '';
    previewedCode = code;
    clearStatus();
  }

  async function loadPreview() {
    const code = requireCanonicalCode();
    if (!account) {
      showLogin('Nejdřív se přihlas, potom zobrazíme zařízení k potvrzení.');
      return;
    }
    const payload = await api('/api/device-authorization/preview', {
      method: 'POST',
      body: JSON.stringify({ user_code: code }),
    });
    renderPreview(payload, code);
  }

  function showResult(approved) {
    elements.previewStep.classList.add('hidden');
    elements.loginStep.classList.add('hidden');
    elements.resultStep.classList.remove('hidden');
    elements.resultIcon.className = `result-icon ${approved ? 'approved' : 'denied'}`;
    elements.resultIcon.textContent = approved ? '✓' : '×';
    elements.resultTitle.textContent = approved ? 'Televize je připojená' : 'Připojení bylo zamítnuto';
    elements.resultMessage.textContent = approved
      ? 'Vrať se k televizi. Aplikace dokončí přihlášení během několika sekund.'
      : 'Televize tento kód nemůže použít. Pokud to bylo omylem, vytvoř na televizi nový kód.';
    previewedCode = null;
    clearStatus();
    elements.resultStep.focus();
  }

  async function decide(approve) {
    const code = requireCanonicalCode();
    if (!previewedCode || code !== previewedCode) {
      throw new RequestError(409, 'Kód se od náhledu změnil. Načti zařízení znovu před rozhodnutím.');
    }
    setBusy([elements.approveButton, elements.denyButton], true);
    try {
      const expectedStatus = approve ? 'approved' : 'denied';
      const payload = await api(`/api/device-authorization/${approve ? 'approve' : 'deny'}`, {
        method: 'POST',
        body: JSON.stringify({ user_code: code }),
      });
      if (!payload || Object.keys(payload).length !== 1 || payload.status !== expectedStatus) {
        throw new RequestError(502, `Web Movly nepotvrdil stav ${expectedStatus}.`);
      }
      showResult(approve);
    } finally {
      setBusy([elements.approveButton, elements.denyButton], false);
    }
  }

  elements.codeForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    clearStatus();
    const button = elements.codeForm.querySelector('button');
    setBusy([button], true);
    try {
      await loadPreview();
    } catch (error) {
      showStatus(error.message, 'error');
      if (error.status === 401) showLogin();
    } finally {
      setBusy([button], false);
    }
  });

  elements.loginForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    clearStatus();
    const username = elements.username.value;
    const password = elements.password.value;
    if (!username || username !== username.trim() || !password) {
      showStatus('Vyplň uživatelské jméno/e-mail bez okrajových mezer a heslo.', 'error');
      return;
    }
    const button = elements.loginForm.querySelector('button');
    setBusy([button], true);
    try {
      const session = await api('/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({ username, password }),
      }, false);
      if (typeof session.token !== 'string' || session.token.length < 16 || /\s/.test(session.token)) {
        throw new RequestError(502, 'Web Movly nevrátil platný přihlašovací token.');
      }
      localStorage.setItem(tokenKey, session.token);
      account = validateSession(session);
      elements.password.value = '';
      await loadPreview();
    } catch (error) {
      showStatus(error.message, 'error');
    } finally {
      setBusy([button], false);
    }
  });

  elements.approveButton.addEventListener('click', () => decide(true).catch((error) => showStatus(error.message, 'error')));
  elements.denyButton.addEventListener('click', () => decide(false).catch((error) => showStatus(error.message, 'error')));

  async function initialize() {
    const url = new URL(window.location.href);
    const queryEntries = [...url.searchParams.entries()];
    if (queryEntries.length > 0) {
      if (queryEntries.length !== 1 || queryEntries[0][0] !== 'user_code' || !userCodePattern.test(queryEntries[0][1])) {
        showStatus('Odkaz neobsahuje jeden platný parametr user_code. Použij nový QR kód z televize.', 'error');
        return;
      }
      elements.userCode.value = queryEntries[0][1];
    }

    const token = localStorage.getItem(tokenKey);
    if (!token) {
      showLogin(queryEntries.length === 1 ? 'Pro kontrolu zařízení se přihlas.' : 'Zadej kód a přihlas se.');
      return;
    }
    try {
      account = validateSession(await api('/api/auth/me'));
      if (queryEntries.length === 1) await loadPreview();
    } catch (error) {
      account = null;
      showLogin(error.status === 401 ? 'Přihlášení vypršelo. Přihlas se znovu.' : error.message);
    }
  }

  initialize().catch((error) => showStatus(error.message || 'Aktivaci se nepodařilo inicializovat.', 'error'));
})();
