"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { BookOpen, Check, CircleX, Flame, Lock, Play, Sparkles, Trophy } from "lucide-react";
import type { QuizDto, VideoCardDto } from "@/lib/domain/types";
import { api, messageOf } from "@/lib/client/api";
import { LOCAL_KEYS, useLocal } from "@/lib/client/local";
import { BADGES, DEFAULT_PROGRESS, dayKey, earnedBadges, streakOf, withActivity, type LearningProgress } from "@/lib/client/library";
import { Button, Spinner } from "@/components/ui/ui";

interface Challenge {
  video: VideoCardDto;
  quiz: QuizDto;
}

/** Deterministic "daily challenge": the same question for everyone on the same UTC day. */
function dayNumber(date: Date = new Date()): number {
  return Math.floor(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()) / 86_400_000);
}

export function LearnClient() {
  const [progress, setProgress] = useLocal<LearningProgress>(LOCAL_KEYS.progress, DEFAULT_PROGRESS);
  const [challenge, setChallenge] = useState<Challenge | null>(null);
  const [challengeState, setChallengeState] = useState<"loading" | "ready" | "none" | "error">("loading");
  const [chosen, setChosen] = useState<number | null>(null);
  const [result, setResult] = useState<{ correct: boolean; correctIndex: number; explanation: string } | null>(null);
  const [answeredToday, setAnsweredToday] = useState(() => progress.activeDays.includes(dayKey()));

  const streak = streakOf(progress.activeDays);
  const correctTotal = Object.values(progress.quizAnswers).filter(Boolean).length;
  const answeredTotal = Object.keys(progress.quizAnswers).length;
  const badges = earnedBadges(progress);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const feed = await api<{ items: VideoCardDto[] }>("/api/feed?tab=latest&limit=20");
        const candidates = feed.items.filter((item) => item.quizCount > 0);
        if (candidates.length === 0) {
          if (!cancelled) setChallengeState("none");
          return;
        }
        const chosenVideo = candidates[dayNumber() % candidates.length];
        if (!chosenVideo) return;
        const detail = await api<{ video: VideoCardDto; quizzes: QuizDto[] }>(`/api/videos/${chosenVideo.id}`);
        const quiz = detail.quizzes[0];
        if (!cancelled) {
          if (quiz) {
            setChallenge({ video: detail.video, quiz });
            setChallengeState("ready");
          } else {
            setChallengeState("none");
          }
        }
      } catch (error) {
        if (!cancelled) {
          setChallengeState("error");
          console.info("daily challenge unavailable:", messageOf(error));
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  async function answer(choice: number) {
    if (!challenge || result) return;
    setChosen(choice);
    try {
      const response = await api<{ correct: boolean; correctIndex: number; explanation: string }>(`/api/quizzes/${challenge.quiz.id}/answer`, {
        body: { choiceIndex: choice },
      });
      setResult(response);
      setProgress((previous) => withActivity(previous, { quiz: { id: challenge.quiz.id, correct: response.correct } }));
      setAnsweredToday(true);
    } catch {
      setChosen(null);
    }
  }

  return (
    <main className="min-h-dvh px-4 pb-28" style={{ paddingTop: "calc(var(--safe-top) + 1rem)" }}>
      <header className="mb-5">
        <p className="mb-1 flex items-center gap-2 text-xs text-brand">
          <BookOpen className="size-4" aria-hidden="true" />
          مركز التعلّم
        </p>
        <h1 className="text-2xl font-bold">تعلّم خطوة بخطوة</h1>
        <p className="mt-2 text-sm leading-7 text-muted">تقدّمك وسلسلتك وشاراتك تُحفظ على هذا الجهاز فقط.</p>
      </header>

      <section className="grid grid-cols-3 gap-3" aria-label="ملخص التقدم">
        <Stat icon={<Flame className="size-5 text-brand" aria-hidden="true" />} value={streak} label="أيام متتالية" />
        <Stat icon={<Play className="size-5 text-teal" aria-hidden="true" />} value={progress.watched.length} label="فيديو شاهدته" />
        <Stat icon={<Check className="size-5 text-success" aria-hidden="true" />} value={`${correctTotal}/${answeredTotal}`} label="إجابات صحيحة" />
      </section>

      {progress.lastVideo ? (
        <section className="mt-5 rounded-3xl bg-surface p-4 ring-1 ring-white/10">
          <p className="text-xs text-muted">واصل من حيث توقفت</p>
          <Link href={`/?v=${progress.lastVideo.id}`} className="mt-1 flex items-center justify-between gap-3">
            <span className="line-clamp-2 font-semibold">{progress.lastVideo.title}</span>
            <span className="grid size-10 shrink-0 place-items-center rounded-full bg-brand text-ink">
              <Play className="size-4 translate-x-px fill-ink" aria-hidden="true" />
            </span>
          </Link>
        </section>
      ) : null}

      <section className="mt-6 rounded-3xl bg-surface p-5 ring-1 ring-white/10" aria-labelledby="daily-title">
        <h2 id="daily-title" className="flex items-center gap-2 font-semibold">
          <Sparkles className="size-5 text-brand" aria-hidden="true" />
          تحدّي اليوم
        </h2>
        {challengeState === "loading" ? <Spinner label="جارٍ تحميل السؤال" /> : null}
        {challengeState === "none" || challengeState === "error" ? (
          <p className="mt-2 text-sm leading-7 text-muted">ستظهر أسئلة التحدي اليومي عند توفر فيديوهات بأسئلة منشورة.</p>
        ) : null}
        {challenge ? (
          <div className="mt-3 flex flex-col gap-3">
            <p className="text-sm text-muted">من الفيديو: {challenge.video.title}</p>
            <p className="text-base font-semibold leading-8">{challenge.quiz.question}</p>
            <ul className="flex flex-col gap-2">
              {challenge.quiz.options.map((option, index) => {
                const correct = result?.correctIndex === index;
                const wrong = result && chosen === index && !result.correct;
                return (
                  <li key={option}>
                    <button
                      type="button"
                      disabled={Boolean(result)}
                      onClick={() => void answer(index)}
                      className={`flex w-full items-center justify-between gap-3 rounded-2xl px-4 py-3 text-start text-sm ring-1 ${
                        correct ? "bg-success/15 ring-success" : wrong ? "bg-danger/15 ring-danger" : "bg-white/[0.04] ring-white/10 hover:bg-white/[0.08]"
                      }`}
                    >
                      {option}
                      {correct ? <Check className="size-4 text-success" aria-hidden="true" /> : null}
                      {wrong ? <CircleX className="size-4 text-danger" aria-hidden="true" /> : null}
                    </button>
                  </li>
                );
              })}
            </ul>
            {result ? <p className="rounded-2xl bg-white/[0.05] p-3 text-sm leading-7 text-muted">{result.explanation}</p> : null}
          </div>
        ) : null}
        {answeredToday ? <p className="mt-3 text-xs text-success">أحسنت! سجّلنا نشاط اليوم في سلسلتك.</p> : null}
      </section>

      <section className="mt-6" aria-labelledby="badges-title">
        <h2 id="badges-title" className="mb-3 flex items-center gap-2 font-semibold">
          <Trophy className="size-5 text-brand" aria-hidden="true" />
          الشارات ({badges.length}/{BADGES.length})
        </h2>
        <ul className="grid grid-cols-2 gap-3">
          {BADGES.map((badge) => {
            const earned = badges.some((item) => item.id === badge.id);
            return (
              <li key={badge.id} className={`rounded-2xl p-4 ring-1 ${earned ? "bg-brand/10 ring-brand/40" : "bg-white/[0.03] ring-white/10 opacity-70"}`}>
                <span className="flex items-center gap-2 font-semibold">
                  {earned ? <Trophy className="size-4 text-brand" aria-hidden="true" /> : <Lock className="size-4 text-muted" aria-hidden="true" />}
                  {badge.title}
                </span>
                <span className="mt-1 block text-xs leading-5 text-muted">{badge.text}</span>
              </li>
            );
          })}
        </ul>
      </section>

      <section className="mt-6" aria-labelledby="paths-title">
        <h2 id="paths-title" className="mb-3 font-semibold">مسارات مقترحة</h2>
        <div className="flex flex-col gap-2">
          {["everyday-science", "space-and-light", "start-coding"].map((slug) => (
            <Link key={slug} href={`/playlist/${slug}`} className="rounded-2xl bg-surface p-4 text-sm font-semibold ring-1 ring-white/10 hover:bg-surface-2">
              {slug === "everyday-science" ? "علوم من حياتنا" : slug === "space-and-light" ? "الفضاء والضوء" : "ابدأ مع البرمجة"}
            </Link>
          ))}
        </div>
      </section>

      <div className="mt-6 flex justify-center">
        <Button variant="ghost" onClick={() => setProgress(DEFAULT_PROGRESS)}>
          إعادة ضبط التقدم على هذا الجهاز
        </Button>
      </div>
    </main>
  );
}

function Stat({ icon, value, label }: { icon: React.ReactNode; value: number | string; label: string }) {
  return (
    <div className="rounded-2xl bg-surface p-3 text-center ring-1 ring-white/10">
      <div className="flex justify-center">{icon}</div>
      <div className="mt-2 text-xl font-bold tabular-nums">{value}</div>
      <div className="mt-0.5 text-[11px] leading-4 text-muted">{label}</div>
    </div>
  );
}
