/**
 * HTTP Range parsing for media responses. iOS Safari requires byte-range support before it will
 * play a <video> element, so every media route must honor these headers.
 *
 * Supports: "bytes=start-end", "bytes=start-", and suffix ranges "bytes=-n".
 * Multi-range requests are not supported and fall back to a full response.
 */

export type ParsedRange =
  | { kind: "full" }
  | { kind: "partial"; start: number; end: number }
  | { kind: "unsatisfiable" };

export function parseRange(header: string | null, size: number): ParsedRange {
  if (!header) return { kind: "full" };
  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!match) return { kind: "full" };
  const [, startRaw = "", endRaw = ""] = match;

  if (startRaw === "" && endRaw === "") return { kind: "full" };

  if (startRaw === "") {
    // Suffix range: the last N bytes.
    const suffix = Number(endRaw);
    if (suffix <= 0 || size === 0) return { kind: "unsatisfiable" };
    const start = Math.max(0, size - suffix);
    return { kind: "partial", start, end: size - 1 };
  }

  const start = Number(startRaw);
  const end = endRaw === "" ? size - 1 : Math.min(Number(endRaw), size - 1);
  if (!Number.isFinite(start) || !Number.isFinite(end) || start >= size || end < start) {
    return { kind: "unsatisfiable" };
  }
  return { kind: "partial", start, end };
}

/** Copies bytes into a standalone ArrayBuffer, the body type that `Response` accepts without casts. */
export function bodyFrom(bytes: Uint8Array): ArrayBuffer {
  const copy = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(copy).set(bytes);
  return copy;
}

export function contentTypeForKey(key: string): string {
  const ext = key.split(".").pop()?.toLowerCase() ?? "";
  if (ext === "mov") return "video/quicktime";
  if (ext === "jpg" || ext === "jpeg") return "image/jpeg";
  if (ext === "png") return "image/png";
  return "video/mp4";
}
