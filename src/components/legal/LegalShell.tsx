import Link from "next/link";
import type { ReactNode } from "react";
import { ArrowRight } from "lucide-react";

/** Shared layout for policy pages. Every policy page is a draft until reviewed by counsel. */
export function LegalShell({ title, updated, children }: { title: string; updated: string; children: ReactNode }) {
  return (
    <main className="min-h-dvh px-5 pb-28 text-[15px] leading-8" style={{ paddingTop: "calc(var(--safe-top) + 1rem)" }}>
      <div className="mb-5 flex items-center gap-3">
        <Link href="/more" aria-label="رجوع إلى المزيد" className="grid size-10 place-items-center rounded-full bg-white/[0.07] ring-1 ring-white/10">
          <ArrowRight className="size-5" aria-hidden="true" />
        </Link>
        <h1 className="text-2xl font-bold">{title}</h1>
      </div>
      <p className="mb-6 rounded-2xl bg-brand/10 p-3 text-sm ring-1 ring-brand/30">
        <strong className="text-brand">مسودة:</strong> هذا النص مكتوب للتشغيل التجريبي، ويحتاج مراجعة قانونية متخصصة قبل النشر العام. آخر تحديث: {updated}.
      </p>
      <article className="flex flex-col gap-5 text-muted [&_h2]:mt-3 [&_h2]:text-lg [&_h2]:font-semibold [&_h2]:text-text [&_strong]:text-text [&_ul]:list-disc [&_ul]:space-y-2 [&_ul]:ps-5">
        {children}
      </article>
    </main>
  );
}
