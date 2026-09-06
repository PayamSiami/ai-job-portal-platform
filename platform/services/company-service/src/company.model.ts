import { Schema, model, type Document } from "mongoose";
import slugify from "slugify";

export interface ICompany extends Document {
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
  createdAt: Date;
  updatedAt: Date;
}

const companySchema = new Schema<ICompany>(
  {
    ownerId: { type: String, required: true, unique: true, index: true },
    name: { type: String, required: true, trim: true, maxlength: 120 },
    slug: { type: String, required: true, unique: true },
    logo: String,
    website: String,
    industry: String,
    size: String,
    about: { type: String, maxlength: 5000 },
    location: String,
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true },
);

companySchema.set("toJSON", { versionKey: false });

export function buildCompanySlug(name: string): string {
  const base = slugify(name, { lower: true, strict: true }) || "company";
  return `${base}-${Date.now().toString(36)}`;
}

export const Company = model<ICompany>("Company", companySchema);
