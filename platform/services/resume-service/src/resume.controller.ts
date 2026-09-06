import { z } from "zod";
import type { Request, Response } from "express";
import {
  AppError,
  asyncHandler,
  sendError,
  sendSuccess,
  userContext,
} from "@portal/shared";
import { Resume } from "./resume.model.js";
import { renderResumePdf } from "./pdf.js";

export const UpsertSchema = z.object({
  title: z.string().min(2).max(120),
  personalInfo: z
    .object({
      fullName: z.string().max(120).optional(),
      email: z.string().email().optional().or(z.literal("")),
      phone: z.string().max(30).optional(),
      location: z.string().max(120).optional(),
    })
    .optional(),
  summary: z.string().max(2000).optional(),
  skills: z.array(z.string().max(40)).max(40).default([]),
  workExperience: z
    .array(
      z.object({
        company: z.string().max(120),
        position: z.string().max(120),
        startDate: z.string().max(20).optional(),
        endDate: z.string().max(20).optional(),
        current: z.boolean().optional(),
        description: z.string().max(2000).optional(),
      }),
    )
    .max(15)
    .default([]),
  education: z
    .array(
      z.object({
        institution: z.string().max(120),
        degree: z.string().max(120),
        field: z.string().max(120).optional(),
        startDate: z.string().max(20).optional(),
        endDate: z.string().max(20).optional(),
      }),
    )
    .max(10)
    .default([]),
  languages: z.array(z.string().max(30)).max(10).default([]),
  template: z.enum(["modern", "classic", "minimal"]).default("modern"),
});

export const createResume = asyncHandler(async (req: Request, res: Response) => {
  const ctx = userContext(req);
  const parsed = UpsertSchema.safeParse(req.body);
  if (!parsed.success) return sendError(res, parsed.error.issues[0]?.message ?? "Invalid resume", 400);

  const count = await Resume.countDocuments({ userId: ctx.userId });
  if (count >= 10) return sendError(res, "Resume limit reached (10)", 400);

  const resume = await Resume.create({
    ...parsed.data,
    userId: ctx.userId,
    isPrimary: count === 0, // first resume is primary automatically
  });
  sendSuccess(res, resume.toJSON(), "Resume created", 201);
});

export const listMine = asyncHandler(async (req: Request, res: Response) => {
  const ctx = userContext(req);
  const resumes = await Resume.find({ userId: ctx.userId }).sort({ updatedAt: -1 });
  sendSuccess(res, resumes.map((r) => r.toJSON()));
});

export const getResume = asyncHandler(async (req: Request, res: Response) => {
  const ctx = userContext(req);
  const resume = await Resume.findById(req.params.id);
  if (!resume) return sendError(res, "Resume not found", 404);
  if (resume.userId !== ctx.userId && ctx.role !== "admin") {
    return sendError(res, "Not your resume", 403);
  }
  sendSuccess(res, resume.toJSON());
});

export const updateResume = asyncHandler(async (req: Request, res: Response) => {
  const ctx = userContext(req);
  const resume = await Resume.findById(req.params.id);
  if (!resume) return sendError(res, "Resume not found", 404);
  if (resume.userId !== ctx.userId) return sendError(res, "Not your resume", 403);

  const parsed = UpsertSchema.partial().safeParse(req.body);
  if (!parsed.success) return sendError(res, parsed.error.issues[0]?.message ?? "Invalid resume", 400);
  Object.assign(resume, parsed.data);
  await resume.save();
  sendSuccess(res, resume.toJSON(), "Resume updated");
});

export const deleteResume = asyncHandler(async (req: Request, res: Response) => {
  const ctx = userContext(req);
  const resume = await Resume.findById(req.params.id);
  if (!resume) return sendError(res, "Resume not found", 404);
  if (resume.userId !== ctx.userId) return sendError(res, "Not your resume", 403);
  await resume.deleteOne();
  sendSuccess(res, { id: req.params.id }, "Resume deleted");
});

export const setPrimary = asyncHandler(async (req: Request, res: Response) => {
  const ctx = userContext(req);
  const resume = await Resume.findById(req.params.id);
  if (!resume) return sendError(res, "Resume not found", 404);
  if (resume.userId !== ctx.userId) return sendError(res, "Not your resume", 403);
  await Resume.updateMany({ userId: ctx.userId }, { isPrimary: false });
  resume.isPrimary = true;
  await resume.save();
  sendSuccess(res, resume.toJSON(), "Primary resume set");
});

/** PDF export: generated on the fly, auth-checked (resumes are PII — never public URLs). */
export const exportPdf = asyncHandler(async (req: Request, res: Response) => {
  const ctx = userContext(req);
  const resume = await Resume.findById(req.params.id);
  if (!resume) return sendError(res, "Resume not found", 404);
  if (resume.userId !== ctx.userId && ctx.role !== "admin") {
    return sendError(res, "Not your resume", 403);
  }

  const buffer = await renderResumePdf(resume);
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader(
    "Content-Disposition",
    `attachment; filename="resume-${String(resume._id).slice(-8)}.pdf"`,
  );
  res.setHeader("Content-Length", buffer.length);
  res.end(buffer);
});

// ------------------------- Internal -------------------------

/** Ownership-checked read for application-service (x-user-id must match owner). */
export const internalGet = asyncHandler(async (req: Request, res: Response) => {
  const resume = await Resume.findById(req.params.id);
  if (!resume) return sendError(res, "Resume not found", 404);
  const requestedUserId = String(req.query.userId ?? "");
  if (requestedUserId && resume.userId !== requestedUserId) {
    return sendError(res, "Resume not owned by requesting user", 403);
  }
  sendSuccess(res, resume.toJSON());
});

/** Flattened text + structured content used for AI screening and interviews. */
export const internalContent = asyncHandler(async (req: Request, res: Response) => {
  const resume = await Resume.findById(req.params.id);
  if (!resume) return sendError(res, "Resume not found", 404);
  sendSuccess(res, {
    title: resume.title,
    summary: resume.summary,
    skills: resume.skills,
    workExperience: resume.workExperience,
    education: resume.education,
    languages: resume.languages,
  });
});

void AppError;
