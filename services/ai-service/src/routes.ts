import { Router } from "express";
import { requireInternalToken } from "@portal/shared";
import * as controller from "./internal.controller.js";

// Every endpoint here is internal: called by other services with the
// shared INTERNAL_API_TOKEN. Users never hit ai-service directly.
const router = Router();

router.use(requireInternalToken);

// Interview AI
router.post("/interview/questions", controller.interviewQuestions);
router.post("/interview/score-answer", controller.interviewScore);
router.post("/interview/score-answer/stream", controller.interviewScoreStream);
router.post("/interview/report", controller.interviewReport);

// Screening & content AI
router.post("/screen-application", controller.screen);
router.post("/generate-job-description", controller.description);
router.post("/generate-cover-letter", controller.coverLetter);
router.post("/analyze-resume", controller.analyzeResumeEndpoint);

export default router;
