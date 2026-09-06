import { Schema, model, type Document } from "mongoose";

export interface IResume extends Document {
  userId: string;
  title: string;
  personalInfo: {
    fullName?: string;
    email?: string;
    phone?: string;
    location?: string;
  };
  summary?: string;
  skills: string[];
  workExperience: Array<{
    company: string;
    position: string;
    startDate?: string;
    endDate?: string;
    current?: boolean;
    description?: string;
  }>;
  education: Array<{
    institution: string;
    degree: string;
    field?: string;
    startDate?: string;
    endDate?: string;
  }>;
  languages: string[];
  template: string;
  isPrimary: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const resumeSchema = new Schema<IResume>(
  {
    userId: { type: String, required: true, index: true },
    title: { type: String, required: true, trim: true, maxlength: 120 },
    personalInfo: {
      fullName: String,
      email: String,
      phone: String,
      location: String,
    },
    summary: { type: String, maxlength: 2000 },
    skills: { type: [String], default: [] },
    workExperience: [
      {
        company: String,
        position: String,
        startDate: String,
        endDate: String,
        current: Boolean,
        description: String,
      },
    ],
    education: [
      {
        institution: String,
        degree: String,
        field: String,
        startDate: String,
        endDate: String,
      },
    ],
    languages: { type: [String], default: [] },
    template: { type: String, default: "modern" },
    isPrimary: { type: Boolean, default: false },
  },
  { timestamps: true },
);

resumeSchema.set("toJSON", { versionKey: false });

export const Resume = model<IResume>("Resume", resumeSchema);
