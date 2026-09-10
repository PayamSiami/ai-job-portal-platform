import { internalFetch, internalFetchStream } from "@portal/shared";

// Outbound internal clients. interview-service owns no application/job/
// resume data — it validates access and snapshots context via these calls.

const env = (name: string, fallback: string) => process.env[name] || fallback;
const APPLICATION = () => env("APPLICATION_SERVICE_URL", "http://localhost:8003");
const JOB = () => env("JOB_SERVICE_URL", "http://localhost:8002");
const RESUME = () => env("RESUME_SERVICE_URL", "http://localhost:8004");
const AI = () => env("AI_SERVICE_URL", "http://localhost:8006");

export interface ApplicationSnapshot {
  _id: string;
  jobId: string;
  jobTitle: string;
  candidateId: string;
  employerId: string;
  resumeId: string;
  coverLetter: string;
  status: string; // ApplicationStatus
  interviewScore?: number;
}

export async function getApplication(
  applicationId: string,
  requesterId: string,
): Promise<ApplicationSnapshot | null> {
  try {
    return await internalFetch<ApplicationSnapshot>(
      APPLICATION(),
      `/api/applications/internal/${applicationId}?requesterId=${requesterId}`,
      { timeoutMs: 10_000 },
    );
  } catch (err) {
    if (err instanceof Error && err.message.includes("404")) return null;
    throw err;
  }
}

export interface ResumeContent {
  title: string;
  summary?: string;
  skills: string[];
  workExperience: Array<{ position: string; company: string; description?: string }>;
  education: Array<{ degree: string; institution: string }>;
}

export async function getResumeContent(resumeId: string): Promise<ResumeContent | null> {
  try {
    return await internalFetch<ResumeContent>(
      RESUME(),
      `/api/resumes/internal/${resumeId}/content`,
      { timeoutMs: 10_000 },
    );
  } catch {
    return null; // interview can proceed with job context only
  }
}

export async function getJobSkills(jobId: string): Promise<{ skills: string[]; experienceLevel: string } | null> {
  try {
    const job = await internalFetch<{ skills?: string[]; experienceLevel?: string }>(
      JOB(),
      `/api/jobs/internal/${jobId}`,
      { timeoutMs: 10_000 },
    );
    return { skills: job?.skills ?? [], experienceLevel: job?.experienceLevel ?? "mid" };
  } catch {
    return null;
  }
}

// ------------------------- ai-service -------------------------

export interface InterviewQuestion {
  type: "technical" | "behavioral" | "resume" | "intro";
  text: string;
}

export interface AnswerScore {
  score: number;
  feedback: string;
  strengths: string[];
  improvements: string[];
}

export interface InterviewReport {
  overallScore: number;
  summary: string;
  strengths: string[];
  weaknesses: string[];
  recommendation: string;
}

export async function aiQuestions(input: {
  jobTitle: string;
  jobSkills: string[];
  experienceLevel: string;
  resumeSummary: string;
  coverLetter?: string;
  language: "fa" | "en";
  count?: number;
}): Promise<InterviewQuestion[] | null> {
  try {
    const data = await internalFetch<{ questions: InterviewQuestion[] }>(
      AI(),
      "/internal/interview/questions",
      { method: "POST", body: input, timeoutMs: 90_000 },
    );
    return data.questions;
  } catch (err) {
    console.error("[interview] question generation failed:", err);
    return null;
  }
}

export async function aiScore(input: {
  jobTitle: string;
  question: string;
  questionType: string;
  answer: string;
  language: "fa" | "en";
}): Promise<AnswerScore | null> {
  try {
    const data = await internalFetch<{ score: AnswerScore }>(
      AI(),
      "/internal/interview/score-answer",
      { method: "POST", body: input, timeoutMs: 90_000 },
    );
    return data.score;
  } catch (err) {
    console.error("[interview] answer scoring failed:", err);
    return null;
  }
}

/**
 * Streaming variant of aiScore: returns the raw fetch Response so the caller
 * can pipe SSE tokens to the client while accumulating the full score locally.
 */
export function aiScoreStream(input: {
  jobTitle: string;
  question: string;
  questionType: string;
  answer: string;
  language: "fa" | "en";
}) {
  return internalFetchStream(AI(), "/internal/interview/score-answer/stream", {
    method: "POST",
    body: input,
    timeoutMs: 90_000,
  });
}

export async function aiReport(input: {
  jobTitle: string;
  language: "fa" | "en";
  transcript: Array<{ question: string; answer: string; score: number }>;
}): Promise<InterviewReport | null> {
  try {
    const data = await internalFetch<{ report: InterviewReport }>(
      AI(),
      "/internal/interview/report",
      { method: "POST", body: input, timeoutMs: 90_000 },
    );
    return data.report;
  } catch (err) {
    console.error("[interview] report generation failed:", err);
    return null;
  }
}

/** Best-effort write-back of the final result onto the application document. */
export async function syncResultToApplication(
  applicationId: string,
  overallScore: number,
  recommendation: string,
): Promise<void> {
  try {
    await internalFetch(APPLICATION(), `/api/applications/internal/${applicationId}/interview-result`, {
      method: "PATCH",
      body: { overallScore, recommendation },
      timeoutMs: 10_000,
    });
  } catch (err) {
    console.error("[interview] failed to sync result to application-service:", err);
  }
}
