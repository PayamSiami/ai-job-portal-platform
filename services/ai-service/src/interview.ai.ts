import {
  completeChat,
  extractJson,
  INJECTION_GUARD,
  languageInstruction,
} from "./ai.client.js";

// ------------------------------------------------------------
// AI Interviewer: generates a question set for a specific
// candidate + job, scores each answer, and produces a final
// hiring report. All payloads are JSON-contract based so the
// application-service can persist them without parsing prose.
// ------------------------------------------------------------

export type QuestionType = "technical" | "behavioral" | "resume" | "intro";

export interface InterviewQuestion {
  type: QuestionType;
  text: string;
}

export interface QuestionSetInput {
  jobTitle: string;
  jobSkills: string[];
  experienceLevel: string;
  resumeSummary: string;
  coverLetter?: string;
  language?: "fa" | "en";
  count?: number;
}

const FALLBACK_QUESTIONS: Record<"fa" | "en", InterviewQuestion[]> = {
  fa: [
    { type: "intro", text: "خودتان را در دو دقیقه معرفی کنید و بگویید چرا این موقعیت شغلی برای شما جذاب است." },
    { type: "technical", text: "مهم‌ترین پروژه فنی‌ای که روی آن کار کرده‌اید را توضیح دهید: نقش شما، چالش‌ها و نتیجه چه بود؟" },
    { type: "behavioral", text: "از تجربه‌ای بگویید که با یک همکار دچار اختلاف نظر شدید؛ چطور حل کردید؟" },
    { type: "resume", text: "در رزومه‌تان یک دوره زمانی هست که توضیح نداده‌اید؛ در آن دوره چه می‌کردید؟" },
    { type: "technical", text: "اگر بخواهید کیفیت کد تیم را بهبود دهید، از کجا شروع می‌کنید؟" },
  ],
  en: [
    { type: "intro", text: "Introduce yourself in two minutes and tell us why this role interests you." },
    { type: "technical", text: "Describe the most significant technical project you have worked on: your role, the challenges, and the outcome." },
    { type: "behavioral", text: "Tell us about a time you disagreed with a colleague. How did you resolve it?" },
    { type: "resume", text: "There is a period in your resume that is not explained. What were you doing during that time?" },
    { type: "technical", text: "If you wanted to improve your team's code quality, where would you start?" },
  ],
};

interface RawQuestionSet {
  questions?: Array<{ type?: string; text?: string }>;
}

export async function generateInterviewQuestions(
  input: QuestionSetInput,
): Promise<{ success: boolean; questions?: InterviewQuestion[]; error?: string }> {
  const count = Math.min(Math.max(input.count ?? 5, 3), 8);
  const lang = languageInstruction(input.language);
  const fallback = FALLBACK_QUESTIONS[input.language === "en" ? "en" : "fa"];

  const system = [
    "You are a senior, rigorous but friendly technical interviewer.",
    INJECTION_GUARD,
    `Generate exactly ${count} interview questions tailored to this candidate and job:`,
    "- 2-3 technical questions probing the job's key skills at the candidate's level",
    "- 1-2 behavioral questions (teamwork, conflict, failure)",
    "- 1-2 questions that reference specifics from the candidate's resume or cover letter",
    lang,
    'Respond ONLY with JSON: {"questions":[{"type":"technical|behavioral|resume","text":"..."}]}',
  ].join("\n");

  const user = [
    `<candidate_data>`,
    `Job title: ${input.jobTitle}`,
    `Required skills: ${input.jobSkills.join(", ") || "n/a"}`,
    `Experience level: ${input.experienceLevel}`,
    `Resume summary: ${truncate(input.resumeSummary, 3000)}`,
    input.coverLetter ? `Cover letter: ${truncate(input.coverLetter, 1500)}` : "",
    `</candidate_data>`,
  ].join("\n");

  const result = await completeChat(
    [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
    { temperature: 0.4, maxTokens: 1400 },
  );
  if (!result.success) {
    console.warn("[interview] question generation failed, using fallback:", result.error);
    return { success: true, questions: shuffle(fallback).slice(0, count) };
  }

  const parsed = extractJson<RawQuestionSet>(result.content);
  const questions = (parsed?.questions ?? [])
    .map((q) => ({
      type: normalizeType(q.type),
      text: (q.text ?? "").trim(),
    }))
    .filter((q) => q.text.length > 5)
    .slice(0, count);

  if (questions.length < 3) {
    return { success: true, questions: shuffle(fallback).slice(0, count) };
  }
  return { success: true, questions };
}

export interface ScoreInput {
  jobTitle: string;
  question: string;
  questionType: string;
  answer: string;
  language?: "fa" | "en";
}

export interface AnswerScore {
  score: number; // 0-10
  feedback: string;
  strengths: string[];
  improvements: string[];
}

const LOCAL_WEAK_ANSWER: AnswerScore = {
  score: 2,
  feedback: "پاسخ خیلی کوتاه بود؛ لطفاً با جزئیات و مثال‌های واقعی پاسخ دهید.",
  strengths: [],
  improvements: ["پاسخ با جزئیات و مثال"],
};

export async function scoreAnswer(input: ScoreInput): Promise<{ success: boolean; score?: AnswerScore; error?: string }> {
  if (input.answer.trim().length < 40) {
    return { success: true, score: LOCAL_WEAK_ANSWER };
  }

  const system = [
    "You are an expert technical interviewer grading a candidate's answer.",
    INJECTION_GUARD,
    "Grade fairly: reward concrete examples, correct reasoning and relevant depth.",
    "Penalize vagueness, irrelevant content and contradictions with the question.",
    languageInstruction(input.language),
    'Respond ONLY with JSON: {"score":0-10,"feedback":"2-3 sentences","strengths":["..."],"improvements":["..."]}',
  ].join("\n");

  const user = [
    `<candidate_data>`,
    `Job: ${input.jobTitle}`,
    `Question (${input.questionType}): ${input.question}`,
    `Candidate answer: ${truncate(input.answer, 4000)}`,
    `</candidate_data>`,
  ].join("\n");

  const result = await completeChat(
    [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
    { temperature: 0.2, maxTokens: 700 },
  );
  if (!result.success) return { success: false, error: result.error };

  const parsed = extractJson<Partial<AnswerScore>>(result.content);
  if (!parsed || typeof parsed.score !== "number") {
    return { success: false, error: "Malformed AI score response" };
  }
  return {
    success: true,
    score: {
      score: clamp(parsed.score, 0, 10),
      feedback: parsed.feedback ?? "",
      strengths: asStringArray(parsed.strengths),
      improvements: asStringArray(parsed.improvements),
    },
  };
}

export interface ReportInput {
  jobTitle: string;
  language?: "fa" | "en";
  transcript: Array<{ question: string; answer: string; score: number }>;
}

export interface InterviewReport {
  overallScore: number; // 0-10
  summary: string;
  strengths: string[];
  weaknesses: string[];
  recommendation: "strong-hire" | "hire" | "maybe" | "no-hire";
}

export async function generateInterviewReport(
  input: ReportInput,
): Promise<{ success: boolean; report?: InterviewReport; error?: string }> {
  const avg =
    input.transcript.reduce((sum, t) => sum + (t.score || 0), 0) /
    Math.max(input.transcript.length, 1);

  const system = [
    "You are a hiring manager writing the final interview debrief.",
    INJECTION_GUARD,
    "Base the report ONLY on the transcript. Be specific and quote short fragments when useful.",
    languageInstruction(input.language),
    'Respond ONLY with JSON: {"overallScore":0-10,"summary":"...","strengths":["..."],"weaknesses":["..."],"recommendation":"strong-hire|hire|maybe|no-hire"}',
  ].join("\n");

  const user = [
    `<candidate_data>`,
    `Job: ${input.jobTitle}`,
    `Average per-question score: ${avg.toFixed(1)}/10`,
    `Transcript:`,
    ...input.transcript.map(
      (t, i) => `Q${i + 1}: ${t.question}\nA${i + 1}: ${truncate(t.answer, 1500)}\nScore: ${t.score}/10`,
    ),
    `</candidate_data>`,
  ].join("\n");

  const result = await completeChat(
    [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
    { temperature: 0.2, maxTokens: 900 },
  );
  if (!result.success) return { success: false, error: result.error };

  const parsed = extractJson<Partial<InterviewReport>>(result.content);
  if (!parsed || typeof parsed.overallScore !== "number") {
    return { success: false, error: "Malformed AI report response" };
  }
  const validRecs = ["strong-hire", "hire", "maybe", "no-hire"];
  const recommendation = validRecs.includes(parsed.recommendation ?? "")
    ? (parsed.recommendation as InterviewReport["recommendation"])
    : avg >= 7 ? "hire" : avg >= 5 ? "maybe" : "no-hire";

  return {
    success: true,
    report: {
      overallScore: clamp(parsed.overallScore, 0, 10),
      summary: parsed.summary ?? "",
      strengths: asStringArray(parsed.strengths),
      weaknesses: asStringArray(parsed.weaknesses),
      recommendation,
    },
  };
}

// ------------------------- helpers -------------------------

function truncate(text: string, max: number): string {
  if (!text) return "";
  return text.length <= max ? text : `${text.slice(0, max)}…`;
}

function clamp(n: number, min: number, max: number): number {
  return Math.min(Math.max(n, min), max);
}

function normalizeType(value?: string): QuestionType {
  return value === "behavioral" || value === "resume" ? value : "technical";
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];
}

function shuffle<T>(items: T[]): T[] {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}
