// Logika české úvodní stránky; dříve inline v index.html, kvůli CSP script-src 'self' (WEB-N30).
// Dříve komponenta návrhového runtime (React a Babel z CDN); nyní běží přímo nad statickým HTML.
(function () {
    const root = document.getElementById('mvLandingRoot');
    if (!root) return;
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    // ---- responsive images ----
    root.querySelectorAll('img').forEach(img => { img.decoding = 'async'; });
    root.querySelectorAll('img[src*="image.tmdb.org/t/p/w500/"]').forEach(img => {
      const source = img.getAttribute('src');
      img.width = 152;
      img.height = 224;
      img.loading = 'lazy';
      img.sizes = '152px';
      img.srcset = [
        `${source.replace('/w500/', '/w185/')} 185w`,
        `${source.replace('/w500/', '/w342/')} 342w`,
        `${source} 500w`,
      ].join(', ');
    });

    // ---- scroll reveal + counters ----
    const reveals = [...root.querySelectorAll('[data-reveal]')];
    const counts = [...root.querySelectorAll('[data-count]')];
    const counted = new Set();
    const show = el => { el.style.opacity = '1'; el.style.transform = 'none'; };
    const setCount = el => {
      el.textContent = `${parseFloat(el.getAttribute('data-count'))}${el.getAttribute('data-suffix') || ''}`;
      counted.add(el);
    };

    const runCount = el => {
      if (counted.has(el)) return;
      counted.add(el);
      const target = parseFloat(el.getAttribute('data-count'));
      const suf = el.getAttribute('data-suffix') || '';
      const dur = 1100, t0 = performance.now();
      const step = now => {
        const p = Math.min(1, (now - t0) / dur);
        const val = Math.round(target * (0.5 - Math.cos(Math.PI * p) / 2));
        el.textContent = val + suf;
        if (p < 1) requestAnimationFrame(step);
      };
      requestAnimationFrame(step);
    };

    if (reduceMotion) {
      reveals.forEach(show);
      counts.forEach(setCount);
    } else if ('IntersectionObserver' in window) {
      reveals.forEach(el => {
        el.style.opacity = '0';
        el.style.transform = 'translateY(28px)';
        el.style.transition = 'opacity .7s cubic-bezier(.2,.7,.2,1), transform .7s cubic-bezier(.2,.7,.2,1)';
        const delay = el.getAttribute('data-delay');
        if (delay) el.style.transitionDelay = `${delay}ms`;
      });
      const revealObserver = new IntersectionObserver(entries => {
        entries.forEach(entry => {
          if (!entry.isIntersecting) return;
          if (entry.target.hasAttribute('data-reveal')) show(entry.target);
          if (entry.target.hasAttribute('data-count')) runCount(entry.target);
          revealObserver.unobserve(entry.target);
        });
      }, { rootMargin: '0px 0px -8% 0px', threshold: 0.01 });
      reveals.forEach(el => revealObserver.observe(el));
      counts.forEach(el => revealObserver.observe(el));
      this._revealObserver = revealObserver;
    } else {
      console.warn('[Movly] IntersectionObserver není dostupný; scroll animace jsou vypnuté.');
      reveals.forEach(show);
      counts.forEach(setCount);
    }

    // ---- nav elevation + progress + parallax (max. jednou za frame) ----
    const nav = document.getElementById('mvNav');
    const prog = document.getElementById('mvProgress');
    const parallax = [...root.querySelectorAll('[data-parallax]')];
    const updateScrollState = () => {
      const y = window.scrollY || window.pageYOffset;
      const max = document.documentElement.scrollHeight - window.innerHeight;
      if (prog) prog.style.width = (max > 0 ? (y / max * 100) : 0) + '%';
      if (nav) {
        if (y > 16) { nav.style.boxShadow = '0 10px 34px rgba(0,0,0,.55)'; nav.style.background = 'rgba(10,10,18,.92)'; }
        else { nav.style.boxShadow = 'none'; nav.style.background = 'rgba(10,10,18,.72)'; }
      }
      if (!reduceMotion) {
        parallax.forEach(el => { const s = parseFloat(el.getAttribute('data-parallax')); el.style.transform = 'translateY(' + (y * s) + 'px)'; });
      }
    };
    const onScroll = () => {
      if (this._scrollFrame) return;
      this._scrollFrame = requestAnimationFrame(() => {
        this._scrollFrame = 0;
        updateScrollState();
      });
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll);
    updateScrollState();
    this._onScroll = onScroll;
    this._onResize = onScroll;

    // ---- hero: spotlight + 3D tilt ----
    const hero = root.querySelector('#top');
    const spot = document.getElementById('mvSpot');
    const tilt = root.querySelector('[data-tilt]');
    if (hero && !reduceMotion) {
      hero.addEventListener('mousemove', e => {
        const r = hero.getBoundingClientRect();
        const x = (e.clientX - r.left) / r.width;
        const y = (e.clientY - r.top) / r.height;
        if (spot) { spot.style.opacity = '1'; spot.style.left = (e.clientX - r.left) + 'px'; spot.style.top = (e.clientY - r.top) + 'px'; }
        if (tilt) tilt.style.transform = 'rotateY(' + ((x - 0.5) * 11) + 'deg) rotateX(' + ((0.5 - y) * 8) + 'deg)';
      });
      hero.addEventListener('mouseleave', () => {
        if (spot) spot.style.opacity = '0';
        if (tilt) tilt.style.transform = 'rotateY(0deg) rotateX(0deg)';
      });
    }

    // ---- magnetic buttons ----
    if (!reduceMotion) {
      root.querySelectorAll('[data-magnetic]').forEach(btn => {
        btn.addEventListener('mousemove', e => {
          const r = btn.getBoundingClientRect();
          const mx = e.clientX - r.left - r.width / 2;
          const my = e.clientY - r.top - r.height / 2;
          btn.style.transform = 'translate(' + (mx * 0.25) + 'px,' + (my * 0.4) + 'px)';
        });
        btn.addEventListener('mouseleave', () => { btn.style.transform = 'translate(0,0)'; });
      });
    }

    // ---- náhledy tabs ----
    const tabs = [...root.querySelectorAll('[data-shot-tab]')];
    const panes = [...root.querySelectorAll('[data-shot-pane]')];
    tabs.forEach(t => t.addEventListener('click', () => {
      const k = t.getAttribute('data-shot-tab');
      tabs.forEach(x => {
        const on = x === t;
        x.style.background = on ? 'linear-gradient(135deg,#7C3AED 0%,#A21CAF 50%,#BE185D 100%)' : 'rgba(255,255,255,.06)';
        x.setAttribute('aria-pressed', String(on));
        x.style.color = on ? '#fff' : '#A0A0B2';
        x.style.borderColor = on ? 'transparent' : 'rgba(255,255,255,.12)';
      });
      panes.forEach(p => {
        const on = p.getAttribute('data-shot-pane') === k;
        p.style.opacity = on ? '1' : '0';
        p.style.transform = on ? 'scale(1)' : 'scale(1.03)';
      });
    }));

    // ---- pause marquee on hover ----
    root.querySelectorAll('[data-marquee]').forEach(m => {
      m.addEventListener('mouseenter', () => { m.style.animationPlayState = 'paused'; });
      m.addEventListener('mouseleave', () => { m.style.animationPlayState = 'running'; });
    });

    // ---- viditelné zastavení animací (WCAG 2.2.2) ----
    const motionToggle = document.getElementById('mvMotionToggle');
    if (motionToggle) {
      const setPaused = (paused, remember) => {
        root.classList.toggle('mv-motion-paused', paused);
        motionToggle.textContent = paused ? 'Spustit animace' : 'Pozastavit animace';
        if (remember) try { localStorage.setItem('movly-landing-motion', paused ? 'paused' : 'running'); } catch {}
      };
      let saved = null;
      try { saved = localStorage.getItem('movly-landing-motion'); } catch {}
      setPaused(saved === 'paused', false);
      motionToggle.addEventListener('click', () => setPaused(!root.classList.contains('mv-motion-paused'), true));
    }

    // ---- mobilní nabídka: zavřít po výběru odkazu nebo klávesou Escape ----
    const mobileNav = document.getElementById('mvMobileNav');
    if (mobileNav) {
      mobileNav.querySelectorAll('a').forEach(a => a.addEventListener('click', () => { mobileNav.open = false; }));
      mobileNav.addEventListener('keydown', e => {
        if (e.key === 'Escape' && mobileNav.open) { mobileNav.open = false; mobileNav.querySelector('summary').focus(); }
      });
      document.addEventListener('click', e => { if (mobileNav.open && !mobileNav.contains(e.target)) mobileNav.open = false; });
    }

    // ---- real Movly login + installer downloads ----
    const loginBtn = document.getElementById('mvLoginBtn');
    const userEl = document.getElementById('mvUser');
    const passEl = document.getElementById('mvPass');
    const errEl = document.getElementById('mvLoginErr');
    const formEl = document.getElementById('mvLoginForm');
    const boxEl = document.getElementById('mvLoggedInBox');
    const guidesEl = document.getElementById('mvGuides');
    const logoutBtn = document.getElementById('mvLogoutBtn');
    const nameEl = document.getElementById('mvLoggedInName');
    const emailEl = document.getElementById('mvLoggedInEmail');
    const statusEl = document.getElementById('mvDownloadStatus');
    const gridEl = document.getElementById('mvDownloadGrid');
    const tokenKey = 'movlyDownloadToken';

    const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, ch => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#039;' })[ch]);
    const setStatus = (message, kind = '') => {
      if (!statusEl) return;
      statusEl.textContent = message;
      statusEl.style.display = 'block';
      statusEl.style.color = kind === 'error' ? '#FFC1C1' : kind === 'ok' ? '#B8F7D7' : '#C9C9D6';
      statusEl.style.borderColor = kind === 'error' ? 'rgba(248,113,113,.34)' : kind === 'ok' ? 'rgba(52,211,153,.32)' : 'rgba(255,255,255,.1)';
      statusEl.style.background = kind === 'error' ? 'rgba(248,113,113,.1)' : kind === 'ok' ? 'rgba(52,211,153,.1)' : 'rgba(255,255,255,.06)';
    };
    const showSession = on => {
      if (formEl) formEl.style.display = on ? 'none' : 'block';
      if (boxEl) boxEl.style.display = on ? 'block' : 'none';
      if (guidesEl) guidesEl.style.display = on ? 'block' : 'none';
      if (!on && gridEl) gridEl.innerHTML = '';
    };
    const api = async (path, options = {}) => {
      const headers = { Accept: 'application/json', ...(options.headers || {}) };
      if (options.body && !headers['Content-Type']) headers['Content-Type'] = 'application/json';
      const token = localStorage.getItem(tokenKey);
      if (token) headers.Authorization = `Bearer ${token}`;
      let response;
      try {
        response = await fetch(path, { ...options, headers });
      } catch (error) {
        throw new Error(`Služba teď není dostupná (${error.message}).`);
      }
      const text = await response.text();
      let payload = {};
      if (text) {
        try { payload = JSON.parse(text); }
        catch { throw new Error(`Služba vrátila nečitelnou odpověď (${response.status}).`); }
      }
      if (!response.ok) throw new Error(payload.message || payload.error || `Požadavek selhal (${response.status}).`);
      return payload;
    };
    const icons = {
      windows: '<svg width="24" height="24" viewBox="0 0 24 24" fill="#60A5FA"><path d="M3 5.6 10.4 4.6v6.9H3V5.6Zm0 12.8 7.4 1V12.5H3v5.9Zm8.3 1.1L21 21v-8.5h-9.7v7Zm0-15.1V11.5H21V3l-9.7 1.4Z"></path></svg>',
      apple: '<svg width="24" height="24" viewBox="0 0 384 512" fill="#fff"><path d="M318.7 268.7c-.2-36.7 16.4-64.4 50-84.8-18.8-26.9-47.2-41.7-84.7-44.6-35.5-2.8-74.3 20.7-88.5 20.7-15 0-49.4-19.7-76.4-19.7C63.3 141.2 4 184.8 4 273.5q0 39.3 14.4 81.2c12.8 36.7 59 126.7 107.2 125.2 25.2-.6 43-17.9 75.8-17.9 31.8 0 48.3 17.9 76.4 17.9 48.6-.7 90.4-82.5 102.6-119.3-65.2-30.7-61.7-90-61.7-91.9zm-56.6-164.2c27.3-32.4 24.8-61.9 24-72.5-24.1 1.4-52 16.4-67.9 34.9-17.5 19.8-27.8 44.3-25.6 71.9 26.1 2 49.9-11.4 69.5-34.3z"></path></svg>',
      android: '<svg width="25" height="25" viewBox="0 0 24 24" fill="#34D399"><path d="M17.6 9.48 19.44 6.3a.62.62 0 1 0-1.08-.62l-1.86 3.22A10.2 10.2 0 0 0 12 7.86a10.2 10.2 0 0 0-4.5 1.04L5.64 5.68a.62.62 0 1 0-1.08.62L6.4 9.48A8.68 8.68 0 0 0 3.6 16h16.8a8.68 8.68 0 0 0-2.8-6.52ZM8.5 13.1a.9.9 0 1 1 0-1.8.9.9 0 0 1 0 1.8Zm7 0a.9.9 0 1 1 0-1.8.9.9 0 0 1 0 1.8Z"></path></svg>',
      tv: '<svg width="25" height="25" viewBox="0 0 24 24" fill="none" stroke="#A0A0B2" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="6" width="18" height="12" rx="2"></rect><path d="M8 21h8"></path><path d="M12 18v3"></path></svg>',
      mail: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="5" width="18" height="14" rx="2"></rect><path d="m3 7 9 6 9-6"></path></svg>',
      download: '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v12M7 10l5 5 5-5M5 21h14"></path></svg>',
    };
    const renderDownloads = downloads => {
      if (!gridEl) return;
      const byId = new Map((downloads || []).map(item => [item.id, item]));
      const chip = (text, tone = 'neutral') => {
        const style = tone === 'green'
          ? 'color:#34D399;background:rgba(52,211,153,.14);border-color:rgba(52,211,153,.18);'
          : tone === 'yellow'
            ? 'color:#FBBF24;background:rgba(251,191,36,.15);border-color:rgba(251,191,36,.18);'
            : tone === 'purple'
              ? 'color:#A78BFA;background:rgba(139,92,246,.18);border-color:rgba(139,92,246,.18);'
              : 'color:#A0A0B2;background:rgba(255,255,255,.07);border-color:rgba(255,255,255,.1);';
        return `<span style="font-size:12px;font-weight:800;border:1px solid;border-radius:999px;padding:6px 13px;${style}">${escapeHtml(text)}</span>`;
      };
      const card = ({ title, icon, badge, badgeTone, text, chips = '', button = '', muted = false, extra = '' }) => `
        <article style="background:#14141F;border:1px solid rgba(255,255,255,.08);border-radius:18px;padding:24px;min-height:238px;display:flex;flex-direction:column;box-shadow:0 14px 34px rgba(0,0,0,.16);${muted ? 'opacity:.58;' : ''}">
          <div style="display:flex;align-items:center;justify-content:space-between;gap:14px;margin-bottom:20px;">
            <div style="display:flex;align-items:center;gap:13px;min-width:0;">${icon}<h4 style="font-size:20px;font-weight:850;letter-spacing:-.35px;margin:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${escapeHtml(title)}</h4></div>
            ${badge ? chip(badge, badgeTone) : ''}
          </div>
          <p style="font-size:15px;line-height:1.55;color:#A0A0B2;margin:0 0 18px;flex:1;">${text}</p>
          ${chips ? `<div style="display:flex;gap:8px;margin-bottom:18px;flex-wrap:wrap;">${chips}</div>` : ''}
          ${extra}
          ${button}
        </article>`;
      const downloadButton = (item, label = 'Stáhnout') => item?.available
        ? `<button type="button" data-download-id="${escapeHtml(item.id)}" style="display:flex;align-items:center;justify-content:center;gap:10px;width:100%;padding:14px;border-radius:12px;border:none;background:linear-gradient(135deg,#7C3AED 0%,#A21CAF 50%,#BE185D 100%);color:#fff;font-size:15px;font-weight:850;box-shadow:0 10px 28px rgba(139,92,246,.3);cursor:pointer;">${icons.download}${escapeHtml(label)}</button>`
        : `<button type="button" disabled style="display:flex;align-items:center;justify-content:center;width:100%;padding:14px;border-radius:12px;border:1px solid rgba(255,255,255,.12);background:rgba(255,255,255,.06);color:#A0A0B2;font-size:15px;font-weight:800;cursor:not-allowed;">Připravujeme</button>`;
      const fileExtension = item => {
        const match = String(item?.fileName || '').match(/\.([a-z0-9]+)$/i);
        return match ? match[1].toLowerCase() : '';
      };
      const macInstallCopy = item => {
        const ext = fileExtension(item);
        if (ext === 'dmg') return 'Instalačka je připnutá k tvému účtu. Stáhni .dmg, otevři a přetáhni Movly do složky Aplikace.';
        if (ext === 'zip') return 'Instalačka je připnutá k tvému účtu. Stáhni .zip, rozbal aplikaci a přetáhni Movly do složky Aplikace.';
        return 'Instalačka je připnutá k tvému účtu. Stáhni aktuální macOS build a dokonči instalaci podle staženého balíčku.';
      };
      const downloadLabel = (item, base = 'Stáhnout') => {
        const ext = fileExtension(item);
        return ext ? `${base} .${ext}` : base;
      };
      const windowsCard = id => {
        const item = byId.get(id) || {};
        return card({
          title: item.title || id,
          icon: icons.windows,
          badge: 'Windows',
          badgeTone: 'purple',
          text: escapeHtml(item.subtitle || 'Windows instalačka'),
          chips: [item.type || 'EXE installer', item.sizeLabel || 'soubor chybí'].map(value => chip(value)).join(''),
          button: downloadButton(item),
        });
      };
      const mac = byId.get('macos-universal') || {};
      gridEl.innerHTML = [
        windowsCard('windows-x64'),
        windowsCard('windows-arm64'),
        windowsCard('windows-x86'),
        card({
          title: 'macOS',
          icon: icons.apple,
          badge: mac.available ? 'Připraveno' : 'Připravujeme',
          badgeTone: mac.available ? 'green' : 'neutral',
          text: macInstallCopy(mac),
          chips: mac.available ? [mac.type, mac.sizeLabel].filter(Boolean).map(value => chip(value)).join('') : '',
          button: downloadButton(mac, downloadLabel(mac)),
        }),
        card({
          title: 'Android',
          icon: icons.android,
          badge: 'Uzavřená beta',
          badgeTone: 'yellow',
          text: '',
          extra: `<ol style="margin:0 0 18px;padding-left:20px;color:#A0A0B2;font-size:15px;line-height:1.55;">
            <li style="padding-left:7px;margin-bottom:9px;">Pošli nám e-mail, pod kterým jsi přihlášený v <strong style="color:#D4D4DE;">Google Play</strong> — přidáme tě do uzavřené bety.</li>
            <li style="padding-left:7px;margin-bottom:9px;">Po přidání vyhledej v Google Play balíček:<br><code style="display:inline-block;margin-top:8px;color:#A78BFA;background:#0A0A12;border:1px solid rgba(255,255,255,.1);border-radius:8px;padding:5px 10px;font-size:13px;">cz.movly</code></li>
            <li style="padding-left:7px;">Nainstaluj a přihlas se svým účtem.</li>
          </ol>`,
          button: `<a href="mailto:cinelog@outlook.cz" style="display:flex;align-items:center;justify-content:center;gap:10px;width:100%;padding:14px;border-radius:12px;border:1px solid rgba(255,255,255,.14);background:rgba(255,255,255,.07);color:#fff;font-size:15px;font-weight:850;text-decoration:none;">${icons.mail}Požádat o přístup</a>`,
        }),
        card({
          title: 'iOS',
          icon: icons.apple,
          badge: 'Připravujeme',
          badgeTone: 'neutral',
          text: 'Verze pro iPhone a iPad je v přípravě. Brzy dorazí přes TestFlight a App Store.',
          muted: true,
        }),
        card({
          title: 'tvOS',
          icon: icons.tv,
          badge: 'Připravujeme',
          badgeTone: 'neutral',
          text: 'Aplikace pro Apple TV je v přípravě. Brzy ji najdeš na Apple TV s ovládáním zaměřeným na dálkový ovladač.',
          muted: true,
        }),
      ].join('');
    };
    const loadDownloads = async () => {
      setStatus('Načítám dostupné instalačky...');
      const data = await api('/api/downloads');
      renderDownloads(data.downloads || []);
      setStatus('Vyber instalačku pro svoje zařízení.', 'ok');
    };
    const applySession = async session => {
      const account = session.account || {};
      if (nameEl) nameEl.textContent = account.displayName || account.username || 'Přihlášeno';
      if (emailEl) emailEl.textContent = account.email || 'Instalačky najdeš níže.';
      showSession(true);
      if (!session.hasDownloadAccess) {
        if (gridEl) gridEl.innerHTML = '';
        setStatus('Instalačky pro tento účet teď nejsou dostupné.', 'error');
        return;
      }
      await loadDownloads();
    };
    const clearSession = ({ preserveError = false } = {}) => {
      localStorage.removeItem(tokenKey);
      showSession(false);
      if (passEl) passEl.value = '';
      if (errEl && !preserveError) errEl.style.display = 'none';
    };
    const tryLogin = async () => {
      if (!userEl || !passEl || !loginBtn) return;
      loginBtn.disabled = true;
      loginBtn.textContent = 'Přihlašuji...';
      if (errEl) errEl.style.display = 'none';
      try {
        const session = await api('/api/auth/login', { method: 'POST', body: JSON.stringify({ username: userEl.value, password: passEl.value }) });
        localStorage.setItem(tokenKey, session.token);
        passEl.value = '';
        await applySession(session);
      } catch (error) {
        clearSession({ preserveError: true });
        if (errEl) { errEl.textContent = error.message; errEl.style.display = 'block'; }
      } finally {
        loginBtn.disabled = false;
        loginBtn.textContent = 'Přihlásit se';
      }
    };
    document.getElementById('mvLoginForm')?.addEventListener('submit', e => { e.preventDefault(); tryLogin(); });
    if (logoutBtn) logoutBtn.addEventListener('click', async () => {
      try {
        await api('/api/auth/logout', { method: 'POST' });
        clearSession();
      } catch (error) {
        setStatus(`Odhlášení se nepodařilo: ${error.message}`, 'error');
      }
    });
    if (gridEl) gridEl.addEventListener('click', async event => {
      const button = event.target.closest('[data-download-id]');
      if (!button || button.disabled) return;
      const original = button.innerHTML;
      button.disabled = true;
      button.textContent = 'Připravuji odkaz...';
      try {
        const data = await api(`/api/downloads/${encodeURIComponent(button.dataset.downloadId)}/link`, { method: 'POST' });
        if (data.windowsReleaseMode === 'legacy-v1-manual-only') {
          setStatus('Stahování začíná. Jde o starší ruční Windows build; automatické aktualizace jsou pro něj z bezpečnostních důvodů vypnuté.');
        } else {
          setStatus('Stahování začíná...', 'ok');
        }
        window.location.href = data.url;
      } catch (error) {
        setStatus(error.message, 'error');
      } finally {
        button.disabled = false;
        button.innerHTML = original;
      }
    });
    (async () => {
      if (!localStorage.getItem(tokenKey)) return;
      try {
        const session = await api('/api/auth/me');
        await applySession(session);
      } catch (error) {
        clearSession();
        if (errEl) {
          errEl.textContent = `Uložené přihlášení se nepodařilo ověřit: ${error.message}`;
          errEl.style.display = 'block';
        }
      }
    })();
}).call({});
