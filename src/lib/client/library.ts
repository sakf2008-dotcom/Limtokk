"use client";

/**
 * Local "library" data: saved videos, followed creators, saved facts, owner tokens, learning
 * progress, streaks and badges. Everything here lives in this browser only.
 */

export interface SavedVideo {
  id: string;
  title: string;
  categoryName: string;
  creatorName: string;
  posterUrl: string | null;
  savedAt: string;
}

export interface FollowedCreator {
  id: string;
  name: string;
  avatar: string;
  followedAt: string;
}

export interface SavedFact {
  id: string;
  text: string;
  videoId: string;
  videoTitle: string;
  savedAt: string;
}

export interface OwnedVideo {
  videoId: string;
  title: string;
  ownerToken: string;
  createdAt: string;
}

export interface LearningProgress {
  watched: string[];
  activeDays: string[];
  quizAnswers: Record<string, boolean>;
  lastVideo: { id: string; title: string } | null;
}

export interface Preferences {
  interests: string[];
  muted: boolean;
  nickname: string;
  /** Pseudonymous creator page this device uploads under (returned by the server, never invented locally). */
  creatorId: string | null;
}

export const DEFAULT_PREFS: Preferences = { interests: [], muted: false, nickname: "", creatorId: null };
export const DEFAULT_PROGRESS: LearningProgress = { watched: [], activeDays: [], quizAnswers: {}, lastVideo: null };

export const BADGES = [
  { id: "first-watch", title: "أول خطوة", text: "شاهدت أول فيديو تعليمي." , test: (p: LearningProgress) => p.watched.length >= 1 },
  { id: "curious-10", title: "فضولي", text: "شاهدت 10 فيديوهات مختلفة.", test: (p: LearningProgress) => p.watched.length >= 10 },
  { id: "streak-3", title: "ثلاثة أيام", text: "تعلّمت 3 أيام متتالية.", test: (p: LearningProgress) => streakOf(p.activeDays) >= 3 },
  { id: "streak-7", title: "أسبوع من التعلم", text: "تعلّمت 7 أيام متتالية.", test: (p: LearningProgress) => streakOf(p.activeDays) >= 7 },
  { id: "quiz-5", title: "محلّل", text: "أجبت 5 أسئلة بشكل صحيح.", test: (p: LearningProgress) => Object.values(p.quizAnswers).filter(Boolean).length >= 5 },
] as const;

export function dayKey(date: Date = new Date()): string {
  const offsetMs = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offsetMs).toISOString().slice(0, 10);
}

/** Consecutive active days ending today (or yesterday, so a streak survives until the day is over). */
export function streakOf(days: string[], today: Date = new Date()): number {
  const set = new Set(days);
  let cursor = new Date(today);
  if (!set.has(dayKey(cursor))) cursor = new Date(cursor.getTime() - 86_400_000);
  let count = 0;
  while (set.has(dayKey(cursor))) {
    count += 1;
    cursor = new Date(cursor.getTime() - 86_400_000);
  }
  return count;
}

export function withActivity(progress: LearningProgress, update: { watchedId?: string; watchedTitle?: string; quiz?: { id: string; correct: boolean } }): LearningProgress {
  const today = dayKey();
  const watched = update.watchedId && !progress.watched.includes(update.watchedId) ? [...progress.watched, update.watchedId].slice(-500) : progress.watched;
  const activeDays = progress.activeDays.includes(today) ? progress.activeDays : [...progress.activeDays, today].slice(-90);
  const quizAnswers = update.quiz ? { ...progress.quizAnswers, [update.quiz.id]: update.quiz.correct } : progress.quizAnswers;
  const lastVideo = update.watchedId && update.watchedTitle ? { id: update.watchedId, title: update.watchedTitle } : progress.lastVideo;
  return { watched, activeDays, quizAnswers, lastVideo };
}

export function earnedBadges(progress: LearningProgress): Array<(typeof BADGES)[number]> {
  return BADGES.filter((badge) => badge.test(progress));
}
