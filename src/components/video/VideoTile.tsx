import Link from "next/link";
import { formatCount } from "@/components/feed/format";

export interface TileVideo {
  id: string;
  title: string;
  posterUrl: string | null;
  categoryName: string;
  categoryAccent: string;
  creator: { name: string };
  viewCount: number;
  isDemo: boolean;
}

/** Poster-first tile used in grids. Server-renderable (no client state). */
export function VideoTile({ video }: { video: TileVideo }) {
  return (
    <Link
      href={`/?v=${video.id}`}
      className="group relative block aspect-[9/14] overflow-hidden rounded-2xl bg-surface-2 ring-1 ring-white/10 transition-transform active:scale-[0.98]"
      aria-label={`${video.title} — ${video.creator.name}`}
    >
      {video.posterUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={video.posterUrl} alt="" loading="lazy" decoding="async" className="absolute inset-0 size-full object-cover transition-transform duration-500 group-hover:scale-105" />
      ) : (
        <div className="absolute inset-0" style={{ background: `linear-gradient(160deg, ${video.categoryAccent}, #0d1017 75%)` }} aria-hidden="true" />
      )}
      <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/15 to-black/10" aria-hidden="true" />
      <div className="absolute inset-x-3 bottom-3 flex flex-col gap-1.5">
        <span className="inline-flex w-fit items-center rounded-full px-2 py-0.5 text-[10px] font-semibold text-ink" style={{ background: video.categoryAccent }}>
          {video.categoryName}
        </span>
        <p className="line-clamp-2 text-[13px] font-semibold leading-5 text-white">{video.title}</p>
        <p className="flex items-center gap-1 text-[11px] text-white/75">
          <span className="truncate">@{video.creator.name}</span>
          <span aria-hidden="true">·</span>
          <span className="shrink-0">{formatCount(video.viewCount)} مشاهدة</span>
        </p>
        {video.isDemo ? <span className="text-[10px] text-white/60">محتوى تجريبي</span> : null}
      </div>
    </Link>
  );
}
