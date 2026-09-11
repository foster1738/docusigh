import { escapeHtml } from "./html/escape.js";
import type { Recipient } from "./recipients.js";

/**
 * Mail-merge: substitute `{{field}}` placeholders with each recipient's own
 * data — their name, and any columns supplied in the recipient file (order
 * number, renewal date, etc.). This is personalisation from the list you
 * provide; it does not invent or randomise values.
 *
 * `{{email}}` and `{{name}}` are always available; everything else comes from
 * the recipient's `fields`. Missing placeholders resolve to an empty string
 * unless `strict` is set, which throws instead.
 *
 * In an HTML context every merged value is HTML-escaped, so a value containing
 * `<` or `&` cannot break the markup or inject tags.
 */
export interface MergeContext {
  recipient: Recipient;
  /** Extra values available to every recipient (campaign-level). */
  globals?: Record<string, string>;
}

export interface MergeOptions {
  /** Escape substituted values for HTML. Set true for html bodies/subjects that render as HTML. */
  html?: boolean;
  /** Throw on an unknown placeholder instead of substituting "". */
  strict?: boolean;
}

const PLACEHOLDER = /\{\{\s*([a-zA-Z0-9_.-]+)\s*\}\}/g;

export function mergeString(template: string, context: MergeContext, options: MergeOptions = {}): string {
  const values = mergeValues(context);
  return template.replace(PLACEHOLDER, (_m, key: string) => {
    const has = Object.prototype.hasOwnProperty.call(values, key);
    if (!has) {
      if (options.strict) throw new Error(`Unknown merge field "${key}"`);
      return "";
    }
    const value = values[key] ?? "";
    return options.html ? escapeHtml(value) : value;
  });
}

/** List placeholders used by a template, for validating a list before a send. */
export function extractPlaceholders(template: string): string[] {
  const out = new Set<string>();
  let m: RegExpExecArray | null;
  PLACEHOLDER.lastIndex = 0;
  while ((m = PLACEHOLDER.exec(template)) !== null) out.add(m[1]!);
  return [...out];
}

function mergeValues(context: MergeContext): Record<string, string> {
  const r = context.recipient;
  return {
    ...(context.globals ?? {}),
    ...r.fields,
    email: r.email,
    name: r.name ?? r.fields["name"] ?? "",
  };
}
