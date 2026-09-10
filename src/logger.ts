export type LogLevel = "debug" | "info" | "warn" | "error";

export interface Logger {
  debug(msg: string, fields?: Record<string, unknown>): void;
  info(msg: string, fields?: Record<string, unknown>): void;
  warn(msg: string, fields?: Record<string, unknown>): void;
  error(msg: string, fields?: Record<string, unknown>): void;
}

export const silentLogger: Logger = {
  debug() {},
  info() {},
  warn() {},
  error() {},
};

/** Structured JSON-lines logger writing to stdout/stderr. */
export function consoleLogger(minLevel: LogLevel = "info"): Logger {
  const order: LogLevel[] = ["debug", "info", "warn", "error"];
  const min = order.indexOf(minLevel);
  const emit = (level: LogLevel, msg: string, fields?: Record<string, unknown>) => {
    if (order.indexOf(level) < min) return;
    const line = JSON.stringify({ ts: new Date().toISOString(), level, msg, ...redact(fields) });
    if (level === "error" || level === "warn") process.stderr.write(`${line}\n`);
    else process.stdout.write(`${line}\n`);
  };
  return {
    debug: (m, f) => emit("debug", m, f),
    info: (m, f) => emit("info", m, f),
    warn: (m, f) => emit("warn", m, f),
    error: (m, f) => emit("error", m, f),
  };
}

const SECRET_KEYS = /(api[-_]?key|token|password|secret|authorization)/i;

/** Never log credentials, even by accident. */
export function redact(fields?: Record<string, unknown>): Record<string, unknown> {
  if (!fields) return {};
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(fields)) {
    out[k] = SECRET_KEYS.test(k) ? "[redacted]" : v;
  }
  return out;
}
