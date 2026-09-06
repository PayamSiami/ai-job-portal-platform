import { config } from "dotenv";
config({ path: new URL("../../../.env", import.meta.url) });
import express from "express";
import { connectMongo, errorHandler, notFoundHandler } from "@portal/shared";
import resumeRoutes from "./resume.routes.js";

const app = express();
app.disable("x-powered-by");
app.use(express.json({ limit: "1mb" }));

app.get("/health", (_req, res) => {
  res.json({ service: "resume", status: "ok" });
});

app.use("/api/resumes", resumeRoutes);

app.use(notFoundHandler);
app.use(errorHandler);

const PORT = parseInt(process.env.PORT || "8004", 10);

async function main(): Promise<void> {
  await connectMongo(process.env.MONGO_DB || "portal_resumes");
  app.listen(PORT, () => console.log(`[resume-service] listening on :${PORT}`));
}

main().catch((err) => {
  console.error("[resume-service] failed to start:", err);
  process.exit(1);
});

export default app;
