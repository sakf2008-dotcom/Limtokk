"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { BookOpen, Copy, FileText, Info, KeyRound, Settings, ShieldCheck, Smartphone, Trash2, Upload } from "lucide-react";
import type { CategoryDto, PlatformInfoDto } from "@/lib/domain/types";
import { api, messageOf } from "@/lib/client/api";
import { LOCAL_KEYS, useLocal } from "@/lib/client/local";
import { DEFAULT_PREFS, type OwnedVideo, type Preferences } from "@/lib/client/library";
import { Button, Chip, EmptyState, Sheet, Spinner, useToast } from "@/components/ui/ui";

interface OwnerStatus {
  id: string;
  title: string;
  status: string;
  statusLabel: string;
  rejectionReason: string | null;
  canDelete: boolean;
  flagsLabels: string[];
}

export function MoreClient() {
  const toast = useToast();
  const [owned, setOwned] = useLocal<Record<string, OwnedVideo>>(LOCAL_KEYS.owned, {});
  const [prefs, setPrefs] = useLocal<Preferences>(LOCAL_KEYS.prefs, DEFAULT_PREFS);
  const [platform, setPlatform] = useState<PlatformInfoDto | null>(null);
  const [categories, setCategories] = useState<CategoryDto[]>([]);
  const [statuses, setStatuses] = useState<Record<string, OwnerStatus | "error">>({});
  const [recoveryCode, setRecoveryCode] = useState<{ videoId: string; code: string } | null>(null);
  const [recoveryForm, setRecoveryForm] = useState({ videoId: "", code: "" });
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    api<PlatformInfoDto>("/api/platform").then(setPlatform).catch(() => setPlatform(null));
    api<{ categories: CategoryDto[] }>("/api/categories").then((payload) => setCategories(payload.categories)).catch(() => setCategories([]));
  }, []);

  const ownedList = Object.values(owned).sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const next: Record<string, OwnerStatus | "error"> = {};
      for (const entry of ownedList) {
        try {
          next[entry.videoId] = await api<OwnerStatus>(`/api/videos/${entry.videoId}/owner`, { bearer: entry.ownerToken });
        } catch {
          next[entry.videoId] = "error";
        }
      }
      if (!cancelled) setStatuses(next);
    })();
    return () => {
      cancelled = true;
    };
    // The list of owned videos changes only when tokens are added or removed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [Object.keys(owned).join(",")]);

  async function createRecovery(entry: OwnedVideo) {
    setBusy(entry.videoId);
    try {
      const response = await api<{ code: string }>(`/api/videos/${entry.videoId}/recovery-code`, { method: "POST", bearer: entry.ownerToken });
      setRecoveryCode({ videoId: entry.videoId, code: response.code });
    } catch (error) {
      toast.show(messageOf(error), "error");
    } finally {
      setBusy(null);
    }
  }

  async function deleteVideo(entry: OwnedVideo) {
    if (!window.confirm("هل تريد حذف هذا الفيديو نهائيًا من علم توك؟ لا يمكن التراجع عن ذلك.")) return;
    setBusy(entry.videoId);
    try {
      await api(`/api/videos/${entry.videoId}`, { method: "DELETE", bearer: entry.ownerToken });
      setOwned((previous) => {
        const next = { ...previous };
        delete next[entry.videoId];
        return next;
      });
      toast.show("تم حذف الفيديو.", "success");
    } catch (error) {
      toast.show(messageOf(error), "error");
    } finally {
      setBusy(null);
    }
  }

  async function recover() {
    setBusy("recover");
    try {
      const response = await api<{ videoId: string; ownerToken: string }>("/api/recover", {
        body: { videoId: recoveryForm.videoId.trim(), code: recoveryForm.code.trim() },
      });
      setOwned((previous) => ({
        ...previous,
        [response.videoId]: { videoId: response.videoId, title: "فيديو مُسترد", ownerToken: response.ownerToken, createdAt: new Date().toISOString() },
      }));
      setRecoveryForm({ videoId: "", code: "" });
      toast.show("تمت استعادة إدارة الفيديو على هذا الجهاز.", "success");
    } catch (error) {
      toast.show(messageOf(error), "error");
    } finally {
      setBusy(null);
    }
  }

  function toggleInterest(id: string) {
    setPrefs((previous) => ({
      ...previous,
      interests: previous.interests.includes(id) ? previous.interests.filter((item) => item !== id) : [...previous.interests, id].slice(0, 8),
    }));
  }

  function clearLocalData() {
    if (!window.confirm("سيتم مسح المحفوظات والتقدم وقائمة فيديوهاتك المُدارة من هذا الجهاز. هل تريد المتابعة؟")) return;
    for (const key of Object.values(LOCAL_KEYS)) {
      try {
        window.localStorage.removeItem(key);
      } catch {
        // Ignore: storage may be unavailable.
      }
    }
    window.location.reload();
  }

  return (
    <main className="min-h-dvh px-4 pb-28" style={{ paddingTop: "calc(var(--safe-top) + 1rem)" }}>
      <header className="mb-5">
        <h1 className="text-2xl font-bold">المزيد</h1>
        <p className="mt-1 text-sm text-muted">مركز جهازك: إدارة فيديوهاتك، والاهتمامات، والخصوصية. لا يوجد حساب ولا تسجيل دخول.</p>
      </header>

      {platform?.demoMode ? (
        <div role="status" className="mb-5 rounded-2xl bg-brand/10 p-4 text-sm leading-7 ring-1 ring-brand/30">
          <strong className="block text-brand">وضع تجريبي</strong>
          البيانات هنا لا تُحفظ بشكل دائم، والفيديوهات المعروضة محتوى تجريبي من الفريق وليست مساهمات حقيقية. التخزين الدائم يتطلب ضبط قاعدة البيانات في إعدادات النشر.
        </div>
      ) : null}

      <section aria-labelledby="my-videos" className="mb-8">
        <h2 id="my-videos" className="mb-2 flex items-center gap-2 text-lg font-semibold">
          <ShieldCheck className="size-5 text-brand" aria-hidden="true" />
          فيديوهاتي على هذا الجهاز
        </h2>
        <p className="mb-4 text-xs leading-6 text-muted">
          إدارة هذه الفيديوهات تعتمد على رمز محفوظ في متصفح هذا الجهاز. مسح بيانات المتصفح أو تغيير الجهاز قد يُفقدك القدرة على الإدارة. احفظ «رمز الاسترداد» في مكان آمن لاستعادة الإدارة لاحقًا.
        </p>
        {ownedList.length === 0 ? (
          <EmptyState icon={<Upload className="size-7" aria-hidden="true" />} title="لم ترفع فيديوهات من هذا الجهاز" text="بعد إرسال فيديو ستظهر حالته هنا." action={<Link href="/add" className="inline-flex h-11 items-center rounded-2xl bg-brand px-5 text-sm font-semibold text-ink">إضافة فيديو</Link>} />
        ) : (
          <ul className="flex flex-col gap-3">
            {ownedList.map((entry) => {
              const status = statuses[entry.videoId];
              const loaded = status && status !== "error" ? status : null;
              return (
                <li key={entry.videoId} className="rounded-2xl bg-surface p-4 ring-1 ring-white/10">
                  <p className="line-clamp-2 font-semibold">{loaded?.title ?? entry.title}</p>
                  <p className="mt-1 text-sm text-muted">
                    {status === undefined ? <Spinner label="جارٍ تحميل الحالة" /> : null}
                    {status === "error" ? "تعذّر تحميل الحالة. قد يكون الرمز غير متاح على هذا الجهاز." : null}
                    {loaded ? <span className="font-semibold text-text">الحالة: {loaded.statusLabel}</span> : null}
                  </p>
                  {loaded?.rejectionReason ? <p className="mt-2 text-sm text-danger">سبب الرفض: {loaded.rejectionReason}</p> : null}
                  {loaded && loaded.flagsLabels.length > 0 ? <p className="mt-2 text-xs text-muted">ملاحظات الفحص: {loaded.flagsLabels.join("، ")}</p> : null}
                  <div className="mt-3 flex flex-wrap gap-2">
                    <Button variant="secondary" className="h-9 px-3 text-xs" onClick={() => void createRecovery(entry)} disabled={busy === entry.videoId}>
                      <KeyRound className="size-3.5" aria-hidden="true" />
                      رمز الاسترداد
                    </Button>
                    {loaded?.canDelete !== false ? (
                      <Button variant="danger" className="h-9 px-3 text-xs" onClick={() => void deleteVideo(entry)} disabled={busy === entry.videoId}>
                        <Trash2 className="size-3.5" aria-hidden="true" />
                        حذف
                      </Button>
                    ) : null}
                  </div>
                </li>
              );
            })}
          </ul>
        )}

        <details className="mt-5 rounded-2xl bg-white/[0.03] p-4 ring-1 ring-white/10">
          <summary className="cursor-pointer text-sm font-semibold">استعادة إدارة فيديو من جهاز آخر</summary>
          <div className="mt-3 flex flex-col gap-3">
            <input value={recoveryForm.videoId} onChange={(event) => setRecoveryForm((previous) => ({ ...previous, videoId: event.target.value }))} placeholder="معرّف الفيديو" aria-label="معرّف الفيديو" className="h-11 rounded-xl bg-white/[0.06] px-3 text-sm outline-none ring-1 ring-white/10 focus:ring-brand" dir="ltr" />
            <input value={recoveryForm.code} onChange={(event) => setRecoveryForm((previous) => ({ ...previous, code: event.target.value }))} placeholder="رمز الاسترداد" aria-label="رمز الاسترداد" className="h-11 rounded-xl bg-white/[0.06] px-3 text-sm outline-none ring-1 ring-white/10 focus:ring-brand" dir="ltr" />
            <Button variant="secondary" onClick={() => void recover()} disabled={!recoveryForm.videoId || !recoveryForm.code || busy === "recover"}>
              استعادة الإدارة
            </Button>
            <p className="text-xs leading-6 text-muted">رمز الاسترداد يُستخدم مرة واحدة. بعد الاستعادة يُلغى الرمز القديم.</p>
          </div>
        </details>
      </section>

      <section aria-labelledby="interests" className="mb-8">
        <h2 id="interests" className="mb-2 flex items-center gap-2 text-lg font-semibold">
          <BookOpen className="size-5 text-brand" aria-hidden="true" />
          اهتماماتك
        </h2>
        <p className="mb-3 text-xs leading-6 text-muted">تُستخدم اهتماماتك لترتيب تبويب «لك» على هذا الجهاز فقط. الترتيب يعتمد على التصنيفات والشعبية الحديثة، وليس نموذجًا ذكيًا مُدرَّبًا.</p>
        <div className="flex flex-wrap gap-2">
          {categories.map((category) => (
            <Chip key={category.id} small active={prefs.interests.includes(category.id)} onClick={() => toggleInterest(category.id)}>
              {category.nameAr}
            </Chip>
          ))}
        </div>
      </section>

      <section aria-labelledby="settings" className="mb-8 flex flex-col gap-3">
        <h2 id="settings" className="flex items-center gap-2 text-lg font-semibold">
          <Settings className="size-5 text-brand" aria-hidden="true" />
          الإعدادات
        </h2>
        <label className="flex items-center justify-between gap-3 rounded-2xl bg-surface p-4 text-sm ring-1 ring-white/10">
          <span>بدء الفيديوهات بدون صوت</span>
          <input type="checkbox" checked={prefs.muted} onChange={(event) => setPrefs((previous) => ({ ...previous, muted: event.target.checked }))} className="size-5 accent-[#f5b942]" />
        </label>
        <label className="flex flex-col gap-2 rounded-2xl bg-surface p-4 text-sm ring-1 ring-white/10">
          <span>اسمك المستعار للتعليقات والرفع</span>
          <input value={prefs.nickname} maxLength={24} onChange={(event) => setPrefs((previous) => ({ ...previous, nickname: event.target.value }))} className="h-11 rounded-xl bg-white/[0.06] px-3 outline-none ring-1 ring-white/10 focus:ring-brand" />
        </label>
        <Button variant="ghost" className="justify-start text-danger" onClick={clearLocalData}>
          <Trash2 className="size-4" aria-hidden="true" />
          مسح البيانات المحفوظة على هذا الجهاز
        </Button>
      </section>

      <section aria-labelledby="install" className="mb-8 rounded-3xl bg-surface p-5 ring-1 ring-white/10">
        <h2 id="install" className="mb-2 flex items-center gap-2 text-lg font-semibold">
          <Smartphone className="size-5 text-brand" aria-hidden="true" />
          أضف علم توك إلى شاشة آيفون
        </h2>
        <ol className="list-decimal space-y-2 ps-5 text-sm leading-7 text-muted">
          <li>افتح الموقع في Safari.</li>
          <li>اضغط زر المشاركة (المربع مع السهم للأعلى).</li>
          <li>اختر «إضافة إلى الشاشة الرئيسية».</li>
          <li>ستفتح علم توك بملء الشاشة مثل التطبيقات.</li>
        </ol>
      </section>

      <section aria-labelledby="links" className="flex flex-col gap-2">
        <h2 id="links" className="mb-1 text-lg font-semibold">معلومات وسياسات</h2>
        {[
          { href: "/learn", label: "مركز التعلّم", icon: BookOpen },
          { href: "/guidelines", label: "إرشادات المجتمع", icon: ShieldCheck },
          { href: "/privacy", label: "سياسة الخصوصية", icon: Info },
          { href: "/terms", label: "شروط الاستخدام", icon: FileText },
          { href: "/copyright", label: "الإبلاغ عن انتهاك حقوق الملكية", icon: FileText },
          { href: "/about", label: "عن علم توك", icon: Info },
        ].map((item) => (
          <Link key={item.href} href={item.href} className="flex items-center gap-3 rounded-2xl bg-white/[0.04] px-4 py-3.5 text-sm ring-1 ring-white/10 hover:bg-white/[0.07]">
            <item.icon className="size-5 text-brand" aria-hidden="true" />
            {item.label}
          </Link>
        ))}
        <Link href="/admin" className="mt-4 flex items-center gap-2 text-xs text-muted hover:text-text">
          <Copy className="size-3.5" aria-hidden="true" />
          دخول المشرفين (لوحة الإدارة)
        </Link>
      </section>

      <Sheet open={recoveryCode !== null} onClose={() => setRecoveryCode(null)} title="رمز الاسترداد">
        {recoveryCode ? (
          <div className="flex flex-col gap-4 text-sm leading-7">
            <p className="text-muted">انسخ هذين السطرين واحفظهما خارج الجهاز. الرمز يُعرض مرة واحدة فقط، ويُستخدم مرة واحدة.</p>
            <div className="rounded-2xl bg-white/[0.06] p-4 font-mono text-base" dir="ltr">
              <p>معرّف الفيديو: {recoveryCode.videoId}</p>
              <p className="mt-2 text-lg font-bold tracking-wider">{recoveryCode.code}</p>
            </div>
            <Button full onClick={() => {
              void navigator.clipboard?.writeText(`معرّف الفيديو: ${recoveryCode.videoId}\nرمز الاسترداد: ${recoveryCode.code}`).then(
                () => toast.show("تم النسخ.", "success"),
                () => toast.show("تعذّر النسخ. انسخه يدويًا.", "error"),
              );
            }}>
              <Copy className="size-4" aria-hidden="true" />
              نسخ الرمز
            </Button>
          </div>
        ) : null}
      </Sheet>
    </main>
  );
}
