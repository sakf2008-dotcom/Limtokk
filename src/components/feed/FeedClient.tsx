"use client";

import Link from "next/link";
import { memo, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Search } from "lucide-react";
import type { VideoCardDto } from "@/lib/domain/types";
import { EmptyState, ErrorState, Skeleton, Spinner, useToast } from "@/components/ui/ui";
import { VideoSlide, type SlideActions } from "./VideoSlide";
import { CaptionSheet, CommentsSheet, MoreSheet, QuizSheet, ReportSheet } from "./sheets";
import { api, messageOf } from "@/lib/client/api";
import { LOCAL_KEYS, useLocal } from "@/lib/client/local";
import {
  DEFAULT_PREFS,
  DEFAULT_PROGRESS,
  withActivity,
  type FollowedCreator,
  type LearningProgress,
  type Preferences,
  type SavedFact,
  type SavedVideo,
} from "@/lib/client/library";

type Tab = "foryou" | "latest";
type SheetState = { kind: "comments" | "report" | "more" | "quiz" | "caption"; video: VideoCardDto } | null;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TABS: Array<{ id: Tab; label: string }> = [
  { id: "foryou", label: "لك" },
  { id: "latest", label: "الأحدث" },
];
const Slide = memo(VideoSlide);

export function FeedClient() {
  return (
    <Suspense fallback={<FeedSkeleton />}>
      <FeedInner />
    </Suspense>
  );
}

function FeedSkeleton() {
  return (
    <div className="relative h-dvh overflow-hidden bg-ink">
      <div className="absolute inset-x-4 top-[calc(var(--safe-top)+5rem)] bottom-[calc(var(--safe-bottom)+6rem)]">
        <Skeleton className="size-full" />
      </div>
      <div className="absolute inset-x-0 top-[calc(var(--safe-top)+1rem)] flex justify-center">
        <Spinner label="جارٍ تحميل الفيديوهات" />
      </div>
    </div>
  );
}

function FeedInner() {
  const toast = useToast();
  const searchParams = useSearchParams();
  const startId = searchParams.get("v");

  const [tab, setTab] = useState<Tab>("foryou");
  const [items, setItems] = useState<VideoCardDto[]>([]);
  const [nextOffset, setNextOffset] = useState<number | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const [reloadKey, setReloadKey] = useState(0);
  // The request key identifies the current first-page request. Phase is derived from it, so the
  // effect below only sets state inside async callbacks.
  const requestKey = `${tab}|${startId ?? ""}|${reloadKey}`;
  const [readyKey, setReadyKey] = useState<string | null>(null);
  const [failure, setFailure] = useState<{ key: string; message: string } | null>(null);
  const phase: "loading" | "ready" | "error" = readyKey === requestKey ? "ready" : failure?.key === requestKey ? "error" : "loading";
  const errorText = failure?.key === requestKey ? failure.message : "";
  const [sheet, setSheet] = useState<SheetState>(null);

  const [prefs, setPrefs] = useLocal<Preferences>(LOCAL_KEYS.prefs, DEFAULT_PREFS);
  const [saved, setSaved] = useLocal<SavedVideo[]>(LOCAL_KEYS.saved, []);
  const [follows, setFollows] = useLocal<FollowedCreator[]>(LOCAL_KEYS.follows, []);
  const [facts, setFacts] = useLocal<SavedFact[]>(LOCAL_KEYS.facts, []);
  const [, setProgress] = useLocal<LearningProgress>(LOCAL_KEYS.progress, DEFAULT_PROGRESS);

  const scrollRef = useRef<HTMLDivElement>(null);
  const interestsRef = useRef<string[]>(prefs.interests);
  const requestIdRef = useRef(0);
  const failedOffsetRef = useRef<number | null | undefined>(undefined);

  useEffect(() => {
    interestsRef.current = prefs.interests;
  }, [prefs.interests]);

  const fetchPage = useCallback((nextTab: Tab, offset: number) => {
    const query = new URLSearchParams({ tab: nextTab, offset: String(offset), limit: "10" });
    if (interestsRef.current.length > 0) query.set("prefs", interestsRef.current.join(","));
    return api<{ items: VideoCardDto[]; nextOffset: number | null }>(`/api/feed?${query.toString()}`);
  }, []);

  // First page for each tab (and after a retry). A shared ?v= video is placed first.
  useEffect(() => {
    const requestId = ++requestIdRef.current;
    const key = requestKey;
    failedOffsetRef.current = undefined;
    scrollRef.current?.scrollTo({ top: 0 });
    (async () => {
      try {
        const page = await fetchPage(tab, 0);
        let initial = page.items;
        if (startId && UUID.test(startId)) {
          try {
            const single = await api<{ video: VideoCardDto }>(`/api/videos/${startId}`);
            initial = [single.video, ...page.items.filter((item) => item.id !== startId)];
          } catch {
            // The shared video may have been removed. The feed still works.
          }
        }
        if (requestId !== requestIdRef.current) return;
        setItems(initial);
        setNextOffset(page.nextOffset);
        setActiveIndex(0);
        setReadyKey(key);
      } catch (error) {
        if (requestId !== requestIdRef.current) return;
        setFailure({ key, message: messageOf(error) });
      }
    })();
  }, [tab, startId, reloadKey, fetchPage, requestKey]);

  const loadMore = useCallback(async () => {
    if (loadingMore || nextOffset === null) return;
    const requestId = requestIdRef.current;
    setLoadingMore(true);
    try {
      const page = await fetchPage(tab, nextOffset);
      if (requestId !== requestIdRef.current) return;
      setItems((previous) => {
        const seen = new Set(previous.map((item) => item.id));
        return [...previous, ...page.items.filter((item) => !seen.has(item.id))];
      });
      setNextOffset(page.nextOffset);
    } catch {
      // Remember the failed offset so that scrolling does not retry in a tight loop.
      failedOffsetRef.current = nextOffset;
    } finally {
      if (requestId === requestIdRef.current) setLoadingMore(false);
    }
  }, [loadingMore, nextOffset, tab, fetchPage]);

  // Infinite pagination is triggered from the scroll observer (not from an effect body), when the
  // viewer is within four slides of the end. The ref always points at the latest loader.
  const loadMoreRef = useRef<() => void>(() => undefined);
  useEffect(() => {
    loadMoreRef.current = () => void loadMore();
  });

  // Active slide detection: the slide that is at least 60% visible becomes active.
  useEffect(() => {
    const root = scrollRef.current;
    if (!root || phase !== "ready") return;
    const observer = new IntersectionObserver(
      (entries) => {
        let best: { index: number; ratio: number } | null = null;
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          const index = Number((entry.target as HTMLElement).dataset.index);
          if (!best || entry.intersectionRatio > best.ratio) best = { index, ratio: entry.intersectionRatio };
        }
        if (best && best.ratio >= 0.6) {
          setActiveIndex(best.index);
          const nearEnd = items.length - best.index <= 4;
          if (nearEnd && nextOffset !== null && failedOffsetRef.current !== nextOffset) loadMoreRef.current();
        }
      },
      { root, threshold: [0.6, 0.9] },
    );
    root.querySelectorAll<HTMLElement>("[data-index]").forEach((element) => observer.observe(element));
    return () => observer.disconnect();
  }, [items.length, phase, nextOffset]);

  const updateItem = useCallback((id: string, patch: Partial<VideoCardDto>) => {
    setItems((previous) => previous.map((item) => (item.id === id ? { ...item, ...patch } : item)));
  }, []);

  const handleLike = useCallback(
    (video: VideoCardDto) => {
      const nextLiked = !video.liked;
      const previous = { liked: video.liked, likeCount: video.likeCount };
      updateItem(video.id, { liked: nextLiked, likeCount: Math.max(0, video.likeCount + (nextLiked ? 1 : -1)) });
      api<{ liked: boolean; likeCount: number }>(`/api/videos/${video.id}/like`, { body: { liked: nextLiked } })
        .then((result) => updateItem(video.id, { liked: result.liked, likeCount: result.likeCount }))
        .catch((error) => {
          updateItem(video.id, previous);
          toast.show(messageOf(error) || "تعذّر تسجيل الإعجاب. حاول مرة أخرى.", "error");
        });
    },
    [toast, updateItem],
  );

  const toggleSave = useCallback(
    (video: VideoCardDto) => {
      const exists = saved.some((entry) => entry.id === video.id);
      setSaved((previous) =>
        exists
          ? previous.filter((entry) => entry.id !== video.id)
          : [
              {
                id: video.id,
                title: video.title,
                categoryName: video.categoryName,
                creatorName: video.creator.name,
                posterUrl: video.posterUrl,
                savedAt: new Date().toISOString(),
              },
              ...previous,
            ].slice(0, 300),
      );
      toast.show(exists ? "أُزيل الفيديو من المحفوظات." : "حُفظ الفيديو على هذا الجهاز.", "success");
    },
    [saved, setSaved, toast],
  );

  const toggleFollow = useCallback(
    (video: VideoCardDto) => {
      const exists = follows.some((entry) => entry.id === video.creator.id);
      setFollows((previous) =>
        exists
          ? previous.filter((entry) => entry.id !== video.creator.id)
          : [{ id: video.creator.id, name: video.creator.name, avatar: video.creator.avatar, followedAt: new Date().toISOString() }, ...previous],
      );
      toast.show(exists ? "أُلغيت المتابعة." : "تمت المتابعة على هذا الجهاز فقط.", "success");
    },
    [follows, setFollows, toast],
  );

  const saveFact = useCallback(
    (video: VideoCardDto) => {
      if (!video.keyFact) return;
      const fact = video.keyFact;
      setFacts((previous) =>
        previous.some((entry) => entry.videoId === video.id)
          ? previous
          : [{ id: video.id, text: fact, videoId: video.id, videoTitle: video.title, savedAt: new Date().toISOString() }, ...previous].slice(0, 300),
      );
      toast.show("حُفظت المعلومة في مكتبتك.", "success");
    },
    [setFacts, toast],
  );

  const handleWatched = useCallback(
    (video: VideoCardDto) => {
      setProgress((previous) => withActivity(previous, { watchedId: video.id, watchedTitle: video.title }));
    },
    [setProgress],
  );

  const toggleMute = useCallback(() => setPrefs((previous) => ({ ...previous, muted: !previous.muted })), [setPrefs]);

  const actions: SlideActions = useMemo(
    () => ({
      onLike: handleLike,
      onComments: (video) => setSheet({ kind: "comments", video }),
      onReport: (video) => setSheet({ kind: "report", video }),
      onMore: (video) => setSheet({ kind: "more", video }),
      onCaption: (video) => setSheet({ kind: "caption", video }),
      onQuiz: (video) => setSheet({ kind: "quiz", video }),
      onShare: (video) => void shareVideo(video, toast.show),
      onSave: toggleSave,
      onFollow: toggleFollow,
      onSaveFact: saveFact,
      onWatched: handleWatched,
      onToggleMute: toggleMute,
    }),
    [handleLike, toggleSave, toggleFollow, saveFact, handleWatched, toggleMute, toast.show],
  );

  const savedIds = useMemo(() => new Set(saved.map((entry) => entry.id)), [saved]);
  const followedIds = useMemo(() => new Set(follows.map((entry) => entry.id)), [follows]);
  const factIds = useMemo(() => new Set(facts.map((entry) => entry.videoId)), [facts]);
  const closeSheet = useCallback(() => setSheet(null), []);

  return (
    <div className="relative h-dvh overflow-hidden bg-ink">
      <h1 className="sr-only">علم توك: فيديوهات تعليمية قصيرة</h1>

      <div ref={scrollRef} className="feed-scroll no-scrollbar h-dvh overflow-y-auto" tabIndex={-1}>
        {phase === "loading" ? <FeedSkeleton /> : null}

        {phase === "error" ? (
          <div className="flex h-dvh items-center justify-center">
            <ErrorState message={errorText} onRetry={() => setReloadKey((value) => value + 1)} />
          </div>
        ) : null}

        {phase === "ready" && items.length === 0 ? (
          <div className="flex h-dvh items-center justify-center">
            <EmptyState
              icon={<Search className="size-7" aria-hidden="true" />}
              title="لا توجد فيديوهات منشورة بعد"
              text="الفيديوهات الجديدة تظهر هنا بعد مراجعتها. يمكنك أيضًا تصفح التصنيفات من صفحة استكشف."
              action={
                <Link href="/explore" className="inline-flex h-11 items-center rounded-2xl bg-brand px-5 text-sm font-semibold text-ink">
                  استكشف التصنيفات
                </Link>
              }
            />
          </div>
        ) : null}

        {phase === "ready"
          ? items.map((video, index) => (
              <Slide
                key={video.id}
                video={video}
                index={index}
                active={index === activeIndex}
                near={Math.abs(index - activeIndex) <= 1}
                muted={prefs.muted}
                saved={savedIds.has(video.id)}
                following={followedIds.has(video.creator.id)}
                {...actions}
              />
            ))
          : null}
      </div>

      {phase === "ready" && loadingMore ? (
        <div className="pointer-events-none absolute inset-x-0 bottom-[calc(var(--safe-bottom)+5.5rem)] z-[3] flex justify-center">
          <Spinner label="جارٍ تحميل المزيد" />
        </div>
      ) : null}

      <header className="pointer-events-none absolute inset-x-0 top-0 z-20" style={{ paddingTop: "calc(var(--safe-top) + 0.5rem)" }}>
        <div className="pointer-events-auto flex items-center justify-between gap-3 bg-gradient-to-b from-black/70 via-black/25 to-transparent px-4 pb-6 pt-1">
          <Link href="/search" aria-label="بحث" className="grid size-9 place-items-center rounded-full bg-black/30 text-white backdrop-blur-md">
            <Search className="size-[18px]" aria-hidden="true" />
          </Link>
          <nav aria-label="نوع التغذية" className="flex items-center gap-4">
            {TABS.map((item) => {
              const selected = tab === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  aria-pressed={selected}
                  onClick={() => setTab(item.id)}
                  className={`relative py-1 text-[15px] font-semibold transition-colors ${selected ? "text-white" : "text-white/60"}`}
                >
                  {item.label}
                  {selected ? <span className="absolute inset-x-1 -bottom-1 h-[3px] rounded-full bg-brand" aria-hidden="true" /> : null}
                </button>
              );
            })}
          </nav>
          <span className="size-9" aria-hidden="true" />
        </div>
      </header>

      <CommentsSheet
        video={sheet?.kind === "comments" ? sheet.video : null}
        open={sheet?.kind === "comments"}
        onClose={closeSheet}
        onCountChange={(id, count) => updateItem(id, { commentCount: count })}
      />
      <ReportSheet
        open={sheet?.kind === "report"}
        onClose={closeSheet}
        target={sheet?.kind === "report" ? { type: "video", id: sheet.video.id, title: sheet.video.title } : null}
      />
      <MoreSheet
        open={sheet?.kind === "more"}
        onClose={closeSheet}
        video={sheet?.kind === "more" ? sheet.video : null}
        muted={prefs.muted}
        onToggleMute={toggleMute}
        onReport={() => sheet?.kind === "more" && setSheet({ kind: "report", video: sheet.video })}
      />
      <QuizSheet video={sheet?.kind === "quiz" ? sheet.video : null} open={sheet?.kind === "quiz"} onClose={closeSheet} />
      <CaptionSheet
        video={sheet?.kind === "caption" ? sheet.video : null}
        open={sheet?.kind === "caption"}
        onClose={closeSheet}
        factSaved={sheet?.kind === "caption" ? factIds.has(sheet.video.id) : false}
        onSaveFact={saveFact}
        onQuiz={(video) => setSheet({ kind: "quiz", video })}
      />
    </div>
  );
}

async function shareVideo(video: VideoCardDto, show: (message: string, tone?: "default" | "success" | "error") => void) {
  const url = `${window.location.origin}/?v=${video.id}`;
  if (typeof navigator.share === "function") {
    try {
      await navigator.share({ title: video.title, text: "شاهد هذا الفيديو التعليمي على علم توك", url });
      return;
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
    }
  }
  try {
    await navigator.clipboard.writeText(url);
    show("تم نسخ رابط الفيديو.", "success");
  } catch {
    show("تعذّر نسخ الرابط تلقائيًا. انسخه من شريط العنوان.", "error");
  }
}
