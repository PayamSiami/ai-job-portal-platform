import {
  EventNames,
  internalFetch,
  startEventConsumer,
} from "@portal/shared";
import { Notification, Activity } from "./notification.model.js";
import { sendMail, emailTemplate } from "./mailer.js";

// ------------------------------------------------------------
// Event consumers: the ONLY place that reacts to domain events.
// Keeps write-side services free of notification concerns.
// ------------------------------------------------------------

interface UserPayload {
  userId: string;
  email: string;
  username: string;
  role: string;
}
interface AppPayload {
  applicationId: string;
  jobId: string;
  jobTitle: string;
  candidateId: string;
  employerId: string;
}
interface StatusPayload extends AppPayload {
  oldStatus: string;
  newStatus: string;
}
interface InterviewPayload extends AppPayload {
  interviewId: string;
  overallScore: number;
  recommendation: string;
}

async function getUserEmail(userId: string): Promise<string | null> {
  try {
    const base = process.env.AUTH_SERVICE_URL || "http://localhost:8001";
    const user = await internalFetch<{ email: string }>(base, `/api/auth/internal/users/${userId}`);
    return user?.email ?? null;
  } catch {
    return null;
  }
}

async function handleEvent(type: string, payload: unknown): Promise<void> {
  switch (type) {
    case EventNames.UserRegistered: {
      const p = payload as UserPayload;
      const isEmployer = p.role === "employer";
      await Notification.create({
        userId: p.userId,
        type: "welcome",
        title: isEmployer ? "به جاب‌مچ خوش آمدید!" : "به جاب‌مچ خوش آمدید!",
        body: isEmployer
          ? "برای شروع، پروفایل شرکت خود را کامل کنید و اولین آگهی شغلی را منتشر کنید."
          : "برای شروع، رزومه خود را بسازید تا برای شغل‌ها اقدام کنید.",
      });
      await sendMail({
        to: p.email,
        subject: "به جاب‌مچ خوش آمدید",
        html: emailTemplate("خوش آمدید 🎉", `<p>${p.username} عزیز، حساب شما ساخته شد.</p>`),
      });
      break;
    }

    case EventNames.ApplicationCreated: {
      const p = payload as AppPayload;
      await Notification.create({
        userId: p.employerId,
        type: "application.created",
        title: `درخواست جدید برای «${p.jobTitle}»`,
        body: "یک نامزد جدید اقدام کرده است. نمره AI پس از بررسی خودکار نمایش داده می‌شود.",
        meta: { applicationId: p.applicationId, jobId: p.jobId },
      });
      await Activity.create({
        userId: p.candidateId,
        action: "application.submitted",
        entityType: "application",
        entityId: p.applicationId,
        meta: { jobTitle: p.jobTitle },
      });
      break;
    }

    case EventNames.ApplicationStatusChanged: {
      const p = payload as StatusPayload;
      await Notification.create({
        userId: p.candidateId,
        type: "application.status",
        title: `وضعیت درخواست شما برای «${p.jobTitle}» تغییر کرد`,
        body: `${p.oldStatus} ← ${p.newStatus}`,
        meta: { applicationId: p.applicationId, jobId: p.jobId },
      });
      const email = await getUserEmail(p.candidateId);
      if (email) {
        await sendMail({
          to: email,
          subject: `به‌روزرسانی وضعیت درخواست: ${p.jobTitle}`,
          html: emailTemplate(
            "تغییر وضعیت درخواست",
            `<p>وضعیت درخواست شما برای «${p.jobTitle}» از <b>${p.oldStatus}</b> به <b>${p.newStatus}</b> تغییر کرد.</p>`,
          ),
        });
      }
      await Activity.create({
        userId: p.candidateId,
        action: "application.status_changed",
        entityType: "application",
        entityId: p.applicationId,
        meta: { from: p.oldStatus, to: p.newStatus },
      });
      break;
    }

    case EventNames.InterviewCompleted: {
      const p = payload as InterviewPayload;
      const scoreLabel = p.overallScore == null ? "در انتظار ارزیابی کارفرما" : `${p.overallScore}/10`;
      await Notification.create({
        userId: p.employerId,
        type: "interview.completed",
        title: `مصاحبه AI برای «${p.jobTitle}» کامل شد`,
        body: `نمره کلی: ${scoreLabel} — پیشنهاد: ${p.recommendation}`,
        meta: { interviewId: p.interviewId, applicationId: p.applicationId },
      });
      await Activity.create({
        userId: p.candidateId,
        action: "interview.completed",
        entityType: "interview",
        entityId: p.interviewId,
        meta: { jobTitle: p.jobTitle, score: p.overallScore },
      });
      const employerEmail = await getUserEmail(p.employerId);
      if (employerEmail) {
        await sendMail({
          to: employerEmail,
          subject: `مصاحبه AI کامل شد: ${p.jobTitle}`,
          html: emailTemplate(
            "گزارش مصاحبه AI آماده است",
            `<p>نامزد مصاحبه AI را برای «${p.jobTitle}» کامل کرد.</p>
             <p>نمره: <b>${scoreLabel}</b> — پیشنهاد: <b>${p.recommendation}</b></p>`,
          ),
        });
      }
      break;
    }

    case EventNames.JobCreated: {
      const p = payload as { jobId: string; employerId: string; title: string };
      await Activity.create({
        userId: p.employerId,
        action: "job.published",
        entityType: "job",
        entityId: p.jobId,
        meta: { title: p.title },
      });
      break;
    }

    case EventNames.ResumeCreated: {
      const p = payload as { resumeId: string; userId: string };
      await Activity.create({
        userId: p.userId,
        action: "resume.created",
        entityType: "resume",
        entityId: p.resumeId,
      });
      break;
    }

    default:
      console.warn(`[notification] no handler for event: ${type}`);
  }
}

export function startConsumers(): void {
  void startEventConsumer("notification-service", async (type, payload) => {
    await handleEvent(type, payload);
  });
}
