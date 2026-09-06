import { z } from "zod";
import { asyncHandler, sendSuccess, sendError, userContext } from "@portal/shared";
import * as authService from "./auth.service.js";

const RegisterSchema = z.object({
  username: z.string().min(3).max(30),
  email: z.string().email(),
  password: z
    .string()
    .min(8, "Password must be at least 8 characters")
    .regex(/[a-z]/, "Password needs a lowercase letter")
    .regex(/[A-Z]/, "Password needs an uppercase letter")
    .regex(/[0-9]/, "Password needs a number"),
  role: z.enum(["job-seeker", "employer"]), // "admin" intentionally NOT allowed
  profile: z
    .object({
      firstName: z.string().max(60).optional(),
      lastName: z.string().max(60).optional(),
      headline: z.string().max(120).optional(),
      location: z.string().max(120).optional(),
    })
    .optional(),
});

const LoginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

const RefreshSchema = z.object({ refreshToken: z.string().min(10) });
const GoogleSchema = z.object({ idToken: z.string().min(10) });
const ChangePasswordSchema = z.object({
  currentPassword: z.string(),
  newPassword: z
    .string()
    .min(8)
    .regex(/[a-z]/)
    .regex(/[A-Z]/)
    .regex(/[0-9]/),
});

export const register = asyncHandler(async (req, res) => {
  const parsed = RegisterSchema.safeParse(req.body);
  if (!parsed.success) return sendError(res, parsed.error.issues[0]?.message ?? "Invalid input", 400);
  const { user, tokens } = await authService.register(parsed.data);
  sendSuccess(res, { user, ...tokens }, "Registered successfully", 201);
});

export const login = asyncHandler(async (req, res) => {
  const parsed = LoginSchema.safeParse(req.body);
  if (!parsed.success) return sendError(res, "Email and password are required", 400);
  const { user, tokens } = await authService.login(parsed.data.email, parsed.data.password);
  sendSuccess(res, { user, ...tokens }, "Login successful");
});

export const refresh = asyncHandler(async (req, res) => {
  const parsed = RefreshSchema.safeParse(req.body);
  if (!parsed.success) return sendError(res, "refreshToken is required", 400);
  const tokens = await authService.refreshTokens(parsed.data.refreshToken);
  sendSuccess(res, tokens, "Token refreshed");
});

export const logout = asyncHandler(async (req, res) => {
  const parsed = RefreshSchema.safeParse(req.body ?? {});
  await authService.logout(parsed.success ? parsed.data.refreshToken : undefined);
  sendSuccess(res, { ok: true }, "Logged out");
});

export const changePassword = asyncHandler(async (req, res) => {
  const ctx = userContext(req);
  if (!ctx.userId) return sendError(res, "Authentication required", 401);
  const parsed = ChangePasswordSchema.safeParse(req.body);
  if (!parsed.success) return sendError(res, parsed.error.issues[0]?.message ?? "Invalid input", 400);
  await authService.changePassword(ctx.userId, parsed.data.currentPassword, parsed.data.newPassword);
  sendSuccess(res, { ok: true }, "Password updated");
});

export const googleAuth = asyncHandler(async (req, res) => {
  const parsed = GoogleSchema.safeParse(req.body);
  if (!parsed.success) return sendError(res, "idToken is required", 400);
  const { user, tokens } = await authService.googleAuth(parsed.data.idToken);
  sendSuccess(res, { user, ...tokens }, "Google authentication successful");
});

export const me = asyncHandler(async (req, res) => {
  const ctx = userContext(req);
  if (!ctx.userId) return sendError(res, "Authentication required", 401);
  const user = await authService.internalGetUser(ctx.userId);
  if (!user) return sendError(res, "User not found", 404);
  sendSuccess(res, user, "Profile fetched");
});

// ------------------------- Internal (x-internal-token) -------------------------

export const internalGetUser = asyncHandler(async (req, res) => {
  const user = await authService.internalGetUser(String(req.params.id));
  if (!user) return sendError(res, "User not found", 404);
  sendSuccess(res, user);
});
