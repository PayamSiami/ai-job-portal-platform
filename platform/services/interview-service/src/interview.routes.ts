import { Router } from "express";
import { requireInternalToken } from "@portal/shared";
import * as controller from "./interview.controller.js";

const router = Router();

// ------------------------- Interview lifecycle -------------------------

router.post("/start", controller.startInterview); // job-seeker: { applicationId, language }
router.get("/employer", controller.employerInterviews); // employer list
router.get("/by-application/:applicationId", controller.byApplication); // participant
router.get("/:id", controller.getInterview); // participant
router.post("/:id/answer", controller.answerQuestion); // job-seeker
router.patch("/:id/abandon", controller.abandonInterview); // job-seeker
router.get("/:id/report", controller.employerReport); // employer

// ------------------------- Internal -------------------------

router.get(
  "/internal/by-application/:applicationId",
  requireInternalToken,
  controller.internalByApplication,
);

export default router;
