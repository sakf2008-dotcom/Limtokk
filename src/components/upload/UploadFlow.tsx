"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { AlertTriangle, ArrowRight, CheckCircle2, Clock, Film, Lock, ShieldCheck, Upload, X } from "lucide-react";
import type { CategoryDto, PlatformInfoDto } from "@/lib/domain/types";
import { api, ClientApiError, messageOf } from "@/lib/client/api";
import { LOCAL_KEYS, useLocal } from "@/lib/client/local";
import { DEFAULT_PREFS, type OwnedVideo, type Preferences } from "@/lib/client/library";
import { solveChallenge, type PowChallengeDto } from "@/lib/client/pow";
import { Button, Spinner } from "@/components/ui/ui";
import { CategoryIcon } from "@/components/ui/CategoryIcon";

interface InitResponse {
  videoId: string;
  creatorId: string;
  ownerToken: string;
  upload: { method: "PUT"; url: string; headers: Record<string, string> };
  flags: string[];
}

interface CompleteResponse {
  videoId: string;
  status: string;
  message: string;
  rejectionReason: string | null;
}

type Stage =
  | { name: "pick" }
  | { name: "details" }
  | { name: "working"; label: string; progress: number }
  | { name: "done"; result: CompleteResponse };

const ALLOWED_EXTENSIONS = ["mp4", "m4v", "mov"];
const TITLE_MIN = 4;

/** Uploads a file with progress reporting. XMLHttpRequest is used because fetch has no upload progress. */
function putFile(url: string, headers: Record<string, string>, file: Blob, onProgress: (fraction: number) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.open("PUT", url, true);
    for (const [name, value] of Object.entries(headers)) request.setRequestHeader(name, value);
    request.upload.onprogress = (event) => {
      if (event.lengthComputable) onProgress(event.loaded / event.total);
    };
    request.onload = () => {
      if (request.status >= 200 && request.status < 300) resolve();
      else reject(new ClientApiError(request.status, "upload_failed", "تعذّر رفع الملف. تحقق من الاتصال ثم أعد المحاولة."));
    };
    request.onerror = () => reject(new ClientApiError(0, "network", "انقطع الاتصال أثناء الرفع. أعد المحاولة عند استقرار الشبكة."));
    request.onabort = () => reject(new ClientApiError(0, "aborted", "أُلغي الرفع."));
    request.send(file);
  });
}

function readDuration(file: File): Promise<number | null> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const element = document.createElement("video");
    element.preload = "metadata";
    element.onloadedmetadata = () => {
      const duration = Number.isFinite(element.duration) ? element.duration : null;
      URL.revokeObjectURL(url);
      resolve(duration);
    };
    element.onerror = () => {
      URL.revokeObjectURL(url);
      resolve(null);
    };
    element.src = url;
  });
}

export function UploadFlow() {
  const [stage, setStage] = useState<Stage>({ name: "pick" });
  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [durationSec, setDurationSec] = useState<number | null>(null);
  const [limits, setLimits] = useState<PlatformInfoDto | null>(null);
  const [categories, setCategories] = useState<CategoryDto[]>([]);
  const [error, setError] = useState("");
  const [prefs, setPrefs] = useLocal<Preferences>(LOCAL_KEYS.prefs, DEFAULT_PREFS);
  const [, setOwned] = useLocal<Record<string, OwnedVideo>>(LOCAL_KEYS.owned, {});

  const [nickname, setNickname] = useState(prefs.nickname);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [keyFact, setKeyFact] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [hashtags, setHashtags] = useState("");
  const [guidelines, setGuidelines] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    api<PlatformInfoDto>("/api/platform").then(setLimits).catch(() => setLimits(null));
    api<{ categories: CategoryDto[] }>("/api/categories")
      .then((payload) => {
        setCategories(payload.categories);
        setCategoryId((current) => current || payload.categories[0]?.id || "");
      })
      .catch(() => setCategories([]));
  }, []);

  useEffect(() => {
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    };
  }, [previewUrl]);

  async function chooseFile(selected: File | undefined) {
    setError("");
    if (!selected) return;
    const extension = selected.name.split(".").pop()?.toLowerCase() ?? "";
    const typeOk = selected.type === "video/mp4" || selected.type === "video/quicktime" || ALLOWED_EXTENSIONS.includes(extension);
    if (!typeOk) {
      setError("صيغة الملف غير مدعومة. اختر فيديو بصيغة MP4 أو MOV من مكتبة الصور.");
      return;
    }
    if (limits && selected.size > limits.uploadMaxBytes) {
      setError(`حجم الملف أكبر من الحد المسموح (${Math.round(limits.uploadMaxBytes / 1048576)} ميجابايت).`);
      return;
    }
    const duration = await readDuration(selected);
    if (duration !== null && limits && duration > limits.maxDurationSeconds) {
      setError(`مدة الفيديو ${Math.round(duration)} ثانية، والحد الأقصى ${limits.maxDurationSeconds} ثانية. اقتطع جزءًا منه ثم أعد الاختيار.`);
      return;
    }
    if (duration !== null && limits && duration < limits.minDurationSeconds) {
      setError("الفيديو قصير جدًا لنشره.");
      return;
    }
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setFile(selected);
    setPreviewUrl(URL.createObjectURL(selected));
    setDurationSec(duration);
    setStage({ name: "details" });
  }

  function parseCount(): number {
    return hashtags.split(/[\s,،#]+/u).filter(Boolean).length;
  }

  async function submit() {
    if (!file) return;
    setError("");
    if (nickname.trim().length < 2) return setError("اكتب اسمًا مستعارًا من حرفين على الأقل.");
    if (title.trim().length < TITLE_MIN) return setError("اكتب عنوانًا واضحًا من 4 أحرف على الأقل.");
    if (!categoryId) return setError("اختر تصنيفًا للفيديو.");
    if (!guidelines) return setError("يلزم الموافقة على إرشادات المجتمع قبل الإرسال.");
    if (parseCount() > 5) return setError("يمكن إضافة 5 وسوم كحد أقصى.");

    try {
      setStage({ name: "working", label: "جارٍ التحقق من أنك إنسان…", progress: 0 });
      const challenge = await api<PowChallengeDto>("/api/challenge");
      const solution = await solveChallenge(challenge);

      setStage({ name: "working", label: "جارٍ تسجيل الفيديو للمراجعة…", progress: 0 });
      const mimeType = file.type === "video/quicktime" || file.name.toLowerCase().endsWith(".mov") ? "video/quicktime" : "video/mp4";
      const init = await api<InitResponse>("/api/uploads", {
        body: {
          fileName: file.name,
          mimeType,
          sizeBytes: file.size,
          declaredDurationMs: durationSec !== null ? Math.round(durationSec * 1000) : undefined,
          nickname: nickname.trim(),
          title: title.trim(),
          description: description.trim(),
          keyFact: keyFact.trim() || null,
          categoryId,
          hashtags,
          acceptedGuidelines: true,
          creatorId: prefs.creatorId,
          challenge: solution,
        },
      });

      // Save the owner token before uploading. If the connection drops, the owner can still manage the submission.
      setOwned((previous) => ({
        ...previous,
        [init.videoId]: { videoId: init.videoId, title: title.trim(), ownerToken: init.ownerToken, createdAt: new Date().toISOString() },
      }));
      setPrefs((previous) => ({ ...previous, nickname: nickname.trim(), creatorId: init.creatorId }));

      setStage({ name: "working", label: "جارٍ رفع الملف…", progress: 0 });
      await putFile(init.upload.url, init.upload.headers, file, (fraction) =>
        setStage({ name: "working", label: "جارٍ رفع الملف…", progress: fraction }),
      );

      setStage({ name: "working", label: "جارٍ الفحص التقني للملف…", progress: 1 });
      const result = await api<CompleteResponse>(`/api/uploads/${init.videoId}/complete`, { method: "POST", bearer: init.ownerToken });
      setStage({ name: "done", result });
    } catch (caught) {
      setStage({ name: "details" });
      setError(messageOf(caught) || "حدث خطأ أثناء الإرسال. حاول مرة أخرى.");
    }
  }

  if (stage.name === "done") {
    return (
      <Outcome
        result={stage.result}
        onAgain={() => {
          if (previewUrl) URL.revokeObjectURL(previewUrl);
          setFile(null);
          setPreviewUrl(null);
          setDurationSec(null);
          setTitle("");
          setDescription("");
          setKeyFact("");
          setHashtags("");
          setGuidelines(false);
          setError("");
          setStage({ name: "pick" });
        }}
      />
    );
  }

  const storageOff = limits !== null && !limits.storageAvailable;

  return (
    <div className="flex min-h-dvh flex-col bg-ink" style={{ paddingTop: "calc(var(--safe-top) + 0.5rem)", paddingBottom: "env(safe-area-inset-bottom)" }}>
      <header className="flex items-center justify-between px-4 pb-3">
        <Link href="/" aria-label="إغلاق" className="grid size-10 place-items-center rounded-full bg-white/[0.07] ring-1 ring-white/10">
          <X className="size-5" aria-hidden="true" />
        </Link>
        <h1 className="text-base font-semibold">إضافة فيديو تعليمي</h1>
        <span className="size-10" aria-hidden="true" />
      </header>

      <div className="flex-1 overflow-y-auto px-4 pb-32">
        {stage.name === "pick" ? (
          <div className="flex flex-col gap-5">
            <section className="rounded-3xl bg-surface p-5 ring-1 ring-white/10">
              <h2 className="text-lg font-semibold">شارك معرفة مفيدة في دقيقة</h2>
              <ul className="mt-3 flex flex-col gap-2 text-sm leading-7 text-muted">
                <li>• مدة الفيديو حتى {limits?.maxDurationSeconds ?? 90} ثانية، والحجم حتى {limits ? Math.round(limits.uploadMaxBytes / 1048576) : 100} ميجابايت.</li>
                <li>• لا تحتاج إلى حساب أو بريد إلكتروني. يكفي اسم مستعار.</li>
                <li>• كل فيديو يُراجع بشريًا قبل ظهوره للجميع.</li>
                <li>• لا تنشر محتوى منسوخًا أو مسيئًا أو مضللًا.</li>
              </ul>
            </section>

            {storageOff ? (
              <div role="status" className="flex items-start gap-3 rounded-2xl bg-brand/10 p-4 text-sm leading-7 ring-1 ring-brand/30">
                <AlertTriangle className="mt-1 size-5 shrink-0 text-brand" aria-hidden="true" />
                <p>رفع الفيديوهات غير مُفعّل في هذه النسخة التجريبية. التخزين الدائم يحتاج إعداد Supabase، وستظهر لك الخطوات في دليل النشر.</p>
              </div>
            ) : null}

            <button
              type="button"
              onClick={() => fileInput.current?.click()}
              disabled={storageOff}
              className="grid min-h-56 place-items-center rounded-3xl border-2 border-dashed border-brand/50 bg-brand/5 p-8 text-center transition-colors hover:bg-brand/10 disabled:opacity-50"
            >
              <span className="flex flex-col items-center gap-3">
                <span className="grid size-16 place-items-center rounded-3xl bg-brand text-ink">
                  <Upload className="size-7" aria-hidden="true" />
                </span>
                <span className="text-lg font-semibold">اختر فيديو من الصور</span>
                <span className="text-sm text-muted">MP4 أو MOV</span>
              </span>
            </button>
            <input
              ref={fileInput}
              type="file"
              accept="video/*,.mp4,.mov,.m4v"
              className="sr-only"
              aria-label="اختر فيديو"
              onChange={(event) => void chooseFile(event.target.files?.[0])}
            />
          </div>
        ) : null}

        {stage.name === "details" && previewUrl ? (
          <form
            className="flex flex-col gap-5"
            onSubmit={(event) => {
              event.preventDefault();
              void submit();
            }}
          >
            <div className="flex items-start gap-4">
              <video src={previewUrl} className="aspect-[9/16] w-28 shrink-0 rounded-2xl bg-black object-cover ring-1 ring-white/10" muted playsInline controls preload="metadata" aria-label="معاينة الفيديو" />
              <div className="min-w-0 flex-1 text-sm text-muted">
                <p className="flex items-center gap-2 text-text"><Film className="size-4" aria-hidden="true" /><span className="truncate">{file?.name}</span></p>
                <p className="mt-1">الحجم: {file ? (file.size / 1048576).toFixed(1) : "—"} ميجابايت</p>
                <p>المدة: {durationSec !== null ? `${Math.round(durationSec)} ثانية` : "سيُتحقق منها على الخادم"}</p>
                <button type="button" onClick={() => setStage({ name: "pick" })} className="mt-3 text-xs font-semibold text-brand">
                  اختيار فيديو آخر
                </button>
              </div>
            </div>

            <Field label="اسمك المستعار" hint="يظهر مع فيديوهاتك. لا يُستخدم كدليل على هويتك.">
              <input value={nickname} onChange={(event) => setNickname(event.target.value)} maxLength={24} required className={inputClass} placeholder="مثال: معلّم الفضاء" />
            </Field>

            <Field label="عنوان الفيديو" hint={`${title.length}/80`}>
              <input value={title} onChange={(event) => setTitle(event.target.value)} maxLength={80} required className={inputClass} placeholder="ماذا سيتعلم المشاهد؟" />
            </Field>

            <Field label="الوصف" hint={`${description.length}/500`}>
              <textarea value={description} onChange={(event) => setDescription(event.target.value)} maxLength={500} rows={3} className={inputClass} placeholder="اشرح الفكرة باختصار ووضوح." />
            </Field>

            <Field label="المعلومة الأساسية (اختياري)" hint={`${keyFact.length}/160`}>
              <input value={keyFact} onChange={(event) => setKeyFact(event.target.value)} maxLength={160} className={inputClass} placeholder="جملة واحدة يمكن للمشاهد حفظها" />
            </Field>

            <fieldset>
              <legend className="mb-2 text-sm font-medium">التصنيف</legend>
              <div className="flex flex-wrap gap-2">
                {categories.map((category) => (
                  <button
                    type="button"
                    key={category.id}
                    onClick={() => setCategoryId(category.id)}
                    aria-pressed={categoryId === category.id}
                    className={`inline-flex h-9 items-center gap-1.5 rounded-full px-3 text-sm font-medium ring-1 transition-colors ${
                      categoryId === category.id ? "bg-brand text-ink ring-brand" : "bg-white/[0.05] ring-white/10"
                    }`}
                  >
                    <CategoryIcon name={category.icon} className="size-4" />
                    {category.nameAr}
                  </button>
                ))}
              </div>
            </fieldset>

            <Field label="وسوم (حتى 5)" hint="مثال: فضاء نجوم">
              <input value={hashtags} onChange={(event) => setHashtags(event.target.value)} className={inputClass} placeholder="#علوم #فيزياء" />
            </Field>

            <label className="flex items-start gap-3 rounded-2xl bg-white/[0.04] p-4 text-sm leading-7 ring-1 ring-white/10">
              <input type="checkbox" checked={guidelines} onChange={(event) => setGuidelines(event.target.checked)} className="mt-1 size-5 accent-[#f5b942]" />
              <span>
                أؤكد أن الفيديو من إنتاجي أو أملك حق استخدامه، وأوافق على{" "}
                <Link href="/guidelines" className="font-semibold text-brand underline">إرشادات المجتمع</Link> وأن الفيديو لن يظهر قبل مراجعته.
              </span>
            </label>

            {error ? <p role="alert" className="rounded-2xl bg-danger/15 p-3 text-sm text-danger">{error}</p> : null}

            <div className="fixed inset-x-0 bottom-0 bg-ink/95 p-4 backdrop-blur-xl" style={{ paddingBottom: "max(1rem, env(safe-area-inset-bottom))" }}>
              <div className="mx-auto max-w-lg">
                <Button type="submit" full disabled={storageOff}>
                  <Upload className="size-4" aria-hidden="true" />
                  إرسال للمراجعة
                </Button>
              </div>
            </div>
          </form>
        ) : null}

        {stage.name === "working" ? (
          <div className="flex flex-col items-center gap-6 py-16 text-center">
            <Spinner label={stage.label} />
            <p className="text-base font-semibold">{stage.label}</p>
            <div className="h-2 w-full max-w-sm overflow-hidden rounded-full bg-white/10" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(stage.progress * 100)} aria-label="تقدّم الرفع">
              <div className="h-full rounded-full bg-brand transition-[width] duration-300" style={{ width: `${Math.round(stage.progress * 100)}%` }} />
            </div>
            <p className="text-xs text-muted">لا تغلق الصفحة حتى يكتمل الرفع.</p>
          </div>
        ) : null}
      </div>
    </div>
  );
}

const inputClass = "h-12 w-full rounded-2xl bg-white/[0.06] px-4 text-[15px] outline-none ring-1 ring-white/10 focus:ring-brand disabled:opacity-60 [&:is(textarea)]:py-3";

function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="flex items-center justify-between text-sm font-medium">
        {label}
        {hint ? <span className="text-xs font-normal text-muted">{hint}</span> : null}
      </span>
      {children}
    </label>
  );
}

function Outcome({ result, onAgain }: { result: CompleteResponse; onAgain: () => void }) {
  const rejected = result.status === "rejected";
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-5 px-6 text-center" style={{ paddingTop: "calc(var(--safe-top) + 1rem)" }}>
      <div className={`grid size-20 place-items-center rounded-full ${rejected ? "bg-danger/15 text-danger" : "bg-success/15 text-success"}`}>
        {rejected ? <AlertTriangle className="size-10" aria-hidden="true" /> : <CheckCircle2 className="size-10" aria-hidden="true" />}
      </div>
      <h1 className="text-2xl font-bold">{rejected ? "لم يُقبل الفيديو" : "تم استلام الفيديو"}</h1>
      <p className="max-w-sm text-sm leading-7 text-muted">{rejected && result.rejectionReason ? result.rejectionReason : result.message}</p>

      {!rejected ? (
        <ul className="w-full max-w-sm space-y-2 text-start text-sm">
          <li className="flex items-center gap-3 rounded-2xl bg-white/[0.05] p-3 ring-1 ring-white/10"><ShieldCheck className="size-5 text-success" aria-hidden="true" />فحص تقني للملف: نجح</li>
          <li className="flex items-center gap-3 rounded-2xl bg-white/[0.05] p-3 ring-1 ring-white/10"><Clock className="size-5 text-brand" aria-hidden="true" />مراجعة بشرية: بانتظار الدور</li>
          <li className="flex items-center gap-3 rounded-2xl bg-white/[0.05] p-3 ring-1 ring-white/10"><Lock className="size-5 text-muted" aria-hidden="true" />إدارة الفيديو من «المزيد» على هذا الجهاز</li>
        </ul>
      ) : null}

      <div className="flex w-full max-w-sm flex-col gap-2">
        <Link href="/more" className="inline-flex h-11 items-center justify-center rounded-2xl bg-brand px-5 text-sm font-semibold text-ink">
          متابعة حالة فيديوهاتي
        </Link>
        <Button variant="secondary" full onClick={onAgain}>
          <ArrowRight className="size-4" aria-hidden="true" />
          إضافة فيديو آخر
        </Button>
      </div>
    </main>
  );
}
