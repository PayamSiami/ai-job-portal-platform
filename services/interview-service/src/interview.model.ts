import { Schema, model, type Document } from "mongoose";

export const INTERVIEW_STATUSES = ["in_progress", "completed", "abandoned"] as const;
export type InterviewStatus = (typeof INTERVIEW_STATUSES)[number];

export type QuestionType = "technical" | "behavioral" | "resume" | "intro";

export interface IInterviewSession extends Document {
  applicationId: string; // unique: one interview per application
  jobId: string;
  jobTitle: string; // snapshot from application-service
  candidateId: string; // snapshot
  employerId: string; // snapshot
  language: "fa" | "en";
  status: InterviewStatus;
  questions: Array<{ type: QuestionType; text: string }>;
  answers: Array<{
    questionIndex: number;
    answer: string;
    score: number;
    feedback: string;
    strengths: string[];
    improvements: string[];
    answeredAt: Date;
  }>;
  overallScore?: number;
  recommendation?: string;
  summary?: string;
  startedAt: Date;
  completedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const interviewSchema = new Schema<IInterviewSession>(
  {
    applicationId: { type: String, required: true, unique: true, index: true },
    jobId: { type: String, required: true, index: true },
    jobTitle: { type: String, required: true },
    candidateId: { type: String, required: true, index: true },
    employerId: { type: String, required: true, index: true },
    language: { type: String, enum: ["fa", "en"], default: "fa" },
    status: { type: String, enum: INTERVIEW_STATUSES, default: "in_progress", index: true },
    questions: [
      {
        type: { type: String, enum: ["technical", "behavioral", "resume", "intro"] },
        text: { type: String, required: true },
      },
    ],
    answers: [
      {
        questionIndex: Number,
        answer: String,
        score: Number,
        feedback: String,
        strengths: [String],
        improvements: [String],
        answeredAt: Date,
      },
    ],
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
