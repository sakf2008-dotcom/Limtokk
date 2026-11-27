"use client";

import { useEffect } from "react";
import { Check, RotateCcw } from "lucide-react";
import { ACCENT_PRESETS, DEFAULT_ACCENT, INK, applyAccent, isHexColor, isReadableOnAccent, readStoredAccent } from "@/lib/domain/accent";
import { LOCAL_KEYS, useLocal } from "@/lib/client/local";
import { Button } from "@/components/ui/ui";

/**
 * Lets the visitor choose the app's one accent color. The choice is kept on this device and applied
 * to the whole app at once, because every component reads the same CSS variable.
 */
export function AccentPicker() {
  const [stored, setStored] = useLocal<string>(LOCAL_KEYS.accent, DEFAULT_ACCENT);
  const accent = isHexColor(stored) ? stored.toLowerCase() : DEFAULT_ACCENT;

  // Apply the value saved on this device, read directly. The first render can still hold the default,
  // and applying that would flash the whole app to the default color when the page loads.
  useEffect(() => {
    applyAccent(readStoredAccent());
  }, [stored]);

  // Apply first, then save: the app changes at once even when storage is blocked.
  function choose(hex: string) {
    applyAccent(hex);
    setStored(hex);
  }

  const readable = isReadableOnAccent(accent);

  return (
    <section aria-labelledby="accent-title" className="flex flex-col gap-4 rounded-2xl bg-surface p-4 ring-1 ring-white/10">
      <h3 id="accent-title" className="text-sm font-semibold">
        لون التطبيق
      </h3>

      <div role="radiogroup" aria-label="لون التطبيق" className="grid grid-cols-4 gap-3">
        {ACCENT_PRESETS.map((preset) => {
          const selected = accent === preset.hex;
          return (
            <button
              key={preset.id}
              type="button"
              role="radio"
              aria-checked={selected}
              aria-label={preset.label}
              onClick={() => choose(preset.hex)}
              className="flex flex-col items-center gap-1.5 text-xs text-muted"
            >
              <span
                className={`grid size-11 place-items-center rounded-full ring-2 transition-transform active:scale-95 ${selected ? "ring-white" : "ring-transparent"}`}
                style={{ background: preset.hex }}
              >
                {selected ? <Check className="size-5" style={{ color: INK }} aria-hidden="true" /> : null}
              </span>
              <span>{preset.label}</span>
            </button>
          );
        })}
      </div>

      <label className="flex items-center justify-between gap-3 text-sm">
        <span>لون آخر تختاره بنفسك</span>
        <input
          type="color"
          value={accent}
          onChange={(event) => choose(event.target.value)}
          aria-label="اختر لونًا آخر"
          className="h-10 w-16 cursor-pointer rounded-xl bg-transparent"
        />
      </label>

      {readable ? null : <p className="text-xs leading-6 text-muted">هذا اللون قاتم، وقد يصعب قراءة النص على الأزرار. اختر لونًا أفتح.</p>}

      <div className="flex flex-wrap items-center gap-3">
        <span className="inline-flex h-10 items-center rounded-2xl px-5 text-sm font-semibold" style={{ background: accent, color: INK }}>
          مثال على الزر
        </span>
        <Button variant="ghost" onClick={() => choose(DEFAULT_ACCENT)}>
          <RotateCcw className="size-4" aria-hidden="true" />
          اللون الافتراضي
        </Button>
      </div>
    </section>
  );
}
