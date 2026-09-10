import { Schema, model, type Document } from "mongoose";

export const INTERVIEW_STATUSES = ["in_progress", "completed", "abandoned"] as const;
export type InterviewStatus = (typeof INTERVIEW_STATUSES)[number];

export type InterviewMode = "ai" | "custom";

/**
 * Question origin. "employer" questions are human-graded (the employer evaluates
 * the answers); the others are AI-scored in "ai" mode.
 */
export type QuestionType = "technical" | "behavioral" | "resume" | "intro" | "employer";

export type DiscFactor = "dominance" | "influence" | "steadiness" | "conscientiousness";

export interface DiscResponse {
  index: number; // 0..23
  rating: number; // 1..5
}

export interface DiscScores {
  dominance: number; // 0..100
  influence: number;
  steadiness: number;
  conscientiousness: number;
}

export interface IDiscResult {
  responses: DiscResponse[];
  scores: DiscScores;
  primary: DiscFactor;
  label: { en: string; fa: string };
  completedAt: Date;
}

export interface IInterviewSession extends Document {
  applicationId: string; // unique: one interview per application
  jobId: string;
  jobTitle: string; // snapshot from application-service
  candidateId: string; // snapshot
  employerId: string; // snapshot
  language: "fa" | "en";
  mode: InterviewMode; // "ai" = AI generates + scores; "custom" = employer questions, human-graded
  customQuestions: string[]; // raw employer input (present when mode === "custom")
  status: InterviewStatus;
  questions: Array<{ type: QuestionType; text: string }>;
  answers: Array<{
    questionIndex: number;
    answer: string;
    score: number | null; // null when human-graded (employer mode)
    feedback: string;
    strengths: string[];
    improvements: string[];
    answeredAt: Date;
  }>;
  disc: IDiscResult | null;
  overallScore?: number;
  recommendation?: string;
  summary?: string;
  startedAt: Date;
  completedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const DiscResultSchema = new Schema<IDiscResult>(
  {
    responses: [{ index: { type: Number, required: true }, rating: { type: Number, required: true } }],
    scores: {
      dominance: { type: Number, required: true },
      influence: { type: Number, required: true },
      steadiness: { type: Number, required: true },
      conscientiousness: { type: Number, required: true },
    },
    primary: { type: String, enum: ["dominance", "influence", "steadiness", "conscientiousness"], required: true },
    label: { en: { type: String, required: true }, fa: { type: String, required: true } },
    completedAt: { type: Date, required: true },
  },
  { _id: false },
);

const interviewSchema = new Schema<IInterviewSession>(
  {
    applicationId: { type: String, required: true, unique: true, index: true },
    jobId: { type: String, required: true, index: true },
    jobTitle: { type: String, required: true },
    candidateId: { type: String, required: true, index: true },
    employerId: { type: String, required: true, index: true },
    language: { type: String, enum: ["fa", "en"], default: "fa" },
    mode: { type: String, enum: ["ai", "custom"], default: "ai", index: true },
    customQuestions: [{ type: String }],
    status: { type: String, enum: INTERVIEW_STATUSES, default: "in_progress", index: true },
    questions: [
      {
        type: { type: String, enum: ["technical", "behavioral", "resume", "intro", "employer"] },
        text: { type: String, required: true },
      },
    ],
    answers: [
      {
        questionIndex: Number,
        answer: String,
        score: { type: Number, default: null }, // nullable: null when human-graded
        feedback: String,
        strengths: [String],
        improvements: [String],
        answeredAt: Date,
      },
    ],
    disc: { type: DiscResultSchema, default: null },
    overallScore: Number,
    recommendation: String,
    summary: String,
    startedAt: { type: Date, default: Date.now },
    completedAt: Date,
  },
  { timestamps: true },
);

interviewSchema.set("toJSON", { versionKey: false });

export const InterviewSession = model<IInterviewSession>("InterviewSession", interviewSchema);
