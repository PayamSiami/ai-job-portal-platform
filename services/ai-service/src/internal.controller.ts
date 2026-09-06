import { z } from "zod";
import { asyncHandler, sendError, sendSuccess } from "@portal/shared";
import {
  generateInterviewQuestions,
  scoreAnswer,
  generateInterviewReport,
} from "./interview.ai.js";
import {
  screenApplication,
  generateJobDescription,
  generateCoverLetter,
  analyzeResume,
} from "./features.ai.js";

function parse<S extends z.ZodTypeAny>(schema: S, body: unknown, res: import("express").Response): z.infer<S> | null {
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    sendError(res, parsed.error.issues[0]?.message ?? "Invalid request body", 400);
    return null;
  }
  return parsed.data;
}

// ------------------------- Interview AI -------------------------

const QuestionsSchema = z.object({
  jobTitle: z.string().min(1),
  jobSkills: z.array(z.string()).default([]),
  experienceLevel: z.string().default("mid"),
  resumeSummary: z.string().default(""),
  coverLetter: z.string().optional(),
  language: z.enum(["fa", "en"]).default("fa"),
  count: z.number().int().min(3).max(8).optional(),
});

export const interviewQuestions = asyncHandler(async (req, res) => {
  const input = parse(QuestionsSchema, req.body, res);
  if (!input) return;
  const result = await generateInterviewQuestions({
    ...input,
    jobSkills: input.jobSkills ?? [],
    experienceLevel: input.experienceLevel ?? "mid",
    resumeSummary: input.resumeSummary ?? "",
    language: input.language ?? "fa",
  });
  if (!result.success) return sendError(res, result.error ?? "AI unavailable", 502);
  sendSuccess(res, { questions: result.questions }, "Interview questions generated");
});

const ScoreSchema = z.object({
  jobTitle: z.string().min(1),
  question: z.string().min(1),
  questionType: z.string().default("technical"),
  answer: z.string().min(1),
  language: z.enum(["fa", "en"]).default("fa"),
});

export const interviewScore = asyncHandler(async (req, res) => {
  const input = parse(ScoreSchema, req.body, res);
  if (!input) return;
  const result = await scoreAnswer({
    ...input,
    questionType: input.questionType ?? "technical",
    language: input.language ?? "fa",
  });
  if (!result.success) return sendError(res, result.error ?? "AI unavailable", 502);
  sendSuccess(res, { score: result.score }, "Answer scored");
});

const ReportSchema = z.object({
  jobTitle: z.string().min(1),
  language: z.enum(["fa", "en"]).default("fa"),
  transcript: z
    .array(
      z.object({
        question: z.string(),
        answer: z.string(),
        score: z.number(),
      }),
    )
    .min(1),
});

export const interviewReport = asyncHandler(async (req, res) => {
  const input = parse(ReportSchema, req.body, res);
  if (!input) return;
  const result = await generateInterviewReport(input);
  if (!result.success) return sendError(res, result.error ?? "AI unavailable", 502);
  sendSuccess(res, { report: result.report }, "Interview report generated");
});

// ------------------------- Other AI features -------------------------

const ScreenSchema = z.object({
  resumeText: z.string().min(1),
  coverLetter: z.string().default(""),
  job: z.object({
    title: z.string(),
    description: z.string(),
    requirements: z.string().optional(),
    skills: z.array(z.string()).default([]),
    experienceLevel: z.string().optional(),
  }),
});

export const screen = asyncHandler(async (req, res) => {
  const input = parse(ScreenSchema, req.body, res);
  if (!input) return;
  const result = await screenApplication(input);
  if (!result.success) return sendError(res, result.error ?? "AI unavailable", 502);
  sendSuccess(res, { screening: result.result }, "Application screened");
});

const DescriptionSchema = z.object({
  title: z.string().min(1),
  skills: z.array(z.string()).default([]),
  experienceLevel: z.string().default("mid"),
});

export const description = asyncHandler(async (req, res) => {
  const input = parse(DescriptionSchema, req.body, res);
  if (!input) return;
  const result = await generateJobDescription(input);
  if (!result.success) return sendError(res, result.error ?? "AI unavailable", 502);
  sendSuccess(res, result, "Description generated");
});

const CoverLetterSchema = z.object({
  resumeSummary: z.string().min(1),
  jobTitle: z.string().min(1),
  companyName: z.string().optional(),
  tone: z.string().optional(),
  language: z.enum(["fa", "en"]).default("fa"),
});

export const coverLetter = asyncHandler(async (req, res) => {
  const input = parse(CoverLetterSchema, req.body, res);
  if (!input) return;
  const result = await generateCoverLetter(input);
  if (!result.success) return sendError(res, result.error ?? "AI unavailable", 502);
  sendSuccess(res, result, "Cover letter generated");
});

const AnalyzeSchema = z.object({
  resumeText: z.string().min(1),
  targetRole: z.string().optional(),
  language: z.enum(["fa", "en"]).default("fa"),
});

export const analyzeResumeEndpoint = asyncHandler(async (req, res) => {
  const input = parse(AnalyzeSchema, req.body, res);
  if (!input) return;
  const result = await analyzeResume(input);
  if (!result.success) return sendError(res, result.error ?? "AI unavailable", 502);
  sendSuccess(res, result, "Resume analyzed");
});
