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

// 2. Safe Lucide icon renderer
function safeRenderIcons() {
  try {
    if (window.lucide && typeof window.lucide.createIcons === 'function') {
      window.lucide.createIcons();
    }
  } catch (e) {
    console.warn('Lucide icon render error:', e);
  }
}

// 3. Tailwind JIT Configuration
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
