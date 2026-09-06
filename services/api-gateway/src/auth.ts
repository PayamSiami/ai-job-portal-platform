import type { NextFunction, Request, Response } from "express";
import jwt from "jsonwebtoken";
import { AccessClaimsSchema, type AccessClaims } from "@portal/shared";

// ------------------------------------------------------------
// Edge auth: the gateway is the ONLY component that verifies
// access JWTs. Verified identity travels downstream as trusted
// x-user-* headers; any such headers from the outside are
// stripped first so they can never be spoofed.
// ------------------------------------------------------------

export const FORWARDED_HEADERS = ["x-user-id", "x-user-role", "x-user-email"] as const;

export function stripForwardedHeaders(req: Request): void {
  for (const header of FORWARDED_HEADERS) {
    delete req.headers[header];
  }
}

export interface AuthedRequest extends Request {
  claims?: AccessClaims;
}

export function verifyOptional(req: AuthedRequest, _res: Response, next: NextFunction): void {
  stripForwardedHeaders(req);
  const header = req.headers.authorization;
  if (header?.startsWith("Bearer ")) {
    try {
      req.claims = AccessClaimsSchema.parse(
        jwt.verify(header.slice(7), process.env.JWT_SECRET ?? ""),
      );
    } catch {
      // Invalid token on an optional-auth route: treat as anonymous.
    }
  }
  next();
}

export function requireAuth(req: AuthedRequest, res: Response, next: NextFunction): void {
  stripForwardedHeaders(req);
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) {
    res.status(401).json({ success: false, message: "Authentication required" });
    return;
  }
  try {
    req.claims = AccessClaimsSchema.parse(
      jwt.verify(header.slice(7), process.env.JWT_SECRET ?? ""),
    );
  } catch {
    res.status(401).json({ success: false, message: "Invalid or expired token" });
    return;
  }
  next();
}

/** Inject verified identity as headers for downstream services. */
export function injectUserHeaders(req: AuthedRequest): void {
  if (req.claims) {
    req.headers["x-user-id"] = req.claims.sub;
    req.headers["x-user-role"] = req.claims.role;
    req.headers["x-user-email"] = req.claims.email;
  }
}
