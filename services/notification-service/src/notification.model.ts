import { Schema, model, type Document } from "mongoose";

export interface INotification extends Document {
  userId: string;
  type: string;
  title: string;
  body: string;
  read: boolean;
  meta?: Record<string, unknown>;
  createdAt: Date;
}

const notificationSchema = new Schema<INotification>(
  {
    userId: { type: String, required: true, index: true },
    type: { type: String, required: true },
    title: { type: String, required: true },
    body: { type: String, default: "" },
    read: { type: Boolean, default: false },
    meta: Schema.Types.Mixed,
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

notificationSchema.index({ userId: 1, read: 1, createdAt: -1 });
notificationSchema.set("toJSON", { versionKey: false });

export const Notification = model<INotification>("Notification", notificationSchema);

export interface IActivity extends Document {
  userId: string;
  actorId?: string;
  action: string;
  entityType: string;
  entityId: string;
  meta?: Record<string, unknown>;
  createdAt: Date;
}

const activitySchema = new Schema<IActivity>(
  {
    userId: { type: String, required: true, index: true },
    actorId: String,
    action: { type: String, required: true },
    entityType: { type: String, required: true },
    entityId: { type: String, required: true },
    meta: Schema.Types.Mixed,
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

activitySchema.index({ userId: 1, createdAt: -1 });
activitySchema.set("toJSON", { versionKey: false });

export const Activity = model<IActivity>("Activity", activitySchema);
