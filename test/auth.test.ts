import { describe, expect, it } from "vitest";
import { AuthError, AuthService, MemoryAuthStore, ScryptHasher } from "../src/index.js";

// Cheap scrypt params keep the test fast.
const hasher = new ScryptHasher({ N: 1024 });
function service() {
  return new AuthService({ store: new MemoryAuthStore(), hasher });
}

describe("ScryptHasher", () => {
  it("hashes and verifies, and rejects wrong passwords", async () => {
    const h = await hasher.hash("correct horse battery staple");
    expect(h.startsWith("scrypt$")).toBe(true);
    expect(await hasher.verify("correct horse battery staple", h)).toBe(true);
    expect(await hasher.verify("wrong", h)).toBe(false);
  });

  it("rejects short passwords", async () => {
    await expect(hasher.hash("short")).rejects.toThrow(/at least 8/);
  });

  it("produces distinct hashes for the same password (random salt)", async () => {
    expect(await hasher.hash("password123")).not.toBe(await hasher.hash("password123"));
  });
});

describe("AuthService", () => {
  it("makes the first signup an active admin and later signups pending members", async () => {
    const auth = service();
    const admin = await auth.signup({ email: "boss@x.com", password: "password123", name: "Boss" });
    expect(admin).toMatchObject({ role: "admin", status: "active" });
    const member = await auth.signup({ email: "new@x.com", password: "password123" });
    expect(member).toMatchObject({ role: "member", status: "pending" });
  });

  it("blocks pending users from logging in until approved", async () => {
    const auth = service();
    await auth.signup({ email: "boss@x.com", password: "password123" });
    const admin = (await auth.login("boss@x.com", "password123")).user;
    await auth.signup({ email: "pending@x.com", password: "password123" });

    await expect(auth.login("pending@x.com", "password123")).rejects.toMatchObject({ code: "not_approved" });

    const pending = await auth.listPending(admin);
    expect(pending.map((u) => u.email)).toContain("pending@x.com");
    await auth.approveUser(admin, pending[0]!.id);
    const ok = await auth.login("pending@x.com", "password123");
    expect(ok.user.status).toBe("active");
  });

  it("rejects bad credentials without leaking whether the email exists", async () => {
    const auth = service();
    await auth.signup({ email: "boss@x.com", password: "password123" });
    await expect(auth.login("boss@x.com", "wrong")).rejects.toMatchObject({ code: "invalid_credentials" });
    await expect(auth.login("ghost@x.com", "whatever1")).rejects.toMatchObject({ code: "invalid_credentials" });
  });

  it("issues sessions that authenticate and expire", async () => {
    let t = Date.parse("2026-01-01T00:00:00Z");
    const auth = new AuthService({ store: new MemoryAuthStore(), hasher, sessionTtlMs: 1000, now: () => new Date(t) });
    await auth.signup({ email: "boss@x.com", password: "password123" });
    const { token } = await auth.login("boss@x.com", "password123");
    expect((await auth.authenticate(token)).email).toBe("boss@x.com");
    t += 1001;
    await expect(auth.authenticate(token)).rejects.toMatchObject({ code: "session_expired" });
  });

  it("logout invalidates the session", async () => {
    const auth = service();
    await auth.signup({ email: "boss@x.com", password: "password123" });
    const { token } = await auth.login("boss@x.com", "password123");
    await auth.logout(token);
    await expect(auth.authenticate(token)).rejects.toMatchObject({ code: "session_invalid" });
  });

  it("enforces admin-only actions", async () => {
    const auth = service();
    await auth.signup({ email: "boss@x.com", password: "password123" }); // admin
    const admin = (await auth.login("boss@x.com", "password123")).user;
    await auth.signup({ email: "m@x.com", password: "password123" });
    const m = (await auth.listPending(admin))[0]!;
    await auth.approveUser(admin, m.id);
    const member = (await auth.login("m@x.com", "password123")).user;
    await expect(auth.listPending(member)).rejects.toMatchObject({ code: "forbidden" });
    await expect(auth.approveUser(member, admin.id)).rejects.toMatchObject({ code: "forbidden" });
  });

  it("suspends users and kills their sessions", async () => {
    const auth = service();
    await auth.signup({ email: "boss@x.com", password: "password123" });
    const admin = (await auth.login("boss@x.com", "password123")).user;
    await auth.signup({ email: "m@x.com", password: "password123" });
    const m = (await auth.listPending(admin))[0]!;
    await auth.approveUser(admin, m.id);
    const { token } = await auth.login("m@x.com", "password123");
    await auth.suspendUser(admin, m.id);
    await expect(auth.authenticate(token)).rejects.toBeInstanceOf(AuthError);
    await expect(auth.login("m@x.com", "password123")).rejects.toMatchObject({ code: "suspended" });
  });

  it("rejects duplicate email and invalid email at signup", async () => {
    const auth = service();
    await auth.signup({ email: "boss@x.com", password: "password123" });
    await expect(auth.signup({ email: "boss@x.com", password: "password123" })).rejects.toMatchObject({ code: "email_taken" });
    await expect(auth.signup({ email: "nope", password: "password123" })).rejects.toMatchObject({ code: "invalid_email" });
  });

  it("bootstrapAdmin provisions an active admin without hardcoded secrets", async () => {
    const auth = service();
    const admin = await auth.bootstrapAdmin("owner@x.com", "password123", "Owner");
    expect(admin).toMatchObject({ role: "admin", status: "active" });
    expect((await auth.login("owner@x.com", "password123")).user.email).toBe("owner@x.com");
  });
});
