import { randomBytes, scrypt, timingSafeEqual, type ScryptOptions } from "node:crypto";

function scryptAsync(password: string, salt: Buffer, keyLen: number, opts: ScryptOptions): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, keyLen, opts, (err, derived) => (err ? reject(err) : resolve(derived as Buffer)));
  });
}

/**
 * Password hashing abstraction. The default is scrypt (memory-hard, built into
 * Node, no native dependency, and on OWASP's recommended list). To use argon2
 * or bcrypt instead, implement this interface over `@node-rs/argon2` or
 * `bcrypt` and pass it to `AuthService`.
 */
export interface PasswordHasher {
  hash(password: string): Promise<string>;
  verify(password: string, stored: string): Promise<boolean>;
}

export interface ScryptParams {
  /** CPU/memory cost. Must be a power of two. Default 2^15. */
  N?: number;
  r?: number;
  p?: number;
  keyLen?: number;
  saltBytes?: number;
}

/**
 * scrypt hasher. Stored format: `scrypt$N$r$p$<saltB64>$<hashB64>`, so the
 * verification cost parameters travel with the hash and can be raised over
 * time without invalidating existing hashes.
 */
export class ScryptHasher implements PasswordHasher {
  private readonly N: number;
  private readonly r: number;
  private readonly p: number;
  private readonly keyLen: number;
  private readonly saltBytes: number;

  constructor(params: ScryptParams = {}) {
    this.N = params.N ?? 32768;
    this.r = params.r ?? 8;
    this.p = params.p ?? 1;
    this.keyLen = params.keyLen ?? 64;
    this.saltBytes = params.saltBytes ?? 16;
  }

  async hash(password: string): Promise<string> {
    assertPasswordLength(password);
    const salt = randomBytes(this.saltBytes);
    const key = await scryptAsync(password.normalize("NFKC"), salt, this.keyLen, this.scryptOpts());
    return `scrypt$${this.N}$${this.r}$${this.p}$${salt.toString("base64")}$${key.toString("base64")}`;
  }

  async verify(password: string, stored: string): Promise<boolean> {
    const parts = stored.split("$");
    if (parts.length !== 6 || parts[0] !== "scrypt") return false;
    const N = Number(parts[1]);
    const r = Number(parts[2]);
    const p = Number(parts[3]);
    const salt = Buffer.from(parts[4]!, "base64");
    const expected = Buffer.from(parts[5]!, "base64");
    if (!Number.isInteger(N) || !Number.isInteger(r) || !Number.isInteger(p)) return false;
    let derived: Buffer;
    try {
      derived = await scryptAsync(password.normalize("NFKC"), salt, expected.length, { N, r, p, maxmem: 256 * 1024 * 1024 });
    } catch {
      return false;
    }
    return derived.length === expected.length && timingSafeEqual(derived, expected);
  }

  private scryptOpts() {
    return { N: this.N, r: this.r, p: this.p, maxmem: 256 * 1024 * 1024 };
  }
}

function assertPasswordLength(password: string): void {
  if (password.length < 8) throw new Error("Password must be at least 8 characters");
  if (password.length > 1024) throw new Error("Password is too long");
}
