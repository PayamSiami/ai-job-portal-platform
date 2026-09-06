import { Schema, model, type Document } from "mongoose";

export const APPLICATION_STATUSES = [
  "pending",
  "reviewing",
  "shortlisted",
  "interview",
  "offered",
  "rejected",
  "withdrawn",
] as const;
export type ApplicationStatus = (typeof APPLICATION_STATUSES)[number];

/** Legal status transitions. Withdrawals are handled by a separate endpoint. */
export const ALLOWED_TRANSITIONS: Record<ApplicationStatus, ApplicationStatus[]> = {
  pending: ["reviewing", "rejected"],
  reviewing: ["shortlisted", "interview", "rejected"],
  shortlisted: ["interview", "rejected"],
  interview: ["offered", "rejected"],
  offered: ["rejected"],
  rejected: [],
  withdrawn: [],
};

export interface IApplication extends Document {
  jobId: string;
  jobTitle: string; // snapshot at apply time
  employerId: string; // snapshot at apply time
  candidateId: string;
  resumeId: string;
  coverLetter: string;
  expectedSalary?: number;
  availableFrom?: Date;
  status: ApplicationStatus;
  // AI screening result
  aiScore?: number;
  aiExplanation?: string;
  aiStrengths?: string[];
  aiWeaknesses?: string[];
  aiRecommendation?: string;
  aiScreenedAt?: Date;
  // AI interview summary (written when an interview completes)
  interviewScore?: number;
  interviewRecommendation?: string;
  createdAt: Date;
  updatedAt: Date;
}

const applicationSchema = new Schema<IApplication>(
  {
    jobId: { type: String, required: true, index: true },
    jobTitle: { type: String, required: true },
    employerId: { type: String, required: true, index: true },
    candidateId: { type: String, required: true, index: true },
    resumeId: { type: String, required: true },
    coverLetter: { type: String, required: true, maxlength: 5000 },
    expectedSalary: Number,
    availableFrom: Date,
    status: { type: String, enum: APPLICATION_STATUSES, default: "pending", index: true },
    aiScore: Number,
    aiExplanation: String,
    aiStrengths: [String],
    aiWeaknesses: [String],
    aiRecommendation: String,
    aiScreenedAt: Date,
    interviewScore: Number,
    interviewRecommendation: String,
  },
  { timestamps: true },
);

// One application per candidate per job — enforced by the DB, not just checks.
applicationSchema.index({ jobId: 1, candidateId: 1 }, { unique: true });

export const Application = model<IApplication>("Application", applicationSchema);
