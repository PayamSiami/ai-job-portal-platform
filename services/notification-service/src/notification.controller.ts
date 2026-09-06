import type { Request, Response } from "express";
import { asyncHandler, sendError, sendSuccess, userContext } from "@portal/shared";
import { Notification, Activity } from "./notification.model.js";

export const listNotifications = asyncHandler(async (req: Request, res: Response) => {
  const ctx = userContext(req);
  const limit = Math.min(parseInt(String(req.query.limit) || "30", 10), 100);
  const unreadOnly = req.query.unread === "true";

  const filter: Record<string, unknown> = { userId: ctx.userId };
  if (unreadOnly) filter.read = false;

  const items = await Notification.find(filter).sort({ createdAt: -1 }).limit(limit);
  const unread = await Notification.countDocuments({ userId: ctx.userId, read: false });
  sendSuccess(res, { items, unread });
});

export const markRead = asyncHandler(async (req: Request, res: Response) => {
  const ctx = userContext(req);
  const result = await Notification.updateOne(
    { _id: req.params.id, userId: ctx.userId },
    { read: true },
  );
  if (result.matchedCount === 0) return sendError(res, "Notification not found", 404);
  sendSuccess(res, { ok: true });
});

export const markAllRead = asyncHandler(async (req: Request, res: Response) => {
  const ctx = userContext(req);
  await Notification.updateMany({ userId: ctx.userId, read: false }, { read: true });
  sendSuccess(res, { ok: true });
});

export const listActivities = asyncHandler(async (req: Request, res: Response) => {
  const ctx = userContext(req);
  const limit = Math.min(parseInt(String(req.query.limit) || "50", 10), 100);
  const items = await Activity.find({ userId: ctx.userId }).sort({ createdAt: -1 }).limit(limit);
  sendSuccess(res, items.map((a) => a.toJSON()));
});
