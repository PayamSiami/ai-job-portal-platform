import jwt from "jsonwebtoken";
import { requireEnv } from "./config.js";
import { AccessClaimsSchema, type AccessClaims } from "../types/index.js";

// ------------------------------------------------------------
// Token strategy
// ------------------------------------------------------------
// Access token:  short-lived (default 15m), carries role claims,
//                signed with JWT_SECRET. Stateless — verified by
//                the gateway without a DB hit.
// Refresh token: long-lived (default 30d), opaque jti + family id,
//                signed with JWT_REFRESH_SECRET. Its jti must exist
//                in redis (jti -> familyId) to be accepted, so the
//                auth-service can revoke single tokens or a whole
//                family on reuse (detects token theft).
// ------------------------------------------------------------

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
  accessExpiresIn: number; // seconds
  refreshExpiresIn: number; // seconds
}

export interface RefreshTokenClaims {
  sub: string;
  jti: string;
  fam: string;
}

function accessSecret(): string {
  return requireEnv("JWT_SECRET");
}

function refreshSecret(): string {
  return requireEnv("JWT_REFRESH_SECRET");
}

function parseDurationSeconds(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const match = /^(\d+)([smhd])?$/.exec(value.trim());
  if (!match) return fallback;
  const amount = parseInt(match[1], 10);
  const unit = match[2] ?? "s";
  const multiplier = unit === "s" ? 1 : unit === "m" ? 60 : unit === "h" ? 3600 : 86400;
  return amount * multiplier;
}

export function accessTtlSeconds(): number {
  return parseDurationSeconds(process.env.JWT_ACCESS_EXPIRE, 15 * 60);
}

export function refreshTtlSeconds(): number {
  return parseDurationSeconds(process.env.JWT_REFRESH_EXPIRE, 30 * 86400);
}

export function signAccessToken(claims: AccessClaims): string {
  return jwt.sign(claims, accessSecret(), {
    expiresIn: accessTtlSeconds(),
  } as jwt.SignOptions);
}

export function verifyAccessToken(token: string): AccessClaims {
  const decoded = jwt.verify(token, accessSecret());
  // Throws if the claims don't match the expected shape.
  return AccessClaimsSchema.parse(decoded);
}

export function signRefreshToken(claims: RefreshTokenClaims): string {
  return jwt.sign(claims, refreshSecret(), {
    expiresIn: refreshTtlSeconds(),
  } as jwt.SignOptions);
}

export function verifyRefreshToken(token: string): RefreshTokenClaims {
  const decoded = jwt.verify(token, refreshSecret());
  const parsed = RefreshClaims.safeParse(decoded);
  if (!parsed.success) throw new Error("Malformed refresh token claims");
  return parsed.data;
}

import { z } from "zod";
const RefreshClaims = z.object({
  sub: z.string().min(1),
  jti: z.string().min(1),
  fam: z.string().min(1),
});
