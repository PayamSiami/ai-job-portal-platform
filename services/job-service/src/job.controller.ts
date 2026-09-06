import { z } from "zod";
import type { Request, Response } from "express";
import { FilterQuery, Types } from "mongoose";
import {
  AppError,
  asyncHandler,
  publishEvent,
  sendError,
  sendSuccess,
  userContext,
} from "@portal/shared";
import { Job, buildSlug, type IJob } from "./job.model.js";
import { CreateJobSchema, ListJobsSchema, UpdateJobSchema } from "./job.schemas.js";
import { generateJobDescription } from "./ai.client.js";

export const createJob = asyncHandler(async (req: Request, res: Response) => {
  const ctx = userContext(req);
  if (ctx.role !== "employer") return sendError(res, "Only employers can create jobs", 403);

  const parsed = CreateJobSchema.safeParse(req.body);
  if (!parsed.success) {
    return sendError(res, parsed.error.issues[0]?.message ?? "Invalid job data", 400);
  }

  const job = await Job.create({ ...parsed.data, employerId: ctx.userId, slug: buildSlug(parsed.data.title) });

  await publishEvent("job.created", {
    jobId: String(job._id),
    employerId: ctx.userId!,
    companyId: job.companyId,
    title: job.title,
    slug: job.slug,
  });

  sendSuccess(res, job.toJSON(), "Job created", 201);
});

export const updateJob = asyncHandler(async (req: Request, res: Response) => {
  const ctx = userContext(req);
  const job = await Job.findById(req.params.id);
  if (!job) return sendError(res, "Job not found", 404);
  if (job.employerId !== ctx.userId && ctx.role !== "admin") {
    return sendError(res, "You can only edit your own jobs", 403);
  }

  const parsed = UpdateJobSchema.safeParse(req.body);
  if (!parsed.success) {
    return sendError(res, parsed.error.issues[0]?.message ?? "Invalid job data", 400);
  }

  Object.assign(job, parsed.data);
  await job.save();
  sendSuccess(res, job.toJSON(), "Job updated");
});

export const deleteJob = asyncHandler(async (req: Request, res: Response) => {
  const ctx = userContext(req);
  const job = await Job.findById(req.params.id);
  if (!job) return sendError(res, "Job not found", 404);
  if (job.employerId !== ctx.userId && ctx.role !== "admin") {
    return sendError(res, "You can only delete your own jobs", 403);
  }
  await job.deleteOne();
  sendSuccess(res, { id: req.params.id }, "Job deleted");
});

export const getJob = asyncHandler(async (req: Request, res: Response) => {
  const job = await Job.findById(req.params.id);
  if (!job) return sendError(res, "Job not found", 404);
  // Fire-and-forget view counter (single increment, no await needed)
  void Job.updateOne({ _id: job._id }, { $inc: { views: 1 } }).catch(() => undefined);
  sendSuccess(res, job.toJSON());
});

export const getJobBySlug = asyncHandler(async (req: Request, res: Response) => {
  const job = await Job.findOne({ slug: req.params.slug });
  if (!job) return sendError(res, "Job not found", 404);
  void Job.updateOne({ _id: job._id }, { $inc: { views: 1 } }).catch(() => undefined);
  sendSuccess(res, job.toJSON());
});

export const listJobs = asyncHandler(async (req: Request, res: Response) => {
  const parsed = ListJobsSchema.safeParse(req.query);
  if (!parsed.success) return sendError(res, "Invalid query parameters", 400);
  const { q, location, workMode, jobType, experienceLevel, minSalary, page, limit, mine, includeInactive } = parsed.data;
  const ctx = userContext(req);

  const filter: FilterQuery<IJob> = {};

  if (mine) {
    if (!ctx.userId) return sendError(res, "Authentication required", 401);
    filter.employerId = ctx.userId;
  } else {
    // Public listing shows only active jobs; employers see their drafts via ?mine=1
    filter.isActive = true;
  }
  if (!mine && !includeInactive) filter.isActive = true;
  if (q) filter.$text = { $search: q };
  if (location) filter.location = { $regex: escapeRegex(location), $options: "i" };
  if (workMode) filter.workMode = workMode;
  if (jobType) filter.jobType = jobType;
  if (experienceLevel) filter.experienceLevel = experienceLevel;
  if (minSalary !== undefined) filter.maxSalary = { $gte: minSalary };

  const [items, total] = await Promise.all([
    Job.find(filter)
      .sort(mine ? { createdAt: -1 } : { createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean(),
    Job.countDocuments(filter),
  ]);

  sendSuccess(res, { items, total, page, limit, pages: Math.ceil(total / limit) });
});

export const generateDescription = asyncHandler(async (req: Request, res: Response) => {
  const ctx = userContext(req);
  if (ctx.role !== "employer") return sendError(res, "Only employers can use AI generation", 403);

  const schema = z.object({
    title: z.string().min(3).max(120),
    skills: z.array(z.string()).max(30).default([]),
    experienceLevel: z.enum(["entry", "junior", "mid", "senior", "lead"]).default("mid"),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return sendError(res, "title is required", 400);

  const result = await generateJobDescription(parsed.data);
  if (!result.success) return sendError(res, result.error ?? "AI generation unavailable", 502);
  sendSuccess(res, result, "AI description generated");
});

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Keep mongoose imports referenced for type-checking in strict mode
void Types;
void AppError;
