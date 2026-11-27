import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ACCENT_PRESETS,
  ACCENT_STORAGE_KEY,
  ACCENT_VARIABLE,
  DEFAULT_ACCENT,
  INK,
  accentBootScript,
  contrastRatio,
  isHexColor,
  isReadableOnAccent,
  readStoredAccent,
} from "@/lib/domain/accent";

describe("the accent color", () => {
  it("offers presets that are all valid colors with readable text on the dark background", () => {
    expect(ACCENT_PRESETS.length).toBeGreaterThanOrEqual(6);
    for (const preset of ACCENT_PRESETS) {
      expect(isHexColor(preset.hex), preset.id).toBe(true);
      expect(isReadableOnAccent(preset.hex), `${preset.id} must reach 4.5:1 with the dark text`).toBe(true);
    }
    expect(ACCENT_PRESETS.map((preset) => preset.hex)).toContain(DEFAULT_ACCENT);
  });

  it("accepts only six-digit hex colors", () => {
    expect(isHexColor("#38bdf8")).toBe(true);
    expect(isHexColor("#38BDF8")).toBe(true);
    expect(isHexColor("#fff")).toBe(false);
    expect(isHexColor("red")).toBe(false);
    expect(isHexColor("#gggggg")).toBe(false);
    expect(isHexColor(null)).toBe(false);
  });

  it("measures contrast like WCAG: dark text on white is strong, dark text on dark is not", () => {
    expect(contrastRatio(INK, "#ffffff")).toBeGreaterThan(15);
    expect(contrastRatio(INK, "#101010")).toBeLessThan(2);
    expect(isReadableOnAccent("#202020")).toBe(false);
  });

  it("reads the saved value in the JSON format the picker writes, and falls back to the default otherwise", () => {
    const store = new Map<string, string>();
    vi.stubGlobal("window", {
      localStorage: {
        getItem: (key: string) => store.get(key) ?? null,
        setItem: (key: string, value: string) => store.set(key, value),
      },
    });
    expect(readStoredAccent()).toBe(DEFAULT_ACCENT);
    store.set(ACCENT_STORAGE_KEY, JSON.stringify("not-a-color"));
    expect(readStoredAccent()).toBe(DEFAULT_ACCENT);
    store.set(ACCENT_STORAGE_KEY, JSON.stringify(42));
    expect(readStoredAccent()).toBe(DEFAULT_ACCENT);
    store.set(ACCENT_STORAGE_KEY, JSON.stringify("#A78BFA"));
    expect(readStoredAccent()).toBe("#a78bfa");
    store.set(ACCENT_STORAGE_KEY, "#38bdf8");
    expect(readStoredAccent()).toBe(DEFAULT_ACCENT);
  });

  it("returns the default when storage throws (private browsing)", () => {
    vi.stubGlobal("window", {
      localStorage: {
        getItem: () => {
          throw new Error("blocked");
        },
      },
    });
    expect(readStoredAccent()).toBe(DEFAULT_ACCENT);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });
});

describe("the early boot script", () => {
  it("reads the same storage key, parses it the same way, and sets the same variable the app uses", () => {
    const script = accentBootScript();
    expect(script).toContain(ACCENT_STORAGE_KEY);
    expect(script).toContain(ACCENT_VARIABLE);
    expect(script).toContain("JSON.parse");
    expect(script).toContain("try");
  });
});
