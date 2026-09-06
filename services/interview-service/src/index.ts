import { config } from "dotenv";
config({ path: new URL("../../../.env", import.meta.url) });
import express from "express";
import { connectMongo, errorHandler, notFoundHandler } from "@portal/shared";
import interviewRoutes from "./interview.routes.js";

const app = express();
app.disable("x-powered-by");
app.use(express.json({ limit: "1mb" }));

app.get("/health", (_req, res) => {
  res.json({ service: "interview", status: "ok" });
});

app.use("/api/interviews", interviewRoutes);

app.use(notFoundHandler);
app.use(errorHandler);

const PORT = parseInt(process.env.PORT || "8008", 10);

async function main(): Promise<void> {
  await connectMongo(process.env.MONGO_DB || "portal_interviews");
  app.listen(PORT, () => console.log(`[interview-service] listening on :${PORT}`));
}

main().catch((err) => {
  console.error("[interview-service] failed to start:", err);
  process.exit(1);
});

export default app;
