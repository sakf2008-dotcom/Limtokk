"use client";

import Link from "next/link";
import { useState } from "react";
import { Bookmark, GraduationCap, Lightbulb, Trash2, UserMinus, Users } from "lucide-react";
import { LOCAL_KEYS, useLocal } from "@/lib/client/local";
import { type FollowedCreator, type SavedFact, type SavedVideo } from "@/lib/client/library";
import { Avatar, Chip, EmptyState } from "@/components/ui/ui";

type Tab = "videos" | "facts" | "follows";

export function SavedClient() {
  const [tab, setTab] = useState<Tab>("videos");
  const [saved, setSaved] = useLocal<SavedVideo[]>(LOCAL_KEYS.saved, []);
  const [facts, setFacts] = useLocal<SavedFact[]>(LOCAL_KEYS.facts, []);
  const [follows, setFollows] = useLocal<FollowedCreator[]>(LOCAL_KEYS.follows, []);

  const tabs: Array<{ id: Tab; label: string; count: number }> = [
    { id: "videos", label: "فيديوهات", count: saved.length },
    { id: "facts", label: "معلومات", count: facts.length },
    { id: "follows", label: "متابَعون", count: follows.length },
  ];

  return (
    <main className="min-h-dvh px-4 pb-28" style={{ paddingTop: "calc(var(--safe-top) + 1rem)" }}>
      <header className="mb-4 flex items-center justify-between gap-3">
        <h1 className="text-2xl font-bold">المحفوظات</h1>
        <Link href="/learn" className="inline-flex h-9 items-center gap-2 rounded-full bg-white/[0.07] px-3 text-sm ring-1 ring-white/10">
          <GraduationCap className="size-4 text-brand" aria-hidden="true" />
          مركز التعلّم
        </Link>
      </header>

      <div role="tablist" aria-label="أقسام المحفوظات" className="mb-5 flex gap-2">
        {tabs.map((item) => (
          <Chip key={item.id} active={tab === item.id} onClick={() => setTab(item.id)}>
            {item.label} <span className="opacity-70">({item.count})</span>
          </Chip>
        ))}
      </div>

      {tab === "videos" ? (
        saved.length === 0 ? (
          <EmptyState icon={<Bookmark className="size-7" aria-hidden="true" />} title="لا توجد فيديوهات محفوظة" text="اضغط زر الحفظ على أي فيديو لتجده هنا لاحقًا." action={<Link href="/" className="inline-flex h-11 items-center rounded-2xl bg-brand px-5 text-sm font-semibold text-ink">تصفّح الفيديوهات</Link>} />
        ) : (
          <ul className="flex flex-col gap-3">
            {saved.map((item) => (
              <li key={item.id} className="flex items-center gap-3 rounded-2xl bg-surface p-3 ring-1 ring-white/10">
                <Link href={`/?v=${item.id}`} className="flex min-w-0 flex-1 items-center gap-3">
                  <span className="relative aspect-[9/14] w-16 shrink-0 overflow-hidden rounded-xl bg-surface-2">
                    {item.posterUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={item.posterUrl} alt="" className="absolute inset-0 size-full object-cover" loading="lazy" />
                    ) : null}
                  </span>
                  <span className="min-w-0">
                    <span className="line-clamp-2 block text-sm font-semibold">{item.title}</span>
                    <span className="mt-1 block truncate text-xs text-muted">{item.categoryName} · @{item.creatorName}</span>
                  </span>
                </Link>
                <button type="button" aria-label={`إزالة ${item.title} من المحفوظات`} onClick={() => setSaved((previous) => previous.filter((entry) => entry.id !== item.id))} className="grid size-10 shrink-0 place-items-center rounded-full bg-white/[0.06] text-muted hover:text-danger">
                  <Trash2 className="size-4" aria-hidden="true" />
                </button>
              </li>
            ))}
          </ul>
        )
      ) : null}

      {tab === "facts" ? (
        facts.length === 0 ? (
          <EmptyState icon={<Lightbulb className="size-7" aria-hidden="true" />} title="لا توجد معلومات محفوظة" text="عند مشاهدة فيديو يحتوي على معلومة أساسية، اضغط «احفظها» لتجمعها هنا." />
        ) : (
          <ul className="flex flex-col gap-3">
            {facts.map((fact) => (
              <li key={fact.videoId} className="rounded-2xl bg-surface p-4 ring-1 ring-white/10">
                <p className="flex items-start gap-2 text-[15px] leading-7">
                  <Lightbulb className="mt-1.5 size-4 shrink-0 text-brand" aria-hidden="true" />
                  <span>{fact.text}</span>
                </p>
                <div className="mt-3 flex items-center justify-between gap-2 text-xs text-muted">
                  <Link href={`/?v=${fact.videoId}`} className="truncate font-semibold text-text">
                    من: {fact.videoTitle}
                  </Link>
                  <button type="button" onClick={() => setFacts((previous) => previous.filter((entry) => entry.videoId !== fact.videoId))} className="shrink-0 font-semibold text-danger">
                    حذف
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )
      ) : null}

      {tab === "follows" ? (
        follows.length === 0 ? (
          <EmptyState icon={<Users className="size-7" aria-hidden="true" />} title="لم تتابع أحدًا بعد" text="المتابعة تُحفظ على هذا الجهاز فقط، وتساعدك على تذكر أصحاب المحتوى الذين تفضّلهم." />
        ) : (
          <ul className="flex flex-col gap-2">
            {follows.map((creator) => (
              <li key={creator.id} className="flex items-center gap-3 rounded-2xl bg-surface p-3 ring-1 ring-white/10">
                <Link href={`/creator/${creator.id}`} className="flex min-w-0 flex-1 items-center gap-3">
                  <Avatar avatarKey={creator.avatar} name={creator.name} size={44} />
                  <span className="min-w-0">
                    <span className="block truncate font-semibold">@{creator.name}</span>
                    <span className="text-xs text-muted">اسم مستعار غير موثّق</span>
                  </span>
                </Link>
                <button type="button" onClick={() => setFollows((previous) => previous.filter((entry) => entry.id !== creator.id))} className="inline-flex h-9 items-center gap-1.5 rounded-full bg-white/[0.07] px-3 text-xs font-semibold">
                  <UserMinus className="size-3.5" aria-hidden="true" />
                  إلغاء
                </button>
              </li>
            ))}
          </ul>
        )
      ) : null}

      <p className="mt-8 text-center text-[11px] leading-6 text-muted">
        المحفوظات والمتابعات والمعلومات تُحفظ على هذا الجهاز فقط. مسح بيانات المتصفح يحذفها، ولا تنتقل تلقائيًا إلى جهاز آخر.
      </p>
    </main>
  );
}
