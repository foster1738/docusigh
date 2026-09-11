import { isValidEmail } from "./validate.js";

export interface Recipient {
  email: string;
  name?: string;
  /** Extra columns from the file, available as mail-merge fields. */
  fields: Record<string, string>;
}

export interface ParseRecipientsResult {
  recipients: Recipient[];
  /** Rows that were skipped, with a reason (bad email, blank, duplicate). */
  skipped: { line: number; value: string; reason: string }[];
  /** Column headers detected (CSV only). */
  headers: string[];
}

export interface ParseOptions {
  /** Column name (case-insensitive) holding the address. Default: auto-detect "email". */
  emailColumn?: string;
  /** Column name holding the display name. Default: auto-detect "name". */
  nameColumn?: string;
  /** Drop repeated addresses, keeping the first. Default true. */
  dedupe?: boolean;
  /** Cap on recipients returned; extra rows are reported as skipped. */
  limit?: number;
}

/**
 * Parse a recipient list from CSV or TXT.
 *
 * - **CSV** with a header row: the `email` column (or `emailColumn`) is the
 *   address; every other column becomes a mail-merge field. Quoted fields and
 *   escaped quotes ("") are handled.
 * - **TXT**: one recipient per line, either `email` or `email,Display Name`
 *   or `Display Name <email>`. Lines starting with `#` are comments.
 *
 * Invalid addresses are skipped and reported, never sent. Detection between
 * the two formats is by extension when given, else by sniffing for a header.
 */
export function parseRecipients(content: string, format: "csv" | "txt" | "auto" = "auto", options: ParseOptions = {}): ParseRecipientsResult {
  const kind = format === "auto" ? sniffFormat(content) : format;
  return kind === "csv" ? parseCsv(content, options) : parseTxt(content, options);
}

function sniffFormat(content: string): "csv" | "txt" {
  const firstLine = content.replace(/^﻿/, "").split(/\r?\n/, 1)[0] ?? "";
  // A header row with a comma and no "@" in the first line looks like CSV.
  if (firstLine.includes(",") && !firstLine.includes("@")) return "csv";
  return "txt";
}

function parseTxt(content: string, options: ParseOptions): ParseRecipientsResult {
  const dedupe = options.dedupe !== false;
  const recipients: Recipient[] = [];
  const skipped: ParseRecipientsResult["skipped"] = [];
  const seen = new Set<string>();
  const lines = content.replace(/^﻿/, "").split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!.trim();
    if (!line || line.startsWith("#")) continue;
    const parsed = parseAddressLine(line);
    if (!parsed) {
      skipped.push({ line: i + 1, value: line, reason: "no valid email" });
      continue;
    }
    if (options.limit !== undefined && recipients.length >= options.limit) {
      skipped.push({ line: i + 1, value: line, reason: "over limit" });
      continue;
    }
    const key = parsed.email.toLowerCase();
    if (dedupe && seen.has(key)) {
      skipped.push({ line: i + 1, value: line, reason: "duplicate" });
      continue;
    }
    seen.add(key);
    recipients.push(parsed);
  }
  return { recipients, skipped, headers: [] };
}

/** Accepts `email`, `email,Name`, `Name <email>`, or `email;Name`. */
function parseAddressLine(line: string): Recipient | null {
  const angled = line.match(/^(.*)<([^>]+)>\s*$/);
  if (angled) {
    const email = angled[2]!.trim();
    const name = angled[1]!.trim().replace(/^["']|["']$/g, "");
    if (!isValidEmail(email)) return null;
    return name ? { email: email.toLowerCase(), name, fields: {} } : { email: email.toLowerCase(), fields: {} };
  }
  const parts = line.split(/[,;\t]/).map((p) => p.trim());
  const email = parts.find((p) => isValidEmail(p));
  if (!email) return null;
  const name = parts.find((p) => p && p !== email && !isValidEmail(p));
  return name ? { email: email.toLowerCase(), name, fields: {} } : { email: email.toLowerCase(), fields: {} };
}

function parseCsv(content: string, options: ParseOptions): ParseRecipientsResult {
  const rows = parseCsvRows(content.replace(/^﻿/, ""));
  const skipped: ParseRecipientsResult["skipped"] = [];
  if (rows.length === 0) return { recipients: [], skipped, headers: [] };
  const headers = rows[0]!.map((h) => h.trim());
  const lower = headers.map((h) => h.toLowerCase());
  const emailIdx = options.emailColumn
    ? lower.indexOf(options.emailColumn.toLowerCase())
    : lower.findIndex((h) => h === "email" || h === "e-mail" || h === "email address");
  const nameIdx = options.nameColumn
    ? lower.indexOf(options.nameColumn.toLowerCase())
    : lower.findIndex((h) => h === "name" || h === "full name" || h === "fullname");

  if (emailIdx < 0) {
    // No usable email column: treat the whole thing as a TXT list instead.
    return parseTxt(content, options);
  }

  const dedupe = options.dedupe !== false;
  const seen = new Set<string>();
  const recipients: Recipient[] = [];
  for (let r = 1; r < rows.length; r++) {
    const cols = rows[r]!;
    if (cols.length === 1 && cols[0]!.trim() === "") continue;
    const email = (cols[emailIdx] ?? "").trim().toLowerCase();
    if (!isValidEmail(email)) {
      skipped.push({ line: r + 1, value: cols.join(","), reason: "invalid or missing email" });
      continue;
    }
    if (options.limit !== undefined && recipients.length >= options.limit) {
      skipped.push({ line: r + 1, value: email, reason: "over limit" });
      continue;
    }
    if (dedupe && seen.has(email)) {
      skipped.push({ line: r + 1, value: email, reason: "duplicate" });
      continue;
    }
    seen.add(email);
    const fields: Record<string, string> = {};
    for (let c = 0; c < headers.length; c++) {
      const key = headers[c];
      if (!key || c === emailIdx) continue;
      fields[key] = (cols[c] ?? "").trim();
    }
    const name = nameIdx >= 0 ? (cols[nameIdx] ?? "").trim() : "";
    recipients.push(name ? { email, name, fields } : { email, fields });
  }
  return { recipients, skipped, headers };
}

/** Minimal RFC-4180 CSV reader: quoted fields, escaped quotes, CRLF or LF. */
export function parseCsvRows(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else field += ch;
      continue;
    }
    if (ch === '"') inQuotes = true;
    else if (ch === ",") { row.push(field); field = ""; }
    else if (ch === "\n") { row.push(field); rows.push(row); row = []; field = ""; }
    else if (ch === "\r") { /* handled by \n */ }
    else field += ch;
  }
  if (field.length > 0 || row.length > 0) { row.push(field); rows.push(row); }
  return rows;
}
