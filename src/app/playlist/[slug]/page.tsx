import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getDb } from "@/lib/server/db/client";
import { getPlaylistVideoIds } from "@/lib/server/repo/catalog";
import { getPublicVideosByIds } from "@/lib/server/repo/videos";
import { VideoTile } from "@/components/video/VideoTile";
import { EmptyState } from "@/components/ui/ui";
import { ListVideo } from "lucide-react";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  if (!/^[a-z0-9-]{3,60}$/.test(slug)) return { title: "مسار تعلّم" };
  const playlist = await getPlaylistVideoIds(await getDb(), slug);
  return { title: playlist?.title ?? "مسار تعلّم" };
}

export default async function PlaylistPage({ params }: Props) {
  const { slug } = await params;
  if (!/^[a-z0-9-]{3,60}$/.test(slug)) notFound();
  const db = await getDb();
  const playlist = await getPlaylistVideoIds(db, slug);
  if (!playlist) notFound();
  const videos = await getPublicVideosByIds(db, playlist.videoIds, null);

  return (
    <main className="min-h-dvh px-4 pb-28" style={{ paddingTop: "calc(var(--safe-top) + 1rem)" }}>
      <header className="mb-6">
        <p className="mb-2 inline-flex items-center gap-2 text-xs text-brand">
          <ListVideo className="size-4" aria-hidden="true" />
          مسار تعلّم
        </p>
        <h1 className="text-2xl font-bold">{playlist.title}</h1>
        <p className="mt-2 text-sm leading-7 text-muted">{playlist.description}</p>
      </header>
      {videos.length === 0 ? (
        <EmptyState icon={<ListVideo className="size-7" aria-hidden="true" />} title="لا توجد فيديوهات في هذا المسار بعد" />
      ) : (
        <ol className="grid grid-cols-2 gap-3">
          {videos.map((video, index) => (
            <li key={video.id} className="relative">
              <span className="absolute start-2 top-2 z-10 grid size-6 place-items-center rounded-full bg-brand text-xs font-bold text-ink">{index + 1}</span>
              <VideoTile video={video} />
            </li>
          ))}
        </ol>
      )}
    </main>
  );
}
