import { ServerResponse } from "node:http";
import {
  createProxyMiddleware,
  type RequestHandler,
} from "http-proxy-middleware";
import { type AuthedRequest } from "./auth.js";

// ------------------------------------------------------------
// Routing table: public prefix -> service.
// The gateway does NOT parse request bodies: JWT verification
// only reads headers, so request streams (uploads, PDFs) pass
// through untouched to the owning service.
// ------------------------------------------------------------

export interface RouteRule {
  prefix: string;
  target: () => string;
  /** "public" = pass-through, "optional" = verify if token present, "required" = 401 without a valid token */
  auth: "public" | "optional" | "required";
}

function env(name: string, port: number): string {
  return process.env[name] || `http://localhost:${port}`;
}

export const ROUTES: RouteRule[] = [
  // Auth service: register/login/refresh work without a token;
  // /me and /change-password verify when a Bearer token is present.
  {
    prefix: "/api/auth",
    target: () => env("AUTH_SERVICE_URL", 8001),
    auth: "optional",
  },

  // Job service: public reads, authenticated writes (service enforces roles)
  {
    prefix: "/api/jobs",
    target: () => env("JOB_SERVICE_URL", 8002),
    auth: "optional",
  },

  // Applications: user-scoped, service enforces roles
  {
    prefix: "/api/applications",
    target: () => env("APPLICATION_SERVICE_URL", 8003),
    auth: "required",
  },

  // AI interviews (dedicated service)
  {
    prefix: "/api/interviews",
    target: () => env("INTERVIEW_SERVICE_URL", 8008),
    auth: "required",
  },

  // Resumes: owner-scoped, never public
  {
    prefix: "/api/resumes",
    target: () => env("RESUME_SERVICE_URL", 8004),
    auth: "required",
  },

  // Companies: public slug/logo reads; writes need a user (service enforces employer role)
  {
    prefix: "/api/companies",
    target: () => env("COMPANY_SERVICE_URL", 8005),
    auth: "optional",
  },

  // Notifications: always personal
  {
    prefix: "/api/notifications",
    target: () => env("NOTIFICATION_SERVICE_URL", 8007),
    auth: "required",
  },
];

export function buildProxies(): Map<string, RequestHandler> {
  const proxies = new Map<string, RequestHandler>();
  for (const rule of ROUTES) {
    proxies.set(
      rule.prefix,
      createProxyMiddleware({
        target: rule.target(),
        changeOrigin: false,
        xfwd: true,
        on: {
          proxyReq: (proxyReq, req) => {
            // injectUserHeaders mutates req.headers, which is too late for
            // http-proxy-middleware (it already built proxyReq from req.headers).
            // Set headers on the actual outgoing proxy request instead.
            const claims = (req as AuthedRequest).claims;
            if (claims) {
              proxyReq.setHeader("x-user-id", claims.sub);
              proxyReq.setHeader("x-user-role", claims.role);
              proxyReq.setHeader("x-user-email", claims.email);
            }
          },
          error: (err, _req, res) => {
            console.error("[gateway] proxy error:", err.message);
            if (res instanceof ServerResponse && !res.headersSent) {
              res.statusCode = 502;
              res.setHeader("content-type", "application/json");
              res.end(
                JSON.stringify({
                  success: false,
                  message: "Service unavailable",
                }),
              );
            }
          },
        },
      }),
    );
  }
  return proxies;
}
