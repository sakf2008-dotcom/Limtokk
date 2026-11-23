"use client";

import Link from "next/link";
import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { ArrowRight, Clock, Search, Trash2, Users, X } from "lucide-react";
import type { VideoCardDto } from "@/lib/domain/types";
import { api, messageOf } from "@/lib/client/api";
import { LOCAL_KEYS, useLocal } from "@/lib/client/local";
import { Avatar, Chip, EmptyState, Skeleton } from "@/components/ui/ui";
import { VideoTile } from "@/components/video/VideoTile";

interface CreatorHit {
  id: string;
  name: string;
  avatar: string;
  videoCount: number;
}

interface TrendingPayload {
  tags: Array<{ tag: string; uses: number }>;
}

type Kind = "videos" | "creators";

export function SearchClient() {
  return (
    <Suspense fallback={<Skeleton className="mx-4 h-12" />}>
      <SearchInner />
    </Suspense>
  );
}

function SearchInner() {
  const params = useSearchParams();
  const initialTag = params.get("tag");
  const initialQuery = params.get("q") ?? "";
  const [query, setQuery] = useState(initialTag ? `#${initialTag}` : initialQuery);
  const [kind, setKind] = useState<Kind>("videos");
  const [videos, setVideos] = useState<VideoCardDto[]>([]);
  const [creators, setCreators] = useState<CreatorHit[]>([]);
  const [status, setStatus] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [errorText, setErrorText] = useState("");
  const [trending, setTrending] = useState<TrendingPayload["tags"]>([]);
  const [recent, setRecent] = useLocal<string[]>(LOCAL_KEYS.searches, []);

  useEffect(() => {
    api<TrendingPayload>("/api/trending")
      .then((payload) => setTrending(payload.tags.slice(0, 10)))
      .catch(() => setTrending([]));
  }, []);

  useEffect(() => {
    const trimmed = query.trim().slice(0, 80);
    if (trimmed.length === 0) return;
    const timer = window.setTimeout(async () => {
      try {
        if (trimmed.startsWith("#")) {
          const tag = trimmed.slice(1);
          const payload = await api<{ items: VideoCardDto[] }>(`/api/search?tag=${encodeURIComponent(tag)}`);
          setVideos(payload.items);
          setCreators([]);
        } else if (kind === "videos") {
          const payload = await api<{ items: VideoCardDto[] }>(`/api/search?q=${encodeURIComponent(trimmed)}&type=videos`);
          setVideos(payload.items);
          setCreators([]);
        } else {
          const payload = await api<{ items: CreatorHit[] }>(`/api/search?q=${encodeURIComponent(trimmed)}&type=creators`);
          setCreators(payload.items);
          setVideos([]);
        }
        setErrorText("");
        setStatus("ready");
      } catch (error) {
        setErrorText(messageOf(error));
        setStatus("error");
      }
    }, 300);
    return () => window.clearTimeout(timer);
  }, [query, kind]);

  function remember(term: string) {
    const clean = term.trim().slice(0, 40);
    if (clean.length < 2) return;
    setRecent((previous) => [clean, ...previous.filter((item) => item !== clean)].slice(0, 8));
  }

  const hasQuery = query.trim().length > 0;
  // Results from an empty query are never shown, so there is no need to clear state for them.
  const shownVideos = hasQuery ? videos : [];
  const shownCreators = hasQuery ? creators : [];
  const hasResults = shownVideos.length > 0 || shownCreators.length > 0;

  return (
    <main className="min-h-dvh px-4 pb-28" style={{ paddingTop: "calc(var(--safe-top) + 0.75rem)" }}>
      <div className="sticky top-0 z-10 -mx-4 bg-ink/90 px-4 pb-3 pt-1 backdrop-blur-xl" style={{ paddingTop: "calc(var(--safe-top) + 0.5rem)" }}>
        <div className="flex items-center gap-2">
          <Link href="/explore" aria-label="رجوع" className="grid size-10 shrink-0 place-items-center rounded-full bg-white/[0.06] ring-1 ring-white/10">
            <ArrowRight className="size-5" aria-hidden="true" />
          </Link>
          <label className="relative flex-1">
            <span className="sr-only">ابحث في علم توك</span>
            <Search className="pointer-events-none absolute start-3.5 top-1/2 size-5 -translate-y-1/2 text-muted" aria-hidden="true" />
            <input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") remember(query);
              }}
              onBlur={() => remember(query)}
              placeholder="موضوع، وسم، أو اسم صاحب محتوى"
              enterKeyHint="search"
              className="h-11 w-full rounded-2xl bg-white/[0.07] ps-11 pe-10 text-[15px] outline-none ring-1 ring-white/10 focus:ring-brand [&::-webkit-search-cancel-button]:hidden"
            />
            {hasQuery ? (
              <button type="button" aria-label="مسح البحث" onClick={() => setQuery("")} className="absolute end-2 top-1/2 grid size-7 -translate-y-1/2 place-items-center rounded-full bg-white/10">
                <X className="size-4" aria-hidden="true" />
              </button>
            ) : null}
          </label>
        </div>
        {hasQuery && !query.trim().startsWith("#") ? (
          <div role="tablist" aria-label="نوع النتائج" className="mt-3 flex gap-2">
            <Chip active={kind === "videos"} onClick={() => setKind("videos")}>
              الفيديوهات
            </Chip>
            <Chip active={kind === "creators"} onClick={() => setKind("creators")}>
              <Users className="size-3.5" aria-hidden="true" />
              أصحاب المحتوى
            </Chip>
          </div>
        ) : null}
      </div>

      {!hasQuery ? (
        <div className="fade-in flex flex-col gap-7 pt-2">
          {recent.length > 0 ? (
            <section aria-labelledby="recent-title">
              <div className="mb-3 flex items-center justify-between">
                <h2 id="recent-title" className="flex items-center gap-2 font-semibold">
                  <Clock className="size-4 text-muted" aria-hidden="true" />
                  عمليات البحث الأخيرة
                </h2>
                <button type="button" onClick={() => setRecent([])} className="inline-flex items-center gap-1 text-xs text-muted hover:text-text">
                  <Trash2 className="size-3.5" aria-hidden="true" />
                  مسح
                </button>
              </div>
              <div className="flex flex-wrap gap-2">
                {recent.map((term) => (
                  <Chip key={term} onClick={() => setQuery(term)} small>
                    {term}
                  </Chip>
                ))}
              </div>
              <p className="mt-2 text-[11px] text-muted">تُحفظ عمليات البحث على هذا الجهاز فقط.</p>
            </section>
          ) : null}
          <section aria-labelledby="trend-title">
            <h2 id="trend-title" className="mb-3 font-semibold">
              مواضيع متداولة
            </h2>
            {trending.length > 0 ? (
              <div className="flex flex-wrap gap-2">
                {trending.map((item) => (
                  <Chip key={item.tag} onClick={() => setQuery(`#${item.tag}`)}>
                    #{item.tag}
                  </Chip>
                ))}
              </div>
            ) : (
              <p className="text-sm text-muted">ستظهر المواضيع المتداولة مع نشر الفيديوهات.</p>
            )}
          </section>
        </div>
      ) : null}

      {status === "loading" && !hasResults ? (
        <div className="mt-6 grid grid-cols-2 gap-3" aria-label="جارٍ البحث">
          <Skeleton className="aspect-[9/14]" />
          <Skeleton className="aspect-[9/14]" />
        </div>
      ) : null}

      {status === "error" ? <p role="alert" className="mt-6 text-sm text-danger">{errorText}</p> : null}

      {status === "ready" && !hasResults ? (
        <div className="mt-6">
          <EmptyState
            icon={<Search className="size-7" aria-hidden="true" />}
            title="لا توجد نتائج مطابقة"
            text="جرّب كلمات أبسط، أو ابحث عن تصنيف مثل «الفضاء» أو «الرياضيات». البحث يتجاهل الحركات والفروق في الهمزات."
          />
        </div>
      ) : null}

      {kind === "videos" && shownVideos.length > 0 ? (
        <div className="mt-6 grid grid-cols-2 gap-3">
          {shownVideos.map((video) => (
            <VideoTile key={video.id} video={video} />
          ))}
        </div>
      ) : null}

      {kind === "creators" && shownCreators.length > 0 ? (
        <ul className="mt-6 flex flex-col gap-2">
          {shownCreators.map((creator) => (
            <li key={creator.id}>
              <Link href={`/creator/${creator.id}`} className="flex items-center gap-3 rounded-2xl bg-surface p-3 ring-1 ring-white/10 hover:bg-surface-2">
                <Avatar avatarKey={creator.avatar} name={creator.name} size={44} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-semibold">@{creator.name}</span>
                  <span className="text-xs text-muted">{creator.videoCount} فيديو منشور · اسم مستعار غير موثّق</span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      ) : null}
    </main>
  );
}
