import { HttpError, NetworkError, NotFoundError, RateLimitError, TimeoutError } from '../errors.js';
import { sleep } from '../utils.js';

/**
 * Compuerta compartida de rate limit: cuando una respuesta indica que el cupo se agotó
 * (X-RateLimit-Remaining: 0), todas las peticiones posteriores esperan hasta el reset
 * o abortan rápido si la espera supera el máximo permitido.
 */
export class RateLimitGate {
  private blockedUntil = 0;
  remaining: number | null = null;
  limit: number | null = null;

  block(untilMs: number): void {
    this.blockedUntil = Math.max(this.blockedUntil, untilMs);
  }

  get resetAt(): Date | null {
    return this.blockedUntil > 0 ? new Date(this.blockedUntil) : null;
  }

  async wait(maxWaitMs: number, onWait?: (ms: number, resetAt: Date) => void): Promise<void> {
    const ms = this.blockedUntil - Date.now();
    if (ms <= 0) return;
    if (ms > maxWaitMs) {
      throw new RateLimitError(
        new Date(this.blockedUntil),
        'Configura GITHUB_TOKEN (5000 req/h) o aumenta --max-wait.',
      );
    }
    onWait?.(ms, new Date(this.blockedUntil));
    await sleep(ms);
  }
}

export interface RateLimitPolicy {
  gate: RateLimitGate;
  maxWaitMs: number;
  onWait?: (ms: number, resetAt: Date) => void;
}

export interface HttpOptions {
  timeoutMs: number;
  retries: number;
  headers?: Record<string, string>;
  rateLimit?: RateLimitPolicy;
  /** Base del backoff exponencial (ms). */
  backoffBaseMs?: number;
}

export interface HttpResult<T> {
  data: T;
  status: number;
  redirected: boolean;
  finalUrl: string;
  headers: Headers;
}

const MAX_BACKOFF_MS = 10_000;

export function backoffDelay(attempt: number, baseMs = 500): number {
  const exp = Math.min(baseMs * 2 ** attempt, MAX_BACKOFF_MS);
  return exp + Math.floor(Math.random() * 250);
}

function intHeader(headers: Headers, name: string): number | null {
  const value = headers.get(name);
  if (value === null) return null;
  const n = Number.parseInt(value, 10);
  return Number.isFinite(n) ? n : null;
}

function isTimeout(err: unknown): boolean {
  return err instanceof Error && (err.name === 'TimeoutError' || err.name === 'AbortError');
}

async function safeText(res: Response): Promise<string> {
  try {
    return await res.text();
  } catch {
    return '';
  }
}

/**
 * GET JSON con timeout por request, reintentos con backoff exponencial (red, 403, 429, 5xx)
 * y lectura de cabeceras de rate limit (X-RateLimit-Remaining / X-RateLimit-Reset / Retry-After).
 */
export async function fetchJson<T>(url: string, options: HttpOptions): Promise<HttpResult<T>> {
  const { retries, timeoutMs, rateLimit } = options;
  const baseMs = options.backoffBaseMs ?? 500;

  for (let attempt = 0; ; attempt++) {
    if (rateLimit) await rateLimit.gate.wait(rateLimit.maxWaitMs, rateLimit.onWait);

    let res: Response;
    try {
      res = await fetch(url, {
        headers: options.headers,
        redirect: 'follow',
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (err) {
      const typed = isTimeout(err) ? new TimeoutError(url, timeoutMs) : new NetworkError(url, err);
      if (attempt >= retries) throw typed;
      await sleep(backoffDelay(attempt, baseMs));
      continue;
    }

    const remaining = intHeader(res.headers, 'x-ratelimit-remaining');
    const reset = intHeader(res.headers, 'x-ratelimit-reset');
    if (rateLimit) {
      if (remaining !== null) rateLimit.gate.remaining = remaining;
      const limit = intHeader(res.headers, 'x-ratelimit-limit');
      if (limit !== null) rateLimit.gate.limit = limit;
      // +1 s de margen por desfase de reloj.
      if (remaining === 0 && reset !== null) rateLimit.gate.block(reset * 1000 + 1000);
    }

    if (res.ok) {
      const data = (await res.json()) as T;
      return { data, status: res.status, redirected: res.redirected, finalUrl: res.url, headers: res.headers };
    }

    if (res.status === 404 || res.status === 410) {
      await res.body?.cancel();
      throw new NotFoundError(url);
    }

    const rateLimited = (res.status === 403 || res.status === 429) && remaining === 0;
    const retryable = res.status === 403 || res.status === 429 || res.status >= 500;

    if (!retryable || attempt >= retries) {
      if (rateLimited) {
        await res.body?.cancel();
        throw new RateLimitError(reset !== null ? new Date(reset * 1000) : null);
      }
      throw new HttpError(url, res.status, await safeText(res));
    }

    await res.body?.cancel();

    // Rate limit primario: la compuerta esperará (o abortará) al inicio de la siguiente iteración.
    if (rateLimited) continue;

    // Rate limit secundario / 429: respetar Retry-After si existe.
    const retryAfter = intHeader(res.headers, 'retry-after');
    if (retryAfter !== null) {
      const waitMs = retryAfter * 1000;
      if (rateLimit && waitMs > rateLimit.maxWaitMs) {
        throw new RateLimitError(new Date(Date.now() + waitMs), 'GitHub pidió esperar (Retry-After).');
      }
      await sleep(waitMs);
      continue;
    }

    await sleep(backoffDelay(attempt, baseMs));
  }
}
