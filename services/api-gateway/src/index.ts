import { config } from "dotenv";
config({ path: new URL("../../../.env", import.meta.url) });
import express from "express";
import rateLimit from "express-rate-limit";
import cors from "cors";
import { envInt, env } from "@portal/shared";
import { ROUTES, buildProxies } from "./routes.js";
import { requireAuth, verifyOptional } from "./auth.js";
import { openapiDocument, SWAGGER_UI_HTML } from "./openapi.js";

const app = express();
app.disable("x-powered-by");
app.disable("etag");

// We sit behind nginx in production; trust exactly one hop so
// rate limiting keys off real client IPs from X-Forwarded-For.
app.set("trust proxy", 1);

// CORS
const origins = env("CORS_ORIGIN", "http://localhost:3000,http://localhost:5173")
  .split(",")
  .map((o) => o.trim())
  .filter(Boolean);
app.use(
  cors({
    origin: origins,
    credentials: true,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization", "Accept"],
  }),
);

// Rate limiting (fixes the legacy monolith's single-IP bucket: trust proxy
// is set, so clients are keyed by their real IP).
const globalLimiter = rateLimit({
  windowMs: envInt("RATE_LIMIT_WINDOW_MS", 900_000),
  limit: envInt("RATE_LIMIT_MAX", 300),
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: { success: false, message: "Too many requests, please try again later." },
});

const authLimiter = rateLimit({
  windowMs: 900_000,
  limit: 30, // login/register/refresh brute-force protection
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: { success: false, message: "Too many auth attempts, please try again later." },
});

app.use("/api/auth/login", authLimiter);
app.use("/api/auth/register", authLimiter);
app.use("/api/auth/refresh", authLimiter);
app.use("/api", globalLimiter);

// Gateway health (compose healthcheck target)
app.get("/health", (_req, res) => {
  res.json({ service: "gateway", status: "ok" });
});

// API documentation (Swagger UI), mounted BEFORE the proxy catch-all so these
// paths are never forwarded to an upstream service. No extra dependencies:
// the UI is a static page that loads swagger-ui-dist from a CDN.
app.get("/openapi.json", (_req, res) =>
  res.type("application/json").json(openapiDocument),
);
app.get("/api-docs", (_req, res) => res.type("html").send(SWAGGER_UI_HTML));

// ------------------------- Proxy routing -------------------------

const proxies = buildProxies();

// Services each mount their own router at "/api/<service>" and internal
// callers reference the full "/api/<service>/internal/..." path. So we do NOT
// strip the /api/<service> prefix here. Express strips a matched prefix when
// middleware is mounted with app.use(prefix, ...), so we mount at "/" and pick
// the rule by path, then hand the proxy the FULL original URL unchanged.
const authFor = (rule: (typeof ROUTES)[number]): express.RequestHandler =>
  rule.auth === "required"
    ? requireAuth
    : rule.auth === "optional"
      ? verifyOptional
      : (_req, _res, next) => next();

app.use((req, res, next) => {
  const rule = ROUTES.find(
    (r) => req.path === r.prefix || req.path.startsWith(`${r.prefix}/`),
  );
  if (!rule) return next();
  const proxy = proxies.get(rule.prefix);
  if (!proxy) return next();
  authFor(rule)(req, res, () => proxy(req, res, next));
});

// 404
app.use((_req, res) => {
  res.status(404).json({ success: false, message: "Route not found" });
});

// Error handler
app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error("[gateway]", err.message);
  res.status(500).json({ success: false, message: "Gateway error" });
});

const PORT = envInt("PORT", 8000);
app.listen(PORT, () => console.log(`[api-gateway] listening on :${PORT}`));

export default app;
