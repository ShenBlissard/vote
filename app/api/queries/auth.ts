import { randomBytes } from "node:crypto";
import { and, eq, gt } from "drizzle-orm";
import { getDb } from "./connection";
import { sessions, users, type User } from "@db/schema";

export const SESSION_COOKIE = "vote_session";
const SESSION_TTL_MS = 180 * 24 * 3600 * 1000; // 半年

// ---------- 登录失败锁定（内存记录，重启不强制保留） ----------

interface LockEntry {
  fails: number;
  lockUntil: number;
}
const lockMap = new Map<string, LockEntry>();

function lockKey(code: string, name: string): string {
  return `${code}::${name}`;
}

export function assertNotLocked(code: string, name: string): string | null {
  const e = lockMap.get(lockKey(code, name));
  if (e && e.lockUntil > Date.now()) {
    return "失败次数过多，请 10 分钟后再试";
  }
  return null;
}

function recordFail(code: string, name: string): void {
  const key = lockKey(code, name);
  const e = lockMap.get(key) ?? { fails: 0, lockUntil: 0 };
  e.fails += 1;
  if (e.fails >= 5) {
    e.lockUntil = Date.now() + 10 * 60 * 1000;
    e.fails = 0;
  }
  lockMap.set(key, e);
}

function clearFail(code: string, name: string): void {
  lockMap.delete(lockKey(code, name));
}

// ---------- 账号 ----------

export function validCode(code: string): boolean {
  return /^\d{4}$/.test(code);
}

export function validName(name: string): boolean {
  const n = name.trim();
  return n.length >= 1 && n.length <= 50;
}

export async function findUser(code: string, name: string): Promise<User | null> {
  const db = getDb();
  const [u] = await db
    .select()
    .from(users)
    .where(and(eq(users.code, code), eq(users.name, name)));
  return u ?? null;
}

export async function createUser(code: string, name: string): Promise<User> {
  const db = getDb();
  const u: typeof users.$inferInsert = {
    id: randomBytes(12).toString("hex"),
    code,
    name,
    createdAt: Date.now(),
  };
  await db.insert(users).values(u);
  return u as User;
}

// 导入名单时静默查/建账号（对发起人零感知）
export async function findOrCreateUser(code: string, name: string): Promise<User> {
  const existing = await findUser(code, name);
  if (existing) return existing;
  try {
    return await createUser(code, name);
  } catch {
    // 并发唯一键冲突时回读
    const again = await findUser(code, name);
    if (again) return again;
    throw new Error("创建账号失败");
  }
}

// ---------- 会话 ----------

export async function createSession(userId: string): Promise<string> {
  const db = getDb();
  const token = randomBytes(24).toString("hex");
  const now = Date.now();
  await db.insert(sessions).values({
    token,
    userId,
    createdAt: now,
    expiresAt: now + SESSION_TTL_MS,
  });
  return token;
}

export async function getUserBySession(token: string | null): Promise<User | null> {
  if (!token) return null;
  const db = getDb();
  const [row] = await db
    .select({ user: users })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(and(eq(sessions.token, token), gt(sessions.expiresAt, Date.now())));
  return row?.user ?? null;
}

export async function deleteSession(token: string | null): Promise<void> {
  if (!token) return;
  const db = getDb();
  await db.delete(sessions).where(eq(sessions.token, token));
}

export function sessionCookieHeader(token: string): string {
  const maxAge = Math.floor(SESSION_TTL_MS / 1000);
  return `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}`;
}

export function clearSessionCookieHeader(): string {
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
}

export function readSessionToken(req: Request): string | null {
  const raw = req.headers.get("cookie") ?? "";
  for (const part of raw.split(";")) {
    const [k, ...rest] = part.trim().split("=");
    if (k === SESSION_COOKIE) return rest.join("=") || null;
  }
  return null;
}

// ---------- 登录 / 注册 ----------

export type AuthResult =
  | { ok: true; user: User; token: string }
  | { ok: false; error: string };

export async function login(code: string, name: string): Promise<AuthResult> {
  const locked = assertNotLocked(code, name);
  if (locked) return { ok: false, error: locked };
  const user = await findUser(code, name);
  if (!user) {
    recordFail(code, name);
    const after = assertNotLocked(code, name);
    return {
      ok: false,
      error: after ?? "该账号不存在，请检查数字和姓名，或切换到注册",
    };
  }
  clearFail(code, name);
  const token = await createSession(user.id);
  return { ok: true, user, token };
}

export async function register(code: string, name: string): Promise<AuthResult> {
  const locked = assertNotLocked(code, name);
  if (locked) return { ok: false, error: locked };
  const existing = await findUser(code, name);
  if (existing) return { ok: false, error: "该账号已被注册，请直接登录" };
  const user = await createUser(code, name);
  clearFail(code, name);
  const token = await createSession(user.id);
  return { ok: true, user, token };
}
