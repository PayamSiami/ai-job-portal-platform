import { z } from "zod";
import { asyncHandler, sendSuccess, sendError, userContext, AppError } from "@portal/shared";

export const CreateJobSchema = z.object({
  title: z.string().min(3).max(120),
  companyId: z.string().optional(),
  companyName: z.string().max(120).optional(),
  description: z.string().min(30).max(20000),
  requirements: z.string().max(20000).optional(),
  skills: z.array(z.string().min(1).max(40)).max(30).default([]),
  location: z.string().max(120).optional(),
  workMode: z.enum(["on-site", "remote", "hybrid"]).default("on-site"),
  jobType: z.enum(["full-time", "part-time", "contract", "internship", "freelance"]).default("full-time"),
  experienceLevel: z.enum(["entry", "junior", "mid", "senior", "lead"]).default("mid"),
  minSalary: z.number().int().nonnegative().optional(),
  maxSalary: z.number().int().nonnegative().optional(),
});

export const UpdateJobSchema = CreateJobSchema.partial();

export const ListJobsSchema = z.object({
  q: z.string().max(120).optional(),
  location: z.string().max(120).optional(),
  workMode: z.enum(["on-site", "remote", "hybrid"]).optional(),
  jobType: z.enum(["full-time", "part-time", "contract", "internship", "freelance"]).optional(),
  experienceLevel: z.enum(["entry", "junior", "mid", "senior", "lead"]).optional(),
  minSalary: z.coerce.number().int().nonnegative().optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(50).default(20),
  mine: z.coerce.boolean().optional(),
  includeInactive: z.coerce.boolean().optional(),
});
