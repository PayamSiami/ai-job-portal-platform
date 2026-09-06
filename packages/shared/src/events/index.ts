import { z } from "zod";

// ============================================================
// Domain event contracts, published on the Redis Stream
// "portal:events". Every payload is validated with zod before
// publishing and after consuming.
// ============================================================

export const EVENT_STREAM = "portal:events";
export const EVENT_DLQ = "portal:events:dlq";

export const EventNames = {
  UserRegistered: "user.registered",
  CompanyCreated: "company.created",
  JobCreated: "job.created",
  ResumeCreated: "resume.created",
  ApplicationCreated: "application.created",
  ApplicationStatusChanged: "application.status_changed",
  InterviewCompleted: "interview.completed",
} as const;
export type EventName = (typeof EventNames)[keyof typeof EventNames];

export const UserRegisteredPayload = z.object({
  userId: z.string(),
  email: z.string().email(),
  username: z.string(),
  role: z.enum(["job-seeker", "employer", "admin"]),
});

export const CompanyCreatedPayload = z.object({
  companyId: z.string(),
  ownerId: z.string(),
  name: z.string(),
});

export const JobCreatedPayload = z.object({
  jobId: z.string(),
  employerId: z.string(),
  companyId: z.string().optional(),
  title: z.string(),
  slug: z.string(),
});

export const ResumeCreatedPayload = z.object({
  resumeId: z.string(),
  userId: z.string(),
});

export const ApplicationCreatedPayload = z.object({
  applicationId: z.string(),
  jobId: z.string(),
  jobTitle: z.string(),
  candidateId: z.string(),
  employerId: z.string(),
});

export const ApplicationStatusChangedPayload = z.object({
  applicationId: z.string(),
  jobId: z.string(),
  jobTitle: z.string(),
  candidateId: z.string(),
  employerId: z.string(),
  oldStatus: z.string(),
  newStatus: z.string(),
});

export const InterviewCompletedPayload = z.object({
  interviewId: z.string(),
  applicationId: z.string(),
  jobId: z.string(),
  jobTitle: z.string(),
  candidateId: z.string(),
  employerId: z.string(),
  overallScore: z.number(),
  recommendation: z.string(),
});

/** Map of event name -> zod payload schema. Used to validate on publish & consume. */
export const EventSchemas = {
  [EventNames.UserRegistered]: UserRegisteredPayload,
  [EventNames.CompanyCreated]: CompanyCreatedPayload,
  [EventNames.JobCreated]: JobCreatedPayload,
  [EventNames.ResumeCreated]: ResumeCreatedPayload,
  [EventNames.ApplicationCreated]: ApplicationCreatedPayload,
  [EventNames.ApplicationStatusChanged]: ApplicationStatusChangedPayload,
  [EventNames.InterviewCompleted]: InterviewCompletedPayload,
} as const;

export type EventPayloadMap = {
  [K in keyof typeof EventSchemas]: z.infer<(typeof EventSchemas)[K]>;
};

export type EventHandler = (
  type: string,
  payload: unknown,
  eventId: string,
) => Promise<void> | void;
