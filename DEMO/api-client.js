(() => {
  class ApiError extends Error {
    constructor(message, status, code) {
      super(message);
      this.name = 'ApiError';
      this.status = status;
      this.code = code;
    }
  }

  async function request(path, options = {}) {
    const response = await fetch(`/api${path}`, {
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json', ...options.headers },
      ...options,
      body: options.body && typeof options.body !== 'string' ? JSON.stringify(options.body) : options.body
    });
    const contentType = response.headers.get('content-type') || '';
    const payload = contentType.includes('application/json') ? await response.json() : null;
    if (!response.ok) throw new ApiError(payload?.message || 'No se pudo completar la solicitud.', response.status, payload?.error);
    return payload;
  }

  async function available() {
    try {
      const controller = new AbortController();
      const timeout = window.setTimeout(() => controller.abort(), 1800);
      const response = await fetch('/api/health', { signal: controller.signal, credentials: 'same-origin', headers:{ Accept:'application/json' } });
      window.clearTimeout(timeout);
      if (!response.ok || !(response.headers.get('content-type') || '').includes('application/json')) return false;
      const payload = await response.json();
      return payload.status === 'ok';
    } catch {
      return false;
    }
  }

  window.SheinApi = { request, available, ApiError };
})();
