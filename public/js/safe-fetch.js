(function () {
  const RAILWAY_FALLBACK_ORIGIN = 'https://lorgen-invitational-production.up.railway.app';

  function resolveApiUrl(url) {
    if (typeof url !== 'string') return url;
    if (!url.startsWith('/')) return url;

    const explicitOrigin =
      (typeof window !== 'undefined' && window.__LORGEN_API_ORIGIN) ||
      (typeof document !== 'undefined' && document.querySelector('meta[name="lorgen-api-origin"]')?.content) ||
      '';
    if (explicitOrigin) return `${explicitOrigin.replace(/\/+$/, '')}${url}`;

    if (typeof window === 'undefined' || !window.location) return url;

    const host = window.location.hostname || '';
    const isRailwayHost = host.endsWith('.up.railway.app');
    if (isRailwayHost) return url;

    const isLikelyLegacyFrontend =
      host.endsWith('.vercel.app') ||
      host === 'www.lorgen-invitational.no' ||
      host === 'lorgen-invitational.no';
    if (isLikelyLegacyFrontend) {
      return `${RAILWAY_FALLBACK_ORIGIN}${url}`;
    }

    return url;
  }

  async function parseApiResponse(response) {
    const text = await response.text();
    if (!text) return { data: {}, isJson: true, rawText: '' };

    try {
      return { data: JSON.parse(text), isJson: true, rawText: text };
    } catch (_error) {
      return { data: text, isJson: false, rawText: text };
    }
  }

  async function safeJsonFetch(url, options = {}) {
    const resolvedUrl = resolveApiUrl(url);
    const method = (options.method || 'GET').toUpperCase();
    const hasBody = options.body !== undefined && options.body !== null;
    const headers = {
      ...(hasBody && !(options.body instanceof FormData) ? { 'Content-Type': 'application/json' } : {}),
      ...(options.headers || {})
    };

    const { debugHook, ...fetchOptions } = options;

    let response;
    try {
      response = await fetch(resolvedUrl, {
        credentials: 'include',
        ...fetchOptions,
        headers
      });
    } catch (networkError) {
      console.error('[safeJsonFetch] Network error', { url, resolvedUrl, method, error: networkError });
      throw new Error(networkError?.message || 'Kunne ikke nå serveren. Prøv igjen.');
    }

    const parsed = await parseApiResponse(response);
    if (typeof debugHook === 'function') {
      try {
        debugHook({
          url,
          resolvedUrl,
          method,
          status: response.status,
          ok: response.ok,
          parsedResponse: parsed.isJson ? parsed.data : { raw: parsed.rawText }
        });
      } catch (_debugError) {
        // Ignorer debug-feil slik at API-kall ikke påvirkes.
      }
    }

    if (!response.ok) {
      console.error('[safeJsonFetch] HTTP error', {
        url,
        resolvedUrl,
        method,
        status: response.status,
        payload: parsed.data
      });
      let message = `Serverfeil (${response.status})`;
      if (parsed.isJson && parsed.data && typeof parsed.data === 'object') {
        message = parsed.data.error || parsed.data.message || message;
      } else if (!parsed.isJson && parsed.rawText) {
        message = parsed.rawText;
      }
      throw new Error(message);
    }

    if (!parsed.isJson) {
      console.error('[safeJsonFetch] Non-JSON success response', { url, resolvedUrl, method, status: response.status });
      return { raw: parsed.rawText };
    }

    return parsed.data;
  }

  window.safeJsonFetch = safeJsonFetch;
})();
