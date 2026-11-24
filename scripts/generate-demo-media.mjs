// Generates the bundled DEMO videos and posters in public/demo-media from src/lib/demo/catalog.json.
//  - Slides are rendered by Chromium (Playwright), so Arabic text is shaped correctly.
//  - The font is embedded as base64, so nothing is fetched from the network.
//  - ffmpeg encodes H.264 (yuv420p, faststart) with a quiet pad tone so the mute control is meaningful.
// Run with: npm run media:demo   (requires ffmpeg on PATH)
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const catalog = JSON.parse(readFileSync(join(root, "src/lib/demo/catalog.json"), "utf8"));
const outDir = join(root, "public/demo-media");
const SLIDE_SECONDS = 3.5; // must equal DEMO_SLIDE_MS in src/lib/server/db/demo-seed.ts
const FPS = 30;
const PREINSTALLED = "/opt/pw-browsers/chromium";

const CATEGORY = {
  science: { name: "العلوم", accent: "#34D399" },
  history: { name: "التاريخ", accent: "#F59E0B" },
  geography: { name: "الجغرافيا", accent: "#38BDF8" },
  space: { name: "الفضاء", accent: "#818CF8" },
  technology: { name: "التقنية", accent: "#22D3EE" },
  ai: { name: "الذكاء الاصطناعي", accent: "#C084FC" },
  math: { name: "الرياضيات", accent: "#F472B6" },
  health: { name: "الصحة", accent: "#4ADE80" },
  nature: { name: "الطبيعة", accent: "#A3E635" },
  general: { name: "معلومات عامة", accent: "#FBBF24" },
};

const fontFile = (weight) =>
  join(root, `node_modules/@fontsource/ibm-plex-sans-arabic/files/ibm-plex-sans-arabic-arabic-${weight}-normal.woff2`);
const fontFace = (weight) =>
  `@font-face{font-family:'Plex';font-weight:${weight};src:url(data:font/woff2;base64,${readFileSync(fontFile(weight)).toString("base64")}) format('woff2');}`;

function slideHtml(video, slide, index, total, accent, categoryName) {
  const pct = Math.round(((index + 1) / total) * 100);
  return `<!doctype html><html dir="rtl" lang="ar"><head><meta charset="utf-8"><style>
${fontFace(400)}${fontFace(700)}
html,body{margin:0;width:720px;height:1280px;overflow:hidden;font-family:'Plex',sans-serif;color:#f6f2ea}
body{background:radial-gradient(120% 60% at 50% 0%,${accent}66 0%,transparent 62%),linear-gradient(180deg,#121621 0%,#07080c 100%);
  display:flex;flex-direction:column;justify-content:center;padding:120px 72px;box-sizing:border-box;position:relative}
.brand{position:absolute;top:150px;right:72px;font-weight:700;font-size:30px;color:#f5b942}
.chip{align-self:flex-start;padding:10px 22px;border-radius:999px;background:${accent};color:#07080c;font-weight:700;font-size:26px;margin-bottom:34px}
.index{font-size:26px;color:#a6acbb;margin-bottom:18px}
h1{font-size:74px;line-height:1.28;margin:0 0 40px;font-weight:700}
p{font-size:44px;line-height:1.7;margin:0;color:#e9e4da;font-weight:400}
.note{position:absolute;bottom:72px;right:72px;font-size:24px;color:#a6acbb}
.bar{position:absolute;bottom:0;left:0;height:12px;width:${pct}%;background:#f5b942}
</style></head><body>
<div class="brand">علم توك</div>
<div class="chip">${categoryName}</div>
<div class="index" dir="ltr">${index + 1} / ${total}</div>
<h1>${slide.title}</h1>
<p>${slide.body}</p>
<div class="note">محتوى تجريبي من فريق علم توك</div>
<div class="bar"></div>
</body></html>`;
}

const ffmpeg = (args) => execFileSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", ...args], { stdio: ["ignore", "inherit", "inherit"] });

mkdirSync(outDir, { recursive: true });
const work = mkdtempSync(join(tmpdir(), "ilmtok-media-"));
const browser = await chromium.launch(existsSync(PREINSTALLED) ? { executablePath: PREINSTALLED } : {});

try {
  for (const video of catalog.videos) {
    const category = CATEGORY[video.categoryId] ?? { name: "معلومات عامة", accent: "#FBBF24" };
    const page = await browser.newPage({ viewport: { width: 720, height: 1280 }, deviceScaleFactor: 1.5 });
    const clips = [];
    for (const [index, slide] of video.slides.entries()) {
      await page.setContent(slideHtml(video, slide, index, video.slides.length, category.accent, category.name), { waitUntil: "load" });
      await page.evaluate(() => document.fonts.ready);
      const png = join(work, `${video.slug}-${index}.png`);
      await page.screenshot({ path: png, type: "png" });
      if (index === 0) {
        ffmpeg(["-i", png, "-vf", "scale=720:1280", "-q:v", "4", join(outDir, `${video.slug}.jpg`)]);
      }
            const clip = join(work, `${video.slug}-${index}.mp4`);
      ffmpeg([
        "-loop", "1", "-t", String(SLIDE_SECONDS), "-i", png,
        // Static frame with fades: identical frames compress extremely well, which keeps the repository small.
        "-vf", `fps=${FPS},fade=t=in:st=0:d=0.35,fade=t=out:st=${(SLIDE_SECONDS - 0.35).toFixed(2)}:d=0.35,format=yuv420p`,
        "-c:v", "libx264", "-preset", "slow", "-tune", "stillimage", "-crf", "27", "-profile:v", "high", "-level", "4.2", "-pix_fmt", "yuv420p", "-an", clip,
      ]);
      clips.push(clip);
    }
    await page.close();

    const listFile = join(work, `${video.slug}.txt`);
    writeFileSync(listFile, clips.map((clip) => `file '${clip}'`).join("\n"));
    const joined = join(work, `${video.slug}-joined.mp4`);
    ffmpeg(["-f", "concat", "-safe", "0", "-i", listFile, "-c", "copy", joined]);

    const total = (video.slides.length * SLIDE_SECONDS).toFixed(2);
    const tone =
      `aevalsrc='0.035*sin(2*PI*196*t)+0.025*sin(2*PI*293.66*t)+0.018*sin(2*PI*392*t)':s=48000:d=${total},` +
      "afade=t=in:st=0:d=1,afade=t=out:st=" + (Number(total) - 1.2).toFixed(2) + ":d=1.2";
    ffmpeg([
      "-i", joined, "-f", "lavfi", "-i", tone,
      "-map", "0:v", "-map", "1:a", "-c:v", "copy", "-c:a", "aac", "-b:a", "96k", "-shortest",
      "-movflags", "+faststart", join(outDir, `${video.slug}.mp4`),
    ]);
    const probe = execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration,size", "-of", "csv=p=0", join(outDir, `${video.slug}.mp4`)]).toString().trim();
    console.log(`${video.slug}: ${probe}`);
  }
} finally {
  await browser.close();
  rmSync(work, { recursive: true, force: true });
}
