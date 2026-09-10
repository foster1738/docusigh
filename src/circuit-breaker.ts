import { EmailError } from "./errors.js";

export type CircuitState = "closed" | "open" | "half-open";

export interface CircuitBreakerOptions {
  /** Consecutive retryable failures before the circuit opens. */
  failureThreshold?: number;
  /** How long the circuit stays open before allowing a probe request. */
  openMs?: number;
  /** Successful probes required in half-open state before closing. */
  successThreshold?: number;
  now?: () => number;
}

/**
 * A per-provider circuit breaker. When a provider fails repeatedly we stop
 * sending to it for a cooling-off period and fall through to the next
 * provider in the chain, then send a single probe to see if it recovered.
 *
 * Only *retryable* errors count as failures: a 400 for an invalid address says
 * nothing about the provider's health.
 */
export class CircuitBreaker {
  private state: CircuitState = "closed";
  private consecutiveFailures = 0;
  private halfOpenSuccesses = 0;
  private openedAt = 0;
  private probeInFlight = false;
  private readonly failureThreshold: number;
  private readonly openMs: number;
  private readonly successThreshold: number;
  private readonly now: () => number;

  constructor(
    readonly name: string,
    options: CircuitBreakerOptions = {},
  ) {
    this.failureThreshold = options.failureThreshold ?? 5;
    this.openMs = options.openMs ?? 30_000;
    this.successThreshold = options.successThreshold ?? 1;
    this.now = options.now ?? Date.now;
  }

  getState(): CircuitState {
    if (this.state === "open" && this.now() - this.openedAt >= this.openMs) {
      this.state = "half-open";
      this.halfOpenSuccesses = 0;
      this.probeInFlight = false;
    }
    return this.state;
  }

  /** Returns true if a request may proceed; reserves the probe slot in half-open. */
  tryAcquire(): boolean {
    const state = this.getState();
    if (state === "closed") return true;
    if (state === "half-open" && !this.probeInFlight) {
      this.probeInFlight = true;
      return true;
    }
    return false;
  }

  assertAvailable(): void {
    if (!this.tryAcquire()) {
      throw new EmailError(`Circuit for provider "${this.name}" is open`, {
        code: "CIRCUIT_OPEN",
        retryable: true,
        provider: this.name,
      });
    }
  }

  /** Give back a half-open probe slot without recording an outcome. */
  release(): void {
    if (this.state === "half-open") this.probeInFlight = false;
  }

  recordSuccess(): void {
    const state = this.getState();
    if (state === "half-open") {
      this.probeInFlight = false;
      this.halfOpenSuccesses += 1;
      if (this.halfOpenSuccesses >= this.successThreshold) this.reset();
      return;
    }
    this.consecutiveFailures = 0;
  }

  recordFailure(err: unknown): void {
    if (EmailError.isEmailError(err) && !err.retryable) {
      // Permanent rejection of one message; provider is healthy.
      return;
    }
    const state = this.getState();
    if (state === "half-open") {
      this.trip();
      return;
    }
    this.consecutiveFailures += 1;
    if (this.consecutiveFailures >= this.failureThreshold) this.trip();
  }

  reset(): void {
    this.state = "closed";
    this.consecutiveFailures = 0;
    this.halfOpenSuccesses = 0;
    this.probeInFlight = false;
  }

  private trip(): void {
    this.state = "open";
    this.openedAt = this.now();
    this.probeInFlight = false;
    this.consecutiveFailures = 0;
  }
}
