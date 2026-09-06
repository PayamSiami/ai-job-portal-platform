import type { NextFunction, Request, RequestHandler, Response } from "express";

// ------------------------------------------------------------
// HTTP plumbing shared by every service: typed errors, async
// wrapper, uniform response envelope, global error handler and
// an authenticated internal-service fetch client.
// ------------------------------------------------------------

export class AppError extends Error {
  statusCode: number;
  isOperational = true;

  constructor(message: string, statusCode = 500) {
    super(message);
    this.statusCode = statusCode;
    Error.captureStackTrace?.(this, this.constructor);
  }
}

/** Wrap an async express handler so rejections reach the error handler. */
export const asyncHandler =
  (fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>): RequestHandler =>
  (req, res, next) => {
    void fn(req, res, next).catch(next);
  };

export function sendSuccess(
  res: Response,
  data: unknown,
  message = "OK",
  status = 200,
): void {
  res.status(status).json({ success: true, message, data });
}

export function sendError(
  res: Response,
  message: string,
  status = 500,
  details?: unknown,
): void {
  res.status(status).json({ success: false, message, ...(details ? { details } : {}) });
}

export function errorHandler(
  err: unknown,
  req: Request,
  res: Response,
  _next: NextFunction,
): void {
  const isAppError = err instanceof AppError;
  const status = isAppError ? err.statusCode : 500;
  const message = isAppError ? err.message : "Something went wrong";

  if (!isAppError) {
    // Unexpected error: log server-side, never leak internals to clients.
    console.error("[unhandled]", req.method, req.originalUrl, err);
  }

  if (res.headersSent) {
    return;
  }
  sendError(res, message, status);
}

export function notFoundHandler(req: Request, res: Response): void {
  sendError(res, `Route ${req.method} ${req.originalUrl} not found`, 404);
}

// ------------------------------------------------------------
// Internal service-to-service calls.
// /internal/* endpoints on every service require the shared
// INTERNAL_API_TOKEN; user context travels via x-user-id.
// ------------------------------------------------------------

/**
 * User context injected by the api-gateway after JWT verification.
 * Services trust these headers only from the gateway/internal network.
 */
export function userContext(req: Request): {
  userId?: string;
  role?: string;
  email?: string;
} {
  const get = (k: string) => {
    const v = req.headers[k];
    return Array.isArray(v) ? v[0] : v;
  };
  return {
    userId: get("x-user-id"),
    role: get("x-user-role"),
    email: get("x-user-email"),
  };
}

/**
 * Guards /internal/* service-to-service endpoints: requires the shared
 * INTERNAL_API_TOKEN. These endpoints are only reachable on the private
 docker network.
 */
export function requireInternalToken(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  const token = process.env.INTERNAL_API_TOKEN;
  const provided = req.headers["x-internal-token"];
  if (!token || provided !== token) {
    sendError(res, "Internal endpoint: invalid token", 401);
    return;
  }
  next();
}

export interface InternalCallOptions {
  method?: "GET" | "POST" | "PATCH" | "PUT" | "DELETE";
  body?: unknown;
  userId?: string;
  timeoutMs?: number;
}

export async function internalFetch<T>(
  base: string,
  path: string,
  options: InternalCallOptions = {},
): Promise<T> {
  const token = process.env.INTERNAL_API_TOKEN;
  if (!token) throw new AppError("INTERNAL_API_TOKEN is not configured", 500);

  const response = await fetch(`${base.replace(/\/$/, "")}${path}`, {
    method: options.method ?? "GET",
    headers: {
      "content-type": "application/json",
      "x-internal-token": token,
      ...(options.userId ? { "x-user-id": options.userId } : {}),
    },
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
    signal: AbortSignal.timeout(options.timeoutMs ?? 10_000),
  });

  const text = await response.text();
  let json: { success?: boolean; message?: string; data?: T } = {};
  try {
    json = text ? (JSON.parse(text) as typeof json) : {};
  } catch {
    /* non-JSON body */
  }

  if (!response.ok) {
    throw new AppError(
      json.message || `Internal call failed: ${response.status} ${path}`,
      response.status,
    );
  }
  return json.data as T;
}
