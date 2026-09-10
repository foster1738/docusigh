/**
 * Error classification. The retry loop only cares about `retryable`, but the
 * `code` lets operators and dashboards group failures.
 */

export type EmailErrorCode =
  | "VALIDATION"
  | "SUPPRESSED"
  | "RATE_LIMITED"
  | "TIMEOUT"
  | "NETWORK"
  | "PROVIDER_UNAVAILABLE"
  | "PROVIDER_REJECTED"
  | "AUTH"
  | "CIRCUIT_OPEN"
  | "MESSAGE_TOO_LARGE"
  | "UNKNOWN";

export interface EmailErrorOptions {
  code: EmailErrorCode;
  retryable: boolean;
  provider?: string;
  statusCode?: number;
  cause?: unknown;
  /** Provider-suggested delay before retrying, in milliseconds. */
  retryAfterMs?: number;
}

export class EmailError extends Error {
  readonly code: EmailErrorCode;
  readonly retryable: boolean;
  readonly provider: string | undefined;
  readonly statusCode: number | undefined;
  readonly retryAfterMs: number | undefined;
  override readonly cause: unknown;

  constructor(message: string, options: EmailErrorOptions) {
    super(message);
    this.name = "EmailError";
    this.code = options.code;
    this.retryable = options.retryable;
    this.provider = options.provider;
    this.statusCode = options.statusCode;
    this.retryAfterMs = options.retryAfterMs;
    this.cause = options.cause;
  }

  static isEmailError(err: unknown): err is EmailError {
    return err instanceof EmailError || (typeof err === "object" && err !== null && (err as { name?: string }).name === "EmailError");
  }
}

/** Anything not already classified is treated as a retryable unknown failure. */
export function toEmailError(err: unknown, provider?: string): EmailError {
  if (EmailError.isEmailError(err)) return err;
  if (err instanceof Error) {
    if (err.name === "AbortError" || err.name === "TimeoutError") {
      return new EmailError(`Timed out talking to ${provider ?? "provider"}`, {
        code: "TIMEOUT",
        retryable: true,
        ...(provider !== undefined ? { provider } : {}),
        cause: err,
      });
    }
    const errno = (err as NodeJS.ErrnoException).code;
    if (typeof errno === "string" && NETWORK_ERRNOS.has(errno)) {
      return new EmailError(`Network error (${errno}) talking to ${provider ?? "provider"}`, {
        code: "NETWORK",
        retryable: true,
        ...(provider !== undefined ? { provider } : {}),
        cause: err,
      });
    }
    return new EmailError(err.message, {
      code: "UNKNOWN",
      retryable: true,
      ...(provider !== undefined ? { provider } : {}),
      cause: err,
    });
  }
  return new EmailError(String(err), {
    code: "UNKNOWN",
    retryable: true,
    ...(provider !== undefined ? { provider } : {}),
    cause: err,
  });
}

const NETWORK_ERRNOS = new Set([
  "ECONNRESET",
  "ECONNREFUSED",
  "ETIMEDOUT",
  "EAI_AGAIN",
  "ENOTFOUND",
  "EPIPE",
  "EHOSTUNREACH",
  "ENETUNREACH",
  "UND_ERR_SOCKET",
  "UND_ERR_CONNECT_TIMEOUT",
  "UND_ERR_HEADERS_TIMEOUT",
  "UND_ERR_BODY_TIMEOUT",
]);

/**
 * Map an HTTP status from a provider API to an error. 429 and 5xx are
 * retryable; 4xx (other than 408/425/429) are permanent rejections.
 */
export function classifyHttpStatus(
  provider: string,
  status: number,
  body: string,
  retryAfterHeader?: string | null,
): EmailError {
  const snippet = body.length > 500 ? `${body.slice(0, 500)}…` : body;
  const retryAfterMs = parseRetryAfter(retryAfterHeader);
  const base = {
    provider,
    statusCode: status,
    ...(retryAfterMs !== undefined ? { retryAfterMs } : {}),
  };
  if (status === 401 || status === 403) {
    return new EmailError(`${provider} rejected credentials (${status}): ${snippet}`, {
      code: "AUTH",
      retryable: false,
      ...base,
    });
  }
  if (status === 413) {
    return new EmailError(`${provider} says the message is too large (413): ${snippet}`, {
      code: "MESSAGE_TOO_LARGE",
      retryable: false,
      ...base,
    });
  }
  if (status === 429) {
    return new EmailError(`${provider} rate limited the request (429): ${snippet}`, {
      code: "RATE_LIMITED",
      retryable: true,
      ...base,
    });
  }
  if (status === 408 || status === 425) {
    return new EmailError(`${provider} asked us to retry (${status}): ${snippet}`, {
      code: "PROVIDER_UNAVAILABLE",
      retryable: true,
      ...base,
    });
  }
  if (status >= 500) {
    return new EmailError(`${provider} is unavailable (${status}): ${snippet}`, {
      code: "PROVIDER_UNAVAILABLE",
      retryable: true,
      ...base,
    });
  }
  return new EmailError(`${provider} rejected the message (${status}): ${snippet}`, {
    code: "PROVIDER_REJECTED",
    retryable: false,
    ...base,
  });
}

export function parseRetryAfter(value: string | null | undefined): number | undefined {
  if (!value) return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.round(seconds * 1000);
  const date = Date.parse(value);
  if (!Number.isNaN(date)) return Math.max(0, date - Date.now());
  return undefined;
}
