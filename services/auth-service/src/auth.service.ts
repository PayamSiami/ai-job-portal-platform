import { randomUUID } from "node:crypto";
import bcrypt from "bcryptjs";
import type { UserDoc } from "./user.model.js";
import {
  AppError,
  publishEvent,
  EventNames,
  USER_ROLES,
  signAccessToken,
  signRefreshToken,
  verifyRefreshToken,
  refreshTtlSeconds,
  rememberRefreshToken,
  refreshJtiValid,
  revokeRefreshToken,
  revokeRefreshFamily,
  type TokenPair,
  type UserDTO,
  type UserRole,
} from "@portal/shared";

// ------------------------------------------------------------
// Auth logic: registration (job-seeker | employer ONLY admin
// accounts are provisioned by script), login, refresh-token
// rotation with theft detection, logout, Google sign-in.
// ------------------------------------------------------------

export function issueTokenPair(user: UserDoc, reuseFamily?: string): TokenPair {
  const family = reuseFamily ?? randomUUID();
  const jti = randomUUID();
  const accessToken = signAccessToken({
    sub: String(user._id),
    role: user.role,
    email: user.email,
    username: user.username,
  });
  const refreshToken = signRefreshToken({ sub: String(user._id), jti, fam: family });
  // Fire and forget: token store is best-effort (redis outage shouldn't
  // block login, refresh validation degrades gracefully below).
  void rememberRefreshToken(family, jti, refreshTtlSeconds()).catch((err) =>
    console.error("[auth] failed to record refresh jti:", err),
  );
  return {
    accessToken,
    refreshToken,
    accessExpiresIn: parseExp(process.env.JWT_ACCESS_EXPIRE, 15 * 60),
    refreshExpiresIn: parseExp(process.env.JWT_REFRESH_EXPIRE, 30 * 86400),
  };
}

function parseExp(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const m = /^(\d+)([smhd])?$/.exec(value);
  if (!m) return fallback;
  const n = parseInt(m[1], 10);
  return n * (m[2] === "m" ? 60 : m[2] === "h" ? 3600 : m[2] === "d" ? 86400 : 1);
}

export function toUserDTO(user: UserDoc): UserDTO {
  const json = user.toJSON() as unknown as UserDTO & { _id: unknown };
  return { ...json, _id: String(json._id) };
}

/**
 * Admin-only: change a user's role. There is no UI path to assign "admin"
 * (register forbids it); admins are created only by the env bootstrap, and
 * can re-role others here. Emits a user.role_updated event.
 */
export async function updateUserRole(targetId: string, role: UserRole): Promise<UserDTO> {
  const { User } = await import("./user.model.js");
  const user = await User.findById(targetId);
  if (!user) throw new AppError("User not found", 404);
  if (!USER_ROLES.includes(role)) throw new AppError("Invalid role", 400);
  const oldRole = user.role;
  if (oldRole === role) throw new AppError("User already has this role", 409);
  user.role = role;
  await user.save();
  void publishEvent(EventNames.UserRoleUpdated, {
    userId: String(user._id),
    oldRole,
    newRole: role,
  }).catch((err) => console.error("[auth] failed to publish role update:", err));
  return toUserDTO(user);
}

export async function register(input: {
  username: string;
  email: string;
  password: string;
  role: "job-seeker" | "employer";
  profile?: Record<string, unknown>;
}): Promise<{ user: UserDTO; tokens: TokenPair }> {
  const { User } = await import("./user.model.js");
  const existing = await User.findOne({
    $or: [
      { email: input.email.toLowerCase() },
      { username: input.username },
    ],
  }).lean();
  if (existing) {
    throw new AppError("Email or username already registered", 409);
  }

  const user = await User.create({
    username: input.username,
    email: input.email.toLowerCase(),
    password: input.password,
    role: input.role, // never accepts "admin" enforced by route schema too
    profile: input.profile ?? { skills: [] },
    isActive: true,
  });

  await publishEvent(EventNames.UserRegistered, {
    userId: String(user._id),
    email: user.email,
    username: user.username,
    role: user.role,
  });

  return { user: toUserDTO(user), tokens: issueTokenPair(user) };
}

export async function login(email: string, password: string): Promise<{ user: UserDTO; tokens: TokenPair }> {
  const { User } = await import("./user.model.js");
  const user = await User.findOne({ email: email.toLowerCase() }).select("+password");
  if (!user) throw new AppError("Invalid email or password", 401);
  if (!user.isActive) throw new AppError("Account has been deactivated", 403);
  if (!user.password) throw new AppError("This account uses Google sign-in. Continue with Google.", 400);

  const ok = user.password ? await bcrypt.compare(password, user.password) : false;
  if (!ok) throw new AppError("Invalid email or password", 401);

  user.lastLogin = new Date();
  await user.save();
  return { user: toUserDTO(user), tokens: issueTokenPair(user) };
}

export async function refreshTokens(
  refreshToken: string,
): Promise<TokenPair> {
  let claims;
  try {
    claims = verifyRefreshToken(refreshToken);
  } catch {
    throw new AppError("Invalid refresh token", 401);
  }

  const valid = await refreshJtiValid(claims.fam, claims.jti).catch(() => null);
  if (valid === false) {
    // Token was revoked but is being replayed -> assume theft, kill family.
    await revokeRefreshFamily(claims.fam).catch(() => undefined);
    throw new AppError("Refresh token reuse detected. Please log in again.", 401);
  }
  if (valid === null) {
    // Redis unavailable: fail closed rather than accept revoked tokens.
    throw new AppError("Token store unavailable, try again shortly", 503);
  }

  await revokeRefreshToken(claims.fam, claims.jti).catch(() => undefined);

  const { User } = await import("./user.model.js");
  const user = await User.findById(claims.sub);
  if (!user || !user.isActive) throw new AppError("User no longer exists", 401);

  // Same family -> rotation without theft alarm.
  return issueTokenPair(user, claims.fam);
}

export async function logout(refreshToken?: string): Promise<void> {
  if (!refreshToken) return;
  try {
    const claims = verifyRefreshToken(refreshToken);
    await revokeRefreshFamily(claims.fam);
  } catch {
    // Invalid/expired token on logout: nothing to revoke.
  }
}

export async function changePassword(
  userId: string,
  currentPassword: string,
  newPassword: string,
): Promise<void> {
  const { User } = await import("./user.model.js");
  const user = await User.findById(userId).select("+password");
  if (!user) throw new AppError("User not found", 404);
  if (user.password) {
    const ok = await bcrypt.compare(currentPassword, user.password);
    if (!ok) throw new AppError("Current password is incorrect", 400);
  }
  user.password = newPassword;
  await user.save();
}

export async function googleAuth(idToken: string): Promise<{ user: UserDTO; tokens: TokenPair }> {
  const payload = await verifyGoogleIdToken(idToken);
  if (!payload.email || !payload.sub) {
    throw new AppError("Google token does not contain an email", 400);
  }

  const { User } = await import("./user.model.js");
  let user = await User.findOne({
    $or: [{ googleId: payload.sub }, { email: payload.email.toLowerCase() }],
  });

  if (!user) {
    const username = await uniqueUsername(payload.email.split("@")[0] ?? "user");
    user = await User.create({
      username,
      email: payload.email.toLowerCase(),
      googleId: payload.sub,
      role: "job-seeker", // Google sign-in defaults to seekers; employers register with email
      profile: { skills: [], firstName: payload.name?.split(" ")[0] },
      isActive: true,
    });
    await publishEvent(EventNames.UserRegistered, {
      userId: String(user._id),
      email: user.email,
      username: user.username,
      role: user.role,
    });
  }

  if (!user.isActive) throw new AppError("Account has been deactivated", 403);
  if (!user.googleId) {
    user.googleId = payload.sub; // link on first Google login
    await user.save();
  }

  return { user: toUserDTO(user), tokens: issueTokenPair(user) };
}

interface GoogleTokenInfo {
  sub?: string;
  email?: string;
  email_verified?: string | boolean;
  aud?: string;
  name?: string;
}

async function verifyGoogleIdToken(idToken: string): Promise<GoogleTokenInfo> {
  const response = await fetch(
    `https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(idToken)}`,
    { signal: AbortSignal.timeout(8000) },
  );
  if (!response.ok) throw new AppError("Invalid Google token", 401);
  const info = (await response.json()) as GoogleTokenInfo;
  const clientId = process.env.GOOGLE_CLIENT_ID;
  if (clientId && info.aud !== clientId) {
    throw new AppError("Google token audience mismatch", 401);
  }
  return info;
}

async function uniqueUsername(base: string): Promise<string> {
  const { User } = await import("./user.model.js");
  const clean = base.replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 20) || "user";
  for (let i = 0; i < 20; i++) {
    const candidate = i === 0 ? clean : `${clean}${Math.floor(Math.random() * 10000)}`;
    if (!(await User.exists({ username: candidate }))) return candidate;
  }
  return `user_${randomUUID().slice(0, 8)}`;
}

// ------------------------------------------------------------
// Internal endpoints used by other services.
// ------------------------------------------------------------

export async function internalGetUser(userId: string): Promise<UserDTO | null> {
  const { User } = await import("./user.model.js");
  const user = await User.findById(userId).lean();
  if (!user) return null;
  const { _id, username, email, role, profile, isActive, createdAt } = user as never as UserDTO & { _id: unknown };
  void _id;
  return {
    _id: String((user as unknown as { _id: { toString(): string } })._id),
    username,
    email,
    role,
    profile,
    isActive,
    createdAt: createdAt as unknown as string,
  };
}
