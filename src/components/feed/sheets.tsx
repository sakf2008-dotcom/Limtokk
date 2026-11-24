"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { Check, CircleCheck, CircleX, Copy, Flag, Lightbulb, MessageCircle, Send, Sparkles, Trash2, UserRound, Volume2, VolumeX } from "lucide-react";
import type { CommentDto, QuizDto, VideoCardDto } from "@/lib/domain/types";
import { Button, Sheet, Spinner, useToast } from "@/components/ui/ui";
import { api, ClientApiError, messageOf } from "@/lib/client/api";
import { LOCAL_KEYS, useLocal } from "@/lib/client/local";
import { DEFAULT_PREFS, DEFAULT_PROGRESS, withActivity, type LearningProgress, type Preferences } from "@/lib/client/library";
import { solveChallenge, type PowChallengeDto } from "@/lib/client/pow";

/* ------------------------------------------------------------------ comments */

export function CommentsSheet({
  video,
  open,
  onClose,
  onCountChange,
}: {
  video: VideoCardDto | null;
  open: boolean;
  onClose: () => void;
  onCountChange: (videoId: string, count: number) => void;
}) {
  return (
    <Sheet open={open} onClose={onClose} title={`التعليقات${video ? ` (${new Intl.NumberFormat("ar").format(video.commentCount)})` : ""}`}>
      {open && video ? <CommentsBody video={video} onCountChange={onCountChange} /> : null}
    </Sheet>
  );
}

/** Mounted only while the sheet is open, so each opening loads the thread once. */
function CommentsBody({ video, onCountChange }: { video: VideoCardDto; onCountChange: (videoId: string, count: number) => void }) {
  const toast = useToast();
  const [comments, setComments] = useState<CommentDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [text, setText] = useState("");
  const [replyTo, setReplyTo] = useState<CommentDto | null>(null);
  const [sending, setSending] = useState(false);
  const [notice, setNotice] = useState("");
  const [prefs, setPrefs] = useLocal<Preferences>(LOCAL_KEYS.prefs, DEFAULT_PREFS);
  const [tokens, setTokens] = useLocal<Record<string, string>>(LOCAL_KEYS.commentTokens, {});

  const videoId = video.id;

  // Reads the thread. The initial state is already "loading", so the first call is effect-safe.
  const load = useCallback(async () => {
    try {
      const response = await api<{ comments: CommentDto[] }>(`/api/videos/${videoId}/comments?limit=50`);
      setComments(response.comments);
      setLoadError("");
    } catch (error) {
      setLoadError(messageOf(error));
    } finally {
      setLoading(false);
    }
  }, [videoId]);

  useEffect(() => {
    let cancelled = false;
    api<{ comments: CommentDto[] }>(`/api/videos/${videoId}/comments?limit=50`)
      .then((response) => {
        if (!cancelled) setComments(response.comments);
      })
      .catch((error: unknown) => {
        if (!cancelled) setLoadError(messageOf(error));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [videoId]);

  async function submit() {
    if (!videoId || sending) return;
    const body = text.trim();
    if (!body) return;
    setSending(true);
    setNotice("");
    const payload = { nickname: prefs.nickname.trim() || "زائر", body, parentId: replyTo?.id ?? null };
    try {
      let result: { id: string; status: "visible" | "pending"; deleteToken: string; message: string };
      try {
        result = await api(`/api/videos/${videoId}/comments`, { body: payload });
      } catch (error) {
        if (error instanceof ClientApiError && error.code === "challenge_required") {
          const challenge = error.details.challenge as PowChallengeDto;
          const solution = await solveChallenge(challenge);
          result = await api(`/api/videos/${videoId}/comments`, { body: { ...payload, challenge: solution } });
        } else {
          throw error;
        }
      }
      setTokens((previous) => ({ ...previous, [result.id]: result.deleteToken }));
      setNotice(result.message);
      setText("");
      setReplyTo(null);
      if (result.status === "visible") {
        onCountChange(videoId, (video?.commentCount ?? 0) + 1);
        await load();
      }
    } catch (error) {
      toast.show(messageOf(error) || "تعذّر نشر التعليق.", "error");
    } finally {
      setSending(false);
    }
  }

  async function remove(comment: CommentDto) {
    const token = tokens[comment.id];
    if (!token) return;
    try {
      await api(`/api/comments/${comment.id}`, { method: "DELETE", bearer: token });
      setTokens((previous) => {
        const next = { ...previous };
        delete next[comment.id];
        return next;
      });
      toast.show("تم حذف تعليقك.", "success");
      if (videoId) onCountChange(videoId, Math.max(0, (video?.commentCount ?? 1) - 1));
      await load();
    } catch (error) {
      toast.show(messageOf(error), "error");
    }
  }

  return (
    <>
      <div className="flex flex-col gap-4">
        {loading ? <Spinner label="جارٍ تحميل التعليقات" /> : null}
        {loadError ? <p className="text-sm text-danger">{loadError}</p> : null}
        {!loading && !loadError && comments.length === 0 ? (
          <div className="flex flex-col items-center gap-2 py-8 text-center text-muted">
            <MessageCircle className="size-8" aria-hidden="true" />
            <p className="text-sm">لا توجد تعليقات بعد. كن أول من يعلّق بفكرة مفيدة.</p>
          </div>
        ) : null}

        <ul className="flex flex-col gap-4">
          {comments.map((comment) => (
            <li key={comment.id} className="fade-in">
              <CommentItem comment={comment} canDelete={Boolean(tokens[comment.id])} onReply={() => setReplyTo(comment)} onDelete={() => remove(comment)} />
              {comment.replies.length > 0 ? (
                <ul className="mt-3 flex flex-col gap-3 border-s-2 border-white/10 ps-3">
                  {comment.replies.map((reply) => (
                    <li key={reply.id}>
                      <CommentItem comment={reply} canDelete={Boolean(tokens[reply.id])} onDelete={() => remove(reply)} />
                    </li>
                  ))}
                </ul>
              ) : null}
            </li>
          ))}
        </ul>
      </div>

      <div className="sticky bottom-0 mt-4 flex flex-col gap-2 bg-surface-2 pt-3">
        {replyTo ? (
          <div className="flex items-center justify-between rounded-xl bg-white/5 px-3 py-2 text-xs text-muted">
            <span>الرد على {replyTo.authorName}</span>
            <button type="button" className="font-semibold text-text" onClick={() => setReplyTo(null)}>
              إلغاء
            </button>
          </div>
        ) : null}
        {notice ? <p className="flex items-center gap-2 text-xs text-success"><CircleCheck className="size-4" aria-hidden="true" />{notice}</p> : null}
        <div className="flex items-center gap-2">
          <label className="sr-only" htmlFor="comment-nickname">اسمك المستعار</label>
          <input
            id="comment-nickname"
            value={prefs.nickname}
            maxLength={24}
            onChange={(event) => setPrefs((previous) => ({ ...previous, nickname: event.target.value }))}
            placeholder="اسمك (اختياري)"
            className="h-10 w-32 shrink-0 rounded-xl bg-white/[0.06] px-3 text-sm outline-none ring-1 ring-white/10 focus:ring-brand"
          />
          <label className="sr-only" htmlFor="comment-text">اكتب تعليقًا</label>
          <input
            id="comment-text"
            value={text}
            maxLength={300}
            onChange={(event) => setText(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") void submit();
            }}
            placeholder={replyTo ? "اكتب ردك…" : "أضف تعليقًا مفيدًا…"}
            className="h-10 min-w-0 flex-1 rounded-xl bg-white/[0.06] px-3 text-sm outline-none ring-1 ring-white/10 focus:ring-brand"
          />
          <button
            type="button"
            onClick={() => void submit()}
            disabled={sending || text.trim().length === 0}
            aria-label="إرسال التعليق"
            className="grid size-10 shrink-0 place-items-center rounded-xl bg-brand text-ink disabled:opacity-40"
          >
            {sending ? <span className="spin size-4 rounded-full border-2 border-ink/30 border-t-ink" /> : <Send className="size-4" aria-hidden="true" />}
          </button>
        </div>
        <p className="text-[11px] leading-5 text-muted">
          التعليقات تُنشر باسم مستعار دون حساب. التعليقات التي تحتوي على روابط أو بيانات تواصل أو كلمات محظورة تُراجع قبل ظهورها.
        </p>
      </div>
    </>
  );
}

function CommentItem({
  comment,
  canDelete,
  onReply,
  onDelete,
}: {
  comment: CommentDto;
  canDelete: boolean;
  onReply?: () => void;
  onDelete: () => void;
}) {
  return (
    <div className="flex gap-3">
      <span className="grid size-8 shrink-0 place-items-center rounded-full bg-white/10 text-xs font-semibold">{Array.from(comment.authorName)[0] ?? "ز"}</span>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 text-xs text-muted">
          <span className="font-semibold text-text">{comment.authorName}</span>
          <time dateTime={comment.createdAt}>{formatRelative(comment.createdAt)}</time>
        </div>
        <p className="mt-0.5 whitespace-pre-line break-words text-sm leading-6">{comment.body}</p>
        <div className="mt-1 flex items-center gap-4 text-xs text-muted">
          {onReply ? (
            <button type="button" onClick={onReply} className="font-semibold hover:text-text">
              رد
            </button>
          ) : null}
          {canDelete ? (
            <button type="button" onClick={onDelete} className="inline-flex items-center gap-1 font-semibold text-danger">
              <Trash2 className="size-3.5" aria-hidden="true" />
              حذف تعليقي
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}

export function formatRelative(iso: string, now: number = Date.now()): string {
  const diff = Math.max(0, now - new Date(iso).getTime());
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 1) return "الآن";
  if (minutes < 60) return `منذ ${new Intl.NumberFormat("ar").format(minutes)} د`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `منذ ${new Intl.NumberFormat("ar").format(hours)} س`;
  const days = Math.floor(hours / 24);
  return `منذ ${new Intl.NumberFormat("ar").format(days)} ي`;
}

/* ------------------------------------------------------------------ report */

export const REPORT_REASONS = [
  { value: "inappropriate", label: "محتوى غير لائق" },
  { value: "misleading", label: "معلومة مضللة أو خاطئة" },
  { value: "spam", label: "إعلان أو رسائل مزعجة" },
  { value: "harassment", label: "تنمّر أو إساءة" },
  { value: "copyright", label: "حقوق ملكية أو محتوى منسوخ" },
  { value: "privacy", label: "انتهاك للخصوصية" },
  { value: "other", label: "سبب آخر" },
] as const;

export function ReportSheet({
  open,
  onClose,
  target,
}: {
  open: boolean;
  onClose: () => void;
  target: { type: "video" | "comment"; id: string; title: string } | null;
}) {
  return (
    <Sheet open={open} onClose={onClose} title="الإبلاغ عن المحتوى">
      {open && target ? <ReportForm target={target} onDone={onClose} /> : null}
    </Sheet>
  );
}

/** Mounted only while the sheet is open, so every report starts with a clean form. */
function ReportForm({ target, onDone }: { target: { type: "video" | "comment"; id: string; title: string }; onDone: () => void }) {
  const toast = useToast();
  const [reason, setReason] = useState<(typeof REPORT_REASONS)[number]["value"] | null>(null);
  const [details, setDetails] = useState("");
  const [sending, setSending] = useState(false);

  async function submit() {
    if (!reason || sending) return;
    setSending(true);
    try {
      const result = await api<{ message: string }>("/api/reports", {
        body: { targetType: target.type, targetId: target.id, reason, details: details.trim() || null },
      });
      toast.show(result.message, "success");
      onDone();
    } catch (error) {
      toast.show(messageOf(error), "error");
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm leading-7 text-muted">
        البلاغ يصل إلى فريق المراجعة. لا نحتاج اسمك أو بريدك، والبلاغ من جهازك يُسجَّل مرة واحدة لكل عنصر.
      </p>
      <p className="truncate rounded-xl bg-white/5 px-3 py-2 text-sm">{target.title}</p>
      <fieldset className="flex flex-col gap-2">
        <legend className="sr-only">سبب البلاغ</legend>
        {REPORT_REASONS.map((item) => (
          <label
            key={item.value}
            className={`flex cursor-pointer items-center justify-between gap-3 rounded-2xl px-4 py-3 text-sm ring-1 transition-colors ${
              reason === item.value ? "bg-brand/10 ring-brand" : "bg-white/[0.03] ring-white/10 hover:bg-white/[0.06]"
            }`}
          >
            <span>{item.label}</span>
            <input type="radio" name="report-reason" value={item.value} checked={reason === item.value} onChange={() => setReason(item.value)} className="size-4 accent-[#f5b942]" />
          </label>
        ))}
      </fieldset>
      <label className="block text-sm">
        <span className="mb-1 block text-muted">تفاصيل إضافية (اختياري)</span>
        <textarea
          value={details}
          maxLength={500}
          rows={3}
          onChange={(event) => setDetails(event.target.value)}
          className="w-full rounded-2xl bg-white/[0.06] p-3 text-sm outline-none ring-1 ring-white/10 focus:ring-brand"
        />
      </label>
      <Button full onClick={() => void submit()} disabled={!reason || sending}>
        <Flag className="size-4" aria-hidden="true" />
        {sending ? "جارٍ الإرسال…" : "إرسال البلاغ"}
      </Button>
    </div>
  );
}

/* ------------------------------------------------------------------ more menu */

export function MoreSheet({
  open,
  onClose,
  video,
  muted,
  onToggleMute,
  onReport,
}: {
  open: boolean;
  onClose: () => void;
  video: VideoCardDto | null;
  muted: boolean;
  onToggleMute: () => void;
  onReport: () => void;
}) {
  const toast = useToast();

  async function copyLink() {
    if (!video) return;
    const url = `${window.location.origin}/?v=${video.id}`;
    try {
      await navigator.clipboard.writeText(url);
      toast.show("تم نسخ رابط الفيديو.", "success");
    } catch {
      toast.show("تعذّر النسخ تلقائيًا. انسخ الرابط من شريط العنوان.", "error");
    }
    onClose();
  }

  const items = [
    { label: "نسخ رابط الفيديو", icon: Copy, onClick: copyLink },
    { label: "الإبلاغ عن الفيديو", icon: Flag, onClick: () => (onClose(), onReport()) },
    { label: muted ? "تشغيل الصوت" : "كتم الصوت", icon: muted ? Volume2 : VolumeX, onClick: () => onToggleMute() },
  ];

  return (
    <Sheet open={open} onClose={onClose} title="خيارات">
      <ul className="flex flex-col gap-2">
        {items.map((item) => (
          <li key={item.label}>
            <button type="button" onClick={item.onClick} className="flex w-full items-center gap-3 rounded-2xl bg-white/[0.04] px-4 py-3.5 text-start text-sm ring-1 ring-white/10 hover:bg-white/[0.08]">
              <item.icon className="size-5 text-brand" aria-hidden="true" />
              {item.label}
            </button>
          </li>
        ))}
        {video ? (
          <li>
            <Link href={`/creator/${video.creator.id}`} onClick={onClose} className="flex items-center gap-3 rounded-2xl bg-white/[0.04] px-4 py-3.5 text-sm ring-1 ring-white/10 hover:bg-white/[0.08]">
              <UserRound className="size-5 text-brand" aria-hidden="true" />
              صفحة صاحب المحتوى (باسم مستعار)
            </Link>
          </li>
        ) : null}
      </ul>
    </Sheet>
  );
}

/* ------------------------------------------------------------------ quick quiz */

export function QuizSheet({ video, open, onClose }: { video: VideoCardDto | null; open: boolean; onClose: () => void }) {
  return (
    <Sheet open={open} onClose={onClose} title="سؤال سريع">
      {open && video ? <QuizBody videoId={video.id} /> : null}
    </Sheet>
  );
}

function QuizBody({ videoId }: { videoId: string }) {
  const [quizzes, setQuizzes] = useState<QuizDto[]>([]);
  const [index, setIndex] = useState(0);
  const [chosen, setChosen] = useState<number | null>(null);
  const [result, setResult] = useState<{ correct: boolean; correctIndex: number; explanation: string } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [, setProgress] = useLocal<LearningProgress>(LOCAL_KEYS.progress, DEFAULT_PROGRESS);

  useEffect(() => {
    let cancelled = false;
    api<{ video: VideoCardDto; quizzes: QuizDto[] }>(`/api/videos/${videoId}`)
      .then((response) => {
        if (!cancelled) setQuizzes(response.quizzes);
      })
      .catch((caught) => {
        if (!cancelled) setError(messageOf(caught));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [videoId]);

  const quiz = quizzes[index];

  async function answer(choice: number) {
    if (!quiz || result) return;
    setChosen(choice);
    try {
      const response = await api<{ correct: boolean; correctIndex: number; explanation: string }>(`/api/quizzes/${quiz.id}/answer`, {
        body: { choiceIndex: choice },
      });
      setResult(response);
      setProgress((previous) => withActivity(previous, { quiz: { id: quiz.id, correct: response.correct } }));
    } catch (caught) {
      setError(messageOf(caught));
    }
  }

  return (
    <>
      {loading ? <Spinner label="جارٍ تحميل السؤال" /> : null}
      {error ? <p className="text-sm text-danger">{error}</p> : null}
      {!loading && !error && !quiz ? <p className="text-sm text-muted">لا توجد أسئلة لهذا الفيديو بعد.</p> : null}
      {quiz ? (
        <div className="fade-in flex flex-col gap-4">
          <p className="text-base font-semibold leading-8">{quiz.question}</p>
          <ul className="flex flex-col gap-2.5">
            {quiz.options.map((option, optionIndex) => {
              const isCorrect = result && result.correctIndex === optionIndex;
              const isWrongChoice = result && chosen === optionIndex && !result.correct;
              return (
                <li key={option}>
                  <button
                    type="button"
                    disabled={Boolean(result)}
                    onClick={() => void answer(optionIndex)}
                    className={`flex w-full items-center justify-between gap-3 rounded-2xl px-4 py-3.5 text-start text-sm ring-1 transition-colors ${
                      isCorrect ? "bg-success/15 ring-success" : isWrongChoice ? "bg-danger/15 ring-danger" : "bg-white/[0.04] ring-white/10 hover:bg-white/[0.08]"
                    }`}
                  >
                    <span>{option}</span>
                    {isCorrect ? <Check className="size-5 text-success" aria-hidden="true" /> : null}
                    {isWrongChoice ? <CircleX className="size-5 text-danger" aria-hidden="true" /> : null}
                  </button>
                </li>
              );
            })}
          </ul>
          {result ? (
            <div className="fade-in rounded-2xl bg-white/[0.05] p-4 text-sm leading-7">
              <p className={`mb-1 font-semibold ${result.correct ? "text-success" : "text-danger"}`}>{result.correct ? "إجابة صحيحة!" : "ليست الإجابة الصحيحة، لكن التعلّم يبدأ هنا."}</p>
              <p className="text-muted">{result.explanation}</p>
              {index + 1 < quizzes.length ? (
                <Button
                  variant="secondary"
                  className="mt-3"
                  onClick={() => {
                    setIndex((value) => value + 1);
                    setChosen(null);
                    setResult(null);
                  }}
                >
                  السؤال التالي
                </Button>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}
    </>
  );
}

/* ------------------------------------------------------------------ caption (full description) */

/** Full description, hashtags and the key fact. Opened by "المزيد" so the slide itself stays clean. */
export function CaptionSheet({
  video,
  open,
  onClose,
  factSaved,
  onSaveFact,
  onQuiz,
}: {
  video: VideoCardDto | null;
  open: boolean;
  onClose: () => void;
  factSaved: boolean;
  onSaveFact: (video: VideoCardDto) => void;
  onQuiz: (video: VideoCardDto) => void;
}) {
  return (
    <Sheet open={open} onClose={onClose} title="الوصف">
      {open && video ? (
        <div className="flex flex-col gap-4 text-[15px] leading-7">
          <h3 className="text-base font-semibold">{video.title}</h3>
          {video.description ? <p className="whitespace-pre-line text-muted">{video.description}</p> : null}
          {video.hashtags.length > 0 ? (
            <div className="flex flex-wrap gap-2">
              {video.hashtags.map((tag) => (
                <Link key={tag} href={`/search?tag=${encodeURIComponent(tag)}`} onClick={onClose} className="rounded-full bg-white/[0.06] px-3 py-1 text-sm">
                  #{tag}
                </Link>
              ))}
            </div>
          ) : null}
          {video.keyFact ? (
            <div className="rounded-2xl bg-white/[0.05] p-4 ring-1 ring-white/10">
              <p className="flex items-start gap-2 text-sm leading-7">
                <Lightbulb className="mt-1.5 size-4 shrink-0 text-brand" aria-hidden="true" />
                <span>{video.keyFact}</span>
              </p>
              <Button variant="secondary" className="mt-3 h-9 px-4 text-xs" disabled={factSaved} onClick={() => onSaveFact(video)}>
                {factSaved ? "محفوظة في مكتبتك" : "احفظ المعلومة"}
              </Button>
            </div>
          ) : null}
          {video.quizCount > 0 ? (
            <Button variant="secondary" onClick={() => onQuiz(video)}>
              <Sparkles className="size-4" aria-hidden="true" />
              سؤال سريع
            </Button>
          ) : null}
        </div>
      ) : null}
    </Sheet>
  );
}
