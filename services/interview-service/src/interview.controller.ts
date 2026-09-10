import { z } from "zod";
import { Readable } from "node:stream";
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
  aiScoreStream,
  getApplication,
  getJobSkills,
  getResumeContent,
} from "./clients.js";
import {
  DISC_ITEMS,
  DISC_ITEM_COUNT,
  DISC_RATING_MIN,
  DISC_RATING_MAX,
  computeDisc,
  discItemText,
} from "./disc.js";

// ------------------------------------------------------------
// AI Interview service: candidates run an AI-conducted interview
// against one of their applications. One session per application.
// Access is validated against application-service snapshots.
// ------------------------------------------------------------

const StartSchema = z.object({
  applicationId: z.string().min(1),
  language: z.enum(["fa", "en"]).default("fa"),
  // Employer-supplied questions. When provided, the interview is human-graded
  // (mode "custom") — answers are saved without an AI score and the employer
  // evaluates them. Otherwise questions are AI-generated (mode "ai").
  customQuestions: z.array(z.string().min(3).max(300)).min(1).max(20).optional(),
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

  let questions;
  let mode: "ai" | "custom" = "ai";
  const customQuestions = body.data.customQuestions?.length
    ? body.data.customQuestions
    : undefined;

  if (customQuestions) {
    // Employer-provided questions → human-graded interview.
    mode = "custom";
    questions = customQuestions.map((text) => ({ type: "employer" as const, text }));
  } else {
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

    questions = await aiQuestions({
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
  }

  const session = await InterviewSession.create({
    applicationId: application._id,
    jobId: application.jobId,
    jobTitle: application.jobTitle,
    candidateId: application.candidateId,
    employerId: application.employerId,
    language: body.data.language,
    mode,
    customQuestions: customQuestions ?? [],
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

  // Human-graded mode: employer supplied the questions; no AI scoring here
  // (the employer evaluates the transcript + DISC profile later).
  if (session.mode === "custom") {
    session.answers.push({
      questionIndex: qIndex,
      answer: body.data.answer,
      score: null,
      feedback: "",
      strengths: [],
      improvements: [],
      answeredAt: new Date(),
    });

    const isLast = session.answers.length === session.questions.length;
    if (isLast) {
      session.status = "completed";
      session.completedAt = new Date();
      session.summary = "Employer evaluation pending";
    }

    await session.save();

    if (isLast && session.status === "completed") {
      await publishEvent(EventNames.InterviewCompleted, {
        interviewId: String(session._id),
        applicationId: session.applicationId,
        jobId: session.jobId,
        jobTitle: session.jobTitle,
        candidateId: session.candidateId,
        employerId: session.employerId,
        overallScore: null,
        recommendation: "pending",
      });
    }

    const nextIndex = isLast ? -1 : session.answers.length;
    const nextQuestion = !isLast ? session.questions[nextIndex] : undefined;

    return sendSuccess(
      res,
      {
        ...toClient(session),
        mode: session.mode,
        scored: session.answers[qIndex],
        nextQuestion: nextQuestion
          ? { index: nextIndex, type: nextQuestion.type, text: nextQuestion.text }
          : null,
        finished: isLast,
      },
      isLast ? "Interview completed" : "Answer recorded",
    );
  }

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
        session.answers.reduce((s, a) => s + (a.score ?? 0), 0) / Math.max(session.answers.length, 1);
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

// ------------------------- Streaming answer (SSE) -------------------------
// POST /:id/answer/stream — same validation/ownership rules as answerQuestion,
// but the AI response is streamed token-by-token to the browser as
// `data: {"type":"token","content":"..."}`, then a final
// `data: {"type":"done", ...}` carrying the scored answer + next question.
// Used for a "live typing" interview experience. The non-streaming `answer`
// endpoint still exists and behaves identically (minus the streaming).

function extractFirstJson(raw: string): unknown {
  const cleaned = raw.replace(/```(?:json)?\s*/g, "").trim();
  const start = cleaned.search(/[{[]/);
  if (start === -1) return null;
  const opener = cleaned[start];
  const end = cleaned.lastIndexOf(opener === "{" ? "}" : "]");
  if (end <= start) return null;
  try {
    return JSON.parse(cleaned.slice(start, end + 1));
  } catch {
    return null;
  }
}

export const answerStream = asyncHandler(async (req: Request, res: Response) => {
  const ctx = userContext(req);
  if (ctx.role !== "job-seeker") return sendError(res, "Only candidates can answer", 403);

  const body = AnswerSchema.safeParse(req.body);
  if (!body.success) {
    return sendError(res, body.error.issues[0]?.message ?? "Invalid answer", 400);
  }

  const session = await InterviewSession.findById(req.params.id);
  if (!session) return sendError(res, "Interview not found", 404);
  if (session.candidateId !== ctx.userId) return sendError(res, "Not your interview", 403);
  if (session.status !== "in_progress") return sendError(res, `Interview is ${session.status}`, 400);

  const qIndex = session.answers.length;
  if (qIndex >= session.questions.length) {
    return sendError(res, "All questions already answered", 400);
  }

  const question = session.questions[qIndex];

  // Human-graded mode: no AI stream. Record the answer server-side, then send a
  // single confirmation token + the final done frame (next question / finish).
  if (session.mode === "custom") {
    session.answers.push({
      questionIndex: qIndex,
      answer: body.data.answer,
      score: null,
      feedback: "",
      strengths: [],
      improvements: [],
      answeredAt: new Date(),
    });

    const isLast = session.answers.length === session.questions.length;
    if (isLast) {
      session.status = "completed";
      session.completedAt = new Date();
      session.summary = "Employer evaluation pending";
    }
    await session.save();

    if (isLast && session.status === "completed") {
      await publishEvent(EventNames.InterviewCompleted, {
        interviewId: String(session._id),
        applicationId: session.applicationId,
        jobId: session.jobId,
        jobTitle: session.jobTitle,
        candidateId: session.candidateId,
        employerId: session.employerId,
        overallScore: null,
        recommendation: "pending",
      });
    }

    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");
    res.flushHeaders();

    const sendEvent = (payload: unknown) => {
      res.write(`data: ${JSON.stringify(payload)}\n\n`);
    };
    const nextIndex = isLast ? -1 : session.answers.length;
    const nextQuestion = !isLast ? session.questions[nextIndex] : undefined;
    sendEvent({ type: "token", content: "Answer recorded." });
    sendEvent({
      type: "done",
      ...toClient(session),
      mode: session.mode,
      scored: session.answers[qIndex],
      nextQuestion: nextQuestion
        ? { index: nextIndex, type: nextQuestion.type, text: nextQuestion.text }
        : null,
      finished: isLast,
    });
    res.end();
    return;
  }

  let streamResponse: Awaited<ReturnType<typeof aiScoreStream>> | undefined;
  try {
    streamResponse = await aiScoreStream({
      jobTitle: session.jobTitle,
      question: question.text,
      questionType: question.type,
      answer: body.data.answer,
      language: session.language,
    });
  } catch (err) {
    console.error("[interview] ai stream setup failed:", err instanceof Error ? err.message : err);
    return sendError(res, "AI interview is temporarily unavailable. Please retry.", 503);
  }

  // Headers must be set before flushing so the gateway forwards them as SSE.
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders();

  let buffer = "";
  let accumulated = "";
  let finalized = false;

  const sendEvent = (payload: unknown) => {
    res.write(`data: ${JSON.stringify(payload)}\n\n`);
  };

  const onFragment = (frag: string) => {
    accumulated += frag;
    sendEvent({ type: "token", content: frag });
  };

  // Mirrors answerQuestion's post-scoring side effects (DB save, report, event,
  // application write-back), but emits the result to the SSE client instead of
  // a normal JSON response.
  const finalize = async () => {
    if (finalized) return;
    finalized = true;

    const parsed = extractFirstJson(accumulated);
    if (
      !parsed ||
      typeof parsed !== "object" ||
      typeof (parsed as { score?: unknown }).score !== "number"
    ) {
      sendEvent({ type: "error", message: "AI scoring was malformed; answer not saved." });
      res.end();
      return;
    }

    const parsedScore = parsed as { score: number; feedback?: string; strengths?: unknown; improvements?: unknown };
    const scoreAs = {
      score: Math.min(Math.max(parsedScore.score, 0), 10),
      feedback: parsedScore.feedback ?? "",
      strengths: asStringArray(parsedScore.strengths),
      improvements: asStringArray(parsedScore.improvements),
    };

    session.answers.push({
      questionIndex: qIndex,
      answer: body.data.answer,
      score: scoreAs.score,
      feedback: scoreAs.feedback,
      strengths: scoreAs.strengths,
      improvements: scoreAs.improvements,
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
          session.answers.reduce((s, a) => s + (a.score ?? 0), 0) / Math.max(session.answers.length, 1);
        session.overallScore = Math.round(avg * 10) / 10;
        session.recommendation = avg >= 7 ? "hire" : avg >= 5 ? "maybe" : "no-hire";
        session.summary = "AI report unavailable; score is the average of per-answer scores.";
      }
      session.status = "completed";
      session.completedAt = new Date();
    }

    try {
      await session.save();
    } catch (saveErr) {
      console.error("[interview] save after stream failed:", saveErr);
      sendEvent({ type: "error", message: "Answer scored but failed to persist; please retry the answer." });
      res.end();
      return;
    }

    if (isLast && session.status === "completed") {
      void import("./clients.js").then(({ syncResultToApplication }) =>
        syncResultToApplication(
          session.applicationId,
          session.overallScore ?? 0,
          session.recommendation ?? "maybe",
        ),
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

    sendEvent({
      type: "done",
      ...toClient(session),
      scored: session.answers[qIndex],
      nextQuestion: nextQuestion
        ? { index: nextIndex, type: nextQuestion.type, text: nextQuestion.text }
        : null,
      finished: isLast,
    });
    res.end();
  };

  // Stream the SSE frames from ai-service to the client, token by token, while
  // accumulating the concatenated JSON for the final parse.
  const abort = new AbortController();
  res.on("close", () => {
    abort.abort();
    if (!finalized) {
      finalized = true;
      res.end();
    }
  });

  const webStream = streamResponse.body;
  if (!webStream) {
    sendEvent({ type: "error", message: "AI service returned no stream body." });
    res.end();
    return;
  }
  const nodeStream = Readable.fromWeb(webStream as unknown as globalThis.ReadableStream<Uint8Array>, { signal: abort.signal });

  nodeStream.on("error", (err: unknown) => {
    if (finalized) return;
    console.error("[interview] stream error:", err instanceof Error ? err.message : err);
    sendEvent({ type: "error", message: "Stream interrupted. Your answer may not have been saved." });
    res.end();
  });

  nodeStream.on("data", (chunk: Buffer | string) => {
    if (finalized) return;
    buffer += typeof chunk === "string" ? chunk : chunk.toString("utf8");
    // Parse complete SSE frames delimited by a blank line.
    let idx: number;
    while ((idx = buffer.indexOf("\n\n")) !== -1 && !finalized) {
      const frame = buffer.slice(0, idx);
      buffer = buffer.slice(idx + 2);
      let dataLine = "";
      for (const line of frame.split("\n")) {
        if (line.startsWith("data:")) dataLine = line.slice(5).trim();
      }
      if (dataLine === "[DONE]") {
        void finalize();
        return;
      }
      if (!dataLine || dataLine === "[DONE]") continue;
      try {
        const val = JSON.parse(dataLine);
        if (typeof val === "string") onFragment(val);
        else if (val && typeof val.error === "string") {
          sendEvent({ type: "error", message: val.error });
          res.end();
          return;
        }
      } catch {
        /* ignore malformed frame */
      }
    }
  });

  nodeStream.on("end", () => {
    if (!finalized) void finalize();
  });
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
    mode: session.mode,
    customQuestions: session.customQuestions ?? [],
    disc: session.disc
      ? {
          completed: true,
          scores: session.disc.scores,
          primary: session.disc.primary,
          label: session.disc.label,
          completedAt: session.disc.completedAt,
        }
      : null,
    overallScore: session.overallScore,
    recommendation: session.recommendation,
    summary: session.summary,
    startedAt: session.startedAt,
    completedAt: session.completedAt,
  };
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];
}

// ------------------------- DISC assessment -------------------------
// Available when mode === "custom". The candidate self-reports on 24
// statements; scores are computed client-side-free on the server, and the
// employer reviews the resulting profile.

const DiscAnswersSchema = z.object({
  responses: z
    .array(
      z.object({
        index: z.number().int().min(0).max(DISC_ITEM_COUNT - 1),
        rating: z.number().int().min(DISC_RATING_MIN).max(DISC_RATING_MAX),
      }),
    )
    .min(DISC_ITEM_COUNT, `All ${DISC_ITEM_COUNT} items are required`)
    .max(DISC_ITEM_COUNT),
});

export const discItems = asyncHandler(async (req: Request, res: Response) => {
  const session = await InterviewSession.findById(req.params.id);
  if (!session) return sendError(res, "Interview not found", 404);
  const ctx = userContext(req);
  // Candidate needs them to answer; employer may preview the profile view.
  if (ctx.userId !== session.candidateId && ctx.userId !== session.employerId) {
    return sendError(res, "Access denied", 403);
  }
  const language = (req.query.lang === "en" ? "en" : session.language === "en" ? "en" : "fa") as "en" | "fa";
  sendSuccess(
    res,
    DISC_ITEMS.map((it, index) => ({
      index,
      factor: it.factor,
      text: discItemText(it, language),
    })),
    "DISC items",
  );
});

export const saveDisc = asyncHandler(async (req: Request, res: Response) => {
  const ctx = userContext(req);
  const session = await InterviewSession.findById(req.params.id);
  if (!session) return sendError(res, "Interview not found", 404);
  if (session.candidateId !== ctx.userId) return sendError(res, "Not your interview", 403);
  if (session.mode !== "custom") {
    return sendError(res, "DISC is only available for employer-custom interviews", 400);
  }

  const parsed = DiscAnswersSchema.safeParse(req.body);
  if (!parsed.success) {
    return sendError(res, parsed.error.issues[0]?.message ?? "Invalid input", 400);
  }

  // dedupe / validate indices form a complete set
  const byIndex = new Map<number, number>();
  for (const r of parsed.data.responses) byIndex.set(r.index, r.rating);
  if (byIndex.size !== DISC_ITEM_COUNT) {
    return sendError(res, "Each DISC item must be rated exactly once", 400);
  }

  const computed = computeDisc(parsed.data.responses, session.language);
  session.disc = {
    responses: parsed.data.responses,
    scores: computed.scores,
    primary: computed.primary,
    label: computed.label,
    completedAt: new Date(),
  };
  await session.save();

  // DISC is an optional assessment; the interview's completed status is driven
  // by answering all questions, not by submitting DISC, so we do NOT auto-complete
  // here. The candidate may take DISC before or after finishing the Q&A.
  sendSuccess(res, toClient(session).disc, "DISC assessment recorded", 200);
});

export const discDetail = asyncHandler(async (req: Request, res: Response) => {
  const ctx = userContext(req);
  const session = await InterviewSession.findById(req.params.id).select("disc employerId mode");
  if (!session) return sendError(res, "Interview not found", 404);
  if (session.employerId !== ctx.userId && ctx.role !== "admin") {
    return sendError(res, "Access denied", 403);
  }
  if (!session.disc) return sendError(res, "DISC assessment not completed", 404);
  sendSuccess(
    res,
    {
      scores: session.disc.scores,
      primary: session.disc.primary,
      label: session.disc.label,
      completedAt: session.disc.completedAt,
    },
    "DISC profile",
  );
});

void AppError;
