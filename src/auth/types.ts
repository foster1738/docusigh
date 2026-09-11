export type UserRole = "admin" | "member";

/** Lifecycle: a signup is `pending` until an admin approves it. */
export type UserStatus = "pending" | "active" | "suspended";

export interface User {
  id: string;
  email: string;
  name?: string;
  role: UserRole;
  status: UserStatus;
  passwordHash: string;
  createdAt: Date;
  updatedAt: Date;
  approvedBy?: string;
  approvedAt?: Date;
  lastLoginAt?: Date;
}

/** The user without the password hash — safe to return from the service. */
export type PublicUser = Omit<User, "passwordHash">;

export interface Session {
  id: string;
  userId: string;
  /** SHA-256 of the raw token. The raw token is returned once, on creation, and never stored. */
  tokenHash: string;
  createdAt: Date;
  expiresAt: Date;
  lastSeenAt: Date;
  userAgent?: string;
  ip?: string;
}
