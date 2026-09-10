/**
 * Exponential backoff with full jitter (AWS Architecture Blog, 2015). Full
 * jitter spreads retries evenly across [0, cap] which avoids the thundering
 * herd that fixed or "equal jitter" schedules produce when a provider recovers.
 */
export interface BackoffOptions {
  /** Delay for the first retry, in milliseconds. */
  baseMs: number;
  /** Upper bound for any single delay. */
  maxMs: number;
  /** Growth factor per attempt. */
  factor?: number;
  /** Random source in [0, 1); injectable for deterministic tests. */
  random?: () => number;
}

export function computeBackoffMs(attempt: number, options: BackoffOptions): number {
  const factor = options.factor ?? 2;
  const random = options.random ?? Math.random;
  const exp = Math.min(options.maxMs, options.baseMs * Math.pow(factor, Math.max(0, attempt - 1)));
  return Math.floor(random() * exp);
}

/**
 * Honour a provider's Retry-After hint when present but never wait longer than
 * the cap, so a misbehaving provider cannot stall the queue indefinitely.
 */
export function nextRetryDelayMs(attempt: number, options: BackoffOptions, retryAfterMs?: number): number {
  const computed = computeBackoffMs(attempt, options);
  if (retryAfterMs !== undefined && retryAfterMs > computed) {
    return Math.min(retryAfterMs, options.maxMs);
  }
  return computed;
}
