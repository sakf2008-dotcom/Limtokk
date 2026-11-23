import { describe, expect, it } from "vitest";
import { MediaProbeError, probeMp4, type RangeReader } from "@/lib/server/media/mp4";

/** Builds an ISO-BMFF box: 32-bit size, 4-character type, payload. */
function box(type: string, ...parts: Buffer[]): Buffer {
  const payload = Buffer.concat(parts);
  const header = Buffer.alloc(8);
  header.writeUInt32BE(payload.length + 8, 0);
  header.write(type, 4, "latin1");
  return Buffer.concat([header, payload]);
}

function u32(value: number): Buffer {
  const buffer = Buffer.alloc(4);
  buffer.writeUInt32BE(value, 0);
  return buffer;
}

function ftyp(major = "isom", compatible: string[] = ["isom", "mp41"]): Buffer {
  return box("ftyp", Buffer.from(major.padEnd(4, " "), "latin1"), u32(512), ...compatible.map((brand) => Buffer.from(brand.padEnd(4, " "), "latin1")));
}

function mvhd(timescale: number, duration: number): Buffer {
  // version 0, flags 0, creation, modification, timescale, duration, then the rest of the box.
  return box("mvhd", u32(0), u32(0), u32(0), u32(timescale), u32(duration), Buffer.alloc(80));
}

function tkhd(width: number, height: number): Buffer {
  // Version 0 layout: width/height are 16.16 fixed-point at payload offset 76 and 80.
  const payload = Buffer.alloc(84);
  payload.writeUInt32BE(width * 65536, 76);
  payload.writeUInt32BE(height * 65536, 80);
  return box("tkhd", payload);
}

function hdlr(handler: string): Buffer {
  return box("hdlr", u32(0), u32(0), Buffer.from(handler, "latin1"), Buffer.alloc(12));
}

function stsd(codec: string): Buffer {
  const entry = box(codec, Buffer.alloc(78));
  return box("stsd", u32(0), u32(1), entry);
}

function track(handler: string, codec: string, width = 720, height = 1280): Buffer {
  const stbl = box("stbl", stsd(codec));
  const minf = box("minf", stbl);
  const mdia = box("mdia", hdlr(handler), minf);
  return box("trak", tkhd(width, height), mdia);
}

function movie(options: { timescale?: number; duration?: number; handler?: string; codec?: string; width?: number; height?: number } = {}): Buffer {
  const moov = box(
    "moov",
    mvhd(options.timescale ?? 1000, options.duration ?? 5000),
    track(options.handler ?? "vide", options.codec ?? "avc1", options.width ?? 720, options.height ?? 1280),
  );
  return Buffer.concat([ftyp(), moov, box("mdat", Buffer.alloc(256, 7))]);
}

function readerFor(bytes: Buffer): RangeReader {
  return {
    size: bytes.length,
    read: async (start: number, length: number) => {
      if (start < 0 || start + length > bytes.length) throw new Error("out of range read");
      return new Uint8Array(bytes.subarray(start, start + length));
    },
  };
}

async function reasonOf(bytes: Buffer): Promise<string> {
  try {
    await probeMp4(readerFor(bytes));
    return "accepted";
  } catch (error) {
    if (error instanceof MediaProbeError) return error.reason;
    throw error;
  }
}

describe("MP4/MOV structural probe", () => {
  it("accepts a valid H.264 MP4 and reports duration and dimensions", async () => {
    const probe = await probeMp4(readerFor(movie({ timescale: 1000, duration: 5000 })));
    expect(probe.durationMs).toBe(5000);
    expect(probe.width).toBe(720);
    expect(probe.height).toBe(1280);
    expect(probe.videoCodec).toBe("avc1");
    expect(probe.brand).toBe("isom");
  });

  it("accepts QuickTime (.mov) containers as recorded by iPhones", async () => {
    const bytes = Buffer.concat([
      ftyp("qt  ", ["qt  "]),
      box("moov", mvhd(600, 3000), track("vide", "hvc1")),
      box("mdat", Buffer.alloc(64)),
    ]);
    const probe = await probeMp4(readerFor(bytes));
    expect(probe.durationMs).toBe(5000);
    expect(probe.videoCodec).toBe("hvc1");
  });

  it("uses the timescale for fractional durations", async () => {
    const probe = await probeMp4(readerFor(movie({ timescale: 44100, duration: 44100 * 12 + 22050 })));
    expect(probe.durationMs).toBe(12_500);
  });

  it("rejects a file that is not an ISO-BMFF container", async () => {
    expect(await reasonOf(Buffer.from("this is plain text, not a video file at all, really"))).toBe("not_mp4");
  });

  it("rejects an unsupported brand", async () => {
    const bytes = Buffer.concat([box("ftyp", Buffer.from("3gp5", "latin1"), u32(0), Buffer.from("3gp5", "latin1")), box("moov", mvhd(1000, 5000), track("vide", "avc1")), box("mdat", Buffer.alloc(8))]);
    expect(await reasonOf(bytes)).toBe("unsupported_brand");
  });

  it("rejects a file without a moov box", async () => {
    const bytes = Buffer.concat([ftyp(), box("mdat", Buffer.alloc(64))]);
    expect(await reasonOf(bytes)).toBe("no_moov");
  });

  it("rejects audio-only files", async () => {
    expect(await reasonOf(movie({ handler: "soun" }))).toBe("no_video_track");
  });

  it("rejects codecs browsers cannot play", async () => {
    expect(await reasonOf(movie({ codec: "mp4v" }))).toBe("unsupported_codec");
  });

  it("rejects zero or missing durations", async () => {
    expect(await reasonOf(movie({ duration: 0 }))).toBe("invalid_duration");
  });

  it("rejects absurd dimensions", async () => {
    expect(await reasonOf(movie({ width: 9000 }))).toBe("invalid_dimensions");
  });

  it("rejects a box whose declared size runs past the end of the file (truncated upload)", async () => {
    const full = movie();
    const truncated = full.subarray(0, full.length - 100);
    expect(await reasonOf(truncated)).toBe("invalid_box");
  });

  it("rejects a malicious box that declares an impossible size", async () => {
    const bytes = Buffer.concat([ftyp(), Buffer.from([0xff, 0xff, 0xff, 0xff, 0x6d, 0x6f, 0x6f, 0x76])]);
    expect(await reasonOf(bytes)).toBe("invalid_box");
  });

  it("never reads the large mdat payload (reads only box headers and metadata)", async () => {
    const bytes = movie();
    const reads: Array<[number, number]> = [];
    const reader: RangeReader = {
      size: bytes.length,
      read: async (start, length) => {
        reads.push([start, length]);
        return new Uint8Array(bytes.subarray(start, start + length));
      },
    };
    await probeMp4(reader);
    const mdatStart = bytes.indexOf(Buffer.from("mdat", "latin1")) - 4;
    expect(reads.some(([start, length]) => start <= mdatStart && start + length > mdatStart + 16)).toBe(false);
  });
});
