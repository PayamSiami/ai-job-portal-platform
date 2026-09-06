import { completeChat, extractJson, INJECTION_GUARD, languageInstruction } from "./ai.client.js";

// ------------------------------------------------------------
// Non-interview AI features: application screening, AI job
// description drafting, cover-letter generation and resume
// analysis. Same JSON-contract + injection-guard approach.
// ------------------------------------------------------------

export interface ScreenResult {
  score: number; // 0-100
  explanation: string;
  strengths: string[];
  weaknesses: string[];
  recommendation: "strong-hire" | "hire" | "maybe" | "no-hire";
}

export async function screenApplication(input: {
  resumeText: string;
  coverLetter: string;
  job: { title: string; description: string; requirements?: string; skills: string[]; experienceLevel?: string };
}): Promise<{ success: boolean; result?: ScreenResult; error?: string }> {
  const system = [
    "You are an expert technical recruiter scoring how well a candidate fits a job.",
    INJECTION_GUARD,
    "Score 0-100 based on skills match, relevant experience and cover-letter quality.",
    'Respond ONLY with JSON: {"score":0-100,"explanation":"2-3 sentences","strengths":["..."],"weaknesses":["..."],"recommendation":"strong-hire|hire|maybe|no-hire"}',
  ].join("\n");

  const user = [
    `<candidate_data>`,
    `Resume:\n${truncate(input.resumeText, 6000)}`,
    input.coverLetter ? `Cover letter:\n${truncate(input.coverLetter, 2000)}` : "",
    `</candidate_data>`,
    `<job>`,
    `Title: ${input.job.title}`,
    `Skills: ${input.job.skills.join(", ") || "n/a"}`,
    `Level: ${input.job.experienceLevel ?? "mid"}`,
    `Description: ${truncate(input.job.description, 3000)}`,
    input.job.requirements ? `Requirements: ${truncate(input.job.requirements, 2000)}` : "",
    `</job>`,
  ].join("\n\n");

  const result = await completeChat(
    [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
    { temperature: 0.2, maxTokens: 800 },
  );
  if (!result.success) return { success: false, error: result.error };

  const parsed = extractJson<Partial<ScreenResult>>(result.content);
  if (!parsed || typeof parsed.score !== "number") {
    return { success: false, error: "Malformed screening response" };
  }
  const validRecs = ["strong-hire", "hire", "maybe", "no-hire"];
  return {
    success: true,
    result: {
      score: Math.min(Math.max(Math.round(parsed.score), 0), 100),
      explanation: parsed.explanation ?? "",
      strengths: strArr(parsed.strengths),
      weaknesses: strArr(parsed.weaknesses),
      recommendation: validRecs.includes(parsed.recommendation ?? "")
        ? (parsed.recommendation as ScreenResult["recommendation"])
        : "maybe",
    },
  };
}

export async function generateJobDescription(input: {
  title: string;
  skills: string[];
  experienceLevel: string;
}): Promise<{ success: boolean; description?: string; requirements?: string; error?: string }> {
  const system = [
    "You are a senior technical writer who drafts honest, attractive job descriptions.",
    "Do not invent fake company names, salaries or benefits.",
    'Respond ONLY with JSON: {"description":"2-3 paragraphs markdown","requirements":"bullet list markdown"}',
  ].join("\n");

  const user = `Draft a job description for: "${input.title}" (${input.experienceLevel} level). Key skills: ${input.skills.join(", ") || "n/a"}. Write in Persian (Farsi).`;

  const result = await completeChat(
    [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
    { temperature: 0.5, maxTokens: 1200 },
  );
  if (!result.success) return { success: false, error: result.error };

  const parsed = extractJson<{ description?: string; requirements?: string }>(result.content);
  if (!parsed?.description) return { success: false, error: "Malformed description response" };
  return { success: true, description: parsed.description, requirements: parsed.requirements };
}

export async function generateCoverLetter(input: {
  resumeSummary: string;
  jobTitle: string;
  companyName?: string;
  tone?: string;
  language?: "fa" | "en";
}): Promise<{ success: boolean; coverLetter?: string; error?: string }> {
  const system = [
    "You write concise, specific cover letters (250-350 words). No clichés, no fabricated experience.",
    INJECTION_GUARD,
    languageInstruction(input.language),
    'Respond ONLY with JSON: {"coverLetter":"..."}',
  ].join("\n");

  const user = [
    `<candidate_data>Resume summary: ${truncate(input.resumeSummary, 3000)}</candidate_data>`,
    `Target job: ${input.jobTitle} at ${input.companyName ?? "the company"}. Tone: ${input.tone ?? "professional"}.`,
  ].join("\n");

  const result = await completeChat(
    [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
    { temperature: 0.6, maxTokens: 800 },
  );
  if (!result.success) return { success: false, error: result.error };
  const parsed = extractJson<{ coverLetter?: string }>(result.content);
  if (!parsed?.coverLetter) return { success: false, error: "Malformed cover letter response" };
  return { success: true, coverLetter: parsed.coverLetter };
}

export async function analyzeResume(input: {
  resumeText: string;
  targetRole?: string;
  language?: "fa" | "en";
}): Promise<{
  success: boolean;
  analysis?: { score: number; summary: string; suggestions: string[]; keywordGaps: string[] };
  error?: string;
}> {
  const system = [
    "You are a resume expert giving actionable improvement feedback.",
    INJECTION_GUARD,
    languageInstruction(input.language),
    'Respond ONLY with JSON: {"score":0-100,"summary":"2 sentences","suggestions":["..."],"keywordGaps":["..."]}',
  ].join("\n");

  const user = [
    `<candidate_data>`,
    `Resume:\n${truncate(input.resumeText, 6000)}`,
    input.targetRole ? `Target role: ${input.targetRole}` : "",
    `</candidate_data>`,
  ].join("\n");

  const result = await completeChat(
    [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
    { temperature: 0.3, maxTokens: 900 },
  );
  if (!result.success) return { success: false, error: result.error };

  const parsed = extractJson<{ score?: number; summary?: string; suggestions?: string[]; keywordGaps?: string[] }>(
    result.content,
  );
  if (!parsed || typeof parsed.score !== "number") {
    return { success: false, error: "Malformed analysis response" };
  }
  return {
    success: true,
    analysis: {
      score: Math.min(Math.max(Math.round(parsed.score), 0), 100),
      summary: parsed.summary ?? "",
      suggestions: strArr(parsed.suggestions),
      keywordGaps: strArr(parsed.keywordGaps),
    },
  };
}

function truncate(text: string, max: number): string {
  if (!text) return "";
  return text.length <= max ? text : `${text.slice(0, max)}…`;
}

function strArr(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];
}
