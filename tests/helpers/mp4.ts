/** Builds small, structurally valid MP4 files for tests. No media is decoded anywhere. */
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

export function buildMp4(options: { durationMs?: number; width?: number; height?: number; padBytes?: number } = {}): Buffer {
  const timescale = 1000;
  const duration = options.durationMs ?? 5000;
  const width = options.width ?? 720;
  const height = options.height ?? 1280;
  const ftyp = box("ftyp", Buffer.from("isom", "latin1"), u32(512), Buffer.from("isom", "latin1"), Buffer.from("mp41", "latin1"));
  const mvhd = box("mvhd", u32(0), u32(0), u32(0), u32(timescale), u32(duration), Buffer.alloc(80));
  const tkhdPayload = Buffer.alloc(84);
  tkhdPayload.writeUInt32BE(width * 65536, 76);
  tkhdPayload.writeUInt32BE(height * 65536, 80);
  const tkhd = box("tkhd", tkhdPayload);
  const hdlr = box("hdlr", u32(0), u32(0), Buffer.from("vide", "latin1"), Buffer.alloc(12));
  const stsd = box("stsd", u32(0), u32(1), box("avc1", Buffer.alloc(78)));
  const trak = box("trak", tkhd, box("mdia", hdlr, box("minf", box("stbl", stsd))));
  const moov = box("moov", mvhd, trak);
  const mdat = box("mdat", Buffer.alloc(options.padBytes ?? 4096, 1));
  return Buffer.concat([ftyp, moov, mdat]);
}
