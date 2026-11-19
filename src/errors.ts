/**
 * Jerarquía de errores tipados. Cada error lleva un `code` estable (útil en --json/CI)
 * y un mensaje legible para humanos.
 */

export type ErrorCode =
  | 'MANIFEST_ERROR'
  | 'NETWORK_ERROR'
  | 'TIMEOUT'
  | 'HTTP_ERROR'
  | 'NOT_FOUND'
  | 'RATE_LIMITED';

export class GhostDepsError extends Error {
  readonly code: ErrorCode;

  constructor(code: ErrorCode, message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = new.target.name;
    this.code = code;
  }
}

export class ManifestError extends GhostDepsError {
  constructor(message: string, options?: { cause?: unknown }) {
    super('MANIFEST_ERROR', message, options);
  }
}

export class NetworkError extends GhostDepsError {
  constructor(readonly url: string, cause: unknown) {
    const detail = cause instanceof Error ? cause.message : String(cause);
    super('NETWORK_ERROR', `Error de red al consultar ${url}: ${detail}`, { cause });
  }
}

export class TimeoutError extends GhostDepsError {
  constructor(readonly url: string, readonly timeoutMs: number) {
    super('TIMEOUT', `Timeout (${timeoutMs} ms) al consultar ${url}`);
  }
}

export class HttpError extends GhostDepsError {
  constructor(readonly url: string, readonly status: number, body?: string) {
    const snippet = body ? `: ${body.slice(0, 200)}` : '';
    super('HTTP_ERROR', `HTTP ${status} al consultar ${url}${snippet}`);
  }
}

export class NotFoundError extends GhostDepsError {
  constructor(readonly url: string) {
    super('NOT_FOUND', `Recurso no encontrado (404): ${url}`);
  }
}

export class RateLimitError extends GhostDepsError {
  constructor(readonly resetAt: Date | null, hint?: string) {
    const when = resetAt ? ` hasta las ${resetAt.toLocaleTimeString()}` : '';
    super('RATE_LIMITED', `Rate limit de GitHub agotado${when}.${hint ? ' ' + hint : ''}`);
  }
}

export function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}
