(function() {
  function initSwagger() {
    var path = window.location.pathname;
    var prefix = '';
    if (path.startsWith('/itsm')) {
      prefix = '/itsm';
    } else if (path.startsWith('/api/id')) {
      prefix = '/api/id';
    }
    var openapiUrl = prefix + '/openapi.json';

    if (typeof window.SwaggerUIBundle === 'function') {
      var presets = [window.SwaggerUIBundle.presets.apis];
      if (window.SwaggerUIBundle.SwaggerUIStandalonePreset) {
        presets.push(window.SwaggerUIBundle.SwaggerUIStandalonePreset);
      }
      window.ui = window.SwaggerUIBundle({
        url: openapiUrl,
        dom_id: '#swagger-ui',
        layout: 'BaseLayout',
        deepLinking: true,
        showExtensions: false,
        showCommonExtensions: false,
        persistAuthorization: true,
        displayRequestDuration: true,
        filter: true,
        tryItOutEnabled: true,
        docExpansion: 'list',
        oauth2RedirectUrl: window.location.origin + prefix + '/docs/oauth2-redirect',
        presets: presets
      });
    }

    var removeOpenApiLabels = function() {
      var elements = document.querySelectorAll('.swagger-ui .info a, .swagger-ui .info span, .swagger-ui .info small');
      for (var i = 0; i < elements.length; i++) {
        var el = elements[i];
        var txt = (el.textContent || '').toLowerCase();
        if (txt.includes('openapi.json') || txt.includes('openai.json') || txt.endsWith('.json')) {
          el.remove();
        }
      }
    };
    removeOpenApiLabels();
    try {
      var obs = new MutationObserver(removeOpenApiLabels);
      obs.observe(document.body, { childList: true, subtree: true });
    } catch (_) {}
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initSwagger);
  } else {
    initSwagger();
  }
})();
