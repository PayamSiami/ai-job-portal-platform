import { Router } from "express";
import { requireInternalToken } from "@portal/shared";
import * as controller from "./job.controller.js";

const router = Router();

// Public
router.get("/", controller.listJobs);
router.get("/slug/:slug", controller.getJobBySlug);
router.get("/generate-description", controller.generateDescription);
router.get("/:id", controller.getJob);

// Authenticated (gateway injects x-user-* headers)
router.post("/", controller.createJob);
router.put("/:id", controller.updateJob);
router.delete("/:id", controller.deleteJob);

// Internal service-to-service
router.get("/internal/:id", requireInternalToken, controller.getJob);

export default router;
