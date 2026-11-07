import { AxiosError, AxiosInstance } from 'axios';

/**
 * Rewrite axios errors so the message says which service and request failed,
 * e.g. "Paperless: no response within 30s (GET /api/documents/123/preview/)"
 * instead of axios' bare "timeout of 30000ms exceeded".
 */
export function describeErrors(client: AxiosInstance, service: string): void {
  client.interceptors.response.use(undefined, (err: unknown) => {
    if (!(err instanceof AxiosError)) return Promise.reject(err);
    const cfg = err.config;
    const req = `${(cfg?.method ?? 'GET').toUpperCase()} ${cfg?.baseURL ?? ''}${cfg?.url ?? ''}`;
    let reason: string;
    if (err.code === 'ECONNABORTED' || err.code === 'ETIMEDOUT') {
      reason = `no response within ${Math.round((cfg?.timeout ?? 0) / 1000)}s`;
    } else if (err.response) {
      const body = typeof err.response.data === 'string'
        ? err.response.data
        : Buffer.isBuffer(err.response.data) ? '' : JSON.stringify(err.response.data ?? '');
      reason = `HTTP ${err.response.status}${body ? `: ${body.slice(0, 300)}` : ''}`;
    } else {
      reason = `not reachable (${err.code ?? err.message})`;
    }
    err.message = `${service}: ${reason} (${req})`;
    return Promise.reject(err);
  });
}
