import { internalFetch } from "@portal/shared";

// Thin client: job-service asks ai-service to draft a description.
// AI keys live ONLY in the ai-service.

export interface GeneratedDescription {
  success: boolean;
  description?: string;
  requirements?: string;
  error?: string;
}

export async function generateJobDescription(input: {
  title: string;
  skills: string[];
  experienceLevel: string;
}): Promise<GeneratedDescription> {
  const base = process.env.AI_SERVICE_URL || "http://localhost:8006";
  try {
    return await internalFetch<GeneratedDescription>(base, "/internal/generate-job-description", {
      method: "POST",
      body: input,
      timeoutMs: 60_000,
    });
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "AI service unreachable",
    };
  }
}
