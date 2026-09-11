import { createHash, randomBytes, randomUUID } from "node:crypto";
import { ScryptHasher, type PasswordHasher } from "./password.js";
import type { AuthStore } from "./store.js";
import { isValidEmail } from "../validate.js";
import type { PublicUser, Session, User, UserRole } from "./types.js";

export class AuthError extends Error {
  constructor(
    message: string,
    readonly code:
      | "invalid_credentials"
      | "email_taken"
      | "not_found"
      | "not_approved"
      | "suspended"
      | "forbidden"
      | "invalid_email"
      | "weak_password"
      | "session_expired"
      | "session_invalid",
  ) {
    super(message);
    this.name = "AuthError";
  }
}

export interface AuthServiceOptions {
  store: AuthStore;
  hasher?: PasswordHasher;
  /** Session lifetime in ms. Default 7 days. */
  sessionTtlMs?: number;
  /**
   * When true (default), the very first user created via `signup` becomes an
   * active admin instead of a pending member, so a fresh install has an owner
   * without hardcoding credentials. Set false if you bootstrap admins another way.
   */
  firstUserIsAdmin?: boolean;
  now?: () => Date;
  idGenerator?: () => string;
}

export interface SignupInput {
  email: string;
  password: string;
  name?: string;
}

export interface LoginResult {
  user: PublicUser;
  /** The raw session token. Returned once; store only its hash server-side. */
  token: string;
  expiresAt: Date;
}

/**
 * User and admin model: signup, admin approval, roles, and sessions.
 *
 * - Passwords are hashed with the injected `PasswordHasher` (scrypt by
 *   default); the plaintext is never stored or logged.
 * - New signups start `pending` and cannot log in until an admin approves them
 *   (except the first user, which bootstraps as an active admin).
 * - Sessions are opaque random tokens; only the SHA-256 of the token is
 *   stored, so a database leak does not expose usable session tokens.
 * - No secrets are baked into the code. Provide admin credentials at runtime.
 */
export class AuthService {
  private readonly store: AuthStore;
  private readonly hasher: PasswordHasher;
  private readonly sessionTtlMs: number;
  private readonly firstUserIsAdmin: boolean;
  private readonly now: () => Date;
  private readonly id: () => string;

  constructor(options: AuthServiceOptions) {
    this.store = options.store;
    this.hasher = options.hasher ?? new ScryptHasher();
    this.sessionTtlMs = options.sessionTtlMs ?? 7 * 24 * 60 * 60 * 1000;
    this.firstUserIsAdmin = options.firstUserIsAdmin !== false;
    this.now = options.now ?? (() => new Date());
    this.id = options.idGenerator ?? randomUUID;
  }

  /** Register a new user. Returns the pending (or bootstrapped-admin) account. */
  async signup(input: SignupInput): Promise<PublicUser> {
    const email = input.email.trim().toLowerCase();
    if (!isValidEmail(email)) throw new AuthError("Invalid email address", "invalid_email");
    if (await this.store.getUserByEmail(email)) throw new AuthError("That email is already registered", "email_taken");
    const passwordHash = await this.hashOrThrow(input.password);
    const isFirst = (await this.store.countUsers()) === 0 && this.firstUserIsAdmin;
    const now = this.now();
    const user: User = {
      id: this.id(),
      email,
      ...(input.name ? { name: input.name.trim() } : {}),
      role: isFirst ? "admin" : "member",
      status: isFirst ? "active" : "pending",
      passwordHash,
      createdAt: now,
      updatedAt: now,
    };
    await this.store.createUser(user);
    return toPublic(user);
  }

  /**
   * Create an active admin directly (for provisioning the first admin from a
   * setup script or env vars). Never call this with credentials committed to
   * source control.
   */
  async bootstrapAdmin(email: string, password: string, name?: string): Promise<PublicUser> {
    const normalized = email.trim().toLowerCase();
    if (!isValidEmail(normalized)) throw new AuthError("Invalid email address", "invalid_email");
    const existing = await this.store.getUserByEmail(normalized);
    const passwordHash = await this.hashOrThrow(password);
    const now = this.now();
    if (existing) {
      const updated: User = { ...existing, role: "admin", status: "active", passwordHash, updatedAt: now, ...(name ? { name } : {}) };
      await this.store.updateUser(updated);
      return toPublic(updated);
    }
    const user: User = {
      id: this.id(),
      email: normalized,
      ...(name ? { name } : {}),
      role: "admin",
      status: "active",
      passwordHash,
      createdAt: now,
      updatedAt: now,
    };
    await this.store.createUser(user);
    return toPublic(user);
  }

  async login(email: string, password: string, meta?: { userAgent?: string; ip?: string }): Promise<LoginResult> {
    const user = await this.store.getUserByEmail(email.trim().toLowerCase());
    // Verify against a real-looking hash even when the user is missing, to keep
    // timing uniform and avoid leaking which emails exist.
    const ok = await this.hasher.verify(password, user?.passwordHash ?? DUMMY_HASH);
    if (!user || !ok) throw new AuthError("Incorrect email or password", "invalid_credentials");
    if (user.status === "pending") throw new AuthError("Your account is awaiting admin approval", "not_approved");
    if (user.status === "suspended") throw new AuthError("Your account is suspended", "suspended");

    const now = this.now();
    const token = randomBytes(32).toString("base64url");
    const session: Session = {
      id: this.id(),
      userId: user.id,
      tokenHash: hashToken(token),
      createdAt: now,
      expiresAt: new Date(now.getTime() + this.sessionTtlMs),
      lastSeenAt: now,
      ...(meta?.userAgent ? { userAgent: meta.userAgent } : {}),
      ...(meta?.ip ? { ip: meta.ip } : {}),
    };
    await this.store.createSession(session);
    await this.store.updateUser({ ...user, lastLoginAt: now, updatedAt: now });
    return { user: toPublic({ ...user, lastLoginAt: now }), token, expiresAt: session.expiresAt };
  }

  /** Resolve a raw session token to its user, sliding the last-seen timestamp. */
  async authenticate(token: string): Promise<PublicUser> {
    const session = await this.store.getSessionByTokenHash(hashToken(token));
    if (!session) throw new AuthError("Not signed in", "session_invalid");
    const now = this.now();
    if (session.expiresAt.getTime() <= now.getTime()) {
      await this.store.deleteSession(session.id);
      throw new AuthError("Session expired", "session_expired");
    }
    const user = await this.store.getUserById(session.userId);
    if (!user || user.status !== "active") {
      await this.store.deleteSession(session.id);
      throw new AuthError("Not signed in", "session_invalid");
    }
    if (now.getTime() - session.lastSeenAt.getTime() > 60_000) {
      await this.store.updateSession({ ...session, lastSeenAt: now });
    }
    return toPublic(user);
  }

  async logout(token: string): Promise<void> {
    const session = await this.store.getSessionByTokenHash(hashToken(token));
    if (session) await this.store.deleteSession(session.id);
  }

  // --- Admin actions -------------------------------------------------------

  async listPending(actor: PublicUser, limit?: number): Promise<PublicUser[]> {
    this.requireAdmin(actor);
    return (await this.store.listUsers({ status: "pending" }, limit)).map(toPublic);
  }

  async listUsers(actor: PublicUser, limit?: number): Promise<PublicUser[]> {
    this.requireAdmin(actor);
    return (await this.store.listUsers(undefined, limit)).map(toPublic);
  }

  async approveUser(actor: PublicUser, userId: string): Promise<PublicUser> {
    this.requireAdmin(actor);
    const user = await this.mustGet(userId);
    const now = this.now();
    const updated: User = { ...user, status: "active", approvedBy: actor.id, approvedAt: now, updatedAt: now };
    await this.store.updateUser(updated);
    return toPublic(updated);
  }

  async suspendUser(actor: PublicUser, userId: string): Promise<PublicUser> {
    this.requireAdmin(actor);
    if (actor.id === userId) throw new AuthError("You cannot suspend yourself", "forbidden");
    const user = await this.mustGet(userId);
    const updated: User = { ...user, status: "suspended", updatedAt: this.now() };
    await this.store.updateUser(updated);
    await this.store.deleteSessionsForUser(userId);
    return toPublic(updated);
  }

  async setRole(actor: PublicUser, userId: string, role: UserRole): Promise<PublicUser> {
    this.requireAdmin(actor);
    const user = await this.mustGet(userId);
    const updated: User = { ...user, role, updatedAt: this.now() };
    await this.store.updateUser(updated);
    return toPublic(updated);
  }

  private requireAdmin(actor: PublicUser): void {
    if (actor.role !== "admin" || actor.status !== "active") {
      throw new AuthError("Admin access required", "forbidden");
    }
  }

  private async mustGet(userId: string): Promise<User> {
    const user = await this.store.getUserById(userId);
    if (!user) throw new AuthError("User not found", "not_found");
    return user;
  }

  private async hashOrThrow(password: string): Promise<string> {
    try {
      return await this.hasher.hash(password);
    } catch (err) {
      throw new AuthError(err instanceof Error ? err.message : "Weak password", "weak_password");
    }
  }
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function toPublic(user: User): PublicUser {
  const { passwordHash: _omit, ...rest } = user;
  return rest;
}

// A fixed scrypt hash of a random value, used only to equalise login timing
// for unknown emails. Never matches a real password.
const DUMMY_HASH = "scrypt$32768$8$1$AAAAAAAAAAAAAAAAAAAAAA==$" + "A".repeat(88);
