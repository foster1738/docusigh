import { classifyHttpStatus, EmailError, toEmailError } from "../errors.js";

export interface HttpJsonOptions {
  provider: string;
  url: string;
  method?: "POST" | "GET";
  headers: Record<string, string>;
  body?: unknown;
  signal: AbortSignal;
  /** Overrides global fetch; used by tests. */
  fetchImpl?: typeof fetch;
}

/**
 * POST JSON to a provider and classify the response. Every provider adapter
 * goes through here so timeouts, network errors and HTTP statuses map to the
 * same `EmailError` codes.
 */
export async function httpJson<T = unknown>(options: HttpJsonOptions): Promise<T> {
  const fetchImpl = options.fetchImpl ?? fetch;
  let res: Response;
  try {
    res = await fetchImpl(options.url, {
      method: options.method ?? "POST",
      headers: { "content-type": "application/json", accept: "application/json", ...options.headers },
      ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
      signal: options.signal,
    });
  } catch (err) {
    throw toEmailError(err, options.provider);
  }

  const text = await res.text().catch(() => "");
  if (!res.ok) {
    throw classifyHttpStatus(options.provider, res.status, text, res.headers.get("retry-after"));
  }
  if (!text) return {} as T;
  try {
    return JSON.parse(text) as T;
  } catch (err) {
    throw new EmailError(`${options.provider} returned a non-JSON success response`, {
      code: "UNKNOWN",
      retryable: true,
      provider: options.provider,
      cause: err,
    });
  }
}

export function toBase64(content: Uint8Array | string, encoding?: "base64"): string {
  if (typeof content === "string") return encoding === "base64" ? content : Buffer.from(content, "utf8").toString("base64");
  return Buffer.from(content).toString("base64");
}
