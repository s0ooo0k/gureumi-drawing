import "server-only";

import { createHmac, createHash, randomUUID, timingSafeEqual } from "node:crypto";

import { isGurumiRecordId } from "./records";

const TOKEN_VERSION = 1;
const TOKEN_MAX_AGE_MS = 72 * 60 * 60 * 1_000;
const RATE_LIMIT_WINDOW_MS = 10 * 60 * 1_000;
export const GURUMI_EXPECTED_ROUND_DURATION_MS = 33_000;
// Several booth devices can share one venue NAT address. Keep the limit high
// enough for event traffic while still bounding automated bursts.
const RATE_LIMITS = {
  round: 120,
  submission: 160,
} as const;

type RateLimitScope = keyof typeof RATE_LIMITS;

type RoundTokenPayload = {
  expiresAt: number;
  id: string;
  issuedAt: number;
  version: typeof TOKEN_VERSION;
};

type RateLimitEntry = {
  count: number;
  resetAt: number;
};

type GurumiGlobal = typeof globalThis & {
  __ausgconGurumiRateLimits?: Map<string, RateLimitEntry>;
};

const gurumiGlobal = globalThis as GurumiGlobal;
const rateLimits = gurumiGlobal.__ausgconGurumiRateLimits ?? new Map<string, RateLimitEntry>();
gurumiGlobal.__ausgconGurumiRateLimits = rateLimits;

function signingSecret() {
  const secret = process.env.GURUMI_ROUND_SECRET;
  if (!secret) throw new Error("Gurumi round signing secret is not configured.");
  return secret;
}

function signature(value: string) {
  return createHmac("sha256", signingSecret())
    .update(`ausgcon-2026-gurumi-round:${value}`)
    .digest("base64url");
}

function safeEqual(first: string, second: string) {
  const firstDigest = createHash("sha256").update(first).digest();
  const secondDigest = createHash("sha256").update(second).digest();
  return timingSafeEqual(firstDigest, secondDigest);
}

function clientAddress(request: Request) {
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return request.headers.get("x-real-ip")?.trim() || forwarded || "local";
}

function clientKey(request: Request) {
  return createHash("sha256")
    .update(`ausgcon-2026-gurumi-client:${clientAddress(request)}`)
    .digest("base64url")
    .slice(0, 24);
}

function pruneRateLimits(now: number) {
  if (rateLimits.size < 500) return;
  for (const [key, entry] of rateLimits) {
    if (entry.resetAt <= now) rateLimits.delete(key);
  }
}

export function takeGurumiRateLimit(request: Request, scope: RateLimitScope) {
  const now = Date.now();
  pruneRateLimits(now);
  const key = `${scope}:${clientKey(request)}`;
  const current = rateLimits.get(key);

  if (!current || current.resetAt <= now) {
    rateLimits.set(key, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
    return { allowed: true, retryAfterSeconds: 0 };
  }

  if (current.count >= RATE_LIMITS[scope]) {
    return {
      allowed: false,
      retryAfterSeconds: Math.max(1, Math.ceil((current.resetAt - now) / 1_000)),
    };
  }

  current.count += 1;
  return { allowed: true, retryAfterSeconds: 0 };
}

export function createGurumiRoundSession() {
  const issuedAt = Date.now();
  const payload: RoundTokenPayload = {
    expiresAt: issuedAt + TOKEN_MAX_AGE_MS,
    id: randomUUID(),
    issuedAt,
    version: TOKEN_VERSION,
  };
  const encodedPayload = Buffer.from(JSON.stringify(payload)).toString("base64url");

  return {
    expiresAt: new Date(payload.expiresAt).toISOString(),
    id: payload.id,
    token: `${encodedPayload}.${signature(encodedPayload)}`,
  };
}

export function readGurumiRoundSession(token: string, expectedId: string) {
  if (token.length > 1_024) return null;
  const [encodedPayload, suppliedSignature, extra] = token.split(".");
  if (!encodedPayload || !suppliedSignature || extra) return null;
  if (!safeEqual(suppliedSignature, signature(encodedPayload))) return null;

  try {
    const payload = JSON.parse(
      Buffer.from(encodedPayload, "base64url").toString("utf8"),
    ) as Partial<RoundTokenPayload>;
    const now = Date.now();

    if (
      payload.version === TOKEN_VERSION &&
      isGurumiRecordId(payload.id) &&
      payload.id === expectedId &&
      typeof payload.issuedAt === "number" &&
      typeof payload.expiresAt === "number" &&
      payload.issuedAt <= now + 60_000 &&
      payload.expiresAt >= now &&
      payload.expiresAt - payload.issuedAt <= TOKEN_MAX_AGE_MS
    ) {
      return {
        expiresAt: payload.expiresAt,
        id: payload.id,
        issuedAt: payload.issuedAt,
      };
    }
    return null;
  } catch {
    return null;
  }
}

export function verifyGurumiRoundSession(token: string, expectedId: string) {
  return readGurumiRoundSession(token, expectedId) !== null;
}
