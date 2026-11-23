import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getDb } from "@/lib/server/db/client";
import { getCategory } from "@/lib/server/repo/catalog";
import { searchVideos } from "@/lib/server/repo/videos";
import { LoadMoreGrid } from "@/components/video/LoadMoreGrid";
import { CategoryIcon } from "@/components/ui/CategoryIcon";
import { EmptyState } from "@/components/ui/ui";
import { Sparkles } from "lucide-react";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  if (!/^[a-z0-9-]{2,40}$/.test(slug)) return { title: "التصنيف" };
  const category = await getCategory(await getDb(), slug);
  return { title: category ? `${category.nameAr}` : "التصنيف" };
}

export default async function CategoryPage({ params }: Props) {
  const { slug } = await params;
  if (!/^[a-z0-9-]{2,40}$/.test(slug)) notFound();
  const db = await getDb();
  const category = await getCategory(db, slug);
  if (!category) notFound();

  const videos = await searchVideos(db, {
    text: null,
    categoryId: category.id,
    tag: null,
    creatorId: null,
    offset: 0,
    limit: 12,
    deviceHash: null,
  });

  return (
    <main className="min-h-dvh px-4 pb-28" style={{ paddingTop: "calc(var(--safe-top) + 1rem)" }}>
      <header className="mb-6 flex items-center gap-4">
        <span className="grid size-14 shrink-0 place-items-center rounded-2xl text-ink" style={{ background: category.accent }}>
          <CategoryIcon name={category.icon} className="size-7" />
        </span>
        <div className="min-w-0">
          <h1 className="text-2xl font-bold">{category.nameAr}</h1>
          <p className="mt-1 text-sm leading-6 text-muted">{category.descriptionAr}</p>
        </div>
      </header>

      {videos.length === 0 ? (
        <EmptyState icon={<Sparkles className="size-7" aria-hidden="true" />} title="لا توجد فيديوهات في هذا التصنيف بعد" text="عند نشر فيديو جديد في هذا التصنيف سيظهر هنا." />
      ) : (
        <LoadMoreGrid
          initialItems={videos}
          initialNext={videos.length === 12 ? 12 : null}
          endpoint={`/api/search?category=${encodeURIComponent(category.id)}`}
          itemsKey="items"
        />
      )}
    </main>
  );
}
