import Link from "next/link";
import { Compass } from "lucide-react";

export default function NotFound() {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-4 px-6 text-center" style={{ paddingTop: "calc(var(--safe-top) + 1rem)" }}>
      <div className="grid size-20 place-items-center rounded-3xl bg-surface-2 text-brand ring-1 ring-white/10">
        <Compass className="size-9" aria-hidden="true" />
      </div>
      <h1 className="text-2xl font-bold">هذه الصفحة غير موجودة</h1>
      <p className="max-w-sm text-sm leading-7 text-muted">ربما انتقل الفيديو أو الصفحة، أو ربما كتبت الرابط بشكل مختلف.</p>
      <Link href="/" className="inline-flex h-11 items-center rounded-2xl bg-brand px-5 text-sm font-semibold text-ink">
        العودة إلى الرئيسية
      </Link>
    </main>
  );
}
