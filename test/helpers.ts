import type { EmailMessage } from "../src/index.js";

export function msg(overrides: Partial<EmailMessage> = {}): EmailMessage {
  return {
    from: { email: "noreply@docusigh.test", name: "DocuSigh" },
    to: [{ email: "signer@example.com", name: "Sam Signer" }],
    subject: "Please sign: Lease Agreement",
    text: "Open the link to sign.",
    html: "<p>Open the link to sign.</p>",
    ...overrides,
  };
}

/** A controllable clock so tests never sleep. */
export class FakeClock {
  private t: number;
  constructor(start = Date.parse("2026-01-01T00:00:00Z")) {
    this.t = start;
  }
  now = (): Date => new Date(this.t);
  nowMs = (): number => this.t;
  advance(ms: number): void {
    this.t += ms;
  }
}
