"use client";

import Link from "next/link";
import { useEffect } from "react";
import { RotateCcw } from "lucide-react";

/** Shown when a page fails while rendering. It offers a retry or the home page, and no technical details. */
export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-5 px-6 text-center" style={{ paddingTop: "calc(var(--safe-top) + 1rem)" }}>
      <h1 className="text-2xl font-bold">حدث خطأ غير متوقع</h1>
      <p className="max-w-sm text-sm leading-7 text-muted">تعذّر عرض هذه الصفحة. حاول مرة أخرى، أو ارجع إلى الرئيسية.</p>
      <div className="flex flex-wrap justify-center gap-3">
        <button type="button" onClick={reset} className="inline-flex h-11 items-center gap-2 rounded-2xl bg-brand px-5 text-sm font-semibold text-ink">
          <RotateCcw className="size-4" aria-hidden="true" />
          حاول مرة أخرى
        </button>
        <Link href="/" className="inline-flex h-11 items-center rounded-2xl bg-white/10 px-5 text-sm font-semibold ring-1 ring-white/10">
          العودة إلى الرئيسية
        </Link>
      </div>
      {error.digest ? (
        <p className="text-xs text-muted">
          رقم الخطأ: <span dir="ltr">{error.digest}</span>
        </p>
      ) : null}
    </main>
  );
}
