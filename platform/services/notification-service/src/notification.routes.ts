import { Router } from "express";
import * as controller from "./notification.controller.js";

// All endpoints require the user context injected by the gateway.
const router = Router();

router.get("/", controller.listNotifications);
router.get("/activities", controller.listActivities);
router.patch("/:id/read", controller.markRead);
router.post("/read-all", controller.markAllRead);

export default router;
