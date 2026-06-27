/* =====================================================================
   Cloudflare Single Email Viewer — frontend app logic
   Vanilla JS (no framework). Handles config, the input -> panel
   transition, fetching the latest email, refresh, and safe rendering.
   ===================================================================== */
(function () {
  'use strict';

  var $ = function (id) {
    return document.getElementById(id);
  };

  var els = {
    stage: $('stage'),
    hero: $('hero'),
    inbox: $('inbox'),
    form: $('email-form'),
    input: $('email-input'),
    submitBtn: $('submit-btn'),
    formError: $('form-error'),
    title: $('site-title'),
    avatar: $('email-avatar'),
    from: $('email-from'),
    address: $('email-address'),
    time: $('email-time'),
    subject: $('email-subject'),
    body: $('email-body'),
    empty: $('email-empty'),
    card: $('email-card'),
    backBtn: $('back-btn'),
    refreshBtn: $('refresh-btn'),
    checkedFor: $('checked-for'),
    toast: $('toast'),
    credit: $('credit'),
  };

  var state = {
    email: '',
    refreshIndex: 0,
    busy: false,
  };

  var toastTimer = null;

  /* ---------------- helpers ---------------- */

  function hexToRgb(hex) {
    var m = /^#?([0-9a-f]{6})$/i.exec(String(hex || '').trim());
    if (!m) return { r: 139, g: 92, b: 246 };
    var n = parseInt(m[1], 16);
    return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
  }

  function rgba(c, a) {
    return 'rgba(' + c.r + ',' + c.g + ',' + c.b + ',' + a + ')';
  }

  function applyTheme(hex) {
    var c = hexToRgb(hex);
    var root = document.documentElement.style;
    root.setProperty('--accent', hex);
    root.setProperty('--accent-soft', rgba(c, 0.18));
    root.setProperty('--accent-glow', rgba(c, 0.55));
    if (window.__bg && typeof window.__bg.setAccent === 'function') {
      window.__bg.setAccent(c.r / 255, c.g / 255, c.b / 255);
    }
  }

  function escapeHtml(str) {
    return String(str == null ? '' : str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function showToast(message) {
    els.toast.textContent = message;
    els.toast.hidden = false;
    // force reflow so the transition runs
    void els.toast.offsetWidth;
    els.toast.classList.add('show');
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(function () {
      els.toast.classList.remove('show');
      setTimeout(function () {
        els.toast.hidden = true;
      }, 320);
    }, 2600);
  }

  function setFormError(msg) {
    if (!msg) {
      els.formError.hidden = true;
      els.formError.textContent = '';
      return;
    }
    els.formError.textContent = msg;
    els.formError.hidden = false;
  }

  function formatDate(iso) {
    var d = new Date(iso);
    if (isNaN(d.getTime())) return '';
    try {
      return d.toLocaleString(undefined, {
        day: '2-digit',
        month: 'short',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      });
    } catch (e) {
      return d.toISOString();
    }
  }

  function bg() {
    return window.__bg || null;
  }

  /* ---------------- rendering ---------------- */

  function clearBody() {
    while (els.body.firstChild) els.body.removeChild(els.body.firstChild);
  }

  function renderEmail(email) {
    if (!email) {
      // empty / no messages state
      els.empty.hidden = false;
      els.subject.textContent = '';
      els.from.textContent = 'Inbox kosong';
      els.address.textContent = state.email;
      els.avatar.textContent = '·';
      els.time.textContent = '';
      els.time.setAttribute('datetime', '');
      clearBody();
      return;
    }

    els.empty.hidden = true;

    var fromName = (email.fromName || email.from || '?').trim();
    var letter = (fromName || '?').charAt(0).toUpperCase();
    els.avatar.textContent = /[a-z0-9]/i.test(letter) ? letter : '✉';
    els.from.textContent = fromName || email.from || 'Tidak diketahui';
    els.address.textContent = email.from || '';
    els.subject.textContent = email.subject || '(tanpa subjek)';

    var dt = formatDate(email.date);
    els.time.textContent = dt;
    els.time.setAttribute('datetime', email.date || '');

    clearBody();
    if (email.html && String(email.html).trim()) {
      // Render untrusted HTML inside a fully sandboxed iframe (no scripts,
      // no same-origin) so it can never run JS or read cookies.
      var iframe = document.createElement('iframe');
      iframe.setAttribute('sandbox', '');
      iframe.setAttribute('referrerpolicy', 'no-referrer');
      iframe.setAttribute('title', 'Isi email');
      iframe.srcdoc =
        '<!DOCTYPE html><html><head><meta charset="utf-8">' +
        '<meta name="referrer" content="no-referrer">' +
        '<base target="_blank">' +
        '<style>html,body{margin:0;padding:14px;' +
        'font-family:system-ui,Segoe UI,Roboto,sans-serif;' +
        'color:#1f2937;background:#fff;word-break:break-word;}' +
        'img{max-width:100%;height:auto}a{color:#6d28d9}</style></head>' +
        '<body>' + email.html + '</body></html>';
      els.body.appendChild(iframe);
      // Auto-size the iframe to its content height when possible.
      iframe.addEventListener('load', function () {
        try {
          var doc = iframe.contentDocument;
          if (doc && doc.body) {
            iframe.style.height = doc.body.scrollHeight + 28 + 'px';
          }
        } catch (e) {
          /* cross-origin guard — keep default height */
        }
      });
    } else {
      var pre = document.createElement('pre');
      pre.className = 'text';
      pre.textContent = email.text || '(email tidak memiliki isi teks)';
      els.body.appendChild(pre);
    }
  }

  /* ---------------- networking ---------------- */

  function fetchInbox(email, refreshIndex) {
    var url =
      '/api/inbox?email=' +
      encodeURIComponent(email) +
      (typeof refreshIndex === 'number' ? '&i=' + refreshIndex : '');
    return fetch(url, {
      headers: { Accept: 'application/json' },
      cache: 'no-store',
    }).then(function (res) {
      return res
        .json()
        .catch(function () {
          throw new Error('Respon server tidak valid.');
        })
        .then(function (data) {
          if (!res.ok || data.ok === false) {
            throw new Error(
              (data && data.error) || 'Gagal mengambil email (HTTP ' + res.status + ').'
            );
          }
          return data;
        });
    });
  }

  /* ---------------- phase transitions ---------------- */

  function goToInbox() {
    els.hero.classList.add('fade-scale-out');
    var b = bg();
    if (b && typeof b.zoomIn === 'function') b.zoomIn();

    setTimeout(function () {
      els.hero.hidden = true;
      els.hero.classList.remove('fade-scale-out');
      els.inbox.hidden = false;
      els.inbox.classList.remove('fade-scale-in');
      void els.inbox.offsetWidth;
      els.inbox.classList.add('fade-scale-in');
    }, 520);
  }

  function goToHero() {
    els.inbox.hidden = true;
    els.hero.hidden = false;
    els.hero.classList.remove('fade-scale-out');
    void els.hero.offsetWidth;
    els.hero.classList.add('fade-scale-in');
    setFormError('');
    var b = bg();
    if (b && typeof b.reset === 'function') b.reset();
    setTimeout(function () {
      els.hero.classList.remove('fade-scale-in');
      els.input.focus();
    }, 600);
  }

  /* ---------------- actions ---------------- */

  function onSubmit(e) {
    e.preventDefault();
    if (state.busy) return;
    setFormError('');

    var email = (els.input.value || '').trim().toLowerCase();
    if (!email) {
      setFormError('Masukkan alamat email terlebih dahulu.');
      return;
    }
    // Light client-side check; server validates authoritatively.
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
      setFormError('Format email tidak valid. Contoh: admin@domainanda.com');
      return;
    }

    state.busy = true;
    state.email = email;
    state.refreshIndex = 0;
    els.submitBtn.disabled = true;
    els.form.classList.add('is-loading');

    fetchInbox(email)
      .then(function (data) {
        renderEmail(data.email);
        els.checkedFor.textContent = 'Menampilkan inbox untuk ' + email;
        goToInbox();
        if (!data.email) showToast('No new messages');
        else if (data.demo) showToast('Mode demo — menampilkan email contoh');
      })
      .catch(function (err) {
        setFormError(err.message || 'Terjadi kesalahan.');
      })
      .then(function () {
        state.busy = false;
        els.submitBtn.disabled = false;
        els.form.classList.remove('is-loading');
      });
  }

  function onRefresh() {
    if (state.busy || !state.email) return;
    state.busy = true;
    state.refreshIndex += 1;
    els.refreshBtn.disabled = true;
    els.refreshBtn.classList.add('is-refreshing');

    fetchInbox(state.email, state.refreshIndex)
      .then(function (data) {
        els.card.classList.remove('crossfade');
        void els.card.offsetWidth;
        els.card.classList.add('crossfade');
        renderEmail(data.email);
        if (!data.email) showToast('No new messages');
        else showToast('Inbox diperbarui');
      })
      .catch(function (err) {
        showToast(err.message || 'Gagal memperbarui.');
      })
      .then(function () {
        state.busy = false;
        els.refreshBtn.disabled = false;
        els.refreshBtn.classList.remove('is-refreshing');
      });
  }

  /* ---------------- init ---------------- */

  function loadConfig() {
    return fetch('/api/config', { cache: 'no-store' })
      .then(function (r) {
        return r.json();
      })
      .then(function (cfg) {
        if (cfg.siteName) {
          els.title.textContent = cfg.siteName;
          document.title = cfg.siteName;
        }
        if (cfg.themeColor) applyTheme(cfg.themeColor);
        els.credit.textContent = (cfg.siteName || 'Inbox Viewer') +
          (cfg.demo ? ' · demo' : '');
      })
      .catch(function () {
        /* keep defaults */
      });
  }

  function init() {
    els.form.addEventListener('submit', onSubmit);
    els.refreshBtn.addEventListener('click', onRefresh);
    els.backBtn.addEventListener('click', goToHero);
    loadConfig();
    setTimeout(function () {
      els.input.focus();
    }, 400);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
