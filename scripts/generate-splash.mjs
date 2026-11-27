// Renders the iPhone launch screens (apple-touch-startup-image) from public/brand/logo.svg, on the dark
// background. The sizes come from src/lib/domain/splash-screens.json, which the layout also reads.
// Run with: npm run splash
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const PREINSTALLED = "/opt/pw-browsers/chromium";

const screens = JSON.parse(readFileSync(join(root, "src/lib/domain/splash-screens.json"), "utf8"));
const logo = readFileSync(join(root, "public/brand/logo.svg"), "utf8");
mkdirSync(join(root, "public/splash"), { recursive: true });

const browser = await chromium.launch(existsSync(PREINSTALLED) ? { executablePath: PREINSTALLED } : {});
try {
  for (const screen of screens) {
    const { cssWidth, cssHeight, scale } = screen;
    const mark = Math.round(Math.min(cssWidth, cssHeight) * 0.28);
    const page = await browser.newPage({ viewport: { width: cssWidth, height: cssHeight }, deviceScaleFactor: scale });
    await page.setContent(
      `<html><body style="margin:0;width:${cssWidth}px;height:${cssHeight}px;background:#07080c;display:grid;place-items:center">${logo.replace("<svg ", `<svg width="${mark}" height="${mark}" `)}</body></html>`,
    );
    const png = await page.screenshot({ type: "png", clip: { x: 0, y: 0, width: cssWidth, height: cssHeight } });
    const out = `public/splash/apple-splash-${cssWidth}x${cssHeight}@${scale}x.png`;
    writeFileSync(join(root, out), png);
    await page.close();
    console.log("wrote", out, png.length, "bytes");
  }
} finally {
  await browser.close();
}
