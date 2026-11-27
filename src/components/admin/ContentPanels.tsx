"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Check, Trash2 } from "lucide-react";
import { api } from "@/lib/client/api";
import { Button, Spinner, useToast } from "@/components/ui/ui";

/** Moderation-console panels for quiz questions and learning paths. They use the admin API like the other tabs. */

type Run = (action: () => Promise<unknown>, success?: string) => Promise<boolean>;

interface PublishedVideo {
  id: string;
  title: string;
}

interface AdminQuiz {
  id: string;
  question: string;
  options: string[];
  correctIndex: number;
  explanation: string;
}

interface AdminPlaylist {
  id: string;
  slug: string;
  titleAr: string;
  descriptionAr: string;
  sortOrder: number;
  isActive: boolean;
  items: Array<{ videoId: string; title: string; position: number; status: string }>;
}

const FIELD = "h-10 rounded-xl bg-white/[0.06] px-3 text-sm outline-none ring-1 ring-white/10";
const EMPTY_QUIZ = { question: "", options: ["", "", "", ""], correct: 0, explanation: "" };

export function Quizzes({ run }: { run: Run }) {
  const toast = useToast();
  const [videos, setVideos] = useState<PublishedVideo[] | null>(null);
  const [videoId, setVideoId] = useState("");
  const [loaded, setLoaded] = useState<{ videoId: string; items: AdminQuiz[] } | null>(null);
  const [form, setForm] = useState(EMPTY_QUIZ);

  useEffect(() => {
    api<{ items: PublishedVideo[] }>("/api/admin/videos?status=approved&limit=50")
      .then((payload) => {
        setVideos(payload.items);
        setVideoId((current) => current || payload.items[0]?.id || "");
      })
      .catch(() => setVideos([]));
  }, []);

  const loadQuizzes = useCallback((id: string) => {
    api<{ items: AdminQuiz[] }>(`/api/admin/quizzes?videoId=${encodeURIComponent(id)}`)
      .then((payload) => setLoaded({ videoId: id, items: payload.items }))
      .catch(() => setLoaded({ videoId: id, items: [] }));
  }, []);

  useEffect(() => {
    if (videoId) loadQuizzes(videoId);
  }, [videoId, loadQuizzes]);

  // Ignore a list that belongs to the video chosen before, so a slow response cannot show the wrong questions.
  const quizzes = loaded && loaded.videoId === videoId ? loaded.items : null;

  async function addQuiz(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const options = form.options
      .map((text, index) => ({ text: text.trim(), correct: index === form.correct }))
      .filter((option) => option.text.length > 0);
    const correctIndex = options.findIndex((option) => option.correct);
    if (options.length < 2 || correctIndex < 0) {
      toast.show("أدخل خيارين على الأقل، واختر الإجابة الصحيحة من بين الخيارات المكتوبة.", "error");
      return;
    }
    const saved = await run(
      () =>
        api("/api/admin/quizzes", {
          method: "POST",
          body: {
            videoId,
            question: form.question,
            options: options.map((option) => option.text),
            correctIndex,
            explanation: form.explanation,
          },
        }),
      "تمت إضافة السؤال.",
    );
    if (saved) {
      setForm(EMPTY_QUIZ);
      loadQuizzes(videoId);
    }
  }

  async function removeQuiz(id: string) {
    if (!window.confirm("حذف هذا السؤال نهائيًا؟")) return;
    const removed = await run(() => api("/api/admin/quizzes", { method: "DELETE", body: { id } }), "تم حذف السؤال.");
    if (removed) loadQuizzes(videoId);
  }

  if (!videos) return <Spinner label="جارٍ تحميل الفيديوهات" />;
  if (videos.length === 0) {
    return (
      <p className="rounded-2xl bg-surface p-5 text-sm leading-7 text-muted ring-1 ring-white/10">
        الاختبارات تُضاف إلى الفيديوهات المنشورة فقط. انشر فيديو أولًا من تبويب المراجعة.
      </p>
    );
  }

  return (
    <div className="grid gap-5 md:grid-cols-[1fr_1.2fr]">
      <section className="flex flex-col gap-4">
        <label className="flex flex-col gap-1.5 text-sm">
          <span className="font-semibold">الفيديو</span>
          <select value={videoId} onChange={(event) => setVideoId(event.target.value)} className={`${FIELD} w-full`}>
            {videos.map((video) => (
              <option key={video.id} value={video.id} className="bg-ink">
                {video.title}
              </option>
            ))}
          </select>
        </label>

        <form onSubmit={addQuiz} className="flex flex-col gap-3 rounded-2xl bg-surface p-4 ring-1 ring-white/10">
          <h3 className="text-sm font-semibold">سؤال جديد</h3>
          <input
            value={form.question}
            onChange={(event) => setForm({ ...form, question: event.target.value })}
            aria-label="نص السؤال"
            placeholder="نص السؤال"
            maxLength={200}
            className={FIELD}
          />
          {form.options.map((text, index) => (
            <div key={index} className="flex items-center gap-2">
              <input
                type="radio"
                name="correct-option"
                checked={form.correct === index}
                onChange={() => setForm({ ...form, correct: index })}
                aria-label={`الخيار ${index + 1} هو الإجابة الصحيحة`}
                className="size-4 shrink-0 accent-brand"
              />
              <input
                value={text}
                onChange={(event) =>
                  setForm({ ...form, options: form.options.map((option, position) => (position === index ? event.target.value : option)) })
                }
                aria-label={`الخيار ${index + 1}`}
                placeholder={index < 2 ? `الخيار ${index + 1}` : `الخيار ${index + 1} (اختياري)`}
                maxLength={120}
                className={`${FIELD} min-w-0 flex-1`}
              />
            </div>
          ))}
          <textarea
            value={form.explanation}
            onChange={(event) => setForm({ ...form, explanation: event.target.value })}
            aria-label="شرح الإجابة"
            placeholder="شرح قصير للإجابة الصحيحة"
            maxLength={300}
            rows={3}
            className="rounded-xl bg-white/[0.06] p-3 text-sm outline-none ring-1 ring-white/10"
          />
          <p className="text-xs leading-6 text-muted">السؤال من 5 إلى 200 حرف، والشرح من 5 إلى 300 حرف، والخيارات من 2 إلى 4.</p>
          <Button type="submit" className="self-start">
            إضافة السؤال
          </Button>
        </form>
      </section>

      <section className="flex flex-col gap-3">
        <h3 className="text-sm font-semibold">أسئلة هذا الفيديو</h3>
        {quizzes === null ? <Spinner label="جارٍ التحميل" /> : null}
        {quizzes?.length === 0 ? <p className="text-sm text-muted">لا توجد أسئلة لهذا الفيديو بعد.</p> : null}
        <ul className="flex flex-col gap-3">
          {quizzes?.map((quiz) => (
            <li key={quiz.id} className="flex flex-col gap-2.5 rounded-2xl bg-surface p-4 ring-1 ring-white/10">
              <div className="flex items-start justify-between gap-3">
                <p className="font-semibold leading-7">{quiz.question}</p>
                <Button variant="danger" className="h-9 shrink-0 px-3 text-xs" ariaLabel={`حذف السؤال: ${quiz.question}`} onClick={() => void removeQuiz(quiz.id)}>
                  <Trash2 className="size-3.5" aria-hidden="true" />
                  حذف
                </Button>
              </div>
              <ol className="flex flex-col gap-1 text-sm">
                {quiz.options.map((option, index) => (
                  <li key={index} className={index === quiz.correctIndex ? "flex items-center gap-1.5 font-semibold text-success" : "text-muted"}>
                    {index === quiz.correctIndex ? <Check className="size-3.5" aria-hidden="true" /> : null}
                    {option}
                  </li>
                ))}
              </ol>
              <p className="text-xs leading-6 text-muted">{quiz.explanation}</p>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

export function Playlists({ run }: { run: Run }) {
  const [playlists, setPlaylists] = useState<AdminPlaylist[] | null>(null);
  const [videos, setVideos] = useState<PublishedVideo[]>([]);
  const [draft, setDraft] = useState({ slug: "", titleAr: "", descriptionAr: "" });

  const load = useCallback(() => {
    api<{ items: AdminPlaylist[] }>("/api/admin/playlists")
      .then((payload) => setPlaylists(payload.items))
      .catch(() => setPlaylists([]));
  }, []);

  useEffect(() => {
    load();
    api<{ items: PublishedVideo[] }>("/api/admin/videos?status=approved&limit=50")
      .then((payload) => setVideos(payload.items))
      .catch(() => setVideos([]));
  }, [load]);

  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const saved = await run(
      () => api("/api/admin/playlists", { method: "POST", body: { ...draft, sortOrder: 0, isActive: true } }),
      "تم إنشاء المسار.",
    );
    if (saved) {
      setDraft({ slug: "", titleAr: "", descriptionAr: "" });
      load();
    }
  }

  return (
    <div className="flex flex-col gap-5">
      <form onSubmit={create} className="grid gap-3 rounded-2xl bg-surface p-4 ring-1 ring-white/10 md:grid-cols-2">
        <h3 className="text-sm font-semibold md:col-span-2">مسار تعلّم جديد</h3>
        <input
          value={draft.titleAr}
          onChange={(event) => setDraft({ ...draft, titleAr: event.target.value })}
          aria-label="اسم المسار الجديد"
          placeholder="اسم المسار"
          maxLength={80}
          className={FIELD}
        />
        <input
          value={draft.slug}
          onChange={(event) => setDraft({ ...draft, slug: event.target.value.toLowerCase() })}
          aria-label="الرابط المختصر للمسار الجديد"
          placeholder="الرابط المختصر، مثل: math-basics"
          dir="ltr"
          maxLength={60}
          className={FIELD}
        />
        <textarea
          value={draft.descriptionAr}
          onChange={(event) => setDraft({ ...draft, descriptionAr: event.target.value })}
          aria-label="وصف المسار الجديد"
          placeholder="وصف قصير يظهر أعلى صفحة المسار"
          maxLength={300}
          rows={2}
          className="rounded-xl bg-white/[0.06] p-3 text-sm outline-none ring-1 ring-white/10 md:col-span-2"
        />
        <p className="text-xs leading-6 text-muted md:col-span-2">
          الرابط المختصر بأحرف إنجليزية صغيرة وأرقام وشرطات فقط، ولا يمكن تغييره بعد الإنشاء.
        </p>
        <Button type="submit" className="justify-self-start md:col-span-2">
          إنشاء المسار
        </Button>
      </form>

      {playlists === null ? <Spinner label="جارٍ التحميل" /> : null}
      {playlists?.length === 0 ? <p className="text-sm text-muted">لا توجد مسارات بعد.</p> : null}
      <ul className="flex flex-col gap-4">
        {playlists?.map((playlist) => (
          <PlaylistCard key={playlist.id} playlist={playlist} videos={videos} run={run} onChanged={load} />
        ))}
      </ul>
    </div>
  );
}

function PlaylistCard({ playlist, videos, run, onChanged }: { playlist: AdminPlaylist; videos: PublishedVideo[]; run: Run; onChanged: () => void }) {
  const [fields, setFields] = useState({
    titleAr: playlist.titleAr,
    descriptionAr: playlist.descriptionAr,
    sortOrder: playlist.sortOrder,
    isActive: playlist.isActive,
  });
  const [pick, setPick] = useState("");
  const included = new Set(playlist.items.map((item) => item.videoId));
  const available = videos.filter((video) => !included.has(video.id));

  async function save() {
    const saved = await run(() => api("/api/admin/playlists", { method: "PUT", body: { id: playlist.id, ...fields } }), "تم حفظ المسار.");
    if (saved) onChanged();
  }

  async function remove() {
    if (!window.confirm("حذف هذا المسار؟ الفيديوهات نفسها لن تُحذف.")) return;
    const removed = await run(() => api("/api/admin/playlists", { method: "DELETE", body: { id: playlist.id } }), "تم حذف المسار.");
    if (removed) onChanged();
  }

  async function addVideo() {
    if (!pick) return;
    const added = await run(
      () => api("/api/admin/playlists/items", { method: "POST", body: { playlistId: playlist.id, videoId: pick } }),
      "تمت إضافة الفيديو إلى المسار.",
    );
    if (added) {
      setPick("");
      onChanged();
    }
  }

  async function removeVideo(videoId: string) {
    const removed = await run(
      () => api("/api/admin/playlists/items", { method: "DELETE", body: { playlistId: playlist.id, videoId } }),
      "تمت إزالة الفيديو من المسار.",
    );
    if (removed) onChanged();
  }

  return (
    <li className="flex flex-col gap-4 rounded-2xl bg-surface p-4 ring-1 ring-white/10">
      <div className="grid gap-2 md:grid-cols-[1.2fr_1.5fr_6rem_auto]">
        <input
          value={fields.titleAr}
          onChange={(event) => setFields({ ...fields, titleAr: event.target.value })}
          aria-label={`اسم المسار ${playlist.slug}`}
          maxLength={80}
          className={FIELD}
        />
        <input
          value={fields.descriptionAr}
          onChange={(event) => setFields({ ...fields, descriptionAr: event.target.value })}
          aria-label={`وصف المسار ${playlist.slug}`}
          maxLength={300}
          className={FIELD}
        />
        <input
          type="number"
          min={0}
          max={1000}
          value={fields.sortOrder}
          onChange={(event) => setFields({ ...fields, sortOrder: Number(event.target.value) })}
          aria-label={`ترتيب المسار ${playlist.slug}`}
          className={FIELD}
        />
        <label className="flex items-center gap-1.5 text-xs">
          <input
            type="checkbox"
            checked={fields.isActive}
            onChange={(event) => setFields({ ...fields, isActive: event.target.checked })}
            className="size-4 accent-brand"
          />
          ظاهر للزوار
        </label>
      </div>
      <p className="text-xs text-muted" dir="ltr">
        /playlist/{playlist.slug}
      </p>
      <div className="flex flex-wrap gap-2">
        <Button variant="secondary" className="h-10 px-4 text-xs" onClick={() => void save()}>
          حفظ التعديلات
        </Button>
        <Button variant="danger" className="h-10 px-4 text-xs" onClick={() => void remove()}>
          حذف المسار
        </Button>
      </div>

      <div className="flex flex-col gap-2 border-t border-white/10 pt-3">
        <h4 className="text-xs font-semibold text-muted">الفيديوهات ({playlist.items.length})</h4>
        {playlist.items.length === 0 ? <p className="text-sm text-muted">لم تُضف فيديوهات بعد.</p> : null}
        <ol className="flex flex-col gap-1.5 text-sm">
          {playlist.items.map((item, index) => (
            <li key={item.videoId} className="flex items-center justify-between gap-3">
              <span className="min-w-0 truncate">
                {index + 1}. {item.title}
                {item.status === "approved" ? null : " (غير منشور، لن يظهر للزوار)"}
              </span>
              <button type="button" onClick={() => void removeVideo(item.videoId)} className="shrink-0 rounded-full bg-white/[0.07] px-3 py-1 text-xs">
                إزالة
              </button>
            </li>
          ))}
        </ol>
        <div className="flex flex-wrap gap-2">
          <select
            value={pick}
            onChange={(event) => setPick(event.target.value)}
            aria-label={`اختر فيديو لإضافته إلى ${playlist.slug}`}
            className={`${FIELD} min-w-0 flex-1`}
          >
            <option value="">اختر فيديو منشورًا</option>
            {available.map((video) => (
              <option key={video.id} value={video.id} className="bg-ink">
                {video.title}
              </option>
            ))}
          </select>
          <Button variant="secondary" className="h-10 px-4 text-xs" disabled={!pick} onClick={() => void addVideo()}>
            إضافة
          </Button>
        </div>
      </div>
    </li>
  );
}
