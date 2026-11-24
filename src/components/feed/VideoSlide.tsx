"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import { AlertCircle, Bookmark, Check, Flag, Heart, MessageCircle, MoreHorizontal, Play, Plus, RotateCcw, Share2, Sparkles, Volume2, VolumeX } from "lucide-react";
import type { VideoCardDto } from "@/lib/domain/types";
import { truncateAtWord } from "@/lib/domain/text";
import { Avatar, Chip } from "@/components/ui/ui";
import { api } from "@/lib/client/api";

export interface SlideActions {
  onLike: (video: VideoCardDto) => void;
  onComments: (video: VideoCardDto) => void;
  onReport: (video: VideoCardDto) => void;
  onMore: (video: VideoCardDto) => void;
  onCaption: (video: VideoCardDto) => void;
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
}

interface Heart {
  id: number;
  x: number;
  y: number;
}

const VIEW_THRESHOLD_SECONDS = 3;
/** How many characters of the description are shown on the slide before the "المزيد" button. */
const CAPTION_LIMIT = 40;

const stopPropagation = (event: { stopPropagation: () => void }) => event.stopPropagation();

/**
 * One full-screen slide. The <video> element exists only for the active slide and its neighbours,
 * which keeps iPhone decoder use low. Playback rules:
 *  - Only the active slide plays. Others pause and drop their source.
 *  - Autoplay starts muted if sound is not allowed yet, then the user can unmute.
 *  - A single tap toggles playback. A double tap likes the video.
 */
export function VideoSlide(props: SlideProps) {
  const { video, index, active, near, muted, saved, following } = props;
  const videoRef = useRef<HTMLVideoElement>(null);
  const progressRef = useRef<HTMLDivElement>(null);
  const mutedRef = useRef(muted);
  mutedRef.current = muted;
  const userPausedRef = useRef(false);
  const countedRef = useRef(false);
  const pointerStartRef = useRef<{ x: number; y: number; t: number } | null>(null);
  // Starts at -Infinity: a fresh page has a small performance.now(), so 0 would make an early tap look like a double tap.
  const lastTapRef = useRef(Number.NEGATIVE_INFINITY);
  const tapTimerRef = useRef<number | null>(null);
  const heartIdRef = useRef(0);

  const [buffering, setBuffering] = useState(false);
  const [failed, setFailed] = useState(false);
  const [paused, setPaused] = useState(false);
  const [retryKey, setRetryKey] = useState(0);
  const [hearts, setHearts] = useState<Heart[]>([]);

  // The whole frame is always visible: the video is letterboxed, and a blurred copy of its poster fills the bands.
  const caption = truncateAtWord(video.description, CAPTION_LIMIT);

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
      attempt.catch((error: unknown) => {
        // A pause that interrupts a pending play, or a user pause, is not a failure.
        if (userPausedRef.current) return;
        if (error instanceof DOMException && error.name !== "NotAllowedError") return;
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
      lastTapRef.current = Number.NEGATIVE_INFINITY;
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
      <div className="absolute inset-0" style={{ background: `radial-gradient(120% 80% at 50% 0%, ${video.categoryAccent}55, #07080c 70%)` }} aria-hidden="true" />
      {near && video.posterUrl ? (
        // A blurred copy of the poster fills the bands around the video. Only near slides load it.
        // eslint-disable-next-line @next/next/no-img-element
        <img src={video.posterUrl} alt="" aria-hidden="true" className="absolute inset-0 size-full scale-110 object-cover opacity-30 blur-3xl" />
      ) : null}

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

      {/* Mute toggle, under the top tabs on the start side. */}
      <button
        type="button"
        onClick={props.onToggleMute}
        aria-label={muted ? "تشغيل الصوت" : "كتم الصوت"}
        className="absolute left-3 z-[5] grid size-9 place-items-center rounded-full bg-black/30 text-white backdrop-blur-md"
        style={{ top: "calc(var(--safe-top) + 3.5rem)" }}
      >
        {muted ? <VolumeX className="size-4" aria-hidden="true" /> : <Volume2 className="size-4" aria-hidden="true" />}
      </button>

      {/* Caption block. It stays on the left, clear of the action rail. The full text opens in a sheet. */}
      <div
        className="pointer-events-none absolute bottom-5 left-3 right-[4.25rem] z-[4] flex flex-col gap-1.5 text-white"
        style={{ textShadow: "0 1px 10px rgba(0,0,0,0.6)" }}
      >
        <div className="flex items-center gap-2">
          <Link href={`/creator/${video.creator.id}`} className="pointer-events-auto min-w-0" aria-label={`صفحة ${video.creator.name}`}>
            <span className="block truncate text-[14px] font-semibold">@{video.creator.name}</span>
          </Link>
          <button
            type="button"
            onClick={() => props.onFollow(video)}
            aria-pressed={following}
            className={`pointer-events-auto inline-flex h-6 shrink-0 items-center gap-1 rounded-full px-2.5 text-[11px] font-semibold ${
              following ? "bg-white/15 text-white ring-1 ring-white/25" : "bg-brand text-ink"
            }`}
          >
            {following ? <Check className="size-3" aria-hidden="true" /> : <Plus className="size-3" aria-hidden="true" />}
            {following ? "تتابع" : "متابعة"}
          </button>
        </div>

        <h2 className="line-clamp-2 text-[15px] font-bold leading-6">{video.title}</h2>

        {video.description ? (
          <p className="text-[13px] leading-5 text-white/90">
            {caption.text}
            {caption.truncated ? (
              <button type="button" onClick={() => props.onCaption(video)} className="pointer-events-auto ms-1 font-semibold text-white">
                المزيد
              </button>
            ) : null}
          </p>
        ) : null}

        <div className="flex flex-wrap items-center gap-1.5 text-[12px]">
          <span className="inline-flex h-5 items-center rounded-full px-2 text-[10px] font-semibold text-ink" style={{ background: video.categoryAccent }}>
            {video.categoryName}
          </span>
          {video.isDemo ? <span className="inline-flex h-5 items-center rounded-full bg-white/20 px-2 text-[10px] font-semibold backdrop-blur">تجريبي</span> : null}
          {video.hashtags.slice(0, 2).map((tag) => (
            <Link key={tag} href={`/search?tag=${encodeURIComponent(tag)}`} className="pointer-events-auto font-medium text-white/95" onPointerDown={stopPropagation} onPointerUp={stopPropagation}>
              #{tag}
            </Link>
          ))}
        </div>

        {video.quizCount > 0 ? (
          <div className="pointer-events-auto w-fit pt-0.5">
            <Chip small onClick={() => props.onQuiz(video)} accent="#f5b942">
              <Sparkles className="size-3" aria-hidden="true" />
              سؤال سريع
            </Chip>
          </div>
        ) : null}
      </div>

      {/* Action rail on the physical right edge, as the product design requires. Compact, no heavy backgrounds. */}
      <div className="absolute right-2 z-[5] flex flex-col items-center gap-3.5" style={{ bottom: "1.25rem" }}>
        <Link href={`/creator/${video.creator.id}`} aria-label={`صفحة ${video.creator.name}`} className="relative mb-1" onPointerDown={stopPropagation} onPointerUp={stopPropagation}>
          <Avatar avatarKey={video.creator.avatar} name={video.creator.name} size={40} ring />
        </Link>
        <RailButton label={video.liked ? "إلغاء الإعجاب" : "إعجاب"} count={video.likeCount} onClick={() => props.onLike(video)} pressed={video.liked}>
          <Heart className={`size-7 ${video.liked ? "fill-danger text-danger" : ""}`} aria-hidden="true" />
        </RailButton>
        <RailButton label="التعليقات" count={video.commentCount} onClick={() => props.onComments(video)}>
          <MessageCircle className="size-7" aria-hidden="true" />
        </RailButton>
        <RailButton label={saved ? "إزالة من المحفوظات" : "حفظ الفيديو"} onClick={() => props.onSave(video)} pressed={saved}>
          <Bookmark className={`size-7 ${saved ? "fill-brand text-brand" : ""}`} aria-hidden="true" />
        </RailButton>
        <RailButton label="مشاركة" onClick={() => props.onShare(video)}>
          <Share2 className="size-7" aria-hidden="true" />
        </RailButton>
        <RailButton label="إبلاغ عن هذا الفيديو" onClick={() => props.onReport(video)}>
          <Flag className="size-7" aria-hidden="true" />
        </RailButton>
        <RailButton label="خيارات إضافية" onClick={() => props.onMore(video)}>
          <MoreHorizontal className="size-7" aria-hidden="true" />
        </RailButton>
      </div>

      <div className="pointer-events-none absolute inset-x-0 bottom-0 z-[4] h-[2px] bg-white/15" aria-hidden="true">
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
      onPointerDown={stopPropagation}
      onPointerUp={stopPropagation}
      className="flex flex-col items-center gap-0.5 text-white transition-transform active:scale-90"
    >
      <span className="grid size-9 place-items-center drop-shadow-[0_2px_6px_rgba(0,0,0,0.65)]">{children}</span>
      {count !== undefined ? (
        <span className="text-[11px] font-semibold tabular-nums" style={{ textShadow: "0 1px 6px rgba(0,0,0,0.8)" }}>
          {formatCount(count)}
        </span>
      ) : null}
    </button>
  );
}

function HeartBurst({ x, y }: { x: number; y: number }) {
  return (
    <span className="heart-pop pointer-events-none absolute z-[6] text-danger" style={{ left: x, top: y }} aria-hidden="true">
      <Heart className="size-24 fill-danger drop-shadow-[0_4px_18px_rgba(0,0,0,0.5)]" />
    </span>
  );
}

export function formatCount(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1).replace(/\.0$/, "")}م`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1).replace(/\.0$/, "")}ألف`;
  return new Intl.NumberFormat("ar").format(value);
}
