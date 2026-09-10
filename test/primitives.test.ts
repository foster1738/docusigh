import { describe, expect, it } from "vitest";
import {
  CircuitBreaker,
  EmailError,
  TokenBucket,
  classifyHttpStatus,
  computeBackoffMs,
  nextRetryDelayMs,
  parseRetryAfter,
  toEmailError,
} from "../src/index.js";
import { FakeClock } from "./helpers.js";

describe("backoff", () => {
  const opts = { baseMs: 1000, maxMs: 30_000, factor: 2 };

  it("grows exponentially and is bounded by the cap", () => {
    const max = () => 0.999999;
    expect(computeBackoffMs(1, { ...opts, random: max })).toBeLessThanOrEqual(1000);
    expect(computeBackoffMs(3, { ...opts, random: max })).toBeLessThanOrEqual(4000);
    expect(computeBackoffMs(3, { ...opts, random: max })).toBeGreaterThan(3990);
    expect(computeBackoffMs(20, { ...opts, random: max })).toBeLessThanOrEqual(30_000);
  });

  it("applies full jitter down to zero", () => {
    expect(computeBackoffMs(5, { ...opts, random: () => 0 })).toBe(0);
  });

  it("honours Retry-After but never beyond the cap", () => {
    expect(nextRetryDelayMs(1, { ...opts, random: () => 0 }, 5000)).toBe(5000);
    expect(nextRetryDelayMs(1, { ...opts, random: () => 0 }, 999_999)).toBe(30_000);
  });

  it("parses Retry-After in seconds or as an HTTP date", () => {
    expect(parseRetryAfter("7")).toBe(7000);
    expect(parseRetryAfter(new Date(Date.now() + 10_000).toUTCString())).toBeGreaterThan(8000);
    expect(parseRetryAfter("garbage")).toBeUndefined();
    expect(parseRetryAfter(null)).toBeUndefined();
  });
});

describe("error classification", () => {
  it("maps HTTP statuses", () => {
    expect(classifyHttpStatus("p", 429, "", "3")).toMatchObject({ code: "RATE_LIMITED", retryable: true, retryAfterMs: 3000 });
    expect(classifyHttpStatus("p", 503, "")).toMatchObject({ code: "PROVIDER_UNAVAILABLE", retryable: true });
    expect(classifyHttpStatus("p", 401, "")).toMatchObject({ code: "AUTH", retryable: false });
    expect(classifyHttpStatus("p", 413, "")).toMatchObject({ code: "MESSAGE_TOO_LARGE", retryable: false });
    expect(classifyHttpStatus("p", 422, "bad to")).toMatchObject({ code: "PROVIDER_REJECTED", retryable: false });
    expect(classifyHttpStatus("p", 408, "")).toMatchObject({ retryable: true });
  });

  it("treats abort/timeout and socket errors as retryable", () => {
    expect(toEmailError(new DOMException("x", "AbortError"), "p")).toMatchObject({ code: "TIMEOUT", retryable: true });
    const e = Object.assign(new Error("boom"), { code: "ECONNRESET" });
    expect(toEmailError(e, "p")).toMatchObject({ code: "NETWORK", retryable: true });
    expect(toEmailError("weird", "p")).toMatchObject({ code: "UNKNOWN", retryable: true });
  });

  it("passes through existing EmailErrors", () => {
    const e = new EmailError("x", { code: "AUTH", retryable: false });
    expect(toEmailError(e)).toBe(e);
  });
});

describe("CircuitBreaker", () => {
  it("opens after consecutive retryable failures and half-opens after the cooldown", () => {
    const clock = new FakeClock();
    const cb = new CircuitBreaker("p", { failureThreshold: 3, openMs: 1000, now: clock.nowMs });
    const fail = new EmailError("x", { code: "PROVIDER_UNAVAILABLE", retryable: true });

    cb.recordFailure(fail);
    cb.recordFailure(fail);
    expect(cb.getState()).toBe("closed");
    cb.recordFailure(fail);
    expect(cb.getState()).toBe("open");
    expect(cb.tryAcquire()).toBe(false);

    clock.advance(1000);
    expect(cb.getState()).toBe("half-open");
    expect(cb.tryAcquire()).toBe(true); // one probe
    expect(cb.tryAcquire()).toBe(false); // second caller waits

    cb.recordSuccess();
    expect(cb.getState()).toBe("closed");
  });

  it("re-opens when the probe fails", () => {
    const clock = new FakeClock();
    const cb = new CircuitBreaker("p", { failureThreshold: 1, openMs: 100, now: clock.nowMs });
    const fail = new EmailError("x", { code: "TIMEOUT", retryable: true });
    cb.recordFailure(fail);
    clock.advance(100);
    expect(cb.tryAcquire()).toBe(true);
    cb.recordFailure(fail);
    expect(cb.getState()).toBe("open");
  });

  it("ignores permanent per-message rejections", () => {
    const cb = new CircuitBreaker("p", { failureThreshold: 1 });
    cb.recordFailure(new EmailError("bad addr", { code: "PROVIDER_REJECTED", retryable: false }));
    expect(cb.getState()).toBe("closed");
  });

  it("success resets the failure streak", () => {
    const cb = new CircuitBreaker("p", { failureThreshold: 2 });
    const fail = new EmailError("x", { code: "TIMEOUT", retryable: true });
    cb.recordFailure(fail);
    cb.recordSuccess();
    cb.recordFailure(fail);
    expect(cb.getState()).toBe("closed");
  });
});

describe("TokenBucket", () => {
  it("allows a burst then refills over time", () => {
    const clock = new FakeClock();
    const b = new TokenBucket({ perSecond: 10, burst: 2, now: clock.nowMs });
    expect(b.tryTake()).toBe(true);
    expect(b.tryTake()).toBe(true);
    expect(b.tryTake()).toBe(false);
    expect(b.msUntilNextToken()).toBe(100);
    clock.advance(100);
    expect(b.tryTake()).toBe(true);
    expect(b.tryTake()).toBe(false);
  });

  it("never exceeds capacity after a long idle period", () => {
    const clock = new FakeClock();
    const b = new TokenBucket({ perSecond: 1, burst: 3, now: clock.nowMs });
    clock.advance(60_000);
    expect(b.tryTake()).toBe(true);
    expect(b.tryTake()).toBe(true);
    expect(b.tryTake()).toBe(true);
    expect(b.tryTake()).toBe(false);
  });
});
