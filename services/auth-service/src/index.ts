import { config } from "dotenv";
// Load the platform-root shared .env regardless of CWD (handles both
// `npm run dev` from within a service dir and `node dist/index.js`).
config({ path: new URL("../../../.env", import.meta.url) });
import express from "express";
import { connectMongo, errorHandler, notFoundHandler } from "@portal/shared";
import authRoutes from "./auth.routes.js";
import { createAdmin } from "./admin.script.js";

const app = express();
app.disable("x-powered-by");
app.use(express.json({ limit: "1mb" }));

app.get("/health", (_req, res) => {
  res.json({ service: "auth", status: "ok" });
});

app.use("/api/auth", authRoutes);

app.use(notFoundHandler);
app.use(errorHandler);

const PORT = parseInt(process.env.PORT || "8001", 10);

async function main(): Promise<void> {
  await connectMongo(process.env.MONGO_DB || "portal_auth");

  // Provision the initial admin from env (ADMIN_EMAIL/ADMIN_PASSWORD).
  // This is the ONLY way an admin account can come into existence.
  await createAdmin().catch((err) => console.error("[admin] bootstrap failed:", err));

  app.listen(PORT, () => console.log(`[auth-service] listening on :${PORT}`));
}

main().catch((err) => {
  console.error("[auth-service] failed to start:", err);
  process.exit(1);
});

export default app;
