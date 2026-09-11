import { blocksFromText } from "../html/markdown.js";
import { renderBulletproofEmail } from "../html/render.js";
import type { BulletproofEmailInput, RenderedEmail } from "../html/types.js";

/**
 * Minimal shape of the Anthropic SDK client we depend on, so tests can inject
 * a fake and callers can pass a pre-configured `Anthropic` instance.
 */
export interface MessagesClient {
  messages: {
    create(body: unknown): Promise<{ content: Array<{ type: string; text?: string }> }>;
  };
}

export interface AiDrafterOptions {
  /** Pre-built Anthropic client. When omitted, one is created lazily from the SDK. */
  client?: MessagesClient;
  /** API key for the lazily-created client (falls back to ANTHROPIC_API_KEY). */
  apiKey?: string;
  /** Model id. Defaults to Claude Opus 5. */
  model?: string;
  /** Effort for the drafting call. Defaults to "low" (drafting is not reasoning-heavy). */
  effort?: "low" | "medium" | "high";
  maxTokens?: number;
}

export interface DraftRequest {
  /** What the email should say, in the user's words. */
  prompt: string;
  /** "plain" returns text only; "html" also renders bulletproof HTML. */
  format: "plain" | "html";
  /** Optional brand/sender display name shown in the rendered header and footer. */
  senderName?: string;
  footer?: BulletproofEmailInput["footer"];
  theme?: BulletproofEmailInput["theme"];
  /** Extra guidance appended to the system prompt (tone, length, audience). */
  guidance?: string;
}

export interface DraftResult {
  subject: string;
  /** Markdown-ish body the model produced (paragraphs, optional [Label](url) CTA line). */
  body: string;
  text: string;
  /** Present when `format` is "html". */
  html?: string;
}

const SYSTEM = [
  "You draft legitimate business and transactional emails for a sender who is authorised to contact the recipient.",
  "Write clear, honest, useful copy. Do not impersonate a real person or organisation you were not explicitly told to represent, and never write deceptive, misleading, or high-pressure scam content.",
  'Return ONLY a JSON object with exactly two string fields: "subject" (a concise, specific subject line, no clickbait) and "body".',
  "In the body, separate paragraphs with a blank line. You may use **bold**, *italic*, and [label](https://url) links. If a single call to action fits, put it on its own line as one [Button label](https://url).",
  "You may include {{name}} or other {{placeholder}} tokens where the sender will mail-merge each recipient's own details.",
].join(" ");

/**
 * AI drafting assistant used in the sending flow: turn a prompt into a
 * ready-to-send email, as plain text or bulletproof HTML. Returns the draft;
 * the caller reviews and edits before sending.
 */
export class AiDrafter {
  private readonly model: string;
  private readonly effort: "low" | "medium" | "high";
  private readonly maxTokens: number;
  private clientPromise: Promise<MessagesClient> | null = null;

  constructor(private readonly options: AiDrafterOptions = {}) {
    this.model = options.model ?? "claude-opus-5";
    this.effort = options.effort ?? "low";
    this.maxTokens = options.maxTokens ?? 2000;
    if (options.client) this.clientPromise = Promise.resolve(options.client);
  }

  private async client(): Promise<MessagesClient> {
    if (!this.clientPromise) {
      this.clientPromise = import("@anthropic-ai/sdk").then((mod) => {
        const Anthropic = mod.default;
        return new Anthropic(this.options.apiKey ? { apiKey: this.options.apiKey } : {}) as unknown as MessagesClient;
      });
    }
    return this.clientPromise;
  }

  async draft(request: DraftRequest): Promise<DraftResult> {
    if (!request.prompt.trim()) throw new Error("A prompt is required to draft an email");
    const client = await this.client();
    const system = request.guidance ? `${SYSTEM} Additional guidance: ${request.guidance}` : SYSTEM;
    const userContent =
      (request.format === "plain"
        ? "Write this as a plain-text email (the body will not be rendered as HTML). "
        : "The body will be rendered as an HTML email. ") + `Request: ${request.prompt}`;

    const response = await client.messages.create({
      model: this.model,
      max_tokens: this.maxTokens,
      output_config: { effort: this.effort },
      system,
      messages: [{ role: "user", content: userContent }],
    });

    const text = response.content.filter((b) => b.type === "text").map((b) => b.text ?? "").join("");
    const parsed = extractJson(text);
    const subject = String(parsed.subject ?? "").trim() || "(no subject)";
    const body = String(parsed.body ?? "").trim();

    return this.assemble(subject, body, request);
  }

  /** Build the final result, rendering HTML when requested. Exposed for reuse. */
  assemble(subject: string, body: string, request: Pick<DraftRequest, "format" | "senderName" | "footer" | "theme">): DraftResult {
    if (request.format === "plain") {
      const text = `${body}\n`;
      return { subject, body, text };
    }
    const input: BulletproofEmailInput = {
      preheader: subject,
      title: subject,
      blocks: blocksFromText(body),
      ...(request.senderName ? { header: { name: request.senderName } } : {}),
      ...(request.footer ? { footer: request.footer } : {}),
      ...(request.theme ? { theme: request.theme } : {}),
    };
    const rendered: RenderedEmail = renderBulletproofEmail(input);
    return { subject, body, text: rendered.text, html: rendered.html };
  }
}

/** Pull the first JSON object out of a model response, tolerating stray prose or code fences. */
export function extractJson(text: string): Record<string, unknown> {
  const trimmed = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  try {
    return JSON.parse(trimmed) as Record<string, unknown>;
  } catch {
    const start = trimmed.indexOf("{");
    const end = trimmed.lastIndexOf("}");
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(trimmed.slice(start, end + 1)) as Record<string, unknown>;
      } catch {
        /* fall through */
      }
    }
    throw new Error("AI response was not valid JSON");
  }
}
