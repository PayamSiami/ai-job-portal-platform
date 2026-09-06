import { config } from "dotenv";
config({ path: new URL("../../../.env", import.meta.url) });
import express from "express";
import { connectMongo, errorHandler, notFoundHandler } from "@portal/shared";
import jobRoutes from "./job.routes.js";

const app = express();
app.disable("x-powered-by");
app.use(express.json({ limit: "1mb" }));

app.get("/health", (_req, res) => {
  res.json({ service: "job", status: "ok" });
});

app.use("/api/jobs", jobRoutes);

app.use(notFoundHandler);
app.use(errorHandler);

const PORT = parseInt(process.env.PORT || "8002", 10);

async function main(): Promise<void> {
  await connectMongo(process.env.MONGO_DB || "portal_jobs");
  app.listen(PORT, () => console.log(`[job-service] listening on :${PORT}`));
}

main().catch((err) => {
  console.error("[job-service] failed to start:", err);
  process.exit(1);
});

export default app;
