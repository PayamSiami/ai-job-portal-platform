import nodemailer from "nodemailer";

// Email delivery with a console fallback when SMTP is not configured,
// so local development works out of the box.

let transporter: nodemailer.Transporter | null = null;

function getTransporter(): nodemailer.Transporter | null {
  if (!process.env.SMTP_HOST) return null;
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: parseInt(process.env.SMTP_PORT || "587", 10),
      secure: parseInt(process.env.SMTP_PORT || "587", 10) === 465,
      auth: process.env.SMTP_USER
        ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
        : undefined,
    });
  }
  return transporter;
}

export async function sendMail(options: {
  to: string;
  subject: string;
  html: string;
}): Promise<void> {
  const transport = getTransporter();
  const from = process.env.SMTP_FROM || "AI Job Portal <no-reply@localhost>";
  if (!transport) {
    console.log(`[mailer:console] to=${options.to} subject="${options.subject}" (${options.html.length} bytes html)`);
    return;
  }
  try {
    await transport.sendMail({ from, to: options.to, subject: options.subject, html: options.html });
  } catch (err) {
    console.error("[mailer] send failed:", err);
  }
}

export function emailTemplate(title: string, bodyHtml: string): string {
  return `<!doctype html><html dir="rtl"><body style="font-family:Tahoma,Arial,sans-serif;background:#f6f7fb;padding:24px">
  <div style="max-width:520px;margin:0 auto;background:#fff;border-radius:12px;padding:28px">
    <h2 style="color:#1d4ed8;margin-top:0">${title}</h2>
    <div style="color:#333;line-height:1.8">${bodyHtml}</div>
  </div></body></html>`;
}
