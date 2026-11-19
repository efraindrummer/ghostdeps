import { afterEach, describe, expect, it, vi } from 'vitest';
import { RateLimitGate, fetchJson } from '../src/clients/http.js';
import { HttpError, NotFoundError, RateLimitError } from '../src/errors.js';

function jsonResponse(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });
}

afterEach(() => vi.unstubAllGlobals());

const base = { timeoutMs: 1000, retries: 3, backoffBaseMs: 1 };

describe('fetchJson', () => {
  it('reintenta 5xx con backoff y termina devolviendo datos', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(502, {}))
      .mockResolvedValueOnce(jsonResponse(503, {}))
      .mockResolvedValueOnce(jsonResponse(200, { ok: true }));
    vi.stubGlobal('fetch', fetchMock);
    const res = await fetchJson<{ ok: boolean }>('https://x', base);
    expect(res.data.ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('no reintenta 404 y lanza NotFoundError', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(404, {}));
    vi.stubGlobal('fetch', fetchMock);
    await expect(fetchJson('https://x', base)).rejects.toBeInstanceOf(NotFoundError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('lanza HttpError tras agotar reintentos', async () => {
    vi.stubGlobal('fetch', vi.fn().mockImplementation(async () => jsonResponse(500, {})));
    await expect(fetchJson('https://x', { ...base, retries: 1 })).rejects.toBeInstanceOf(HttpError);
  });

  it('aborta con RateLimitError si el reset supera la espera máxima', async () => {
    const reset = Math.floor(Date.now() / 1000) + 3600;
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse(403, {}, { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': String(reset) }));
    vi.stubGlobal('fetch', fetchMock);
    const gate = new RateLimitGate();
    await expect(fetchJson('https://x', { ...base, rateLimit: { gate, maxWaitMs: 1000 } })).rejects.toBeInstanceOf(
      RateLimitError,
    );
    // Las siguientes peticiones abortan sin tocar la red.
    await expect(fetchJson('https://y', { ...base, rateLimit: { gate, maxWaitMs: 1000 } })).rejects.toBeInstanceOf(
      RateLimitError,
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
