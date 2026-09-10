import { z } from "zod";
import type { Request, Response } from "express";
import {
  AppError,
  asyncHandler,
  publishEvent,
  EventNames,
  sendError,
  sendSuccess,
  userContext,
} from "@portal/shared";
import { Application, ALLOWED_TRANSITIONS, type ApplicationStatus } from "./application.model.js";
import { getJob, getResumeOwned, screenWithAI, getCandidateProfile } from "./clients.js";

export const ApplySchema = z.object({
  jobId: z.string().min(1),
  resumeId: z.string().min(1),
  coverLetter: z.string().min(50, "Cover letter must be at least 50 characters").max(5000),
  expectedSalary: z.number().int().nonnegative().optional(),
  availableFrom: z.coerce.date().optional(),
});

export const StatusSchema = z.object({
  status: z.enum(["pending", "reviewing", "shortlisted", "interview", "offered", "rejected", "withdrawn"]),
});

export const ListSchema = z.object({
  status: z.string().optional(),
  jobId: z.string().optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

// ------------------------------------------------------------
// Candidate: apply for a job
// ------------------------------------------------------------

export const apply = asyncHandler(async (req: Request, res: Response) => {
  const ctx = userContext(req);
  if (ctx.role !== "job-seeker") return sendError(res, "Only job seekers can apply", 403);
  const body = ApplySchema.safeParse(req.body);
  if (!body.success) return sendError(res, body.error.issues[0]?.message ?? "Invalid input", 400);

  const job = await getJob(body.data.jobId);
  if (!job) return sendError(res, "Job not found", 404);
  if (!job.isActive) return sendError(res, "This job is no longer accepting applications", 400);

  const resume = await getResumeOwned(body.data.resumeId, ctx.userId!);
  if (!resume) return sendError(res, "Resume not found or not owned by you", 404);

  let application;
  try {
    application = await Application.create({
      jobId: job._id,
      jobTitle: job.title,
      employerId: job.employerId,
      candidateId: ctx.userId!,
      resumeId: body.data.resumeId,
      coverLetter: body.data.coverLetter,
      expectedSalary: body.data.expectedSalary,
      availableFrom: body.data.availableFrom,
      status: "pending",
    });
  } catch (err) {
    if (err instanceof Error && err.message.includes("duplicate")) {
      return sendError(res, "You have already applied for this job", 409);
    }
    throw err;
  }

  await publishEvent(EventNames.ApplicationCreated, {
    applicationId: String(application._id),
    jobId: job._id,
    jobTitle: job.title,
    candidateId: ctx.userId!,
    employerId: job.employerId,
  });

  // AI screening runs in the background: the candidate gets an instant
  // response, results land on the document when ready (fixes the legacy
  // behaviour of blocking the HTTP request on an LLM call).
  void screenInBackground(String(application._id), body.data.coverLetter, job);

  sendSuccess(res, application.toJSON(), "Application submitted", 201);
});

async function screenInBackground(
  applicationId: string,
  coverLetter: string,
  job: { title: string; description: string; requirements?: string; skills: string[]; experienceLevel: string },
): Promise<void> {
  const { getResumeContent } = await import("./clients.js");
  try {
    const resume = await Application.findById(applicationId).select("resumeId");
    if (!resume) return;
    const content = await getResumeContent(resume.resumeId);
    const resumeText = content
      ? [
          content.title,
          content.summary,
          `Skills: ${content.skills.join(", ")}`,
          ...content.workExperience.map(
            (w) => `${w.position} at ${w.company}: ${w.description ?? ""}`,
          ),
          ...content.education.map((e) => `${e.degree}, ${e.institution}`),
        ]
          .filter(Boolean)
          .join("\n")
      : "";

    const screening = await screenWithAI({
      resumeText,
      coverLetter,
      job: {
        title: job.title,
        description: job.description,
        skills: job.skills,
        experienceLevel: job.experienceLevel,
      },
    });
    if (!screening) return;

    await Application.updateOne(
      { _id: applicationId },
      {
        aiScore: screening.score,
        aiExplanation: screening.explanation,
        aiStrengths: screening.strengths,
        aiWeaknesses: screening.weaknesses,
        aiRecommendation: screening.recommendation,
        aiScreenedAt: new Date(),
      },
    );
  } catch (err) {
    console.error(`[application] background screening failed for ${applicationId}:`, err);
  }
}

// ------------------------------------------------------------
// Candidate: my applications + withdraw
// ------------------------------------------------------------

export const myApplications = asyncHandler(async (req: Request, res: Response) => {
  const ctx = userContext(req);
  const parsed = ListSchema.safeParse(req.query);
  if (!parsed.success) return sendError(res, "Invalid query", 400);
  const { status, jobId, page, limit } = parsed.data;

  const filter: Record<string, unknown> = { candidateId: ctx.userId };
  if (status) filter.status = status;
  if (jobId) filter.jobId = jobId;

  const [items, total] = await Promise.all([
    Application.find(filter)
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean(),
    Application.countDocuments(filter),
  ]);
  sendSuccess(res, { items, total, page, limit, pages: Math.ceil(total / limit) });
});

export const withdraw = asyncHandler(async (req: Request, res: Response) => {
  const ctx = userContext(req);
  const application = await Application.findById(req.params.id);
  if (!application) return sendError(res, "Application not found", 404);
  if (application.candidateId !== ctx.userId) return sendError(res, "Not your application", 403);
  if (!["pending", "reviewing", "shortlisted"].includes(application.status)) {
    return sendError(res, `Cannot withdraw from status: ${application.status}`, 400);
  }

  const oldStatus = application.status;
  application.status = "withdrawn";
  await application.save();

  await publishEvent(EventNames.ApplicationStatusChanged, {
    applicationId: String(application._id),
    jobId: application.jobId,
    jobTitle: application.jobTitle,
    candidateId: application.candidateId,
    employerId: application.employerId,
    oldStatus,
    newStatus: "withdrawn",
  });
  sendSuccess(res, application.toJSON(), "Application withdrawn");
});

// ------------------------------------------------------------
// Employer: applications to my jobs
// ------------------------------------------------------------

export const employerApplications = asyncHandler(async (req: Request, res: Response) => {
  const ctx = userContext(req);
  const parsed = ListSchema.safeParse(req.query);
  if (!parsed.success) return sendError(res, "Invalid query", 400);
  const { status, jobId, page, limit } = parsed.data;

  const filter: Record<string, unknown> = { employerId: ctx.userId };
  if (status) filter.status = status;
  if (jobId) filter.jobId = jobId;

  const [items, total] = await Promise.all([
    Application.find(filter)
      .sort({ aiScore: -1, createdAt: -1 }) // best AI fits first
      .skip((page - 1) * limit)
      .limit(limit)
      .lean(),
    Application.countDocuments(filter),
  ]);
  sendSuccess(res, { items, total, page, limit, pages: Math.ceil(total / limit) });
});

// ------------------------------------------------------------
// Employer: candidates who applied to one of my jobs (profile-enriched)
// ------------------------------------------------------------

export const getCandidates = asyncHandler(async (req: Request, res: Response) => {
  const ctx = userContext(req);
  if (!ctx.userId) return sendError(res, "Authentication required", 401);

  const jobId = String(req.params.jobId);

  const parsed = ListSchema.safeParse(req.query);
  if (!parsed.success) return sendError(res, "Invalid query", 400);
  const { status, page, limit } = parsed.data;

  // Scoped by the employerId snapshot on the application document, so only
  // candidates who applied to jobs the caller posted are returned. A job-seeker
  // hitting this endpoint simply gets an empty list.
  const filter: Record<string, unknown> = { jobId, employerId: ctx.userId };
  if (status) filter.status = status;

  const [items, total] = await Promise.all([
    Application.find(filter)
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean(),
    Application.countDocuments(filter),
  ]);

  // Best-effort profile enrichment from auth-service; never blocks/fails the
  // response if the lookup fails for an individual candidate.
  const enriched = await Promise.all(
    items.map(async (app) => {
      const candidate = await getCandidateProfile(String(app.candidateId));
      return { ...app, candidate };
    }),
  );

  sendSuccess(res, { items: enriched, total, page, limit, pages: Math.ceil(total / limit) });
});

export const stats = asyncHandler(async (req: Request, res: Response) => {
  const ctx = userContext(req);
  const [byStatus, screening] = await Promise.all([
    Application.aggregate<{ _id: string; count: number }>([
      { $match: { employerId: ctx.userId } },
      { $group: { _id: "$status", count: { $sum: 1 } } },
    ]),
    Application.aggregate<{ avgAiScore: number | null; avgInterviewScore: number | null }>([
      { $match: { employerId: ctx.userId } },
      {
        $group: {
          _id: null,
          avgAiScore: { $avg: "$aiScore" },
          avgInterviewScore: { $avg: "$interviewScore" },
        },
      },
    ]),
  ]);

  const counts: Record<string, number> = {};
  for (const row of byStatus) counts[row._id] = row.count;
  const total = Object.values(counts).reduce((a, b) => a + b, 0);

  sendSuccess(res, {
    total,
    byStatus: counts,
    avgAiScore: screening[0]?.avgAiScore ?? null,
    avgInterviewScore: screening[0]?.avgInterviewScore ?? null,
  });
});

// ------------------------------------------------------------
// Shared: get one application (participant or admin)
// ------------------------------------------------------------

export const getById = asyncHandler(async (req: Request, res: Response) => {
  const ctx = userContext(req);
  const application = await Application.findById(req.params.id);
  if (!application) return sendError(res, "Application not found", 404);

  const isParticipant =
    application.candidateId === ctx.userId ||
    application.employerId === ctx.userId ||
    ctx.role === "admin";
  if (!isParticipant) return sendError(res, "Access denied", 403);

  sendSuccess(res, application.toJSON());
});

// ------------------------------------------------------------
// Employer: update status (with transition validation)
// ------------------------------------------------------------

export const updateStatus = asyncHandler(async (req: Request, res: Response) => {
  const ctx = userContext(req);
  const application = await Application.findById(req.params.id);
  if (!application) return sendError(res, "Application not found", 404);
  if (application.employerId !== ctx.userId && ctx.role !== "admin") {
    return sendError(res, "Only the employer of this job can update the status", 403);
  }

  const body = StatusSchema.safeParse(req.body);
  if (!body.success) return sendError(res, "Invalid status", 400);
  const next = body.data.status as ApplicationStatus;

  if (next === "withdrawn") return sendError(res, "Candidates withdraw their own applications", 400);
  const allowed = ALLOWED_TRANSITIONS[application.status];
  if (!allowed.includes(next)) {
    return sendError(res, `Cannot move from ${application.status} to ${next}`, 400);
  }

  const oldStatus = application.status;
  application.status = next;
  await application.save();

  await publishEvent(EventNames.ApplicationStatusChanged, {
    applicationId: String(application._id),
    jobId: application.jobId,
    jobTitle: application.jobTitle,
    candidateId: application.candidateId,
    employerId: application.employerId,
    oldStatus,
    newStatus: next,
  });
  sendSuccess(res, application.toJSON(), "Status updated");
});

void AppError;
