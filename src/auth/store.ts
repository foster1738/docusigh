import type { Session, User, UserStatus } from "./types.js";

/** Persistence for users and sessions. Implement over your database of choice. */
export interface AuthStore {
  createUser(user: User): Promise<void>;
  getUserById(id: string): Promise<User | null>;
  getUserByEmail(email: string): Promise<User | null>;
  updateUser(user: User): Promise<void>;
  listUsers(filter?: { status?: UserStatus }, limit?: number): Promise<User[]>;
  countUsers(): Promise<number>;

  createSession(session: Session): Promise<void>;
  getSessionByTokenHash(tokenHash: string): Promise<Session | null>;
  updateSession(session: Session): Promise<void>;
  deleteSession(id: string): Promise<void>;
  deleteSessionsForUser(userId: string): Promise<void>;
  deleteExpiredSessions(now: Date): Promise<number>;
}
