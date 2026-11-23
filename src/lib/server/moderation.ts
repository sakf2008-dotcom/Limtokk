import { normalizeArabic } from "@/lib/domain/text";

/**
 * Rule-based content checks. These are deterministic filters, not AI moderation.
 * Nothing here claims to be an AI classifier. Every flagged item is routed to a human.
 */

export type TextFlag = "blocked_term" | "link" | "contact" | "spam_pattern" | "all_caps";

/** Starter list of clearly prohibited terms. Admins can extend it at runtime from the dashboard. */
export const BASE_BLOCKED_TERMS: readonly string[] = [
  "كس",
  "شرموط",
  "عرص",
  "قحبه",
  "منيوك",
  "ديوث",
  "fuck",
  "shit",
  "bitch",
  "porn",
];

const LINK_PATTERN =
  /(https?:\/\/|www\.|t\.me\/|wa\.me\/|bit\.ly\/|\b[a-z0-9-]+\.(com|net|org|io|me|co|app|xyz|info|shop|store|online)\b)/i;
const CONTACT_PATTERN =
  /(\+?\d[\d\s\-()]{7,}\d)|(@[a-z0-9_.]{3,})|(واتس|واتساب|تلجرام|تليجرام|سناب|انستغرام|whatsapp|telegram|instagram|snapchat)/i;
const REPEATED_CHARACTER_PATTERN = /(.)\1{8,}/u;
const EMOJI_FLOOD_PATTERN = /(\p{Extended_Pictographic}\s*){8,}/u;

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function analyzeText(text: string, extraTerms: readonly string[] = []): TextFlag[] {
  const flags = new Set<TextFlag>();
  const normalized = normalizeArabic(text);

  const terms = [...BASE_BLOCKED_TERMS, ...extraTerms].map((term) => normalizeArabic(term)).filter(Boolean);
  for (const term of terms) {
    const pattern = new RegExp(`(^|\\s)${escapeRegExp(term)}(\\s|$)`, "iu");
    if (pattern.test(normalized)) {
      flags.add("blocked_term");
      break;
    }
  }

  if (LINK_PATTERN.test(text)) flags.add("link");
  if (CONTACT_PATTERN.test(normalized)) flags.add("contact");
  if (REPEATED_CHARACTER_PATTERN.test(text) || EMOJI_FLOOD_PATTERN.test(text)) flags.add("spam_pattern");

  const latinLetters = text.replace(/[^A-Za-z]/g, "");
  if (latinLetters.length >= 20) {
    const upper = latinLetters.replace(/[^A-Z]/g, "").length;
    if (upper / latinLetters.length > 0.8) flags.add("all_caps");
  }

  return [...flags];
}

/** Maps a flag to a short Arabic explanation for the admin dashboard. */
export const FLAG_LABELS_AR: Record<TextFlag, string> = {
  blocked_term: "كلمة محظورة",
  link: "رابط خارجي",
  contact: "معلومات تواصل",
  spam_pattern: "نمط يشبه الرسائل المزعجة",
  all_caps: "كتابة بالأحرف الكبيرة فقط",
};
