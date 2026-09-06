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
import { InterviewSession, type IInterviewSession } from "./interview.model.js";
import {
  aiQuestions,
  aiReport,
  aiScore,
  getApplication,
  getJobSkills,
  getResumeContent,
} from "./clients.js";

// ------------------------------------------------------------
// AI Interview service: candidates run an AI-conducted interview
// against one of their applications. One session per application.
// Access is validated against application-service snapshots.
// ------------------------------------------------------------

const StartSchema = z.object({
  applicationId: z.string().min(1),
  language: z.enum(["fa", "en"]).default("fa"),
});

const AnswerSchema = z.object({
  answer: z.string().min(20, "Answer must be at least 20 characters").max(4000),
});

export const startInterview = asyncHandler(async (req: Request, res: Response) => {
  const ctx = userContext(req);
  if (ctx.role !== "job-seeker") return sendError(res, "Only candidates can take interviews", 403);

  const body = StartSchema.safeParse(req.body ?? {});
  if (!body.success) return sendError(res, "applicationId is required", 400);

  const application = await getApplication(body.data.applicationId, ctx.userId!);
  if (!application) return sendError(res, "Application not found", 404);
  if (application.candidateId !== ctx.userId) {
    return sendError(res, "You can only interview for your own applications", 403);
  }
  if (application.status === "withdrawn" || application.status === "rejected") {
    return sendError(res, `Cannot interview a ${application.status} application`, 400);
  }

  const existing = await InterviewSession.findOne({ applicationId: application._id });
  if (existing) {
    if (existing.status === "in_progress") {
      return sendSuccess(res, toClient(existing), "Interview already in progress");
    }
    return sendError(res, "This application already has a completed interview", 409);
  }

  const [jobInfo, resumeContent] = await Promise.all([
    getJobSkills(application.jobId),
    getResumeContent(application.resumeId),
  ]);

  const resumeSummary = resumeContent
    ? [
        resumeContent.summary ?? resumeContent.title,
        `Skills: ${resumeContent.skills.join(", ")}`,
        ...resumeContent.workExperience.map(
          (w) => `${w.position} at ${w.company}${w.description ? `: ${w.description}` : ""}`,
        ),
      ]
        .filter(Boolean)
        .join("\n")
    : "";

  const questions = await aiQuestions({
    jobTitle: application.jobTitle,
    jobSkills: jobInfo?.skills ?? [],
    experienceLevel: jobInfo?.experienceLevel ?? "mid",
    resumeSummary,
    coverLetter: application.coverLetter,
    language: body.data.language,
  });

  if (!questions || questions.length === 0) {
    return sendError(res, "AI interview is temporarily unavailable. Please try again later.", 503);
  }

  const session = await InterviewSession.create({
    applicationId: application._id,
    jobId: application.jobId,
    jobTitle: application.jobTitle,
    candidateId: application.candidateId,
    employerId: application.employerId,
    language: body.data.language,
    status: "in_progress",
    questions,
    answers: [],
  });

  sendSuccess(res, toClient(session), "Interview started", 201);
});

export const getInterview = asyncHandler(async (req: Request, res: Response) => {
  const ctx = userContext(req);
  const session = await InterviewSession.findById(req.params.id);
  if (!session) return sendError(res, "Interview not found", 404);
  if (!isParticipant(session, ctx)) return sendError(res, "Access denied", 403);
  sendSuccess(res, toClient(session));
});

export const byApplication = asyncHandler(async (req: Request, res: Response) => {
  const ctx = userContext(req);
  const session = await InterviewSession.findOne({ applicationId: req.params.applicationId });
  if (!session) return sendError(res, "No interview for this application", 404);
  if (!isParticipant(session, ctx)) return sendError(res, "Access denied", 403);
  sendSuccess(res, toClient(session));
});

export const answerQuestion = asyncHandler(async (req: Request, res: Response) => {
  const ctx = userContext(req);
  if (ctx.role !== "job-seeker") return sendError(res, "Only candidates can answer", 403);

  const body = AnswerSchema.safeParse(req.body);
  if (!body.success) {
    return sendError(res, body.error.issues[0]?.message ?? "Invalid answer", 400);
  }

  const session = await InterviewSession.findById(req.params.id);
  if (!session) return sendError(res, "Interview not found", 404);
  if (session.candidateId !== ctx.userId) return sendError(res, "Not your interview", 403);
  if (session.status !== "in_progress") {
    return sendError(res, `Interview is ${session.status}`, 400);
  }

  const qIndex = session.answers.length;
  if (qIndex >= session.questions.length) {
    return sendError(res, "All questions already answered", 400);
  }

  const question = session.questions[qIndex];
  const score = await aiScore({
    jobTitle: session.jobTitle,
    question: question.text,
    questionType: question.type,
    answer: body.data.answer,
    language: session.language,
  });

  if (!score) {
    return sendError(
      res,
      "AI scoring is temporarily unavailable. Your answer was not saved — please retry.",
      503,
    );
  }

  session.answers.push({
    questionIndex: qIndex,
    answer: body.data.answer,
    score: score.score,
    feedback: score.feedback,
    strengths: score.strengths,
    improvements: score.improvements,
    answeredAt: new Date(),
  });

  const isLast = session.answers.length === session.questions.length;
  if (isLast) {
    const report = await aiReport({
      jobTitle: session.jobTitle,
      language: session.language,
      transcript: session.questions.map((q, i) => ({
        question: q.text,
        answer: session.answers[i]?.answer ?? "",
        score: session.answers[i]?.score ?? 0,
      })),
    });

    if (report) {
      session.overallScore = report.overallScore;
      session.recommendation = report.recommendation;
      session.summary = report.summary;
    } else {
      const avg =
        session.answers.reduce((s, a) => s + a.score, 0) / Math.max(session.answers.length, 1);
      session.overallScore = Math.round(avg * 10) / 10;
      session.recommendation = avg >= 7 ? "hire" : avg >= 5 ? "maybe" : "no-hire";
      session.summary = "AI report unavailable; score is the average of per-answer scores.";
    }

    session.status = "completed";
    session.completedAt = new Date();
  }

  await session.save();

  if (isLast && session.status === "completed") {
    // Fire-and-forget write-back: application-service stores the summary.
    void import("./clients.js").then(({ syncResultToApplication }) =>
      syncResultToApplication(session.applicationId, session.overallScore ?? 0, session.recommendation ?? "maybe"),
    );

    await publishEvent(EventNames.InterviewCompleted, {
      interviewId: String(session._id),
      applicationId: session.applicationId,
      jobId: session.jobId,
      jobTitle: session.jobTitle,
      candidateId: session.candidateId,
      employerId: session.employerId,
      overallScore: session.overallScore ?? 0,
      recommendation: session.recommendation ?? "maybe",
    });
  }

  const nextIndex = isLast ? -1 : session.answers.length;
  const nextQuestion = !isLast ? session.questions[nextIndex] : undefined;

  sendSuccess(
    res,
    {
      ...toClient(session),
      scored: session.answers[qIndex],
      nextQuestion: nextQuestion
        ? { index: nextIndex, type: nextQuestion.type, text: nextQuestion.text }
        : null,
      finished: isLast,
    },
    isLast ? "Interview completed" : "Answer scored",
  );
});

export const abandonInterview = asyncHandler(async (req: Request, res: Response) => {
  const ctx = userContext(req);
  const session = await InterviewSession.findById(req.params.id);
  if (!session) return sendError(res, "Interview not found", 404);
  if (session.candidateId !== ctx.userId) return sendError(res, "Not your interview", 403);
  if (session.status !== "in_progress") return sendError(res, "Interview is not active", 400);

  session.status = "abandoned";
  await session.save();
  sendSuccess(res, toClient(session), "Interview abandoned");
});

export const employerReport = asyncHandler(async (req: Request, res: Response) => {
  const ctx = userContext(req);
  const session = await InterviewSession.findById(req.params.id);
  if (!session) return sendError(res, "Interview not found", 404);
  if (session.employerId !== ctx.userId && ctx.role !== "admin") {
    return sendError(res, "Access denied", 403);
  }
  sendSuccess(res, toClient(session), "Interview report");
});

export const employerInterviews = asyncHandler(async (req: Request, res: Response) => {
  const ctx = userContext(req);
  const page = Math.max(parseInt(String(req.query.page) || "1", 10), 1);
  const limit = Math.min(parseInt(String(req.query.limit) || "20", 10), 50);

  const filter: Record<string, unknown> = { employerId: ctx.userId };
  if (req.query.status) filter.status = req.query.status;

  const [items, total] = await Promise.all([
    InterviewSession.find(filter).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit).lean(),
    InterviewSession.countDocuments(filter),
  ]);
  sendSuccess(res, { items, total, page, limit, pages: Math.ceil(total / limit) });
});

// ------------------------- Internal -------------------------

/** Application-service asks for the interview summary attached to one of its applications. */
export const internalByApplication = asyncHandler(async (req: Request, res: Response) => {
  const session = await InterviewSession.findOne({ applicationId: req.params.applicationId })
    .select("status overallScore recommendation completedAt")
    .lean();
  sendSuccess(res, session ?? null);
});

// ------------------------- helpers -------------------------

function isParticipant(
  session: IInterviewSession,
  ctx: { userId?: string; role?: string },
): boolean {
  return session.candidateId === ctx.userId || session.employerId === ctx.userId || ctx.role === "admin";
}

function toClient(session: IInterviewSession) {
  return {
    _id: String(session._id),
    applicationId: session.applicationId,
    jobId: session.jobId,
    jobTitle: session.jobTitle,
    candidateId: session.candidateId,
    language: session.language,
    status: session.status,
    questions: session.questions.map((q, i) => ({
      index: i,
      type: q.type,
      text: q.text,
      answered: (session.answers?.length ?? 0) > i,
    })),
    answers: session.answers,
    overallScore: session.overallScore,
    recommendation: session.recommendation,
    summary: session.summary,
    startedAt: session.startedAt,
    completedAt: session.completedAt,
  };
}

void AppError;
