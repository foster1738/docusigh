/**
 * Token-bucket rate limiter. Providers enforce per-second quotas; exceeding
 * them yields 429s that burn retry budget for no reason, so we throttle
 * locally first.
 */
export interface RateLimiterOptions {
  /** Sustained requests per second. */
  perSecond: number;
  /** Maximum burst; defaults to `perSecond`. */
  burst?: number;
  now?: () => number;
}

export class TokenBucket {
  private tokens: number;
  private lastRefill: number;
  private readonly capacity: number;
  private readonly refillPerMs: number;
  private readonly now: () => number;

  constructor(options: RateLimiterOptions) {
    if (options.perSecond <= 0) throw new Error("perSecond must be > 0");
    this.capacity = Math.max(1, options.burst ?? options.perSecond);
    this.refillPerMs = options.perSecond / 1000;
    this.now = options.now ?? Date.now;
    this.tokens = this.capacity;
    this.lastRefill = this.now();
  }

  private refill(): void {
    const t = this.now();
    const elapsed = t - this.lastRefill;
    if (elapsed > 0) {
      this.tokens = Math.min(this.capacity, this.tokens + elapsed * this.refillPerMs);
      this.lastRefill = t;
    }
  }

  /** Take a token if one is available. */
  tryTake(): boolean {
    this.refill();
    if (this.tokens >= 1) {
      this.tokens -= 1;
      return true;
    }
    return false;
  }

  /** Milliseconds until the next token becomes available (0 if now). */
  msUntilNextToken(): number {
    this.refill();
    if (this.tokens >= 1) return 0;
    return Math.ceil((1 - this.tokens) / this.refillPerMs);
  }
}
