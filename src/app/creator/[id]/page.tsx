import type { Metadata } from "next";
import type { ReactNode } from "react";
import { notFound } from "next/navigation";
import { Eye, Heart, ShieldAlert, Film } from "lucide-react";
import { getDb } from "@/lib/server/db/client";
import { isUuid } from "@/lib/server/db/params";
import { getCreatorProfile, searchVideos } from "@/lib/server/repo/videos";
import { LoadMoreGrid } from "@/components/video/LoadMoreGrid";
import { Avatar, EmptyState } from "@/components/ui/ui";
import { formatCount } from "@/components/feed/format";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ id: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params;
  if (!isUuid(id)) return { title: "صفحة صاحب المحتوى" };
  const profile = await getCreatorProfile(await getDb(), id);
  return { title: profile ? `${profile.display_name} (باسم مستعار)` : "صفحة صاحب المحتوى" };
}

export default async function CreatorPage({ params }: Props) {
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const db = await getDb();
  const profile = await getCreatorProfile(db, id);
  if (!profile) notFound();

  const videos = await searchVideos(db, {
    text: null,
    categoryId: null,
    tag: null,
    creatorId: id,
    offset: 0,
    limit: 12,
    deviceHash: null,
  });

  return (
    <main className="min-h-dvh px-4 pb-28" style={{ paddingTop: "calc(var(--safe-top) + 1rem)" }}>
      <header className="flex flex-col items-center gap-3 text-center">
        <Avatar avatarKey={profile.avatar_key} name={profile.display_name} size={84} ring />
        <h1 className="text-2xl font-bold">@{profile.display_name}</h1>
        <p className="inline-flex items-center gap-1.5 rounded-full bg-white/[0.06] px-3 py-1 text-xs text-muted ring-1 ring-white/10">
          <ShieldAlert className="size-3.5" aria-hidden="true" />
          اسم مستعار غير موثّق. لا يدل على هوية شخص بعينه.
        </p>
      </header>

      <dl className="mt-6 grid grid-cols-3 gap-3 text-center">
        <Stat icon={<Film className="size-4" aria-hidden="true" />} label="فيديوهات منشورة" value={formatCount(Number(profile.video_count))} />
        <Stat icon={<Eye className="size-4" aria-hidden="true" />} label="إجمالي المشاهدات" value={formatCount(Number(profile.total_views))} />
        <Stat icon={<Heart className="size-4" aria-hidden="true" />} label="إجمالي الإعجابات" value={formatCount(Number(profile.total_likes))} />
      </dl>

      <section className="mt-8" aria-labelledby="creator-videos">
        <h2 id="creator-videos" className="mb-3 text-lg font-semibold">
          الفيديوهات
        </h2>
        {videos.length === 0 ? (
          <EmptyState icon={<Film className="size-7" aria-hidden="true" />} title="لا توجد فيديوهات منشورة" text="تظهر الفيديوهات هنا بعد اعتمادها من فريق المراجعة." />
        ) : (
          <LoadMoreGrid
            initialItems={videos}
            initialNext={videos.length === 12 ? 12 : null}
            endpoint={`/api/creators/${id}`}
            itemsKey="videos"
          />
        )}
      </section>
    </main>
  );
}

function Stat({ icon, label, value }: { icon: ReactNode; label: string; value: string }) {
  return (
    <div className="rounded-2xl bg-surface p-3 ring-1 ring-white/10">
      <dt className="flex items-center justify-center gap-1 text-[11px] text-muted">
        {icon}
        {label}
      </dt>
      <dd className="mt-1 text-lg font-bold tabular-nums">{value}</dd>
    </div>
  );
}
