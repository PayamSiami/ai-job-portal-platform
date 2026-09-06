import bcrypt from "bcryptjs";
import { Schema, model, type HydratedDocument } from "mongoose";
import type { UserRole } from "@portal/shared";

export interface IUser {
  username: string;
  email: string;
  password?: string;
  role: UserRole;
  profile?: {
    firstName?: string;
    lastName?: string;
    headline?: string;
    location?: string;
    skills?: string[];
    experience?: number;
    education?: string;
    bio?: string;
  };
  googleId?: string;
  isActive: boolean;
  lastLogin?: Date;
  createdAt: Date;
  updatedAt: Date;
}

export type UserDoc = HydratedDocument<IUser>;

const userSchema = new Schema<IUser>(
  {
    username: { type: String, required: true, unique: true, trim: true, minlength: 3, maxlength: 30 },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    password: { type: String, select: false },
    role: { type: String, enum: ["job-seeker", "employer", "admin"], required: true },
    profile: {
      firstName: String,
      lastName: String,
      headline: String,
      location: String,
      skills: [String],
      experience: Number,
      education: String,
      bio: String,
    },
    googleId: { type: String, index: { unique: true, sparse: true } },
    isActive: { type: Boolean, default: true },
    lastLogin: Date,
  },
  { timestamps: true },
);

userSchema.pre("save", async function (next) {
  if (!this.isModified("password") || !this.password) return next();
  this.password = await bcrypt.hash(this.password, 12);
  next();
});

userSchema.set("toJSON", {
  transform: (_doc, ret) => {
    delete ret.password;
    return ret;
  },
});

export const User = model<IUser>("User", userSchema);
