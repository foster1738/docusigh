import type { EmailMessage, EmailProvider, ProviderSendResult } from "../types.js";

export interface FakeSend {
  message: EmailMessage;
  at: Date;
}

/**
 * In-memory provider for tests and local development. Each call can be told
 * to fail with a given error via `failNext` or a custom `behaviour` hook.
 */
export class FakeProvider implements EmailProvider {
  readonly sent: FakeSend[] = [];
  private failures: unknown[] = [];
  private counter = 0;

  constructor(
    readonly name = "fake",
    private behaviour?: (message: EmailMessage, attempt: number) => Promise<ProviderSendResult> | ProviderSendResult,
  ) {}

  /** Queue errors to throw on the next N calls (in order). */
  failNext(...errors: unknown[]): void {
    this.failures.push(...errors);
  }

  async send(message: EmailMessage, signal: AbortSignal): Promise<ProviderSendResult> {
    this.counter += 1;
    if (signal.aborted) throw new DOMException("Aborted", "AbortError");
    if (this.failures.length > 0) throw this.failures.shift();
    if (this.behaviour) return this.behaviour(message, this.counter);
    this.sent.push({ message, at: new Date() });
    return { providerMessageId: `${this.name}-${this.counter}` };
  }

  get calls(): number {
    return this.counter;
  }
}

/** Logs the message and reports success. Handy for local development. */
export class ConsoleProvider implements EmailProvider {
  readonly name = "console";
  private counter = 0;

  async send(message: EmailMessage): Promise<ProviderSendResult> {
    this.counter += 1;
    const to = message.to.map((a) => a.email).join(", ");
    process.stdout.write(`[email] to=${to} subject=${JSON.stringify(message.subject)}\n`);
    return { providerMessageId: `console-${this.counter}` };
  }
}
