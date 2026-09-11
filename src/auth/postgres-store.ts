import type { PgQueryable } from "../store/postgres.js";
import type { AuthStore } from "./store.js";
import type { Session, User, UserRole, UserStatus } from "./types.js";

interface UserRow {
  id: string;
  email: string;
  name: string | null;
  role: UserRole;
  status: UserStatus;
  password_hash: string;
  created_at: Date;
  updated_at: Date;
  approved_by: string | null;
  approved_at: Date | null;
  last_login_at: Date | null;
}

interface SessionRow {
  id: string;
  user_id: string;
  token_hash: string;
  created_at: Date;
  expires_at: Date;
  last_seen_at: Date;
  user_agent: string | null;
  ip: string | null;
}

/** Postgres-backed auth store. Schema: `schema.sql` next to this file. */
export class PostgresAuthStore implements AuthStore {
  constructor(
    private readonly db: PgQueryable,
    private readonly usersTable = "auth_users",
    private readonly sessionsTable = "auth_sessions",
  ) {}

  async createUser(user: User): Promise<void> {
    await this.db.query(
      `INSERT INTO ${this.usersTable}
         (id, email, name, role, status, password_hash, created_at, updated_at, approved_by, approved_at, last_login_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
      [user.id, user.email, user.name ?? null, user.role, user.status, user.passwordHash, user.createdAt, user.updatedAt,
        user.approvedBy ?? null, user.approvedAt ?? null, user.lastLoginAt ?? null],
    );
  }

  async getUserById(id: string): Promise<User | null> {
    const res = await this.db.query(`SELECT * FROM ${this.usersTable} WHERE id = $1`, [id]);
    const row = res.rows[0] as UserRow | undefined;
    return row ? userFromRow(row) : null;
  }

  async getUserByEmail(email: string): Promise<User | null> {
    const res = await this.db.query(`SELECT * FROM ${this.usersTable} WHERE email = $1`, [email.toLowerCase()]);
    const row = res.rows[0] as UserRow | undefined;
    return row ? userFromRow(row) : null;
  }

  async updateUser(user: User): Promise<void> {
    await this.db.query(
      `UPDATE ${this.usersTable} SET email=$2, name=$3, role=$4, status=$5, password_hash=$6,
         updated_at=$7, approved_by=$8, approved_at=$9, last_login_at=$10 WHERE id=$1`,
      [user.id, user.email, user.name ?? null, user.role, user.status, user.passwordHash, user.updatedAt,
        user.approvedBy ?? null, user.approvedAt ?? null, user.lastLoginAt ?? null],
    );
  }

  async listUsers(filter?: { status?: UserStatus }, limit = 200): Promise<User[]> {
    const res = filter?.status
      ? await this.db.query(`SELECT * FROM ${this.usersTable} WHERE status = $1 ORDER BY created_at LIMIT $2`, [filter.status, limit])
      : await this.db.query(`SELECT * FROM ${this.usersTable} ORDER BY created_at LIMIT $1`, [limit]);
    return (res.rows as unknown as UserRow[]).map(userFromRow);
  }

  async countUsers(): Promise<number> {
    const res = await this.db.query(`SELECT count(*)::int AS n FROM ${this.usersTable}`);
    return (res.rows[0] as { n: number } | undefined)?.n ?? 0;
  }

  async createSession(session: Session): Promise<void> {
    await this.db.query(
      `INSERT INTO ${this.sessionsTable}
         (id, user_id, token_hash, created_at, expires_at, last_seen_at, user_agent, ip)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [session.id, session.userId, session.tokenHash, session.createdAt, session.expiresAt, session.lastSeenAt,
        session.userAgent ?? null, session.ip ?? null],
    );
  }

  async getSessionByTokenHash(tokenHash: string): Promise<Session | null> {
    const res = await this.db.query(`SELECT * FROM ${this.sessionsTable} WHERE token_hash = $1`, [tokenHash]);
    const row = res.rows[0] as SessionRow | undefined;
    return row ? sessionFromRow(row) : null;
  }

  async updateSession(session: Session): Promise<void> {
    await this.db.query(
      `UPDATE ${this.sessionsTable} SET last_seen_at=$2, expires_at=$3 WHERE id=$1`,
      [session.id, session.lastSeenAt, session.expiresAt],
    );
  }

  async deleteSession(id: string): Promise<void> {
    await this.db.query(`DELETE FROM ${this.sessionsTable} WHERE id = $1`, [id]);
  }

  async deleteSessionsForUser(userId: string): Promise<void> {
    await this.db.query(`DELETE FROM ${this.sessionsTable} WHERE user_id = $1`, [userId]);
  }

  async deleteExpiredSessions(now: Date): Promise<number> {
    const res = await this.db.query(`DELETE FROM ${this.sessionsTable} WHERE expires_at <= $1`, [now]);
    return res.rowCount ?? 0;
  }
}

function userFromRow(row: UserRow): User {
  return {
    id: row.id,
    email: row.email,
    ...(row.name !== null ? { name: row.name } : {}),
    role: row.role,
    status: row.status,
    passwordHash: row.password_hash,
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
    ...(row.approved_by !== null ? { approvedBy: row.approved_by } : {}),
    ...(row.approved_at !== null ? { approvedAt: new Date(row.approved_at) } : {}),
    ...(row.last_login_at !== null ? { lastLoginAt: new Date(row.last_login_at) } : {}),
  };
}

function sessionFromRow(row: SessionRow): Session {
  return {
    id: row.id,
    userId: row.user_id,
    tokenHash: row.token_hash,
    createdAt: new Date(row.created_at),
    expiresAt: new Date(row.expires_at),
    lastSeenAt: new Date(row.last_seen_at),
    ...(row.user_agent !== null ? { userAgent: row.user_agent } : {}),
    ...(row.ip !== null ? { ip: row.ip } : {}),
  };
}
