"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import { AlertCircle, Bookmark, Check, Flag, Heart, Lightbulb, MessageCircle, MoreHorizontal, Play, Plus, RotateCcw, Share2, Sparkles, Volume2, VolumeX } from "lucide-react";
import type { VideoCardDto } from "@/lib/domain/types";
import { Avatar, Chip } from "@/components/ui/ui";
import { api } from "@/lib/client/api";

export interface SlideActions {
  onLike: (video: VideoCardDto) => void;
  onComments: (video: VideoCardDto) => void;
  onReport: (video: VideoCardDto) => void;
  onMore: (video: VideoCardDto) => void;
  onQuiz: (video: VideoCardDto) => void;
  onShare: (video: VideoCardDto) => void;
  onSave: (video: VideoCardDto) => void;
  onFollow: (video: VideoCardDto) => void;
  onSaveFact: (video: VideoCardDto) => void;
  onWatched: (video: VideoCardDto) => void;
  onToggleMute: () => void;
}

interface SlideProps extends SlideActions {
  video: VideoCardDto;
  index: number;
  active: boolean;
  near: boolean;
  muted: boolean;
  saved: boolean;
  following: boolean;
  factSaved: boolean;
}

interface Heart {
  id: number;
  x: number;
  y: number;
}

const VIEW_THRESHOLD_SECONDS = 3;

/**
 * One full-screen slide. The <video> element exists only for the active slide and its neighbours,
 * which keeps iPhone decoder use low. Playback rules:
 *  - Only the active slide plays. Others pause and drop their source.
 *  - Autoplay starts muted if sound is not allowed yet, then the user can unmute.
 *  - A single tap toggles playback. A double tap likes the video.
 */
export function VideoSlide(props: SlideProps) {
  const { video, index, active, near, muted, saved, following, factSaved } = props;
  const videoRef = useRef<HTMLVideoElement>(null);
  const progressRef = useRef<HTMLDivElement>(null);
  const mutedRef = useRef(muted);
  mutedRef.current = muted;
  const userPausedRef = useRef(false);
  const countedRef = useRef(false);
  const pointerStartRef = useRef<{ x: number; y: number; t: number } | null>(null);
  const lastTapRef = useRef(0);
  const tapTimerRef = useRef<number | null>(null);
  const heartIdRef = useRef(0);

  const [buffering, setBuffering] = useState(false);
  const [failed, setFailed] = useState(false);
  const [paused, setPaused] = useState(false);
  const [retryKey, setRetryKey] = useState(0);
  const [hearts, setHearts] = useState<Heart[]>([]);

  // Keep the propagated mute state in sync on the live element.
  useEffect(() => {
    const element = videoRef.current;
    if (!element) return;
    element.muted = muted;
    element.defaultMuted = true;
    if (!element.hasAttribute("muted")) element.setAttribute("muted", "");
  }, [muted, near]);

  // Activation: play when this slide becomes active, pause when it stops being active.
  useEffect(() => {
    const element = videoRef.current;
    if (!element) return;
    if (!active) {
      element.pause();
      return;
    }
    userPausedRef.current = false;
    tryPlay(element);
    // retryKey re-runs playback after an error; tryPlay reads refs, so it needs no dependency.
  }, [active, near, retryKey]);

  // Pause when the tab or app is hidden, resume when visible again (unless the user paused).
  useEffect(() => {
    const onVisibility = () => {
      const element = videoRef.current;
      if (!element) return;
      if (document.hidden) {
        element.pause();
      } else if (active && !userPausedRef.current) {
        tryPlay(element);
      }
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, [active]);

  // Progress bar: written straight to the DOM every frame, so React does not re-render 60 times a second.
  useEffect(() => {
    if (!active) return;
    let frame = 0;
    const tick = () => {
      const element = videoRef.current;
      const bar = progressRef.current;
      if (element && bar && element.duration > 0 && Number.isFinite(element.duration)) {
        bar.style.transform = `scaleX(${Math.min(1, element.currentTime / element.duration)})`;
      }
      frame = window.requestAnimationFrame(tick);
    };
    frame = window.requestAnimationFrame(tick);
    return () => window.cancelAnimationFrame(frame);
  }, [active]);

  useEffect(() => {
    return () => {
      if (tapTimerRef.current) window.clearTimeout(tapTimerRef.current);
    };
  }, []);

  function tryPlay(element: HTMLVideoElement) {
    element.muted = mutedRef.current;
    const attempt = element.play();
    if (attempt && typeof attempt.catch === "function") {
      attempt.catch(() => {
        // Autoplay with sound is blocked on this browser. Fall back to muted playback.
        if (!element.muted) {
          element.muted = true;
          element.play().catch(() => setPaused(true));
        } else {
          setPaused(true);
        }
      });
    }
  }

  function togglePlayback() {
    const element = videoRef.current;
    if (!element || failed) return;
    if (element.paused) {
      userPausedRef.current = false;
      setPaused(false);
      tryPlay(element);
    } else {
      userPausedRef.current = true;
      element.pause();
      setPaused(true);
    }
  }

  function addHeart(x: number, y: number) {
    heartIdRef.current += 1;
    const id = heartIdRef.current;
    setHearts((previous) => [...previous, { id, x, y }]);
    window.setTimeout(() => setHearts((previous) => previous.filter((heart) => heart.id !== id)), 850);
  }

  function handlePointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    pointerStartRef.current = { x: event.clientX, y: event.clientY, t: performance.now() };
  }

  function handlePointerUp(event: ReactPointerEvent<HTMLDivElement>) {
    const start = pointerStartRef.current;
    pointerStartRef.current = null;
    if (!start) return;
    const moved = Math.hypot(event.clientX - start.x, event.clientY - start.y);
    if (moved > 12 || performance.now() - start.t > 600) return;

    const rect = event.currentTarget.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    const now = performance.now();

    if (now - lastTapRef.current < 320) {
      // Double tap: like (never unlike, to avoid accidental removals) and show the heart.
      if (tapTimerRef.current) window.clearTimeout(tapTimerRef.current);
      tapTimerRef.current = null;
      lastTapRef.current = 0;
      addHeart(x, y);
      if (!video.liked) props.onLike(video);
      return;
    }
    lastTapRef.current = now;
    tapTimerRef.current = window.setTimeout(() => {
      tapTimerRef.current = null;
      togglePlayback();
    }, 260);
  }

  const src = near ? (retryKey > 0 ? `${video.mediaUrl}?r=${retryKey}` : video.mediaUrl) : undefined;

  return (
    <section data-index={index} className="feed-slide" aria-roledescription="شريحة فيديو" aria-label={video.title}>
      {video.posterUrl ? (
        // Blurred poster fills the sides when the video is not full-height.
        // eslint-disable-next-line @next/next/no-img-element
        <img src={video.posterUrl} alt="" aria-hidden="true" className="absolute inset-0 size-full scale-110 object-cover opacity-25 blur-3xl" />
      ) : (
        <div className="absolute inset-0" style={{ background: `radial-gradient(120% 80% at 50% 0%, ${video.categoryAccent}55, #07080c 70%)` }} aria-hidden="true" />
      )}

      <video
        ref={videoRef}
        key={`${video.id}-${retryKey}`}
        src={src}
        poster={video.posterUrl ?? undefined}
        className="absolute inset-0 size-full object-contain"
        playsInline
        loop
        preload={active ? "auto" : "metadata"}
        aria-label={video.title}
        onWaiting={() => setBuffering(true)}
        onStalled={() => setBuffering(true)}
        onCanPlay={() => setBuffering(false)}
        onPlaying={() => {
          setBuffering(false);
          setFailed(false);
          setPaused(false);
        }}
        onPause={() => setPaused(true)}
        onError={() => {
          setBuffering(false);
          if (near) setFailed(true);
        }}
        onTimeUpdate={(event) => {
          if (countedRef.current) return;
          if (event.currentTarget.currentTime >= VIEW_THRESHOLD_SECONDS) {
            countedRef.current = true;
            props.onWatched(video);
            api(`/api/videos/${video.id}/view`, { method: "POST" }).catch(() => undefined);
          }
        }}
      />

      {/* Tap layer: sits under the overlays so only empty space is tappable. */}
      <div
        className="absolute inset-0 z-[1]"
        onPointerDown={handlePointerDown}
        onPointerUp={handlePointerUp}
        onPointerCancel={() => (pointerStartRef.current = null)}
        role="presentation"
      />

      {hearts.map((heart) => (
        <HeartBurst key={heart.id} x={heart.x} y={heart.y} />
      ))}

      {buffering && !failed ? (
        <div className="pointer-events-none absolute inset-0 z-[2] grid place-items-center" role="status" aria-label="جارٍ التحميل">
          <span className="spin size-12 rounded-full border-[3px] border-white/25 border-t-brand" />
        </div>
      ) : null}

      {paused && active && !failed && !buffering ? (
        <div className="pointer-events-none absolute inset-0 z-[2] grid place-items-center">
          <span className="grid size-16 place-items-center rounded-full bg-black/45 text-white backdrop-blur-sm">
            <Play className="size-7 translate-x-0.5 fill-white" aria-hidden="true" />
          </span>
        </div>
      ) : null}

      {failed ? (
        <div className="absolute inset-0 z-[3] grid place-items-center bg-black/70 px-8 text-center">
          <div className="fade-in flex flex-col items-center gap-3">
            <AlertCircle className="size-10 text-danger" aria-hidden="true" />
            <p className="text-sm leading-7">تعذّر تشغيل هذا الفيديو. تحقق من الاتصال ثم أعد المحاولة.</p>
            <button
              type="button"
              onClick={() => {
                setFailed(false);
                setRetryKey((value) => value + 1);
              }}
              className="inline-flex h-10 items-center gap-2 rounded-2xl bg-white px-4 text-sm font-semibold text-ink"
            >
              <RotateCcw className="size-4" aria-hidden="true" />
              إعادة المحاولة
            </button>
          </div>
        </div>
      ) : null}

      {/* Mute toggle sits under the top tabs (start side in RTL). */}
      <button
        type="button"
        onClick={props.onToggleMute}
        aria-label={muted ? "تشغيل الصوت" : "كتم الصوت"}
        className="absolute left-4 z-[5] grid size-10 place-items-center rounded-full bg-black/35 text-white backdrop-blur-md"
        style={{ top: "calc(var(--safe-top) + 4.25rem)" }}
      >
        {muted ? <VolumeX className="size-5" aria-hidden="true" /> : <Volume2 className="size-5" aria-hidden="true" />}
      </button>

      {/* Info overlay (text aligned to the start side, kept clear of the action rail on the right). */}
      <div
        className="pointer-events-none absolute bottom-[calc(var(--safe-bottom)+4.75rem)] left-4 right-[5.25rem] z-[4] flex flex-col gap-2.5 text-white"
        style={{ textShadow: "0 1px 12px rgba(0,0,0,0.55)" }}
      >
        <div className="flex items-center gap-2.5">
          <Link href={`/creator/${video.creator.id}`} className="pointer-events-auto flex min-w-0 items-center gap-2" aria-label={`صفحة ${video.creator.name}`}>
            <span className="truncate text-[15px] font-semibold">@{video.creator.name}</span>
          </Link>
          <button
            type="button"
            onClick={() => props.onFollow(video)}
            aria-pressed={following}
            className={`pointer-events-auto inline-flex h-7 shrink-0 items-center gap-1 rounded-full px-3 text-xs font-semibold ${
              following ? "bg-white/15 text-white ring-1 ring-white/25" : "bg-brand text-ink"
            }`}
          >
            {following ? <Check className="size-3.5" aria-hidden="true" /> : <Plus className="size-3.5" aria-hidden="true" />}
            {following ? "تتابع" : "متابعة"}
          </button>
        </div>

        <h2 className="text-balance text-[17px] font-bold leading-7">{video.title}</h2>
        {video.description ? <p className="line-clamp-2 text-sm leading-6 text-white/90">{video.description}</p> : null}

        <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
          <span className="inline-flex h-6 items-center rounded-full px-2.5 text-[11px] font-semibold text-ink" style={{ background: video.categoryAccent }}>
            {video.categoryName}
          </span>
          {video.isDemo ? (
            <span className="inline-flex h-6 items-center rounded-full bg-white/20 px-2.5 text-[11px] font-semibold backdrop-blur">محتوى تجريبي</span>
          ) : null}
          {video.hashtags.slice(0, 3).map((tag) => (
            <Link key={tag} href={`/search?tag=${encodeURIComponent(tag)}`} className="pointer-events-auto text-[13px] font-medium text-white/95" onPointerDown={(event) => event.stopPropagation()} onPointerUp={(event) => event.stopPropagation()}>
              #{tag}
            </Link>
          ))}
        </div>

        {video.keyFact ? (
          <div className="mt-1 flex items-start gap-2 rounded-2xl bg-black/35 p-2.5 text-[13px] leading-6 backdrop-blur-md ring-1 ring-white/10">
            <Lightbulb className="mt-1 size-4 shrink-0 text-brand" aria-hidden="true" />
            <p className="min-w-0 flex-1">{video.keyFact}</p>
            <button
              type="button"
              onClick={() => props.onSaveFact(video)}
              disabled={factSaved}
              className="pointer-events-auto shrink-0 rounded-full bg-white/15 px-2.5 py-1 text-xs font-semibold disabled:opacity-60"
            >
              {factSaved ? "محفوظة" : "احفظها"}
            </button>
          </div>
        ) : null}

        {video.quizCount > 0 ? (
          <div className="pointer-events-auto w-fit">
            <Chip small onClick={() => props.onQuiz(video)} accent="#f5b942">
              <Sparkles className="size-3.5" aria-hidden="true" />
              سؤال سريع
            </Chip>
          </div>
        ) : null}
      </div>

      {/* Action rail on the physical right edge, as the product design requires. */}
      <div className="absolute right-2.5 z-[5] flex flex-col items-center gap-[18px]" style={{ bottom: "calc(var(--safe-bottom) + 5rem)" }}>
        <Link href={`/creator/${video.creator.id}`} aria-label={`صفحة ${video.creator.name}`} className="relative mb-1" onPointerDown={(event) => event.stopPropagation()} onPointerUp={(event) => event.stopPropagation()}>
          <Avatar avatarKey={video.creator.avatar} name={video.creator.name} size={46} ring />
        </Link>
        <RailButton label={video.liked ? "إلغاء الإعجاب" : "إعجاب"} count={video.likeCount} onClick={() => props.onLike(video)} pressed={video.liked}>
          <Heart className={`size-[26px] ${video.liked ? "fill-danger text-danger" : ""}`} aria-hidden="true" />
        </RailButton>
        <RailButton label="التعليقات" count={video.commentCount} onClick={() => props.onComments(video)}>
          <MessageCircle className="size-[26px]" aria-hidden="true" />
        </RailButton>
        <RailButton label={saved ? "إزالة من المحفوظات" : "حفظ الفيديو"} onClick={() => props.onSave(video)} pressed={saved}>
          <Bookmark className={`size-[26px] ${saved ? "fill-brand text-brand" : ""}`} aria-hidden="true" />
        </RailButton>
        <RailButton label="مشاركة" onClick={() => props.onShare(video)}>
          <Share2 className="size-[25px]" aria-hidden="true" />
        </RailButton>
        <RailButton label="إبلاغ عن هذا الفيديو" onClick={() => props.onReport(video)}>
          <Flag className="size-[24px]" aria-hidden="true" />
        </RailButton>
        <RailButton label="خيارات إضافية" onClick={() => props.onMore(video)}>
          <MoreHorizontal className="size-[26px]" aria-hidden="true" />
        </RailButton>
      </div>

      <div className="pointer-events-none absolute inset-x-0 z-[4] h-[2px] bg-white/15" style={{ bottom: "calc(var(--safe-bottom) + 4rem)" }} aria-hidden="true">
        <div ref={progressRef} className="h-full origin-left bg-brand" style={{ transform: "scaleX(0)" }} />
      </div>
    </section>
  );
}

function RailButton({
  label,
  count,
  onClick,
  pressed,
  children,
}: {
  label: string;
  count?: number;
  onClick: () => void;
  pressed?: boolean;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={pressed}
      onClick={onClick}
      onPointerDown={(event) => event.stopPropagation()}
      onPointerUp={(event) => event.stopPropagation()}
      className="flex flex-col items-center gap-1 text-white active:scale-90 transition-transform"
    >
      <span className="grid size-11 place-items-center rounded-full bg-black/25 backdrop-blur-md ring-1 ring-white/10">{children}</span>
      {count !== undefined ? <span className="text-[12px] font-semibold tabular-nums" style={{ textShadow: "0 1px 6px rgba(0,0,0,0.7)" }}>{formatCount(count)}</span> : null}
    </button>
  );
}

function HeartBurst({ x, y }: { x: number; y: number }) {
  return (
    <span
      className="heart-pop pointer-events-none absolute z-[6] text-danger"
      style={{ left: x, top: y }}
      aria-hidden="true"
    >
      <Heart className="size-24 fill-danger drop-shadow-[0_4px_18px_rgba(0,0,0,0.5)]" />
    </span>
  );
}

export function formatCount(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1).replace(/\.0$/, "")}م`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1).replace(/\.0$/, "")}ألف`;
  return new Intl.NumberFormat("ar").format(value);
}
