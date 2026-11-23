import type { Metadata } from "next";
import { WifiOff } from "lucide-react";

export const metadata: Metadata = { title: "لا يوجد اتصال" };

/** Served by the service worker when the network is unavailable. Static, so it works offline. */
export default function OfflinePage() {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-4 px-6 text-center" style={{ paddingTop: "calc(var(--safe-top) + 1rem)" }}>
      <div className="grid size-20 place-items-center rounded-3xl bg-surface-2 text-brand ring-1 ring-white/10">
        <WifiOff className="size-9" aria-hidden="true" />
      </div>
      <h1 className="text-2xl font-bold">لا يوجد اتصال بالإنترنت</h1>
      <p className="max-w-sm text-sm leading-7 text-muted">
        الفيديوهات تحتاج اتصالًا لتعمل. يمكنك مراجعة محفوظاتك وتقدّمك محليًا، وسيُعاد تحميل الصفحة عند عودة الاتصال.
      </p>
      <a href="/saved" className="inline-flex h-11 items-center rounded-2xl bg-brand px-5 text-sm font-semibold text-ink">
        فتح المحفوظات
      </a>
    </main>
  );
}
