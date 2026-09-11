import type { AuthStore } from "./store.js";
import type { Session, User, UserStatus } from "./types.js";

/** In-memory auth store for tests and single-process development. */
export class MemoryAuthStore implements AuthStore {
  private readonly users = new Map<string, User>();
  private readonly emailIndex = new Map<string, string>();
  private readonly sessions = new Map<string, Session>();
  private readonly tokenIndex = new Map<string, string>();

  async createUser(user: User): Promise<void> {
    const key = user.email.toLowerCase();
    if (this.emailIndex.has(key)) throw new Error("A user with that email already exists");
    this.users.set(user.id, clone(user));
    this.emailIndex.set(key, user.id);
  }

  async getUserById(id: string): Promise<User | null> {
    const u = this.users.get(id);
    return u ? clone(u) : null;
  }

  async getUserByEmail(email: string): Promise<User | null> {
    const id = this.emailIndex.get(email.toLowerCase());
    return id ? this.getUserById(id) : null;
  }

  async updateUser(user: User): Promise<void> {
    if (!this.users.has(user.id)) throw new Error(`User ${user.id} not found`);
    this.users.set(user.id, clone(user));
  }

  async listUsers(filter?: { status?: UserStatus }, limit = 200): Promise<User[]> {
    const out: User[] = [];
    for (const u of this.users.values()) {
      if (filter?.status && u.status !== filter.status) continue;
      out.push(clone(u));
      if (out.length >= limit) break;
    }
    return out.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  }

  async countUsers(): Promise<number> {
    return this.users.size;
  }

  async createSession(session: Session): Promise<void> {
    this.sessions.set(session.id, clone(session));
    this.tokenIndex.set(session.tokenHash, session.id);
  }

  async getSessionByTokenHash(tokenHash: string): Promise<Session | null> {
    const id = this.tokenIndex.get(tokenHash);
    const s = id ? this.sessions.get(id) : undefined;
    return s ? clone(s) : null;
  }

  async updateSession(session: Session): Promise<void> {
    this.sessions.set(session.id, clone(session));
    this.tokenIndex.set(session.tokenHash, session.id);
  }

  async deleteSession(id: string): Promise<void> {
    const s = this.sessions.get(id);
    if (s) this.tokenIndex.delete(s.tokenHash);
    this.sessions.delete(id);
  }

  async deleteSessionsForUser(userId: string): Promise<void> {
    for (const s of [...this.sessions.values()]) {
      if (s.userId === userId) await this.deleteSession(s.id);
    }
  }

  async deleteExpiredSessions(now: Date): Promise<number> {
    let n = 0;
    for (const s of [...this.sessions.values()]) {
      if (s.expiresAt.getTime() <= now.getTime()) {
        await this.deleteSession(s.id);
        n++;
      }
    }
    return n;
  }
}

function clone<T>(v: T): T {
  return structuredClone(v);
}
