/**
 * Genwizard ITSM - Bootstrap & Pre-Initialization
 * Externalized to comply strictly with Content-Security-Policy (CSP) headers without requiring inline script hashes.
 */

// 1. Dynamic base href setup (supports root / and subpath /itsm/ seamlessly)
(function() {
  var p = window.location.pathname;
  if (p === '/itsm') {
    window.location.replace('/itsm/' + window.location.search + window.location.hash);
    return;
  }
  var b = document.createElement('base');
  b.href = p.startsWith('/itsm') ? '/itsm/' : '/';
  document.head.appendChild(b);
})();

// 2. Early SSO User Detection & Immediate Header Population (prevents wrong user flash)
(function initEarlyUserInfo() {
  try {
    var u = null;

    // Check query parameters: ?username=... or ?user=... or hash
    if (typeof window !== 'undefined' && window.location) {
      var sp = new URLSearchParams(window.location.search);
      var hash = window.location.hash || '';
      var hp = new URLSearchParams(hash.startsWith('#') ? hash.substring(1) : hash);
      var qUser = sp.get('username') || sp.get('user') || sp.get('sso_user') || sp.get('sso_username') || sp.get('im_user') || sp.get('login')
        || hp.get('username') || hp.get('user');
      if (qUser) u = { username: qUser };
    }

    // Check cookies: im_user, sso_username, sso_user, username, user, userName, user_name, login, account
    if (!u && typeof document !== 'undefined' && document.cookie) {
      var cm = document.cookie.match(/(?:^|;\s*)(?:im_user|sso_username|sso_user|username|user|userName|user_name|login|account)=([^;]+)/i);
      if (cm && cm[1]) {
        var cUser = decodeURIComponent(cm[1].trim());
        if (cUser) {
          try { u = JSON.parse(cUser); } catch (_) { u = { username: cUser }; }
        }
      }
    }

    // Check token claims if present
    if (!u && typeof localStorage !== 'undefined') {
      var tok = localStorage.getItem('auth_token') || localStorage.getItem('access_token') || localStorage.getItem('apiToken');
      if (tok && tok.indexOf('.') !== -1) {
        try {
          var payload = JSON.parse(atob(tok.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
          if (payload) {
            u = {
              username: payload.preferred_username || payload.username || payload.userName || payload.sub || payload.login,
              full_name: payload.name || payload.full_name || payload.displayName,
              email: payload.email
            };
          }
        } catch (_) {}
      }
    }

    // Check storage keys
    if (!u) {
      var ssoUname = localStorage.getItem('sso_username') || localStorage.getItem('username');
      if (ssoUname) u = { username: ssoUname };
    }

    if (!u) {
      var hasExt = (typeof localStorage !== 'undefined' && (!!localStorage.getItem('auth_token') || !!localStorage.getItem('apiToken')));
      var raw = localStorage.getItem('sso_user') || localStorage.getItem('user') || localStorage.getItem('currentUser') || localStorage.getItem('userInfo') || (!hasExt ? localStorage.getItem('current_user') : null);
      if (raw) {
        try { u = JSON.parse(raw); } catch (_) {
          if (typeof raw === 'string' && raw.length < 60) u = { username: raw };
        }
      }
    }

    if (u && (u.username || u.name || u.full_name)) {
      var uname = (u.username || '').toLowerCase().trim();
      var fname = (u.full_name || u.name || '').trim();
      var cleanUname = uname.split('@')[0];
      var ssoActive = !!(localStorage.getItem('sso_username') || localStorage.getItem('sso_user') || localStorage.getItem('auth_token') || localStorage.getItem('apiToken')) || (cleanUname !== 'admin' && cleanUname !== 'administrator');
      var isLocalAdmin = (cleanUname === 'admin' || cleanUname === 'administrator') && (u.is_local === true || u.id === 1) && !ssoActive;
      var displayName = isLocalAdmin
        ? 'admin'
        : (fname && fname !== 'SSO Enterprise User' && fname !== 'Admin User' && fname !== 'Administrator' && fname.toLowerCase() !== 'admin'
            ? fname
            : (cleanUname && cleanUname !== 'admin' ? (cleanUname.includes('.') ? cleanUname.replace(/\./g, ' ').replace(/\b\w/g, function(l) { return l.toUpperCase(); }) : cleanUname) : (fname || 'User')));

      var rawEmail = (u.email || (uname.includes('@') ? uname : '')).trim();
      if (rawEmail) {
        if (rawEmail.includes('@accenture.com@')) {
          rawEmail = rawEmail.replace(/@accenture\.com@.*$/i, '@accenture.com');
        } else if (rawEmail.toLowerCase().endsWith('@enterprise.corp') && rawEmail.includes('@accenture.com')) {
          rawEmail = rawEmail.replace(/@enterprise\.corp$/i, '');
        } else if (rawEmail.toLowerCase().endsWith('@enterprise.corp')) {
          rawEmail = rawEmail.replace(/@enterprise\.corp$/i, '@accenture.com');
        }
        try { localStorage.setItem('sso_email', rawEmail); } catch (_) {}
      }

      try {
        var curRaw = localStorage.getItem('current_user');
        if (curRaw && curRaw.indexOf('@enterprise.corp') !== -1) {
          var curParsed = JSON.parse(curRaw);
          if (curParsed && curParsed.email) {
            curParsed.email = curParsed.email.replace(/@accenture\.com@.*$/i, '@accenture.com').replace(/@enterprise\.corp$/i, curParsed.email.indexOf('@accenture.com') !== -1 ? '' : '@accenture.com');
            localStorage.setItem('current_user', JSON.stringify(curParsed));
          }
        }
      } catch (_) {}

      if (!isLocalAdmin && cleanUname && cleanUname !== 'admin') {
        try {
          localStorage.setItem('sso_username', u.username);
          sessionStorage.setItem('sso_username', u.username);
          if (displayName && displayName !== 'User') {
            localStorage.setItem('sso_fullname', displayName);
          }
          localStorage.removeItem('nexus_user_id');
          localStorage.removeItem('current_user');
          if (typeof window !== 'undefined') {
            window.__SSO_USER_EARLY = {
              username: u.username,
              full_name: displayName,
              role: u.role || 'itsm_read',
              email: rawEmail || (cleanUname ? cleanUname + '@accenture.com' : ''),
              is_local: false
            };
          }
        } catch (_) {}
      }

      var initials = (displayName === 'admin')
        ? 'AD'
        : (displayName.split(' ').filter(Boolean).map(function(s) { return s[0]; }).join('').toUpperCase().slice(0, 2) || 'U');

      function applyUserEarly() {
        var nameEl = document.getElementById('userName');
        var avatarEl = document.getElementById('userAvatar');
        if (nameEl && displayName) nameEl.textContent = displayName;
        if (avatarEl && initials) avatarEl.textContent = initials;
      }

      if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', applyUserEarly);
      } else {
        applyUserEarly();
      }
    }
  } catch (_) {}
})();

// 3. Form Field Auto-Labeler (eliminates "A form field does not have a label associated with it" warnings)
function ensureFormFieldLabels(root) {
  if (!root) return;
  try {
    var fields = [];
    if (root.matches && root.matches('input, select, textarea')) {
      fields.push(root);
    }
    if (root.querySelectorAll) {
      var found = root.querySelectorAll('input, select, textarea');
      for (var k = 0; k < found.length; k++) {
        fields.push(found[k]);
      }
    }
    for (var i = 0; i < fields.length; i++) {
      var el = fields[i];
      if (el.type === 'hidden' || el.type === 'button' || el.type === 'submit' || el.type === 'reset') continue;

      if (!el.id) {
        var baseName = el.getAttribute('name') || 'field';
        el.id = baseName + '_' + Math.random().toString(36).substr(2, 9);
      }
      var fieldId = el.id;

      // 1. Look for existing explicit label
      var associatedLabel = document.querySelector('label[for="' + fieldId + '"]');
      if (!associatedLabel && el.closest('label')) {
        associatedLabel = el.closest('label');
      }

      // 2. If no explicit label, look for preceding sibling or parent container label
      if (!associatedLabel) {
        var prev = el.previousElementSibling;
        while (prev) {
          if (prev.tagName === 'LABEL') {
            associatedLabel = prev;
            break;
          }
          if (prev.querySelector) {
            var subLabel = prev.querySelector('label');
            if (subLabel) { associatedLabel = subLabel; break; }
          }
          prev = prev.previousElementSibling;
        }
      }

      if (!associatedLabel && el.parentElement) {
        var parentPrev = el.parentElement.previousElementSibling;
        if (parentPrev && parentPrev.tagName === 'LABEL') {
          associatedLabel = parentPrev;
        } else if (el.parentElement.querySelector) {
          var siblingLabel = el.parentElement.querySelector('label');
          if (siblingLabel && !siblingLabel.hasAttribute('for')) {
            associatedLabel = siblingLabel;
          }
        }
      }

      var labelText = '';
      if (associatedLabel) {
        if (!associatedLabel.getAttribute('for')) {
          associatedLabel.setAttribute('for', fieldId);
        }
        labelText = associatedLabel.textContent ? associatedLabel.textContent.replace(/[*:\s]+/g, ' ').trim() : '';
      }

      if (!labelText) {
        labelText = el.getAttribute('placeholder') || el.getAttribute('title') || el.getAttribute('name') || el.id || 'Input field';
        labelText = labelText.replace(/[*:\s]+/g, ' ').trim();
      }

      if (!el.hasAttribute('aria-label') && !el.hasAttribute('aria-labelledby')) {
        el.setAttribute('aria-label', labelText);
      }

      // 3. Guarantee an associated <label for="..."> exists for every field in DOM
      if (!document.querySelector('label[for="' + fieldId + '"]') && !el.closest('label')) {
        var srLabel = document.createElement('label');
        srLabel.setAttribute('for', fieldId);
        srLabel.className = 'sr-only';
        srLabel.textContent = labelText;
        if (el.parentNode) {
          el.parentNode.insertBefore(srLabel, el);
        }
      }
    }

    // 4. Scan all <label> elements to ensure none are unassociated with a field
    var allLabels = root.querySelectorAll ? root.querySelectorAll('label') : [];
    for (var j = 0; j < allLabels.length; j++) {
      var lbl = allLabels[j];
      var targetFor = lbl.getAttribute('for');
      if (targetFor && document.getElementById(targetFor)) continue;

      // If wrapping an input/select/textarea
      var innerField = lbl.querySelector('input, select, textarea');
      if (innerField) {
        if (!innerField.id) innerField.id = (innerField.getAttribute('name') || 'fld') + '_' + Math.random().toString(36).substr(2, 9);
        lbl.setAttribute('for', innerField.id);
        continue;
      }

      // Check siblings or container
      var siblingField = null;
      var siblingEl = lbl.nextElementSibling;
      while (siblingEl && !siblingField) {
        if (siblingEl.matches && siblingEl.matches('input, select, textarea')) {
          siblingField = siblingEl;
        } else if (siblingEl.querySelector) {
          siblingField = siblingEl.querySelector('input, select, textarea');
        }
        siblingEl = siblingEl.nextElementSibling;
      }
      if (!siblingField && lbl.parentElement) {
        siblingField = lbl.parentElement.querySelector('input, select, textarea');
      }
      if (siblingField) {
        if (!siblingField.id) siblingField.id = (siblingField.getAttribute('name') || 'fld') + '_' + Math.random().toString(36).substr(2, 9);
        lbl.setAttribute('for', siblingField.id);
        if (!siblingField.hasAttribute('aria-label') && lbl.textContent) {
          siblingField.setAttribute('aria-label', lbl.textContent.replace(/[*:\s]+/g, ' ').trim());
        }
      }
    }
  } catch (_) {}
}

document.addEventListener('DOMContentLoaded', function() {
  ensureFormFieldLabels(document);
  try {
    var observer = new MutationObserver(function(mutations) {
      for (var i = 0; i < mutations.length; i++) {
        var m = mutations[i];
        if (m.addedNodes && m.addedNodes.length > 0) {
          for (var j = 0; j < m.addedNodes.length; j++) {
            var node = m.addedNodes[j];
            if (node.nodeType === 1) {
              ensureFormFieldLabels(node);
            }
          }
        }
      }
    });
    observer.observe(document.body, { childList: true, subtree: true });
  } catch (_) {}
});

// 4. Content Security Policy (CSP) innerHTML Sanitizer:
// Converts any dynamic onclick/onsubmit/onchange into data-click/data-submit/data-change
// so browsers never block inline scripts or throw CSP inline execution violations.
(function installCspHtmlSanitizer() {
  function sanitizeHtmlForCSP(html) {
    if (typeof html !== 'string' || html.indexOf('on') === -1) return html;
    return html
      .replace(/\sonclick\s*=\s*(["'])([\s\S]*?)\1/gi, ' data-click=$1$2$1')
      .replace(/\sonsubmit\s*=\s*(["'])([\s\S]*?)\1/gi, ' data-submit=$1$2$1')
      .replace(/\sonchange\s*=\s*(["'])([\s\S]*?)\1/gi, ' data-change=$1$2$1')
      .replace(/\sonkeyup\s*=\s*(["'])([\s\S]*?)\1/gi, ' data-keyup=$1$2$1');
  }

  try {
    var desc = Object.getOwnPropertyDescriptor(Element.prototype, 'innerHTML');
    if (desc && desc.set) {
      Object.defineProperty(Element.prototype, 'innerHTML', {
        set: function(val) {
          return desc.set.call(this, typeof val === 'string' ? sanitizeHtmlForCSP(val) : val);
        },
        get: function() {
          return desc.get.call(this);
        },
        configurable: true,
        enumerable: true
      });
    }
  } catch (_) {}
})();

// 5. Universal Delegated Event Dispatcher (guarantees all clicks & form submissions execute even under strict CSP)
(function installDelegatedEventDispatcher() {
  function parseArgs(rawArgs, evt) {
    if (!rawArgs) return [];
    if (rawArgs === 'event') return [evt];
    try {
      var jsonStr = '[' + rawArgs.replace(/\bevent\b/g, 'null') + ']';
      return JSON.parse(jsonStr);
    } catch (_) {
      var args = [];
      var regex = /(?:'([^']*)'|"([^"]*)"|(\d+(?:\.\d+)?)|(true|false|null|undefined)|([^,]+))/g;
      var m;
      while ((m = regex.exec(rawArgs)) !== null) {
        if (m[1] !== undefined) args.push(m[1]);
        else if (m[2] !== undefined) args.push(m[2]);
        else if (m[3] !== undefined) args.push(Number(m[3]));
        else if (m[4] === 'true') args.push(true);
        else if (m[4] === 'false') args.push(false);
        else if (m[4] === 'null') args.push(null);
        else if (m[4] === 'undefined') args.push(undefined);
        else if (m[5] !== undefined) {
          var val = m[5].trim();
          if (val === 'event') args.push(evt);
          else args.push(val);
        }
      }
      return args;
    }
  }

  function dispatchAction(actionStr, targetEl, evt) {
    if (!actionStr || typeof actionStr !== 'string') return;
    actionStr = actionStr.trim();
    if (!actionStr) return;

    // Handle chained statements separated by semicolons
    if (actionStr.indexOf(';') !== -1) {
      var statements = actionStr.split(';').map(function(s) { return s.trim(); }).filter(Boolean);
      if (statements.length > 1) {
        for (var i = 0; i < statements.length; i++) {
          dispatchAction(statements[i], targetEl, evt);
        }
        return;
      } else if (statements.length === 1) {
        actionStr = statements[0];
      }
    }
    actionStr = actionStr.replace(/;\s*$/, '');

    // Special quick prompts
    if (actionStr === 'sendQuickPrompt' && targetEl.getAttribute('data-prompt')) {
      if (typeof window.sendQuickPrompt === 'function') {
        window.sendQuickPrompt(targetEl.getAttribute('data-prompt'));
        return;
      }
    }

    // Function call: fn(args...)
    var fnMatch = actionStr.match(/^([a-zA-Z0-9_$]+)\(([\s\S]*)\)$/);
    if (fnMatch) {
      var fnName = fnMatch[1];
      var rawArgs = fnMatch[2].trim();
      var fn = window[fnName];
      if (typeof fn === 'function') {
        if (!rawArgs) {
          fn.call(targetEl);
          return;
        }
        var args = parseArgs(rawArgs, evt);
        fn.apply(targetEl, args);
        return;
      }
    }

    // Plain function name without parens
    if (typeof window[actionStr] === 'function') {
      window[actionStr].call(targetEl);
      return;
    }

    // GenWizard Copilot Drawer actions
    if (actionStr === 'openFloatingAiDrawer' || actionStr === 'toggleFloatingAiDrawer') {
      var d = document.getElementById('aiDrawer');
      if (d) {
        d.classList.remove('hidden');
        var inp = document.getElementById('drawerInput');
        if (inp) setTimeout(function() { inp.focus(); }, 60);
      }
      return;
    }
    if (actionStr === 'closeFloatingAiDrawer') {
      var d = document.getElementById('aiDrawer');
      if (d) d.classList.add('hidden');
      return;
    }
    if (actionStr === 'startNewDrawerChat') {
      var box = document.getElementById('drawerMessages');
      if (box) {
        box.innerHTML = '<div class="p-2.5 rounded-lg bg-[var(--bg-tertiary)] text-[var(--text-secondary)]">Started new Copilot session. Ask me anything.</div>';
      }
      return;
    }

    // Common DOM actions
    if (actionStr.indexOf('modalContainer') !== -1 && actionStr.indexOf("=''") !== -1) {
      var mc = document.getElementById('modalContainer');
      if (mc) mc.innerHTML = '';
      return;
    }
    if (actionStr.indexOf('searchDropdown') !== -1 && actionStr.indexOf('hidden') !== -1) {
      var sd = document.getElementById('searchDropdown');
      if (sd) sd.classList.add('hidden');
      return;
    }
    if (actionStr.indexOf('nodeDetailBox') !== -1 && actionStr.indexOf('hidden') !== -1) {
      var nb = document.getElementById('nodeDetailBox');
      if (nb) nb.classList.add('hidden');
      return;
    }
    if (actionStr.indexOf('csvFileInput') !== -1 && actionStr.indexOf('click()') !== -1) {
      var cf = document.getElementById('csvFileInput');
      if (cf) cf.click();
      return;
    }
    if (actionStr.indexOf('window.location.hash=') === 0) {
      var hashVal = actionStr.split('=')[1].replace(/['"]/g, '').trim();
      window.location.hash = hashVal;
      return;
    }
  }

  // Delegated Click Listener
  document.addEventListener('click', function(e) {
    var el = e.target.closest('[data-action], [data-click], [onclick]');
    if (!el) return;
    if (el._actionHandled) return;
    el._actionHandled = true;
    setTimeout(function() { el._actionHandled = false; }, 80);
    var action = el.getAttribute('data-action') || el.getAttribute('data-click') || el.getAttribute('onclick');
    if (action) {
      dispatchAction(action, el, e);
    }
  }, false);

  // Delegated Submit Listener
  document.addEventListener('submit', function(e) {
    var form = e.target.closest('form');
    if (!form) return;
    if (form.id === 'drawerForm') {
      e.preventDefault();
      if (typeof window.submitDrawerQuestion === 'function') {
        window.submitDrawerQuestion(e);
      }
      return;
    }
    var action = form.getAttribute('data-submit') || form.getAttribute('onsubmit');
    if (action) {
      e.preventDefault();
      dispatchAction(action, form, e);
    }
  }, false);

  // Delegated Change Listener
  document.addEventListener('change', function(e) {
    var el = e.target.closest('[data-change], [onchange]');
    if (!el) return;
    var action = el.getAttribute('data-change') || el.getAttribute('onchange');
    if (action) {
      dispatchAction(action, el, e);
    }
  }, false);

  // Delegated Keyup Listener
  document.addEventListener('keyup', function(e) {
    var el = e.target.closest('[data-keyup], [onkeyup]');
    if (!el) return;
    var action = el.getAttribute('data-keyup') || el.getAttribute('onkeyup');
    if (action) {
      dispatchAction(action, el, e);
    }
  }, false);
})();

// 6. Safe Lucide icon renderer
function safeRenderIcons() {
  try {
    if (window.lucide && typeof window.lucide.createIcons === 'function') {
      window.lucide.createIcons();
    }
  } catch (e) {
    console.warn('Lucide icon render error:', e);
  }
}

// 7. Tailwind JIT Configuration
window.tailwind = window.tailwind || {};
window.tailwind.config = {
  darkMode: ['class', '[data-theme="dark"]'],
  theme: {
    extend: {
      colors: {
        brand: {
          50: '#faf5ff',
          100: '#f3e8ff',
          200: '#e9d5ff',
          300: '#d8b4fe',
          400: '#c084fc',
          500: '#a855f7',
          600: '#9333ea',
          700: '#7e22ce',
          800: '#6b21a8',
          900: '#581c87',
          accenture: '#a100ff',
        }
      }
    }
  }
};
