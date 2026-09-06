import { config } from "dotenv";
config({ path: new URL("../../../.env", import.meta.url) });
import express from "express";
import { errorHandler, notFoundHandler } from "@portal/shared";
import internalRoutes from "./routes.js";

const app = express();
app.disable("x-powered-by");
app.use(express.json({ limit: "2mb" }));

app.get("/health", (_req, res) => {
  const configured = !!process.env.AI_MODEL && !!process.env.AI_API_KEY;
  res.json({ service: "ai", status: "ok", aiConfigured: configured });
});

// No /api/* surface: ai-service is internal-only.
app.use("/internal", internalRoutes);

app.use(notFoundHandler);
app.use(errorHandler);

const PORT = parseInt(process.env.PORT || "8006", 10);
app.listen(PORT, () => console.log(`[ai-service] listening on :${PORT}`));

export default app;
