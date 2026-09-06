import { Schema, model, type Document, type HydratedDocument } from "mongoose";
import slugify from "slugify";

export interface IJob extends Document {
  title: string;
  slug: string;
  employerId: string;
  companyId?: string;
  companyName?: string;
  description: string;
  requirements?: string;
  skills: string[];
  location?: string;
  workMode: "on-site" | "remote" | "hybrid";
  jobType: "full-time" | "part-time" | "contract" | "internship" | "freelance";
  experienceLevel: "entry" | "junior" | "mid" | "senior" | "lead";
  minSalary?: number;
  maxSalary?: number;
  isActive: boolean;
  views: number;
  createdAt: Date;
  updatedAt: Date;
}

const jobSchema = new Schema<IJob>(
  {
    title: { type: String, required: true, trim: true, maxlength: 120 },
    slug: { type: String, required: true, unique: true },
    employerId: { type: String, required: true, index: true },
    companyId: { type: String, index: true },
    companyName: String,
    description: { type: String, required: true, maxlength: 20000 },
    requirements: { type: String, maxlength: 20000 },
    skills: { type: [String], default: [] },
    location: String,
    workMode: { type: String, enum: ["on-site", "remote", "hybrid"], default: "on-site" },
    jobType: {
      type: String,
      enum: ["full-time", "part-time", "contract", "internship", "freelance"],
      default: "full-time",
    },
    experienceLevel: {
      type: String,
      enum: ["entry", "junior", "mid", "senior", "lead"],
      default: "mid",
    },
    minSalary: Number,
    maxSalary: Number,
    isActive: { type: Boolean, default: true, index: true },
    views: { type: Number, default: 0 },
  },
  { timestamps: true },
);

// Text search over the fields users actually search
jobSchema.index({ title: "text", description: "text", skills: "text" });
jobSchema.index({ isActive: 1, createdAt: -1 });

/** Unique human-readable slug derived from title. */
export function buildSlug(title: string): string {
  const base = slugify(title, { lower: true, strict: true }) || "job";
  return `${base}-${Date.now().toString(36)}${Math.floor(Math.random() * 1000).toString(36)}`;
}

export type JobDoc = HydratedDocument<IJob>;
export const Job = model<IJob>("Job", jobSchema);
