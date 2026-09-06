import { z } from "zod";

// ============================================================
// Shared domain types & DTOs for the whole platform.
// Services own their data; these are the cross-service contracts.
// ============================================================

export const USER_ROLES = ["job-seeker", "employer", "admin"] as const;
export type UserRole = (typeof USER_ROLES)[number];

/** Claims carried inside the short-lived access JWT. */
export const AccessClaimsSchema = z.object({
  sub: z.string().min(1),
  role: z.enum(USER_ROLES),
  email: z.string().email(),
  username: z.string(),
});
export type AccessClaims = z.infer<typeof AccessClaimsSchema>;

export interface UserDTO {
  _id: string;
  username: string;
  email: string;
  role: UserRole;
  profile?: UserProfile;
  isActive: boolean;
  createdAt?: string;
}

export interface UserProfile {
  firstName?: string;
  lastName?: string;
  headline?: string;
  location?: string;
  skills?: string[];
  experience?: number;
  education?: string;
  bio?: string;
}

// ------------------------- Jobs -------------------------

export const JOB_TYPES = ["full-time", "part-time", "contract", "internship", "freelance"] as const;
export const WORK_MODES = ["on-site", "remote", "hybrid"] as const;
export const EXPERIENCE_LEVELS = ["entry", "junior", "mid", "senior", "lead"] as const;

export interface JobDTO {
  _id: string;
  title: string;
  slug: string;
  employerId: string;
  companyId?: string;
  companyName?: string;
  description: string;
  requirements?: string;
  skills: string[];
  location?: string;
  workMode: (typeof WORK_MODES)[number];
  jobType: (typeof JOB_TYPES)[number];
  experienceLevel: (typeof EXPERIENCE_LEVELS)[number];
  minSalary?: number;
  maxSalary?: number;
  isActive: boolean;
  views?: number;
  createdAt?: string;
}

// ------------------------- Applications -------------------------

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

export interface ApplicationDTO {
  _id: string;
  jobId: string;
  candidateId: string;
  resumeId: string;
  coverLetter: string;
  expectedSalary?: number;
  availableFrom?: string;
  status: ApplicationStatus;
  aiScore?: number;
  aiExplanation?: string;
  aiStrengths?: string[];
  aiWeaknesses?: string[];
  aiRecommendation?: string;
  aiScreenedAt?: string;
  createdAt?: string;
}

// ------------------------- Resumes -------------------------

export interface ResumeDTO {
  _id: string;
  userId: string;
  title: string;
  personalInfo?: {
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
  languages?: string[];
  template?: string;
  isPrimary?: boolean;
  createdAt?: string;
}

// ------------------------- Companies -------------------------

export interface CompanyDTO {
  _id: string;
  ownerId: string;
  name: string;
  slug: string;
  logo?: string;
  website?: string;
  industry?: string;
  size?: string;
  about?: string;
  location?: string;
  isActive: boolean;
}
