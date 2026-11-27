/**
 * The app's single accent color. Every button, active state, progress line and highlight uses the
 * CSS variable --color-brand. The visitor picks the color in «المزيد»; the choice is kept on the device.
 *
 * The value is stored as JSON, like every other local setting (see src/lib/client/local.ts). The picker,
 * the boot script and the reader below all use that one format.
 *
 * This module has no client-only imports at load time, so the server layout can use the boot script.
 */

export const ACCENT_STORAGE_KEY = "ilmtok.accent.v1";
export const ACCENT_VARIABLE = "--color-brand";
/** Sky blue: calm, readable, and clearly different from a warm gold. */
export const DEFAULT_ACCENT = "#38bdf8";
/** The dark background color. Text on the accent color uses it, so the accent must be bright enough. */
export const INK = "#07080c";

export interface AccentPreset {
  id: string;
  label: string;
  hex: string;
}

export const ACCENT_PRESETS: AccentPreset[] = [
  { id: "sky", label: "سماوي", hex: "#38bdf8" },
  { id: "gold", label: "ذهبي", hex: "#f5b942" },
  { id: "emerald", label: "زمردي", hex: "#34d399" },
  { id: "violet", label: "بنفسجي", hex: "#a78bfa" },
  { id: "pink", label: "وردي", hex: "#f472b6" },
  { id: "orange", label: "برتقالي", hex: "#fb923c" },
  { id: "rose", label: "قرمزي", hex: "#fb7185" },
  { id: "lime", label: "ليموني", hex: "#a3e635" },
];

const HEX = /^#[0-9a-fA-F]{6}$/;

export function isHexColor(value: unknown): value is string {
  return typeof value === "string" && HEX.test(value);
}

/** WCAG relative luminance of a #rrggbb color. */
export function relativeLuminance(hex: string): number {
  const channel = (offset: number) => {
    const value = Number.parseInt(hex.slice(offset, offset + 2), 16) / 255;
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5);
}

/** WCAG contrast ratio between two #rrggbb colors (1 to 21). */
export function contrastRatio(a: string, b: string): number {
  const [light, dark] = [relativeLuminance(a), relativeLuminance(b)].sort((x, y) => y - x) as [number, number];
  return (light + 0.05) / (dark + 0.05);
}

/** Text on the accent color must reach at least 4.5:1 (WCAG AA for normal text). */
export function isReadableOnAccent(hex: string): boolean {
  return contrastRatio(hex, INK) >= 4.5;
}

/** Reads the saved color on the device. Anything missing, unreadable or invalid falls back to the default. */
export function readStoredAccent(): string {
  try {
    const raw = window.localStorage.getItem(ACCENT_STORAGE_KEY);
    const stored: unknown = raw === null ? null : JSON.parse(raw);
    return isHexColor(stored) ? stored.toLowerCase() : DEFAULT_ACCENT;
  } catch {
    return DEFAULT_ACCENT;
  }
}

/** Applies the color to the whole app at once, because every component reads the same variable. */
export function applyAccent(hex: string): void {
  if (!isHexColor(hex)) return;
  document.documentElement.style.setProperty(ACCENT_VARIABLE, hex.toLowerCase());
}

/**
 * A tiny script placed in the page before the first paint, so a returning visitor sees their color at once
 * instead of a flash of the default. It only reads the stored value and validates it.
 */
export function accentBootScript(): string {
  return `(function(){try{var c=JSON.parse(localStorage.getItem("${ACCENT_STORAGE_KEY}"));if(typeof c==="string"&&/^#[0-9a-fA-F]{6}$/.test(c)){document.documentElement.style.setProperty("${ACCENT_VARIABLE}",c.toLowerCase());}}catch(e){}})();`;
}
