"use client";

import Link from "next/link";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Ban, Check, CircleCheck, Eye, Flag, LogOut, MessageSquare, RefreshCw, Shield, Star, Trash2, X } from "lucide-react";
import { api, ClientApiError, messageOf } from "@/lib/client/api";
import { Button, Sheet, Spinner, useToast } from "@/components/ui/ui";

type Tab = "overview" | "queue" | "reports" | "comments" | "videos" | "categories" | "settings" | "audit";
const TABS: Array<{ id: Tab; label: string }> = [
  { id: "overview", label: "نظرة عامة" },
  { id: "queue", label: "المراجعة" },
  { id: "reports", label: "البلاغات" },
  { id: "comments", label: "التعليقات" },
  { id: "videos", label: "الفيديوهات" },
  { id: "categories", label: "التصنيفات" },
  { id: "settings", label: "الإعدادات" },
  { id: "audit", label: "السجل" },
];

const STATUS_LABELS: Record<string, string> = {
  pending_upload: "بانتظار الرفع",
  pending_review: "قيد المراجعة",
  approved: "منشور",
  rejected: "مرفوض",
  hidden: "مخفي",
  expired: "منتهٍ",
  deleted: "محذوف",
};

interface AdminVideo {
  id: string;
  title: string;
  description: string;
  keyFact: string | null;
  hashtags: string[];
  status: string;
  categoryId: string;
  creatorName: string;
  createdAt: string;
  publishedAt: string | null;
  sizeBytes: number | null;
  durationMs: number | null;
  flags: string[];
  rejectionReason: string | null;
  isFeatured: boolean;
  isDemo: boolean;
  reportCount: number;
  likeCount: number;
  viewCount: number;
  submitterShortId: string | null;
  submitterHash: string | null;
  previewable: boolean;
}

export function AdminConsole() {
  const toast = useToast();
  const [session, setSession] = useState<"checking" | "in" | "out" | "unavailable">("checking");
  const [tab, setTab] = useState<Tab>("overview");

  useEffect(() => {
    let cancelled = false;
    api("/api/admin/session")
      .then(() => {
        if (!cancelled) setSession("in");
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setSession(error instanceof ClientApiError && error.status === 503 ? "unavailable" : "out");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function run(action: () => Promise<unknown>, success?: string) {
    try {
      await action();
      if (success) toast.show(success, "success");
      return true;
    } catch (error) {
      if (error instanceof ClientApiError && error.status === 401) {
        setSession("out");
      }
      toast.show(messageOf(error), "error");
      return false;
    }
  }

  if (session === "checking") {
    return (
      <main className="grid min-h-dvh place-items-center">
        <Spinner label="جارٍ التحقق من الجلسة" />
      </main>
    );
  }

  if (session === "unavailable") {
    return (
      <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-4 px-6 text-center">
        <Shield className="mx-auto size-10 text-brand" aria-hidden="true" />
        <h1 className="text-xl font-bold">لوحة الإدارة غير مُفعّلة</h1>
        <p className="text-sm leading-7 text-muted">
          يلزم ضبط متغيرات ADMIN_PASSWORD_HASH أو ADMIN_PASSWORD و ADMIN_SESSION_SECRET في إعدادات النشر. التفاصيل في دليل النشر.
        </p>
        <Link href="/" className="text-sm font-semibold text-brand">العودة إلى الرئيسية</Link>
      </main>
    );
  }

  if (session === "out") {
    return <AdminLogin onSuccess={() => setSession("in")} />;
  }

  return (
    <main className="min-h-dvh pb-16" style={{ paddingTop: "calc(var(--safe-top) + 0.5rem)" }}>
      <header className="sticky top-0 z-20 border-b border-white/10 bg-ink/95 px-4 pb-3 backdrop-blur-xl">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-3 pt-2">
          <div className="flex items-center gap-2">
            <Shield className="size-5 text-brand" aria-hidden="true" />
            <h1 className="text-lg font-bold">لوحة الإشراف</h1>
          </div>
          <div className="flex items-center gap-2">
            <Link href="/" className="rounded-full bg-white/[0.07] px-3 py-1.5 text-xs">الموقع</Link>
            <button
              type="button"
              onClick={async () => {
                await run(() => api("/api/admin/logout", { method: "POST" }));
                setSession("out");
              }}
              className="inline-flex items-center gap-1.5 rounded-full bg-white/[0.07] px-3 py-1.5 text-xs"
            >
              <LogOut className="size-3.5" aria-hidden="true" />
              خروج
            </button>
          </div>
        </div>
        <nav aria-label="أقسام الإدارة" className="no-scrollbar mx-auto mt-3 flex max-w-5xl gap-2 overflow-x-auto">
          {TABS.map((item) => (
            <button
              key={item.id}
              type="button"
              aria-pressed={tab === item.id}
              onClick={() => setTab(item.id)}
              className={`shrink-0 rounded-full px-3.5 py-1.5 text-sm font-semibold ring-1 ${tab === item.id ? "bg-brand text-ink ring-brand" : "bg-white/[0.04] ring-white/10 text-muted"}`}
            >
              {item.label}
            </button>
          ))}
        </nav>
      </header>

      <div className="mx-auto max-w-5xl px-4 pt-5">
        {tab === "overview" ? <Overview run={run} /> : null}
        {tab === "queue" ? <VideoList key="queue" status="pending_review" run={run} title="بانتظار المراجعة" /> : null}
        {tab === "reports" ? <Reports run={run} /> : null}
        {tab === "comments" ? <Comments run={run} /> : null}
        {tab === "videos" ? <VideoList key="all" status="" run={run} title="كل الفيديوهات" /> : null}
        {tab === "categories" ? <Categories run={run} /> : null}
        {tab === "settings" ? <Settings run={run} /> : null}
        {tab === "audit" ? <Audit /> : null}
      </div>
    </main>
  );
}

type Run = (action: () => Promise<unknown>, success?: string) => Promise<boolean>;

function AdminLogin({ onSuccess }: { onSuccess: () => void }) {
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      await api("/api/admin/login", { body: { password } });
      setPassword("");
      onSuccess();
    } catch (caught) {
      setError(messageOf(caught));
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="mx-auto flex min-h-dvh max-w-sm flex-col justify-center gap-6 px-6">
      <div className="text-center">
        <Shield className="mx-auto size-11 text-brand" aria-hidden="true" />
        <h1 className="mt-3 text-2xl font-bold">دخول المشرفين</h1>
        <p className="mt-2 text-sm leading-7 text-muted">هذه الصفحة للمشرفين فقط. لا توجد حسابات للزوار.</p>
      </div>
      <form onSubmit={submit} className="flex flex-col gap-3">
        <label className="flex flex-col gap-2 text-sm">
          كلمة المرور
          <input type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} required className="h-12 rounded-2xl bg-white/[0.06] px-4 outline-none ring-1 ring-white/10 focus:ring-brand" />
        </label>
        {error ? <p role="alert" className="text-sm text-danger">{error}</p> : null}
        <Button type="submit" full disabled={busy || password.length === 0}>
          {busy ? "جارٍ التحقق…" : "دخول"}
        </Button>
      </form>
    </main>
  );
}

function Overview({ run }: { run: Run }) {
  const [data, setData] = useState<null | {
    totals: Record<string, number>;
    statusCounts: Record<string, number>;
    openReports: number;
    heldComments: number;
    storedBytes: number;
    storageLimitBytes: number;
    storageAvailable: boolean;
    demoMode: boolean;
    daily: Array<{ day: string; uploads: number; approvals: number; rejections: number; reports: number; comments: number; likes: number }>;
    recentAudit: Array<{ id: number; actor: string; action: string; created_at: string }>;
  }>(null);
  const [error, setError] = useState("");

  const load = useCallback(() => {
    api<NonNullable<typeof data>>("/api/admin/overview")
      .then((payload) => setData(payload))
      .catch((caught) => setError(messageOf(caught)));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  if (error) return <p role="alert" className="text-danger">{error}</p>;
  if (!data) return <Spinner label="جارٍ تحميل الإحصاءات" />;

  const usage = data.storageLimitBytes > 0 ? Math.min(100, Math.round((data.storedBytes / data.storageLimitBytes) * 100)) : 0;
  const kpis: Array<{ label: string; value: number | string }> = [
    { label: "فيديوهات منشورة", value: data.totals.approvedVideos ?? 0 },
    { label: "بانتظار المراجعة", value: data.statusCounts.pending_review ?? 0 },
    { label: "بلاغات مفتوحة", value: data.openReports },
    { label: "تعليقات معلّقة", value: data.heldComments },
    { label: "إجمالي المشاهدات", value: data.totals.totalViews ?? 0 },
    { label: "إجمالي الإعجابات", value: data.totals.totalLikes ?? 0 },
    { label: "أصحاب محتوى (أسماء)", value: data.totals.creators ?? 0 },
    { label: "أجهزة محظورة مؤقتًا", value: data.totals.blockedDevices ?? 0 },
  ];

  return (
    <div className="flex flex-col gap-6">
      {data.demoMode ? (
        <p className="rounded-2xl bg-brand/10 p-3 text-sm ring-1 ring-brand/30">
          وضع تجريبي: البيانات لا تُحفظ بشكل دائم. التخزين الدائم يتطلب إعداد قاعدة البيانات.
        </p>
      ) : null}

      <section className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {kpis.map((kpi) => (
          <div key={kpi.label} className="rounded-2xl bg-surface p-4 ring-1 ring-white/10">
            <p className="text-xs text-muted">{kpi.label}</p>
            <p className="mt-1 text-2xl font-bold tabular-nums">{new Intl.NumberFormat("ar").format(Number(kpi.value))}</p>
          </div>
        ))}
      </section>

      <section className="rounded-2xl bg-surface p-4 ring-1 ring-white/10" aria-labelledby="storage">
        <h2 id="storage" className="font-semibold">التخزين</h2>
        <p className="mt-1 text-sm text-muted">
          {(data.storedBytes / 1048576).toFixed(1)} ميجابايت من {(data.storageLimitBytes / 1073741824).toFixed(1)} غيغابايت المخصصة ({usage}%).
          {data.storageAvailable ? "" : " التخزين غير مُفعّل في هذه النسخة."}
        </p>
        <div className="mt-3 h-2 overflow-hidden rounded-full bg-white/10" role="progressbar" aria-valuenow={usage} aria-valuemin={0} aria-valuemax={100}>
          <div className="h-full bg-brand" style={{ width: `${usage}%` }} />
        </div>
        <p className="mt-3 text-[11px] leading-5 text-muted">استهلاك عرض النطاق الترددي غير متاح داخل التطبيق. راجع لوحة مزوّد الاستضافة والتخزين.</p>
      </section>

      <section aria-labelledby="daily">
        <h2 id="daily" className="mb-2 font-semibold">النشاط خلال 14 يومًا</h2>
        <div className="overflow-x-auto rounded-2xl ring-1 ring-white/10">
          <table className="w-full min-w-[520px] text-sm">
            <thead className="bg-white/[0.04] text-muted">
              <tr>
                {["اليوم", "رفع", "نشر", "رفض", "بلاغات", "تعليقات", "إعجابات"].map((head) => (
                  <th key={head} className="px-3 py-2 text-start font-medium">{head}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.daily.length === 0 ? (
                <tr><td colSpan={7} className="px-3 py-4 text-muted">لا يوجد نشاط مسجل بعد.</td></tr>
              ) : null}
              {data.daily.map((row) => (
                <tr key={row.day} className="border-t border-white/5">
                  <td className="px-3 py-2 tabular-nums" dir="ltr">{row.day}</td>
                  <td className="px-3 py-2 tabular-nums">{row.uploads}</td>
                  <td className="px-3 py-2 tabular-nums">{row.approvals}</td>
                  <td className="px-3 py-2 tabular-nums">{row.rejections}</td>
                  <td className="px-3 py-2 tabular-nums">{row.reports}</td>
                  <td className="px-3 py-2 tabular-nums">{row.comments}</td>
                  <td className="px-3 py-2 tabular-nums">{row.likes}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <div>
        <Button variant="secondary" onClick={() => void run(() => api("/api/admin/cleanup", { method: "POST" }), "تم تشغيل التنظيف.").then(load)}>
          <RefreshCw className="size-4" aria-hidden="true" />
          تشغيل التنظيف الآن
        </Button>
      </div>
    </div>
  );
}

function VideoList({ status, run, title }: { status: string; run: Run; title: string }) {
  const [items, setItems] = useState<AdminVideo[] | null>(null);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState(status);
  const [preview, setPreview] = useState<AdminVideo | null>(null);
  const [error, setError] = useState("");

  const load = useCallback(() => {
    const params = new URLSearchParams({ limit: "40" });
    if (filter) params.set("status", filter);
    if (query.trim()) params.set("q", query.trim());
    api<{ items: AdminVideo[] }>(`/api/admin/videos?${params.toString()}`)
      .then((payload) => setItems(payload.items))
      .catch((caught) => setError(messageOf(caught)));
  }, [filter, query]);

  useEffect(() => {
    load();
  }, [load]);

  async function act(video: AdminVideo, action: string, extra: Record<string, unknown> = {}) {
    const reason = ["reject", "hide", "delete"].includes(action) ? window.prompt("اكتب سبب الإجراء (يظهر في السجل):", "مخالف لإرشادات المجتمع") : "";
    if (reason === null && ["reject", "hide", "delete"].includes(action)) return;
    const ok = await run(
      () => api(`/api/admin/videos/${video.id}`, { body: { action, reason: reason ?? undefined, ...extra } }),
      "تم تنفيذ الإجراء.",
    );
    if (ok) load();
  }

  async function blockDevice(video: AdminVideo) {
    if (!video.submitterHash) return;
    const hours = Number(window.prompt("مدة الحظر المؤقت للجهاز بالساعات (1 إلى 8760):", "24"));
    if (!Number.isFinite(hours) || hours < 1) return;
    const reason = window.prompt("سبب الحظر:", "مخالفات متكررة") ?? "مخالفات";
    const ok = await run(() => api("/api/admin/blocks", { body: { deviceHash: video.submitterHash, hours, reason } }), "تم حظر الجهاز مؤقتًا.");
    if (ok) load();
  }

  return (
    <section className="flex flex-col gap-4" aria-label={title}>
      <div className="flex flex-col gap-2 sm:flex-row">
        <input value={query} onChange={(event) => setQuery(event.target.value)} onKeyDown={(event) => event.key === "Enter" && load()} placeholder="بحث بالعنوان أو الوصف" aria-label="بحث في الفيديوهات" className="h-11 flex-1 rounded-xl bg-white/[0.06] px-3 text-sm outline-none ring-1 ring-white/10 focus:ring-brand" />
        <select value={filter} onChange={(event) => setFilter(event.target.value)} aria-label="الحالة" className="h-11 rounded-xl bg-surface-2 px-3 text-sm ring-1 ring-white/10">
          <option value="">كل الحالات</option>
          {Object.entries(STATUS_LABELS).map(([value, label]) => (
            <option key={value} value={value}>{label}</option>
          ))}
        </select>
        <Button variant="secondary" onClick={load} className="h-11">بحث</Button>
      </div>

      {error ? <p role="alert" className="text-danger">{error}</p> : null}
      {!items ? <Spinner label="جارٍ التحميل" /> : null}
      {items && items.length === 0 ? <p className="rounded-2xl bg-surface p-6 text-center text-sm text-muted">لا توجد عناصر في هذه القائمة.</p> : null}

      <ul className="flex flex-col gap-3">
        {items?.map((video) => (
          <li key={video.id} className="rounded-2xl bg-surface p-4 ring-1 ring-white/10">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="font-semibold leading-7">{video.title}</p>
                <p className="text-xs text-muted">
                  {STATUS_LABELS[video.status] ?? video.status} · {video.creatorName} · {video.categoryId} · {video.durationMs ? `${Math.round(video.durationMs / 1000)} ث` : "—"} · {video.sizeBytes ? `${(video.sizeBytes / 1048576).toFixed(1)} م.ب` : "—"}
                  {video.isDemo ? " · تجريبي" : ""}
                </p>
                <p className="mt-1 text-xs text-muted">أُنشئ: {new Date(video.createdAt).toLocaleString("ar")} · مشاهدات {video.viewCount} · إعجابات {video.likeCount} · بلاغات {video.reportCount}</p>
              </div>
              <span className="shrink-0 rounded-full bg-white/[0.06] px-2.5 py-1 text-xs">{STATUS_LABELS[video.status] ?? video.status}</span>
            </div>
            {video.description ? <p className="mt-2 line-clamp-3 text-sm leading-6 text-muted">{video.description}</p> : null}
            {video.keyFact ? <p className="mt-1 text-xs text-muted">المعلومة: {video.keyFact}</p> : null}
            {video.flags.length > 0 ? <p className="mt-2 text-xs text-brand">ملاحظات الفحص: {video.flags.join("، ")}</p> : null}
            {video.rejectionReason ? <p className="mt-1 text-xs text-danger">سبب: {video.rejectionReason}</p> : null}
            {video.submitterShortId ? <p className="mt-1 text-[11px] text-muted" dir="ltr">جهاز: {video.submitterShortId}…</p> : null}

            <div className="mt-3 flex flex-wrap gap-2">
              {video.previewable ? (
                <Button variant="secondary" className="h-9 px-3 text-xs" onClick={() => setPreview(video)}>
                  <Eye className="size-3.5" aria-hidden="true" /> معاينة
                </Button>
              ) : null}
              {video.status === "pending_review" || video.status === "hidden" ? (
                <Button className="h-9 px-3 text-xs" onClick={() => void act(video, "approve")}>
                  <Check className="size-3.5" aria-hidden="true" /> نشر
                </Button>
              ) : null}
              {video.status === "pending_review" ? (
                <Button variant="danger" className="h-9 px-3 text-xs" onClick={() => void act(video, "reject")}>
                  <X className="size-3.5" aria-hidden="true" /> رفض
                </Button>
              ) : null}
              {video.status === "approved" ? (
                <Button variant="secondary" className="h-9 px-3 text-xs" onClick={() => void act(video, "hide")}>
                  إخفاء
                </Button>
              ) : null}
              {video.status === "hidden" ? (
                <Button variant="secondary" className="h-9 px-3 text-xs" onClick={() => void act(video, "restore")}>
                  استعادة
                </Button>
              ) : null}
              {video.status === "approved" ? (
                <Button variant="secondary" className="h-9 px-3 text-xs" onClick={() => void act(video, video.isFeatured ? "unfeature" : "feature")}>
                  <Star className="size-3.5" aria-hidden="true" /> {video.isFeatured ? "إلغاء التمييز" : "تمييز"}
                </Button>
              ) : null}
              {video.status !== "deleted" ? (
                <Button variant="ghost" className="h-9 px-3 text-xs text-danger" onClick={() => void act(video, "delete")}>
                  <Trash2 className="size-3.5" aria-hidden="true" /> حذف
                </Button>
              ) : null}
              {video.submitterHash ? (
                <Button variant="ghost" className="h-9 px-3 text-xs" onClick={() => void blockDevice(video)}>
                  <Ban className="size-3.5" aria-hidden="true" /> حظر الجهاز مؤقتًا
                </Button>
              ) : null}
            </div>
          </li>
        ))}
      </ul>
      <p className="text-[11px] text-muted">{title}: كل إجراء يُسجَّل في سجل المراجعة.</p>

      <Sheet open={preview !== null} onClose={() => setPreview(null)} title={preview ? `معاينة: ${preview.title}` : "معاينة"}>
        {preview ? (
          <video key={preview.id} src={`/api/admin/videos/${preview.id}/media`} controls playsInline preload="metadata" className="mx-auto max-h-[70dvh] w-auto rounded-2xl bg-black" />
        ) : null}
      </Sheet>
    </section>
  );
}

function Reports({ run }: { run: Run }) {
  const [status, setStatus] = useState<"open" | "resolved" | "dismissed">("open");
  const [items, setItems] = useState<Array<{ id: string; targetType: string; targetId: string; reason: string; details: string | null; targetTitle: string | null; targetStatus: string | null; openReports: number; createdAt: string }> | null>(null);

  const load = useCallback(() => {
    api<{ items: NonNullable<typeof items> }>(`/api/admin/reports?status=${status}`).then((payload) => setItems(payload.items)).catch(() => setItems([]));
  }, [status]);

  useEffect(() => {
    load();
  }, [load]);

  async function act(id: string, action: string) {
    if (await run(() => api(`/api/admin/reports/${id}`, { body: { action } }), "تم تنفيذ القرار.")) load();
  }

  return (
    <section className="flex flex-col gap-4">
      <div className="flex gap-2">
        {(["open", "resolved", "dismissed"] as const).map((value) => (
          <button key={value} type="button" aria-pressed={status === value} onClick={() => setStatus(value)} className={`rounded-full px-3 py-1.5 text-sm ring-1 ${status === value ? "bg-brand text-ink ring-brand" : "ring-white/10 text-muted"}`}>
            {value === "open" ? "مفتوحة" : value === "resolved" ? "تمت معالجتها" : "مرفوضة"}
          </button>
        ))}
      </div>
      {!items ? <Spinner label="جارٍ التحميل" /> : null}
      {items && items.length === 0 ? <p className="rounded-2xl bg-surface p-6 text-center text-sm text-muted">لا توجد بلاغات في هذه القائمة.</p> : null}
      <ul className="flex flex-col gap-3">
        {items?.map((report) => (
          <li key={report.id} className="rounded-2xl bg-surface p-4 ring-1 ring-white/10">
            <p className="flex items-center gap-2 text-xs text-muted"><Flag className="size-3.5 text-brand" aria-hidden="true" />{report.targetType === "video" ? "فيديو" : "تعليق"} · {report.reason} · بلاغات مفتوحة على العنصر: {report.openReports}</p>
            <p className="mt-2 font-semibold leading-7">{report.targetTitle ?? "عنصر محذوف"}</p>
            {report.details ? <p className="mt-1 text-sm text-muted">التفاصيل: {report.details}</p> : null}
            <p className="mt-1 text-xs text-muted">الحالة الحالية للعنصر: {report.targetStatus ?? "—"}</p>
            {status === "open" ? (
              <div className="mt-3 flex flex-wrap gap-2">
                <Button variant="secondary" className="h-9 px-3 text-xs" onClick={() => void act(report.id, "dismiss")}>لا مخالفة</Button>
                <Button className="h-9 px-3 text-xs" onClick={() => void act(report.id, "hide_target")}>إخفاء العنصر</Button>
                <Button variant="danger" className="h-9 px-3 text-xs" onClick={() => void act(report.id, "delete_target")}>حذف العنصر</Button>
                <Button variant="ghost" className="h-9 px-3 text-xs" onClick={() => void act(report.id, "restore_target")}>استعادة العنصر</Button>
              </div>
            ) : null}
          </li>
        ))}
      </ul>
    </section>
  );
}

function Comments({ run }: { run: Run }) {
  const [status, setStatus] = useState<"pending" | "hidden">("pending");
  const [items, setItems] = useState<Array<{ id: string; videoTitle: string; authorName: string; body: string; flags: string[]; createdAt: string | null }> | null>(null);

  const load = useCallback(() => {
    api<{ items: NonNullable<typeof items> }>(`/api/admin/comments?status=${status}`).then((payload) => setItems(payload.items)).catch(() => setItems([]));
  }, [status]);

  useEffect(() => {
    load();
  }, [load]);

  async function act(id: string, action: string) {
    if (await run(() => api(`/api/admin/comments/${id}`, { body: { action } }), "تم.")) load();
  }

  return (
    <section className="flex flex-col gap-4">
      <div className="flex gap-2">
        {(["pending", "hidden"] as const).map((value) => (
          <button key={value} type="button" aria-pressed={status === value} onClick={() => setStatus(value)} className={`rounded-full px-3 py-1.5 text-sm ring-1 ${status === value ? "bg-brand text-ink ring-brand" : "ring-white/10 text-muted"}`}>
            {value === "pending" ? "بانتظار المراجعة" : "مخفية"}
          </button>
        ))}
      </div>
      {!items ? <Spinner label="جارٍ التحميل" /> : null}
      {items && items.length === 0 ? <p className="rounded-2xl bg-surface p-6 text-center text-sm text-muted">لا توجد تعليقات في هذه القائمة.</p> : null}
      <ul className="flex flex-col gap-3">
        {items?.map((comment) => (
          <li key={comment.id} className="rounded-2xl bg-surface p-4 ring-1 ring-white/10">
            <p className="text-xs text-muted"><MessageSquare className="me-1 inline size-3.5" aria-hidden="true" />{comment.authorName} · على: {comment.videoTitle}</p>
            <p className="mt-2 whitespace-pre-line leading-7">{comment.body}</p>
            {comment.flags.length > 0 ? <p className="mt-2 text-xs text-brand">أسباب الاحتجاز: {comment.flags.join("، ")}</p> : null}
            <div className="mt-3 flex flex-wrap gap-2">
              <Button className="h-9 px-3 text-xs" onClick={() => void act(comment.id, "approve")}><CircleCheck className="size-3.5" aria-hidden="true" /> نشر</Button>
              <Button variant="secondary" className="h-9 px-3 text-xs" onClick={() => void act(comment.id, "hide")}>إخفاء</Button>
              <Button variant="danger" className="h-9 px-3 text-xs" onClick={() => void act(comment.id, "delete")}>حذف</Button>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

function Categories({ run }: { run: Run }) {
  const [items, setItems] = useState<Array<{ id: string; nameAr: string; descriptionAr: string; accent: string; icon: string; sortOrder: number; isActive: boolean }> | null>(null);

  const load = useCallback(() => {
    api<{ categories: NonNullable<typeof items> }>("/api/admin/categories").then((payload) => setItems(payload.categories)).catch(() => setItems([]));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  function patch(id: string, changes: Partial<NonNullable<typeof items>[number]>) {
    setItems((previous) => previous?.map((item) => (item.id === id ? { ...item, ...changes } : item)) ?? previous);
  }

  async function save(item: NonNullable<typeof items>[number]) {
    await run(() => api("/api/admin/categories", { method: "PUT", body: item }), "تم حفظ التصنيف.");
    load();
  }

  if (!items) return <Spinner label="جارٍ التحميل" />;
  return (
    <ul className="flex flex-col gap-3">
      {items.map((item) => (
        <li key={item.id} className="grid gap-2 rounded-2xl bg-surface p-4 ring-1 ring-white/10 md:grid-cols-[1fr_1fr_auto_auto_auto]">
          <input value={item.nameAr} onChange={(event) => patch(item.id, { nameAr: event.target.value })} aria-label={`اسم ${item.id}`} className="h-10 rounded-xl bg-white/[0.06] px-3 text-sm outline-none ring-1 ring-white/10" />
          <input value={item.descriptionAr} onChange={(event) => patch(item.id, { descriptionAr: event.target.value })} aria-label={`وصف ${item.id}`} className="h-10 rounded-xl bg-white/[0.06] px-3 text-sm outline-none ring-1 ring-white/10" />
          <input type="color" value={item.accent} onChange={(event) => patch(item.id, { accent: event.target.value })} aria-label={`لون ${item.id}`} className="h-10 w-14 rounded-xl bg-transparent" />
          <input type="number" value={item.sortOrder} min={0} onChange={(event) => patch(item.id, { sortOrder: Number(event.target.value) })} aria-label={`ترتيب ${item.id}`} className="h-10 w-20 rounded-xl bg-white/[0.06] px-3 text-sm outline-none ring-1 ring-white/10" />
          <div className="flex items-center gap-2">
            <label className="flex items-center gap-1.5 text-xs"><input type="checkbox" checked={item.isActive} onChange={(event) => patch(item.id, { isActive: event.target.checked })} className="size-4 accent-[#f5b942]" />ظاهر</label>
            <Button variant="secondary" className="h-10 px-3 text-xs" onClick={() => void save({ ...item, icon: item.icon })}>حفظ</Button>
          </div>
        </li>
      ))}
    </ul>
  );
}

function Settings({ run }: { run: Run }) {
  const [data, setData] = useState<null | { settings: Record<string, number | boolean | string[]>; limits: Record<string, { min: number; max: number }> }>(null);
  const [draft, setDraft] = useState<Record<string, number | boolean | string>>({});

  const load = useCallback(() => {
    api<NonNullable<typeof data>>("/api/admin/settings").then((payload) => {
      setData(payload);
      setDraft({});
    });
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  if (!data) return <Spinner label="جارٍ تحميل الإعدادات" />;
  const value = (key: string) => (key in draft ? draft[key] : data.settings[key]);
  const numeric = [
    ["maxUploadBytes", "أقصى حجم للملف (بايت)"],
    ["maxDurationSeconds", "أقصى مدة (ثانية)"],
    ["minDurationSeconds", "أدنى مدة (ثانية)"],
    ["maxPendingPerDevice", "الإرسالات المعلّقة لكل جهاز"],
    ["maxSubmissionsPerDeviceDay", "الإرسالات اليومية لكل جهاز"],
    ["maxUploadsPerDayGlobal", "الحد اليومي للرفع (كل الأجهزة)"],
    ["maxStorageBytesTotal", "حجم التخزين الإجمالي (بايت)"],
    ["pendingExpiryMinutes", "مهلة الرفع غير المكتمل (دقيقة)"],
    ["rejectedRetentionDays", "الاحتفاظ بالمرفوض (يوم)"],
    ["reportAutoHideThreshold", "إخفاء مؤقت عند عدد البلاغات"],
    ["commentChallengeAfterRecent", "طلب تحقق بعد عدد تعليقات (10 دقائق)"],
  ] as const;

  async function save() {
    const patch: Record<string, unknown> = { ...draft };
    if (typeof patch.extraBlockedTerms === "string") {
      patch.extraBlockedTerms = String(patch.extraBlockedTerms).split(/[\n,،]+/u).map((term) => term.trim()).filter(Boolean);
    }
    if (await run(() => api("/api/admin/settings", { method: "PUT", body: patch }), "تم حفظ الإعدادات.")) load();
  }

  return (
    <form className="flex flex-col gap-4" onSubmit={(event) => { event.preventDefault(); void save(); }}>
      <div className="grid gap-3 md:grid-cols-2">
        {numeric.map(([key, label]) => {
          const limit = data.limits[key];
          return (
            <label key={key} className="flex flex-col gap-1.5 rounded-2xl bg-surface p-4 text-sm ring-1 ring-white/10">
              {label}
              <input type="number" value={Number(value(key))} min={limit?.min} max={limit?.max} onChange={(event) => setDraft((previous) => ({ ...previous, [key]: Number(event.target.value) }))} className="h-10 rounded-xl bg-white/[0.06] px-3 outline-none ring-1 ring-white/10" dir="ltr" />
              {limit ? <span className="text-[11px] text-muted">المجال: {limit.min} إلى {limit.max}</span> : null}
            </label>
          );
        })}
      </div>
      <label className="flex items-center justify-between gap-3 rounded-2xl bg-surface p-4 text-sm ring-1 ring-white/10">
        السماح بالتعليقات
        <input type="checkbox" checked={Boolean(value("commentsEnabled"))} onChange={(event) => setDraft((previous) => ({ ...previous, commentsEnabled: event.target.checked }))} className="size-5 accent-[#f5b942]" />
      </label>
      <label className="flex flex-col gap-2 rounded-2xl bg-surface p-4 text-sm ring-1 ring-white/10">
        كلمات إضافية محظورة (تُفصل بفاصلة أو سطر، وتُراجَع يدويًا)
        <textarea
          rows={3}
          defaultValue={(data.settings.extraBlockedTerms as string[]).join("، ")}
          onChange={(event) => setDraft((previous) => ({ ...previous, extraBlockedTerms: event.target.value }))}
          className="rounded-xl bg-white/[0.06] p-3 outline-none ring-1 ring-white/10"
        />
      </label>
      <div>
        <Button type="submit" disabled={Object.keys(draft).length === 0}>حفظ التغييرات</Button>
      </div>
    </form>
  );
}

function Audit() {
  const [items, setItems] = useState<Array<{ id: number; actor: string; action: string; target_type: string; target_id: string | null; created_at: string }> | null>(null);
  useEffect(() => {
    api<{ items: NonNullable<typeof items> }>("/api/admin/audit?limit=100").then((payload) => setItems(payload.items)).catch(() => setItems([]));
  }, []);
  if (!items) return <Spinner label="جارٍ التحميل" />;
  return (
    <div className="overflow-x-auto rounded-2xl ring-1 ring-white/10">
      <table className="w-full min-w-[560px] text-xs">
        <thead className="bg-white/[0.04] text-muted">
          <tr>{["الوقت", "الفاعل", "الإجراء", "الهدف"].map((head) => <th key={head} className="px-3 py-2 text-start font-medium">{head}</th>)}</tr>
        </thead>
        <tbody>
          {items.map((row) => (
            <tr key={row.id} className="border-t border-white/5">
              <td className="px-3 py-2" dir="ltr">{new Date(row.created_at).toLocaleString("en-GB")}</td>
              <td className="px-3 py-2">{row.actor}</td>
              <td className="px-3 py-2" dir="ltr">{row.action}</td>
              <td className="px-3 py-2" dir="ltr">{row.target_type}{row.target_id ? `:${row.target_id.slice(0, 12)}` : ""}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
