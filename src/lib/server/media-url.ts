import { getConfig } from "./config";

/**
 * Builds browser-facing URLs for stored media. Pure and non-throwing, so it is safe to call while
 * rendering lists even when uploads are disabled.
 *
 *  - "demo":   bundled sample videos served from /public (developer-controlled content).
 *  - "public": approved user uploads. Supabase public bucket URL, or the demo media route locally.
 *  - "pending" never has a public URL.
 */

export type MediaBucketTag = "demo" | "public" | "pending";

function encodeKeyPath(key: string): string {
  return key.split("/").map(encodeURIComponent).join("/");
}

export function publicMediaUrl(bucket: MediaBucketTag, key: string | null): string | null {
  if (!key) return null;
  if (bucket === "demo") return `/demo-media/${encodeKeyPath(key)}`;
  if (bucket === "public") {
    const config = getConfig();
    if (config.storageMode === "supabase" && config.supabaseUrl) {
      return `${config.supabaseUrl}/storage/v1/object/public/ilmtok-public/${encodeKeyPath(key)}`;
    }
    return `/api/media/ilmtok-public/${encodeKeyPath(key)}`;
  }
  return null;
}
