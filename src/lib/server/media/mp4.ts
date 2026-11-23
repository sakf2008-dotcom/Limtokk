/**
 * Minimal, defensive MP4/QuickTime (ISO BMFF) inspector.
 *
 * Purpose: verify an uploaded file's real container structure on the server, not just its declared
 * MIME type or extension. It reads only box headers and the small metadata boxes it needs
 * (ftyp, moov/mvhd, moov/trak/tkhd, mdia/hdlr, stsd). It never decodes media, and it never reads
 * the large mdat payload.
 *
 * Note: this is a structural check. It does not guarantee the video is safe or appropriate.
 * Human review is still required before publication.
 */

export interface RangeReader {
  /** Total size of the object in bytes. */
  readonly size: number;
  /** Reads `length` bytes starting at `start`. Must return exactly `length` bytes. */
  read(start: number, length: number): Promise<Uint8Array>;
}

export interface Mp4Probe {
  brand: string;
  durationMs: number;
  timescale: number;
  width: number | null;
  height: number | null;
  videoCodec: string;
}

export type ProbeReason =
  | "not_mp4"
  | "unsupported_brand"
  | "no_moov"
  | "moov_too_large"
  | "invalid_box"
  | "too_many_boxes"
  | "no_video_track"
  | "unsupported_codec"
  | "invalid_duration"
  | "invalid_dimensions";

export class MediaProbeError extends Error {
  constructor(readonly reason: ProbeReason) {
    super(`media probe failed: ${reason}`);
    this.name = "MediaProbeError";
  }
}

/** Brands we accept as "MP4 family" for video (MPEG-4 and QuickTime/MOV, as recorded by iPhones). */
const ACCEPTED_BRANDS = new Set(["isom", "iso2", "iso4", "iso5", "iso6", "mp41", "mp42", "avc1", "M4V ", "qt  "]);
/** Video sample entries that browsers on iOS and desktop can play. */
const ACCEPTED_VIDEO_CODECS = new Set(["avc1", "avc3", "hvc1", "hev1"]);

const MAX_TOP_LEVEL_BOXES = 256;
const MAX_MOOV_BYTES = 8 * 1024 * 1024;
const MAX_NESTING = 8;

interface BoxHeader {
  type: string;
  start: number;
  headerSize: number;
  size: number;
}

function fourcc(bytes: Uint8Array, offset: number): string {
  return String.fromCharCode(
    bytes[offset] ?? 0,
    bytes[offset + 1] ?? 0,
    bytes[offset + 2] ?? 0,
    bytes[offset + 3] ?? 0,
  );
}

function u32(bytes: Uint8Array, offset: number): number {
  if (offset < 0 || offset + 4 > bytes.length) throw new MediaProbeError("invalid_box");
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(offset);
}

function u64(bytes: Uint8Array, offset: number): bigint {
  if (offset < 0 || offset + 8 > bytes.length) throw new MediaProbeError("invalid_box");
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getBigUint64(offset);
}

/** Reads the box headers of the whole file. Only headers are read, never payloads like mdat. */
async function readTopLevelBoxes(reader: RangeReader): Promise<BoxHeader[]> {
  const boxes: BoxHeader[] = [];
  let position = 0;
  while (position < reader.size) {
    if (boxes.length >= MAX_TOP_LEVEL_BOXES) throw new MediaProbeError("too_many_boxes");
    const remaining = reader.size - position;
    if (remaining < 8) throw new MediaProbeError("invalid_box");
    const header = await reader.read(position, Math.min(16, remaining));
    let size = u32(header, 0);
    const type = fourcc(header, 4);
    let headerSize = 8;
    if (size === 1) {
      if (header.length < 16) throw new MediaProbeError("invalid_box");
      const large = u64(header, 8);
      if (large > BigInt(Number.MAX_SAFE_INTEGER)) throw new MediaProbeError("invalid_box");
      size = Number(large);
      headerSize = 16;
    } else if (size === 0) {
      size = remaining; // box extends to the end of the file
    }
    if (size < headerSize || position + size > reader.size) throw new MediaProbeError("invalid_box");
    boxes.push({ type, start: position, headerSize, size });
    position += size;
  }
  return boxes;
}

/** Parses child boxes that are fully contained in an in-memory buffer. */
function parseChildren(bytes: Uint8Array, from: number, to: number): BoxHeader[] {
  const boxes: BoxHeader[] = [];
  let position = from;
  while (position < to) {
    if (boxes.length >= MAX_TOP_LEVEL_BOXES) throw new MediaProbeError("too_many_boxes");
    if (to - position < 8) throw new MediaProbeError("invalid_box");
    let size = u32(bytes, position);
    const type = fourcc(bytes, position + 4);
    let headerSize = 8;
    if (size === 1) {
      const large = u64(bytes, position + 8);
      if (large > BigInt(Number.MAX_SAFE_INTEGER)) throw new MediaProbeError("invalid_box");
      size = Number(large);
      headerSize = 16;
    } else if (size === 0) {
      size = to - position;
    }
    if (size < headerSize || position + size > to) throw new MediaProbeError("invalid_box");
    boxes.push({ type, start: position, headerSize, size });
    position += size;
  }
  return boxes;
}

interface TrackInfo {
  handler: string | null;
  width: number | null;
  height: number | null;
  codec: string | null;
}

function parseTrack(bytes: Uint8Array, box: BoxHeader, depth: number): TrackInfo {
  const info: TrackInfo = { handler: null, width: null, height: null, codec: null };
  const payloadStart = box.start + box.headerSize;
  const payloadEnd = box.start + box.size;
  for (const child of parseChildren(bytes, payloadStart, payloadEnd)) {
    const childPayload = child.start + child.headerSize;
    if (child.type === "tkhd") {
      const version = bytes[childPayload] ?? 0;
      // Width and height are 16.16 fixed-point numbers near the end of the box.
      const widthOffset = version === 1 ? 88 : 76;
      info.width = u32(bytes, childPayload + widthOffset) / 65536;
      info.height = u32(bytes, childPayload + widthOffset + 4) / 65536;
    } else if (child.type === "mdia" && depth < MAX_NESTING) {
      for (const media of parseChildren(bytes, childPayload, child.start + child.size)) {
        const mediaPayload = media.start + media.headerSize;
        if (media.type === "hdlr") {
          info.handler = fourcc(bytes, mediaPayload + 8);
        } else if (media.type === "minf" && depth < MAX_NESTING) {
          for (const minfChild of parseChildren(bytes, mediaPayload, media.start + media.size)) {
            if (minfChild.type !== "stbl") continue;
            for (const stblChild of parseChildren(
              bytes,
              minfChild.start + minfChild.headerSize,
              minfChild.start + minfChild.size,
            )) {
              if (stblChild.type !== "stsd") continue;
              // stsd: version+flags (4), entry_count (4), then the first sample entry: size (4), type (4).
              const entryType = fourcc(bytes, stblChild.start + stblChild.headerSize + 12);
              info.codec = info.codec ?? entryType;
            }
          }
        }
      }
    }
  }
  return info;
}

/** Full structural probe of an MP4/MOV object. Throws MediaProbeError with a reason on failure. */
export async function probeMp4(reader: RangeReader): Promise<Mp4Probe> {
  if (reader.size < 32) throw new MediaProbeError("not_mp4");
  // Fail fast with the clearest reason: a real MP4/MOV always starts with an ftyp box.
  const head = await reader.read(0, 8);
  if (fourcc(head, 4) !== "ftyp") throw new MediaProbeError("not_mp4");

  const topLevel = await readTopLevelBoxes(reader);
  const first = topLevel[0];
  if (!first || first.type !== "ftyp") throw new MediaProbeError("not_mp4");

  const ftyp = await reader.read(first.start + first.headerSize, first.size - first.headerSize);
  if (ftyp.length < 8) throw new MediaProbeError("not_mp4");
  const major = fourcc(ftyp, 0);
  const compatible: string[] = [];
  for (let offset = 8; offset + 4 <= ftyp.length; offset += 4) compatible.push(fourcc(ftyp, offset));
  if (!ACCEPTED_BRANDS.has(major) && !compatible.some((brand) => ACCEPTED_BRANDS.has(brand))) {
    throw new MediaProbeError("unsupported_brand");
  }

  const moov = topLevel.find((box) => box.type === "moov");
  if (!moov) throw new MediaProbeError("no_moov");
  if (moov.size > MAX_MOOV_BYTES) throw new MediaProbeError("moov_too_large");

  const moovBytes = await reader.read(moov.start, moov.size);
  const moovChildren = parseChildren(moovBytes, moov.headerSize, moov.size);

  const mvhd = moovChildren.find((box) => box.type === "mvhd");
  if (!mvhd) throw new MediaProbeError("invalid_box");
  const mvhdPayload = mvhd.start + mvhd.headerSize;
  const mvhdVersion = moovBytes[mvhdPayload] ?? 0;
  let timescale: number;
  let duration: number;
  if (mvhdVersion === 1) {
    timescale = u32(moovBytes, mvhdPayload + 20);
    duration = Number(u64(moovBytes, mvhdPayload + 24));
  } else {
    timescale = u32(moovBytes, mvhdPayload + 12);
    duration = u32(moovBytes, mvhdPayload + 16);
  }
  if (timescale <= 0 || duration <= 0) throw new MediaProbeError("invalid_duration");
  const durationMs = Math.round((duration * 1000) / timescale);

  const tracks = moovChildren
    .filter((box) => box.type === "trak")
    .map((box) => parseTrack(moovBytes, box, 0));
  const video = tracks.find((track) => track.handler === "vide");
  if (!video) throw new MediaProbeError("no_video_track");
  if (!video.codec || !ACCEPTED_VIDEO_CODECS.has(video.codec)) {
    throw new MediaProbeError("unsupported_codec");
  }
  const width = video.width !== null ? Math.round(video.width) : null;
  const height = video.height !== null ? Math.round(video.height) : null;
  if (width !== null && height !== null && (width <= 0 || height <= 0 || width > 4096 || height > 4096)) {
    throw new MediaProbeError("invalid_dimensions");
  }

  return {
    brand: major.trim(),
    durationMs,
    timescale,
    width,
    height,
    videoCodec: video.codec,
  };
}
