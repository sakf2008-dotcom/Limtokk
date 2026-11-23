"use client";

import { useState } from "react";
import { api, messageOf } from "@/lib/client/api";
import { Button } from "@/components/ui/ui";
import { VideoTile, type TileVideo } from "./VideoTile";

interface PageResponse {
  items?: TileVideo[];
  videos?: TileVideo[];
  nextOffset: number | null;
}

/**
 * Grid with "load more" pagination. `endpoint` already contains its query string (without offset).
 * `itemsKey` tells which field of the response holds the videos.
 */
export function LoadMoreGrid({
  initialItems,
  initialNext,
  endpoint,
  itemsKey,
}: {
  initialItems: TileVideo[];
  initialNext: number | null;
  endpoint: string;
  itemsKey: "items" | "videos";
}) {
  const [items, setItems] = useState(initialItems);
  const [nextOffset, setNextOffset] = useState(initialNext);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function loadMore() {
    if (nextOffset === null || loading) return;
    setLoading(true);
    setError("");
    try {
      const separator = endpoint.includes("?") ? "&" : "?";
      const page = await api<PageResponse>(`${endpoint}${separator}offset=${nextOffset}`);
      const received = (itemsKey === "items" ? page.items : page.videos) ?? [];
      setItems((previous) => {
        const seen = new Set(previous.map((item) => item.id));
        return [...previous, ...received.filter((item) => !seen.has(item.id))];
      });
      setNextOffset(page.nextOffset);
    } catch (caught) {
      setError(messageOf(caught));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex flex-col items-center gap-5">
      <div className="grid w-full grid-cols-2 gap-3 sm:grid-cols-3">
        {items.map((video) => (
          <VideoTile key={video.id} video={video} />
        ))}
      </div>
      {error ? <p role="alert" className="text-sm text-danger">{error}</p> : null}
      {nextOffset !== null ? (
        <Button variant="secondary" onClick={() => void loadMore()} disabled={loading}>
          {loading ? "جارٍ التحميل…" : "عرض المزيد"}
        </Button>
      ) : null}
    </div>
  );
}
