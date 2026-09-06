import { config } from "dotenv";
config({ path: new URL("../../../.env", import.meta.url) });
import express from "express";
import { connectMongo, errorHandler, notFoundHandler } from "@portal/shared";
import applicationRoutes from "./application.routes.js";

const app = express();
app.disable("x-powered-by");
app.use(express.json({ limit: "1mb" }));

app.get("/health", (_req, res) => {
  res.json({ service: "application", status: "ok" });
});

app.use("/api/applications", applicationRoutes);

app.use(notFoundHandler);
app.use(errorHandler);

const PORT = parseInt(process.env.PORT || "8003", 10);

async function main(): Promise<void> {
  await connectMongo(process.env.MONGO_DB || "portal_applications");
  app.listen(PORT, () => console.log(`[application-service] listening on :${PORT}`));
}

main().catch((err) => {
  console.error("[application-service] failed to start:", err);
  process.exit(1);
});

export default app;
