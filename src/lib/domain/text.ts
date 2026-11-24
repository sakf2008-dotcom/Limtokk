/**
 * Text helpers shared by server and client. Pure functions only (no Node or DOM APIs).
 */

const HARAKAT_AND_TATWEEL = /[ً-ٰٟـ]/g;
const INVISIBLE_CHARS = /[​-‏‪-‮⁠-⁩﻿]/g;

/**
 * Normalizes Arabic (and Latin) text for search and comparison:
 * removes diacritics and tatweel, unifies common letter variants, lowercases Latin letters.
 * This is for matching only. Stored display text is never changed by it.
 */
export function normalizeArabic(input: string): string {
  return input
    .normalize("NFKC")
    .replace(INVISIBLE_CHARS, "")
    .replace(HARAKAT_AND_TATWEEL, "")
    .toLowerCase()
    .replace(/[أإآٱ]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ة/g, "ه")
    .replace(/ؤ/g, "و")
    .replace(/ئ/g, "ي")
    .replace(/\s+/g, " ")
    .trim();
}

/** Escapes LIKE wildcards so user input is matched literally. */
export function escapeLike(input: string): string {
  return input.replace(/[\\%_]/g, (match) => `\\${match}`);
}

const HASHTAG_MAX_LENGTH = 24;
export const MAX_HASHTAGS = 5;

/** Turns "#علوم_الفضاء!" into "علوم_الفضاء". Returns null when nothing usable remains. */
export function normalizeHashtag(raw: string): string | null {
  const cleaned = normalizeArabic(raw)
    .replace(/^#+/, "")
    .replace(/[^\p{L}\p{N}_]/gu, "")
    .slice(0, HASHTAG_MAX_LENGTH);
  return cleaned.length >= 2 ? cleaned : null;
}

/** Parses a free-form hashtag field (spaces, commas, or Arabic commas separate tags). */
export function parseHashtags(input: string): string[] {
  const seen = new Set<string>();
  for (const part of input.split(/[\s,،#]+/u)) {
    const tag = normalizeHashtag(part);
    if (tag) seen.add(tag);
    if (seen.size >= MAX_HASHTAGS) break;
  }
  return [...seen];
}

/** Builds the lowercase, normalized text that search queries match against. */
export function buildSearchText(parts: Array<string | null | undefined>, hashtags: string[]): string {
  return normalizeArabic([...parts.filter((p): p is string => Boolean(p)), ...hashtags].join(" "));
}

/** Arabic-Indic and Persian digits converted to ASCII, for numeric parsing of form input. */
export function toAsciiDigits(input: string): string {
  return input.replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660)).replace(/[۰-۹]/g, (d) =>
    String(d.charCodeAt(0) - 0x06f0),
  );
}

/**
 * Cuts text to at most `limit` characters without ending in the middle of a word.
 * Returns the visible part and whether anything was cut (the UI then shows a "more" button).
 */
export function truncateAtWord(input: string, limit: number): { text: string; truncated: boolean } {
  const clean = input.trim();
  const chars = Array.from(clean);
  if (chars.length <= limit) return { text: clean, truncated: false };
  const head = chars.slice(0, limit).join("");
  const lastSpace = head.lastIndexOf(" ");
  const cut = lastSpace > limit * 0.5 ? head.slice(0, lastSpace) : head;
  return { text: `${cut.replace(/[\s،,.؛:;\-–]+$/u, "")}…`, truncated: true };
}
