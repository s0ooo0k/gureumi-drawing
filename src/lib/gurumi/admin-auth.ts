import "server-only";

import { createHash, createHmac, timingSafeEqual } from "node:crypto";

import { cookies, headers } from "next/headers";

const ADMIN_COOKIE_NAME = "ausgcon_gurumi_admin";
const ADMIN_COOKIE_MAX_AGE = 12 * 60 * 60;
const LOGIN_WINDOW_MS = 10 * 60 * 1_000;
const LOGIN_ATTEMPT_LIMIT = 10;

type LoginLimitEntry = {
  count: number;
  resetAt: number;
};

type GurumiAdminGlobal = typeof globalThis & {
  __ausgconGurumiAdminLoginLimits?: Map<string, LoginLimitEntry>;
};

const adminGlobal = globalThis as GurumiAdminGlobal;
const loginLimits = adminGlobal.__ausgconGurumiAdminLoginLimits ?? new Map<string, LoginLimitEntry>();
adminGlobal.__ausgconGurumiAdminLoginLimits = loginLimits;

function configuredPassword() {
  const password = process.env.GURUMI_ADMIN_PASSWORD;
  return password && password.length > 0 ? password : null;
}

function digest(value: string) {
  return createHash("sha256").update(value).digest();
}

function safeEqual(first: string, second: string) {
  return timingSafeEqual(digest(first), digest(second));
}

function sessionSecret() {
  const secret =
    process.env.GURUMI_ADMIN_SESSION_SECRET ??
    process.env.GURUMI_ROUND_SECRET;
  if (!secret) throw new Error("Gurumi admin session secret is not configured.");
  return secret;
}

function sessionSignature(payload: string, password: string) {
  return createHmac("sha256", sessionSecret())
    .update(`ausgcon-2026-gurumi-admin:${password}:${payload}`)
    .digest("base64url");
}

function createSessionToken(password: string) {
  const payload = Buffer.from(
    JSON.stringify({ expiresAt: Date.now() + ADMIN_COOKIE_MAX_AGE * 1_000, version: 1 }),
  ).toString("base64url");
  return `${payload}.${sessionSignature(payload, password)}`;
}

function verifySessionToken(token: string, password: string) {
  const [payload, suppliedSignature, extra] = token.split(".");
  if (!payload || !suppliedSignature || extra) return false;
  if (!safeEqual(suppliedSignature, sessionSignature(payload, password))) return false;

  try {
    const value = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as {
      expiresAt?: unknown;
      version?: unknown;
    };
    return value.version === 1 && typeof value.expiresAt === "number" && value.expiresAt >= Date.now();
  } catch {
    return false;
  }
}

export async function takeGurumiAdminLoginLimit() {
  const requestHeaders = await headers();
  const forwarded = requestHeaders.get("x-forwarded-for")?.split(",")[0]?.trim();
  const address = requestHeaders.get("x-real-ip")?.trim() || forwarded || "local";
  const key = createHash("sha256")
    .update(`ausgcon-2026-gurumi-admin-login:${address}`)
    .digest("base64url")
    .slice(0, 24);
  const now = Date.now();
  const current = loginLimits.get(key);

  if (!current || current.resetAt <= now) {
    loginLimits.set(key, { count: 1, resetAt: now + LOGIN_WINDOW_MS });
    return { allowed: true, retryAfterSeconds: 0 };
  }
  if (current.count >= LOGIN_ATTEMPT_LIMIT) {
    return {
      allowed: false,
      retryAfterSeconds: Math.max(1, Math.ceil((current.resetAt - now) / 1_000)),
    };
  }
  current.count += 1;
  return { allowed: true, retryAfterSeconds: 0 };
}

export function isGurumiAdminConfigured() {
  return configuredPassword() !== null;
}

export function verifyGurumiAdminPassword(candidate: string) {
  const password = configuredPassword();
  return password !== null && safeEqual(candidate, password);
}

export async function isGurumiAdminAuthenticated() {
  const password = configuredPassword();
  if (!password) return false;
  const cookieStore = await cookies();
  const storedToken = cookieStore.get(ADMIN_COOKIE_NAME)?.value;
  return Boolean(storedToken && verifySessionToken(storedToken, password));
}

export async function createGurumiAdminSession() {
  const password = configuredPassword();
  if (!password) throw new Error("Gurumi admin password is not configured.");
  const cookieStore = await cookies();
  cookieStore.set(ADMIN_COOKIE_NAME, createSessionToken(password), {
    httpOnly: true,
    maxAge: ADMIN_COOKIE_MAX_AGE,
    path: "/gurumi",
    sameSite: "strict",
    secure: process.env.NODE_ENV === "production",
  });
}

export async function deleteGurumiAdminSession() {
  const cookieStore = await cookies();
  cookieStore.set(ADMIN_COOKIE_NAME, "", {
    httpOnly: true,
    maxAge: 0,
    path: "/gurumi",
    sameSite: "strict",
    secure: process.env.NODE_ENV === "production",
  });
}
