// ------------------------------------------------------------
// Generic 4-factor personality assessment (the four DISC
// dimensions: Dominance, Influence, Steadiness, Conscientiousness).
//
// This is a *generic* model written from scratch (not the branded
// "DISC" instrument — that is trademarked). 24 statements, 6 per
// factor, rated 1..5. Scores are normalized to 0..100 per factor;
// the highest factor is the candidate's primary profile.
// ------------------------------------------------------------

import type { DiscFactor, DiscResponse, DiscScores, IDiscResult } from "./interview.model.js";

export const DISC_FACTORS: DiscFactor[] = [
  "dominance",
  "influence",
  "steadiness",
  "conscientiousness",
];

export const DISC_LABELS: Record<"en" | "fa", Record<DiscFactor, string>> = {
  en: {
    dominance: "D (Dominance)",
    influence: "I (Influence)",
    steadiness: "S (Steadiness)",
    conscientiousness: "C (Conscientiousness)",
  },
  fa: {
    dominance: "D (حمله\u200cگری)",
    influence: "I (تأثیرگذار)",
    steadiness: "S (ثبات\u200cطلب)",
    conscientiousness: "C (دقی\u200cجو)",
  },
};

export interface DiscItem {
  factor: DiscFactor;
  en: string;
  fa: string;
}

// 24 statements (6 per factor). Order is stable so indices are stable.
export const DISC_ITEMS: DiscItem[] = [
  { factor: "dominance", en: "I prefer to take charge and lead others.", fa: "ترجیح می‌دهم که رهبری و هدایت دیگران را بر عهده بگیرم." },
  { factor: "dominance", en: "I am comfortable challenging the status quo to get results.", fa: "من راحت هستم که با چالش کردن شرایط موجود، به نتیجه برسم." },
  { factor: "dominance", en: "I push through obstacles to reach goals quickly.", fa: "با زودبندی به سوی هدف حرکت می‌کنم حتی اگر موانعی در راه باشد." },
  { factor: "dominance", en: "I make decisions quickly even with limited information.", fa: "حتی با اطلاعات محدود، تصمیم می‌گیرم." },
  { factor: "dominance", en: "I focus on measurable, concrete outcomes.", fa: "تمرکزم بر نتایج قابل‌اندازه‌گیری و واضح است." },
  { factor: "dominance", en: "I am comfortable taking calculated risks.", fa: "خودم را در برابر ریسک‌های محاسبه‌شده راحت می‌دانم." },
  { factor: "influence", en: "I enjoy being the center of attention in group settings.", fa: "لذت می‌برم که مرکز توجه در جمع باشم." },
  { factor: "influence", en: "I motivate others with my enthusiasm and optimism.", fa: "با انرژی و امیدم دیگران را انگیزش می‌دهم." },
  { factor: "influence", en: "I find it easy to persuade people to see things my way.", fa: "راحت است که دیگران را قانع کنم." },
  { factor: "influence", en: "I feel energized when working collaboratively.", fa: "وقتی با دیگران همکاری می‌کنم، پرانرژی می‌شوم." },
  { factor: "influence", en: "I publicly recognize and celebrate others' achievements.", fa: "دستاوردهای دیگران را به‌صورت عمومی قدرتمند می‌دانم." },
  { factor: "influence", en: "I am generally optimistic about future outcomes.", fa: "عموماً در مورد نتایج آینده خوش‌بین هستم." },
  { factor: "steadiness", en: "I prefer a stable, predictable work environment.", fa: "محیط کاری ثابت و قابل‌پیش‌بینی را ترجیح می‌دهم." },
  { factor: "steadiness", en: "I listen carefully before offering my own opinion.", fa: "قبل از ابراز نظرم، با دقت گوش می‌دهم." },
  { factor: "steadiness", en: "I value cooperation over competition.", fa: "همکاری را بر رقابت ارزشمند می‌دانم." },
  { factor: "steadiness", en: "I stay calm and patient when others are stressed.", fa: "وقتی دیگران فشار دارند، آرام و صبور می‌مانم." },
  { factor: "steadiness", en: "I like building strong one-on-one relationships.", fa: "دوست دارم روابط یکی‌به‌یکی قوی بسازم." },
  { factor: "steadiness", en: "I consider how decisions affect people before acting.", fa: "قبل از اقدام، به فکر تأثیر تصمیماتم بر افراد می‌افتم." },
  { factor: "conscientiousness", en: "I pay close attention to accuracy and quality.", fa: "به دقت و کیفیت نزدیک می‌شوم." },
  { factor: "conscientiousness", en: "I plan thoroughly before starting a task.", fa: "قبل از شروع یک وظیفه، برنامه‌ریزی کامل می‌کنم." },
  { factor: "conscientiousness", en: "I prefer working with clear facts and data.", fa: "ترجیح می‌دهم با اطلاعات و ادعاها واضح کار کنم." },
  { factor: "conscientiousness", en: "I set high standards for myself and others.", fa: "استانداردهای بالا برای من و دیگران قائتها می‌کنم." },
  { factor: "conscientiousness", en: "I follow procedures to ensure consistency.", fa: "مقررات را دنبال می‌کنم تا از یکنواختی داشته باشد." },
  { factor: "conscientiousness", en: "I analyze problems methodically before acting.", fa: "قبل از اقدام، مشکلات را به‌صورت سیستماتیک تحلیل می‌کنم." },
];

export function discItemText(item: DiscItem, language: "en" | "fa"): string {
  return language === "en" ? item.en : item.fa;
}

export const DISC_RATING_MIN = 1;
export const DISC_RATING_MAX = 5;
export const DISC_ITEM_COUNT = DISC_ITEMS.length;

function scale(avg: number): number {
  const clamped = Math.min(Math.max(avg, DISC_RATING_MIN), DISC_RATING_MAX);
  return Math.round(((clamped - DISC_RATING_MIN) / (DISC_RATING_MAX - DISC_RATING_MIN)) * 100);
}

export function computeDisc(
  responses: DiscResponse[],
  language: "en" | "fa" = "en",
): Pick<IDiscResult, "scores" | "primary" | "label"> {
  const byFactor: Record<DiscFactor, number[]> = {
    dominance: [],
    influence: [],
    steadiness: [],
    conscientiousness: [],
  };
  for (const r of responses) {
    const item = DISC_ITEMS[r.index];
    if (!item) continue;
    if (r.rating >= DISC_RATING_MIN && r.rating <= DISC_RATING_MAX) byFactor[item.factor].push(r.rating);
  }
  const avg = (arr: number[]) => (arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0);
  const scores: DiscScores = {
    dominance: scale(avg(byFactor.dominance)),
    influence: scale(avg(byFactor.influence)),
    steadiness: scale(avg(byFactor.steadiness)),
    conscientiousness: scale(avg(byFactor.conscientiousness)),
  };
  const primary: DiscFactor = DISC_FACTORS.reduce((best, f) => (scores[f] > scores[best] ? f : best));
  return {
    scores,
    primary,
    label: { en: DISC_LABELS.en[primary], fa: DISC_LABELS.fa[primary] },
  };
}
