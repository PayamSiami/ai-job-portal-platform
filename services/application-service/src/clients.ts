import { internalFetch } from "@portal/shared";

// Outbound clients to sibling services. All calls are internal-token
// authenticated with timeouts; failures are converted to service errors.

const base = (name: string, fallback: string) => () =>
  process.env[name] || fallback;

const AUTH = base("AUTH_SERVICE_URL", "http://localhost:8001");
const JOB = base("JOB_SERVICE_URL", "http://localhost:8002");
const RESUME = base("RESUME_SERVICE_URL", "http://localhost:8004");
const AI = base("AI_SERVICE_URL", "http://localhost:8006");

export interface JobSummary {
  _id: string;
  title: string;
  employerId: string;
  isActive: boolean;
  skills: string[];
  experienceLevel: string;
  description: string;
}

export async function getJob(jobId: string): Promise<JobSummary | null> {
  try {
    return await internalFetch<JobSummary>(JOB(), `/api/jobs/internal/${jobId}`);
  } catch (err) {
    if (err instanceof Error && err.message.includes("404")) return null;
    throw err;
  }
}

export async function getResumeOwned(
  resumeId: string,
  userId: string,
): Promise<{ _id: string } | null> {
  try {
    return await internalFetch<{ _id: string }>(
      RESUME(),
      `/api/resumes/internal/${resumeId}?userId=${userId}`,
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
    return await internalFetch<ResumeContent>(RESUME(), `/api/resumes/internal/${resumeId}/content`);
  } catch {
    return null;
  }
}

/**
 * Light candidate profile used to enrich the getCandidates list view.
 * Only username + public profile are returned (PII omitted).
 */
export interface CandidateProfile {
  username: string;
  profile: {
    firstName?: string;
    lastName?: string;
    headline?: string;
    location?: string;
    skills?: string[];
    experience?: number;
  } | null;
}

export async function getCandidateProfile(userId: string): Promise<CandidateProfile | null> {
  try {
    const user = await internalFetch<{ username?: string; profile?: unknown }>(
      AUTH(),
      `/api/auth/internal/users/${userId}`,
      { timeoutMs: 10_000 },
    );
    if (!user) return null;
    return { username: user.username ?? "", profile: (user.profile as CandidateProfile["profile"]) ?? null };
  } catch {
    return null; // best-effort: enrichment failure never blocks the response
  }
}

export interface ScreeningResult {
  score: number;
  explanation: string;
  strengths: string[];
  weaknesses: string[];
  recommendation: string;
}

export async function screenWithAI(input: {
  resumeText: string;
  coverLetter: string;
  job: { title: string; description: string; requirements?: string; skills: string[]; experienceLevel?: string };
}): Promise<ScreeningResult | null> {
  try {
    const data = await internalFetch<{ screening: ScreeningResult }>(AI(), "/internal/screen-application", {
      method: "POST",
      body: input,
      timeoutMs: 90_000,
    });
    return data.screening;
  } catch (err) {
    console.error("[application] AI screening failed:", err);
    return null; // screening is best-effort; the application still exists
  }
}

// ------------------------- Interview AI -------------------------

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

export async function aiInterviewQuestions(input: {
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
    console.error("[application] interview question generation failed:", err);
    return null;
  }
}

export async function aiScoreAnswer(input: {
  jobTitle: string;
  question: string;
  questionType: string;
  answer: string;
  language: "fa" | "en";
}): Promise<AnswerScore | null> {
  try {
    const data = await internalFetch<{ score: AnswerScore }>(AI(), "/internal/interview/score-answer", {
      method: "POST",
      body: input,
      timeoutMs: 90_000,
    });
    return data.score;
  } catch (err) {
    console.error("[application] answer scoring failed:", err);
    return null;
  }
}

export async function aiInterviewReport(input: {
  jobTitle: string;
  language: "fa" | "en";
  transcript: Array<{ question: string; answer: string; score: number }>;
}): Promise<InterviewReport | null> {
  try {
    const data = await internalFetch<{ report: InterviewReport }>(AI(), "/internal/interview/report", {
      method: "POST",
      body: input,
      timeoutMs: 90_000,
    });
    return data.report;
  } catch (err) {
    console.error("[application] interview report generation failed:", err);
    return null;
  }
}
