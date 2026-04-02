(function () {
  function parseApiResponse(response) {
    return response.text().then((text) => {
      if (!text) return {};
      try {
        return JSON.parse(text);
      } catch (_error) {
        return { __nonJson: true, raw: text };
      }
    });
  }

  async function safeJsonFetch(url, options = {}) {
    const method = (options.method || 'GET').toUpperCase();
    const hasBody = options.body !== undefined && options.body !== null;
    const headers = {
      ...(hasBody && !(options.body instanceof FormData) ? { 'Content-Type': 'application/json' } : {}),
      ...(options.headers || {})
    };

    let response;
    try {
      response = await fetch(url, {
        credentials: 'same-origin',
        ...options,
        headers
      });
    } catch (networkError) {
      console.error('[safeJsonFetch] Network error', { url, method, error: networkError });
      throw new Error('Kunne ikke nå serveren. Prøv igjen.');
    }

    const payload = await parseApiResponse(response);
    if (!response.ok) {
      console.error('[safeJsonFetch] HTTP error', { url, method, status: response.status, payload });
      const message = payload && typeof payload === 'object' && payload.error
        ? payload.error
        : `Serverfeil (${response.status})`;
      throw new Error(message);
    }

    if (payload && payload.__nonJson) {
      console.error('[safeJsonFetch] Non-JSON response', { url, method, status: response.status });
      throw new Error('Serveren svarte ikke med JSON.');
    }

    return payload;
  }

  window.safeJsonFetch = safeJsonFetch;
})();
