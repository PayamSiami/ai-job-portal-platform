import PDFDocument from "pdfkit";
import type { IResume } from "./resume.model.js";

/**
 * Minimal clean PDF renderer. Intentionally simple; visual templates
 * live in the frontend resume-builder preview.
 */
export function renderResumePdf(resume: IResume): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 50, size: "A4" });
    const chunks: Buffer[] = [];
    doc.on("data", (chunk: Buffer) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    const info = resume.personalInfo ?? {};
    doc.fontSize(20).fillColor("#111").text(info.fullName || resume.title, { align: "left" });
    doc.fontSize(10).fillColor("#555");
    const contact = [info.email, info.phone, info.location].filter(Boolean).join("  •  ");
    if (contact) doc.text(contact);
    doc.moveDown(0.5);

    if (resume.summary) {
      doc.fontSize(12).fillColor("#111").text("Summary", { underline: true });
      doc.fontSize(10).fillColor("#333").text(resume.summary);
      doc.moveDown(0.5);
    }

    if (resume.skills.length > 0) {
      doc.fontSize(12).fillColor("#111").text("Skills");
      doc.fontSize(10).fillColor("#333").text(resume.skills.join(", "));
      doc.moveDown(0.5);
    }

    if (resume.workExperience.length > 0) {
      doc.fontSize(12).fillColor("#111").text("Work Experience");
      for (const w of resume.workExperience) {
        doc.fontSize(11).fillColor("#222").text(`${w.position} — ${w.company}`);
        doc.fontSize(9).fillColor("#666").text(`${w.startDate ?? ""} - ${w.current ? "Present" : w.endDate ?? ""}`);
        if (w.description) doc.fontSize(10).fillColor("#333").text(w.description);
        doc.moveDown(0.25);
      }
      doc.moveDown(0.25);
    }

    if (resume.education.length > 0) {
      doc.fontSize(12).fillColor("#111").text("Education");
      for (const e of resume.education) {
        doc.fontSize(11).fillColor("#222").text(`${e.degree}${e.field ? `, ${e.field}` : ""} — ${e.institution}`);
        doc.fontSize(9).fillColor("#666").text(`${e.startDate ?? ""} - ${e.endDate ?? ""}`);
      }
    }

    doc.end();
  });
}
