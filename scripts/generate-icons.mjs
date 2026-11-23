// Renders the IlmTok app icons from the SVG sources in public/brand using the Chromium that
// Playwright provides. Run with: npm run icons
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const PREINSTALLED = "/opt/pw-browsers/chromium";

const targets = [
  { svg: "logo.svg", size: 192, out: "public/icons/icon-192.png" },
  { svg: "logo.svg", size: 512, out: "public/icons/icon-512.png" },
  { svg: "logo.svg", size: 180, out: "public/icons/apple-touch-icon.png" },
  { svg: "logo-maskable.svg", size: 512, out: "public/icons/icon-maskable-512.png" },
];

const browser = await chromium.launch(existsSync(PREINSTALLED) ? { executablePath: PREINSTALLED } : {});
try {
  for (const target of targets) {
    const svg = readFileSync(join(root, "public/brand", target.svg), "utf8");
    const page = await browser.newPage({ viewport: { width: target.size, height: target.size }, deviceScaleFactor: 1 });
    await page.setContent(
      `<html><body style="margin:0;background:transparent">${svg.replace("<svg ", `<svg width="${target.size}" height="${target.size}" `)}</body></html>`,
    );
    const png = await page.screenshot({ omitBackground: true, type: "png", clip: { x: 0, y: 0, width: target.size, height: target.size } });
    writeFileSync(join(root, target.out), png);
    await page.close();
    console.log("wrote", target.out, png.length, "bytes");
  }
} finally {
  await browser.close();
}
