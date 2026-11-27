import type { Metadata } from "next";
import Link from "next/link";
import { Search, Sparkles } from "lucide-react";
import { getDb } from "@/lib/server/db/client";
import { listCategories, listPlaylists } from "@/lib/server/repo/catalog";
import { fetchFeed, getFeaturedVideos, trendingTags } from "@/lib/server/repo/videos";
import { VideoTile } from "@/components/video/VideoTile";
import { CategoryIcon } from "@/components/ui/CategoryIcon";
import { Chip, EmptyState } from "@/components/ui/ui";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "استكشف", description: "تصفح التصنيفات والمسارات التعليمية والوسوم الشائعة." };

export default async function ExplorePage() {
  const db = await getDb();
  const [categories, tags, playlists, featured, latest] = await Promise.all([
    listCategories(db),
    trendingTags(db, 12),
    listPlaylists(db),
    getFeaturedVideos(db, 8, null),
    fetchFeed(db, { tab: "latest", categoryId: null, preferCategories: [], offset: 0, limit: 6, deviceHash: null, now: new Date() }),
  ]);

  return (
    <main className="min-h-dvh px-4 pb-28" style={{ paddingTop: "calc(var(--safe-top) + 1rem)" }}>
      <header className="mb-5 flex flex-col gap-4">
        <h1 className="text-2xl font-bold">استكشف</h1>
        <Link href="/search" className="flex h-12 items-center gap-3 rounded-2xl bg-white/[0.06] px-4 text-sm text-muted ring-1 ring-white/10 hover:bg-white/10">
          <Search className="size-5" aria-hidden="true" />
          ابحث عن موضوع أو وسم أو اسم صاحب محتوى…
        </Link>
      </header>

      <section aria-labelledby="trending-title" className="mb-8">
        <h2 id="trending-title" className="mb-3 flex items-center gap-2 text-lg font-semibold">
          <Sparkles className="size-5 text-brand" aria-hidden="true" />
          مواضيع متداولة
        </h2>
        {tags.length > 0 ? (
          <div className="no-scrollbar -mx-4 flex gap-2 overflow-x-auto px-4 pb-1">
            {tags.map((tag) => (
              <Chip key={tag.tag} href={`/search?tag=${encodeURIComponent(tag.tag)}`}>
                #{tag.tag}
              </Chip>
            ))}
          </div>
        ) : (
          <p className="text-sm text-muted">ستظهر المواضيع المتداولة بعد نشر فيديوهات بوسوم.</p>
        )}
        <p className="mt-2 text-[11px] text-muted">ترتيب الوسوم حسب عدد الفيديوهات المنشورة التي تستخدمها، وليس توقعًا للشعبية.</p>
      </section>

      <section aria-labelledby="categories-title" className="mb-8">
        <h2 id="categories-title" className="mb-3 text-lg font-semibold">
          التصنيفات
        </h2>
        <div className="grid grid-cols-2 gap-3">
          {categories.map((category) => (
            <Link
              key={category.id}
              href={`/category/${category.id}`}
              className="group relative overflow-hidden rounded-2xl bg-surface p-4 ring-1 ring-white/10 transition-transform active:scale-[0.98]"
            >
              <span className="absolute -start-6 -top-6 size-24 rounded-full bg-brand opacity-25 blur-2xl transition-opacity group-hover:opacity-40" aria-hidden="true" />
              <span className="relative grid size-11 place-items-center rounded-2xl bg-brand text-ink">
                <CategoryIcon name={category.icon} />
              </span>
              <h3 className="relative mt-3 text-[15px] font-semibold">{category.nameAr}</h3>
              <p className="relative mt-1 line-clamp-2 text-xs leading-5 text-muted">{category.descriptionAr}</p>
            </Link>
          ))}
        </div>
      </section>

      {featured.length > 0 ? (
        <section aria-labelledby="featured-title" className="mb-8">
          <h2 id="featured-title" className="mb-3 text-lg font-semibold">
            مختارات المحرّرين
          </h2>
          <div className="no-scrollbar -mx-4 flex snap-x gap-3 overflow-x-auto px-4 pb-2">
            {featured.map((video) => (
              <div key={video.id} className="w-40 shrink-0 snap-start">
                <VideoTile video={video} />
              </div>
            ))}
          </div>
        </section>
      ) : null}

      {playlists.length > 0 ? (
        <section aria-labelledby="playlists-title" className="mb-8">
          <h2 id="playlists-title" className="mb-3 text-lg font-semibold">
            مسارات تعلّم
          </h2>
          <ul className="flex flex-col gap-3">
            {playlists.map((playlist) => (
              <li key={playlist.slug}>
                <Link href={`/playlist/${playlist.slug}`} className="flex items-center justify-between gap-3 rounded-2xl bg-surface p-4 ring-1 ring-white/10 hover:bg-surface-2">
                  <span className="min-w-0">
                    <span className="block font-semibold">{playlist.titleAr}</span>
                    <span className="mt-1 block text-xs leading-5 text-muted">{playlist.descriptionAr}</span>
                  </span>
                  <span className="shrink-0 rounded-full bg-white/10 px-2.5 py-1 text-xs">{playlist.videoCount} فيديو</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section aria-labelledby="latest-title">
        <h2 id="latest-title" className="mb-3 text-lg font-semibold">
          أحدث الإضافات
        </h2>
        {latest.length === 0 ? (
          <EmptyState icon={<Sparkles className="size-7" aria-hidden="true" />} title="لا توجد إضافات بعد" text="أول فيديو منشور سيظهر هنا." />
        ) : (
          <div className="grid grid-cols-2 gap-3">
            {latest.map((video) => (
              <VideoTile key={video.id} video={video} />
            ))}
          </div>
        )}
      </section>
    </main>
  );
}
