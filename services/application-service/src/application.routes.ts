import { Router } from "express";
import {
  requireInternalToken,
  asyncHandler,
  sendSuccess,
  sendError,
} from "@portal/shared";
import * as applications from "./application.controller.js";
import { Application } from "./application.model.js";

const router = Router();

// ------------------------- Applications -------------------------

router.post("/", applications.apply); // job-seeker applies
router.get("/mine", applications.myApplications); // job-seeker
router.get("/employer", applications.employerApplications); // employer
router.get("/stats", applications.stats); // employer
// /job/:jobId/candidates must be registered before the /:id catch-all.
router.get("/job/:jobId/candidates", applications.getCandidates); // employer: candidates for one of my jobs
router.get("/:id", applications.getById); // participant or admin
router.patch("/:id/status", applications.updateStatus); // employer
router.patch("/:id/withdraw", applications.withdraw); // job-seeker

// ------------------------- Internal (x-internal-token) -------------------------

// Full snapshot; requesterId must be the candidate or the employer of the job.
router.get(
  "/internal/:id",
  requireInternalToken,
  asyncHandler(async (req, res) => {
    const application = await Application.findById(req.params.id).lean();
    if (!application) {
      sendError(res, "Application not found", 404);
      return;
    }
    const requesterId = String(req.query.requesterId ?? "");
    const allowed =
      !requesterId ||
      requesterId === String(application.candidateId) ||
      requesterId === String(application.employerId);
    if (!allowed) {
      sendError(res, "Access denied", 403);
      return;
    }
    sendSuccess(res, application);
  }),
);

// interview-service writes the final result back after an interview completes.
router.patch(
  "/internal/:id/interview-result",
  requireInternalToken,
  asyncHandler(async (req, res) => {
    const score = Number((req.body as { overallScore?: unknown }).overallScore);
    const recommendation = String(
      (req.body as { recommendation?: unknown }).recommendation ?? "",
    );
    if (!Number.isFinite(score) || score < 0 || score > 10) {
      sendError(res, "overallScore must be 0-10", 400);
      return;
    }
    const application = await Application.findByIdAndUpdate(
      req.params.id,
      { interviewScore: score, interviewRecommendation: recommendation },
      { new: true },
    );
    if (!application) {
      sendError(res, "Application not found", 404);
      return;
    }
    sendSuccess(res, { ok: true });
  }),
);

export default router;
