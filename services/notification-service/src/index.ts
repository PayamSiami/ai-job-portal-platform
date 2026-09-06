import { config } from "dotenv";
config({ path: new URL("../../../.env", import.meta.url) });
import express from "express";
import { connectMongo, errorHandler, notFoundHandler } from "@portal/shared";
import notificationRoutes from "./notification.routes.js";
import { startConsumers } from "./consumers.js";

const app = express();
app.disable("x-powered-by");
app.use(express.json({ limit: "1mb" }));

app.get("/health", (_req, res) => {
  res.json({ service: "notification", status: "ok" });
});

app.use("/api/notifications", notificationRoutes);

app.use(notFoundHandler);
app.use(errorHandler);

const PORT = parseInt(process.env.PORT || "8007", 10);

async function main(): Promise<void> {
  await connectMongo(process.env.MONGO_DB || "portal_notifications");
  startConsumers();
  app.listen(PORT, () => console.log(`[notification-service] listening on :${PORT}`));
}

main().catch((err) => {
  console.error("[notification-service] failed to start:", err);
  process.exit(1);
});

export default app;
