import { config } from "dotenv";
config({ path: new URL("../../../.env", import.meta.url) });
import express from "express";
import { connectMongo, errorHandler, notFoundHandler } from "@portal/shared";
import companyRoutes from "./company.routes.js";

const app = express();
app.disable("x-powered-by");
app.use(express.json({ limit: "1mb" }));

app.get("/health", (_req, res) => {
  res.json({ service: "company", status: "ok" });
});

app.use("/api/companies", companyRoutes);

app.use(notFoundHandler);
app.use(errorHandler);

const PORT = parseInt(process.env.PORT || "8005", 10);

async function main(): Promise<void> {
  await connectMongo(process.env.MONGO_DB || "portal_companies");
  app.listen(PORT, () => console.log(`[company-service] listening on :${PORT}`));
}

main().catch((err) => {
  console.error("[company-service] failed to start:", err);
  process.exit(1);
});

export default app;
