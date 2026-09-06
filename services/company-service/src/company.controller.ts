import path from "node:path";
import { randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import type { Request, Response } from "express";
import multer from "multer";
import {
  AppError,
  asyncHandler,
  internalFetch,
  publishEvent,
  EventNames,
  sendError,
  sendSuccess,
  userContext,
} from "@portal/shared";
import { Company, buildCompanySlug } from "./company.model.js";

// ------------------------------------------------------------
// Company profiles. One company per employer account.
// Logo uploads are hardened: magic-byte validation via sharp
// re-encode (defeats spoofed mimetypes), randomized filename
// (no user-controlled path parts), 2MB cap.
// ------------------------------------------------------------

const ALLOWED_IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const MAX_LOGO_BYTES = 2 * 1024 * 1024;

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_LOGO_BYTES, files: 1 },
});

function uploadSingle(field: string) {
  return (req: Request, res: Response, next: import("express").NextFunction): void => {
    upload.single(field)(req, res, (err: unknown) => {
      if (err instanceof multer.MulterError) {
        sendError(res, err.code === "LIMIT_FILE_SIZE" ? "Logo must be under 2MB" : "Upload failed", 400);
        return;
      }
      if (err) {
        sendError(res, err instanceof Error ? err.message : "Upload failed", 400);
        return;
      }
      next();
    });
  };
}

export const upsertCompany = asyncHandler(async (req: Request, res: Response) => {
  const ctx = userContext(req);
  if (ctx.role !== "employer") return sendError(res, "Only employers can manage a company", 403);

  const schema = zCompany.safeParse(req.body);
  if (!schema.success) return sendError(res, schema.error.issues[0]?.message ?? "Invalid input", 400);

  let company = await Company.findOne({ ownerId: ctx.userId });
  if (company) {
    Object.assign(company, schema.data);
    await company.save();
    sendSuccess(res, company.toJSON(), "Company updated");
    return;
  }

  company = await Company.create({
    ...schema.data,
    ownerId: ctx.userId,
    slug: buildCompanySlug(schema.data.name),
  });

  await publishEvent(EventNames.CompanyCreated, {
    companyId: String(company._id),
    ownerId: ctx.userId!,
    name: company.name,
  });
  sendSuccess(res, company.toJSON(), "Company created", 201);
});

export const getMyCompany = asyncHandler(async (req: Request, res: Response) => {
  const ctx = userContext(req);
  const company = await Company.findOne({ ownerId: ctx.userId });
  if (!company) return sendError(res, "No company profile yet", 404);
  sendSuccess(res, company.toJSON());
});

export const getCompanyBySlug = asyncHandler(async (req: Request, res: Response) => {
  const company = await Company.findOne({ slug: req.params.slug, isActive: true });
  if (!company) return sendError(res, "Company not found", 404);
  sendSuccess(res, company.toJSON());
});

// Internal: resolve company name for a job (used at apply time snapshots)
export const internalGetByOwner = asyncHandler(async (req: Request, res: Response) => {
  const company = await Company.findOne({ ownerId: String(req.query.ownerId) });
  sendSuccess(res, company?.toJSON() ?? null);
});

// ------------------------- Logo upload -------------------------

export const uploadLogo = [
  uploadSingle("logo"),
  asyncHandler(async (req: Request, res: Response) => {
    const ctx = userContext(req);
    if (ctx.role !== "employer") return sendError(res, "Only employers can upload logos", 403);

    const file = req.file;
    if (!file) return sendError(res, "No file uploaded (field name: logo)", 400);
    if (!ALLOWED_IMAGE_TYPES.has(file.mimetype)) {
      return sendError(res, "Only JPEG, PNG or WebP images are allowed", 400);
    }

    // Re-encode with sharp: strips malicious payloads, normalizes format,
    // and fails loudly if the bytes are not actually a decodable image.
    const sharpModule = await import("sharp");
    const sharp = sharpModule.default;
    let output: Buffer;
    try {
      output = await sharp(file.buffer)
        .resize(512, 512, { fit: "inside", withoutEnlargement: true })
        .webp({ quality: 85 })
        .toBuffer();
    } catch {
      return sendError(res, "File is not a valid image", 400);
    }

    const uploadDir = process.env.UPLOAD_DIR || "./uploads";
    const logosDir = path.join(uploadDir, "logos");
    const { mkdir, writeFile } = await import("node:fs/promises");
    await mkdir(logosDir, { recursive: true });

    const filename = `${randomUUID()}.webp`; // never trust originalname
    await writeFile(path.join(logosDir, filename), output);

    const company = await Company.findOne({ ownerId: ctx.userId });
    if (!company) return sendError(res, "Create your company profile first", 404);

    company.logo = `/uploads/logos/${filename}`;
    await company.save();
    sendSuccess(res, { logo: company.logo }, "Logo uploaded");
  }),
];

export const serveLogo = asyncHandler(async (req: Request, res: Response) => {
  // Filenames are server-generated UUIDs; reject anything else outright.
  const filename = String(req.params.filename ?? "");
  if (!/^[a-f0-9-]{36}\.webp$/.test(filename)) {
    return sendError(res, "Invalid file", 400);
  }
  const uploadDir = process.env.UPLOAD_DIR || "./uploads";
  const filePath = path.resolve(uploadDir, "logos", filename);
  if (!filePath.startsWith(path.resolve(uploadDir, "logos"))) {
    return sendError(res, "Invalid file", 400);
  }
  try {
    const info = await stat(filePath);
    res.setHeader("Content-Type", "image/webp");
    res.setHeader("Cache-Control", "public, max-age=604800, immutable");
    res.setHeader("Content-Length", info.size);
    createReadStream(filePath).pipe(res);
  } catch {
    sendError(res, "Not found", 404);
  }
});

import { z } from "zod";
const zCompany = z.object({
  name: z.string().min(2).max(120),
  website: z.string().url().max(200).optional().or(z.literal("")),
  industry: z.string().max(80).optional(),
  size: z.string().max(40).optional(),
  about: z.string().max(5000).optional(),
  location: z.string().max(120).optional(),
});

void internalFetch;
void AppError;
