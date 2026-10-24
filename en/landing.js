// English landing page logic; previously inline in en/index.html, moved out for CSP script-src 'self' (WEB-N30).
// scroll reveal
const io = new IntersectionObserver((entries)=>{
  entries.forEach(e=>{ if(e.isIntersecting){ e.target.classList.add('in'); io.unobserve(e.target); } });
},{threshold:0.12,rootMargin:'0px 0px -40px 0px'});
document.querySelectorAll('.reveal').forEach((el,i)=>{
  el.style.transitionDelay = (Math.min(i,6)*30)+'ms';
  io.observe(el);
});
// header subtle shadow on scroll
const hdr=document.querySelector('header');
addEventListener('scroll',()=>{ hdr.style.borderBottomColor = scrollY>10 ? 'rgba(255,255,255,.14)' : 'rgba(255,255,255,.08)'; },{passive:true});

// installer downloads
const downloadEls = {
  form: document.getElementById('download-login-form'),
  username: document.getElementById('movly-login-user'),
  password: document.getElementById('movly-login-password'),
  loginButton: document.getElementById('movly-login-button'),
  logoutButton: document.getElementById('movly-logout-button'),
  account: document.getElementById('download-account'),
  accountName: document.getElementById('download-account-name'),
  accountEmail: document.getElementById('download-account-email'),
  accountBadges: document.getElementById('download-account-badges'),
  status: document.getElementById('download-status'),
  locked: document.getElementById('download-locked'),
  grid: document.getElementById('download-grid'),
};
const MOVLY_DOWNLOAD_TOKEN = 'movlyDownloadToken';

function setDownloadStatus(message, kind = '') {
  downloadEls.status.textContent = message;
  downloadEls.status.className = `download-status${kind ? ` ${kind}` : ''}`;
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#039;',
  })[char]);
}

async function downloadApi(path, options = {}) {
  const headers = {
    Accept: 'application/json',
    ...(options.headers || {}),
  };
  if (options.body && !headers['Content-Type']) headers['Content-Type'] = 'application/json';
  const token = localStorage.getItem(MOVLY_DOWNLOAD_TOKEN);
  if (token) headers.Authorization = `Bearer ${token}`;

  let response;
  try {
    response = await fetch(path, { ...options, headers });
  } catch (error) {
    throw new Error(`Downloads are unavailable right now (${error.message}). Please try again later.`);
  }

  const text = await response.text();
  let payload = {};
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      throw new Error(`Downloads are unavailable right now (${response.status}). Please try again later.`);
    }
  }

  if (!response.ok) {
    throw new Error(payload.message || payload.error || `Request failed (${response.status}).`);
  }
  return payload;
}

function renderAccount(session) {
  const account = session.account || {};
  const displayName = account.displayName || account.username || 'Movly account';
  downloadEls.accountName.textContent = displayName;
  downloadEls.accountEmail.textContent = account.email || '';
  downloadEls.accountBadges.innerHTML = [
    '<span class="mini-badge">Signed in</span>',
    session.hasDownloadAccess
      ? `<span class="mini-badge good">${escapeHtml(session.accessLabel || 'Access granted')}</span>`
      : '<span class="mini-badge warn">Unavailable</span>',
    account.coins !== null && account.coins !== undefined
      ? `<span class="mini-badge">${escapeHtml(account.coins)} coins</span>`
      : '',
  ].join('');
  downloadEls.form.hidden = true;
  downloadEls.account.hidden = false;
}

function clearAccount() {
  downloadEls.form.hidden = false;
  downloadEls.account.hidden = true;
  downloadEls.grid.hidden = true;
  downloadEls.grid.innerHTML = '';
  downloadEls.locked.hidden = false;
}

function renderDownloads(downloads) {
  downloadEls.grid.innerHTML = downloads.map((item) => {
    const facts = [item.type, item.sizeLabel || 'file missing'].filter(Boolean);
    return `
      <article class="download-card${item.available ? '' : ' missing'}">
        <div class="download-card-head">
          <div>
            <h3>${escapeHtml(item.title)}</h3>
            <p>${escapeHtml(item.subtitle)}</p>
          </div>
          <span class="platform-tag">${escapeHtml(item.platform)}</span>
        </div>
        <div class="download-facts">
          ${facts.map((fact) => `<span>${escapeHtml(fact)}</span>`).join('')}
        </div>
        <button class="btn ${item.available ? 'btn-grad' : 'btn-ghost'}" type="button" data-download-id="${escapeHtml(item.id)}" ${item.available ? '' : 'disabled'}>
          ${item.available ? 'Download' : escapeHtml(item.missingMessage || 'File not uploaded')}
        </button>
      </article>
    `;
  }).join('');
  downloadEls.grid.hidden = false;
  downloadEls.locked.hidden = true;
}

async function loadDownloads() {
  const data = await downloadApi('/api/downloads');
  renderDownloads(data.downloads || []);
  setDownloadStatus('Signed in. Pick the installer for your device.', 'ok');
}

async function applySession(session) {
  renderAccount(session);
  if (!session.hasDownloadAccess) {
    downloadEls.grid.hidden = true;
    downloadEls.locked.hidden = false;
    setDownloadStatus('No installers are available for this account right now.', 'error');
    return;
  }
  await loadDownloads();
}

downloadEls.form.addEventListener('submit', async (event) => {
  event.preventDefault();
  downloadEls.loginButton.disabled = true;
  downloadEls.loginButton.textContent = 'Signing in...';
  setDownloadStatus('Verifying your Movly account...');
  try {
    const session = await downloadApi('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({
        username: downloadEls.username.value,
        password: downloadEls.password.value,
      }),
    });
    localStorage.setItem(MOVLY_DOWNLOAD_TOKEN, session.token);
    downloadEls.password.value = '';
    await applySession(session);
  } catch (error) {
    setDownloadStatus(error.message, 'error');
    clearAccount();
  } finally {
    downloadEls.loginButton.disabled = false;
    downloadEls.loginButton.textContent = 'Sign in';
  }
});

downloadEls.logoutButton.addEventListener('click', async () => {
  try {
    await downloadApi('/api/auth/logout', { method: 'POST' });
    setDownloadStatus('Signed out. Installers are hidden again.');
  } catch (error) {
    setDownloadStatus(`Sign-out could not be completed: ${error.message}`, 'error');
  } finally {
    localStorage.removeItem(MOVLY_DOWNLOAD_TOKEN);
    clearAccount();
  }
});

downloadEls.grid.addEventListener('click', async (event) => {
  const button = event.target.closest('[data-download-id]');
  if (!button) return;
  const originalText = button.textContent;
  button.disabled = true;
  button.textContent = 'Preparing link...';
  try {
    const data = await downloadApi(`/api/downloads/${encodeURIComponent(button.dataset.downloadId)}/link`, { method: 'POST' });
    setDownloadStatus(`The download link is valid for ${data.expiresInSeconds || 300} seconds. Starting download...`, 'ok');
    window.location.href = data.url;
  } catch (error) {
    setDownloadStatus(error.message, 'error');
  } finally {
    button.disabled = false;
    button.textContent = originalText;
  }
});

(async function restoreDownloadSession() {
  if (!localStorage.getItem(MOVLY_DOWNLOAD_TOKEN)) return;
  setDownloadStatus('Verifying saved sign-in...');
  try {
    const session = await downloadApi('/api/auth/me');
    await applySession(session);
  } catch (error) {
    localStorage.removeItem(MOVLY_DOWNLOAD_TOKEN);
    clearAccount();
    setDownloadStatus(error.message, 'error');
  }
})();

// Mobile menu: close after choosing a link, with Escape or by clicking outside (WEB-N27).
(function () {
  const mobileNav = document.getElementById('mobileNav');
  if (!mobileNav) return;
  mobileNav.querySelectorAll('a').forEach(a => a.addEventListener('click', () => { mobileNav.open = false; }));
  mobileNav.addEventListener('keydown', e => {
    if (e.key === 'Escape' && mobileNav.open) { mobileNav.open = false; mobileNav.querySelector('summary').focus(); }
  });
  document.addEventListener('click', e => { if (mobileNav.open && !mobileNav.contains(e.target)) mobileNav.open = false; });
})();
