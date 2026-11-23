import { expect, test, type Page } from "@playwright/test";

/** Mobile viewport checks, the video feed mechanics, navigation, and the security gates. */

async function waitForFeed(page: Page) {
  await page.goto("/");
  await expect(page.locator("section[data-index]").first()).toBeVisible({ timeout: 20_000 });
}

test.describe("home feed on an iPhone-sized screen", () => {
  test("renders full-screen slides, both feed tabs, and the five bottom tabs in order", async ({ page }) => {
    await waitForFeed(page);
    await expect(page.getByRole("button", { name: "لك" })).toBeVisible();
    await expect(page.getByRole("button", { name: "الأحدث" })).toBeVisible();

    const nav = page.getByRole("navigation", { name: "التنقل الرئيسي" });
    const labels = await nav.locator("a").allTextContents();
    expect(labels.map((text) => text.trim()).filter(Boolean)).toEqual(["الرئيسية", "استكشف", "المحفوظات", "المزيد"]);
    await expect(nav.getByRole("link", { name: "إضافة" })).toBeVisible();

    const slideHeight = await page.locator("section[data-index]").first().evaluate((node) => node.getBoundingClientRect().height);
    const viewport = page.viewportSize();
    expect(Math.abs(slideHeight - (viewport?.height ?? 0))).toBeLessThanOrEqual(2);
  });

  test("has no horizontal page scroll on a phone width", async ({ page }) => {
    await waitForFeed(page);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);
  });

  test("plays exactly one video at a time and advances on swipe", async ({ page }) => {
    await waitForFeed(page);
    await expect.poll(async () => page.locator("video").evaluateAll((videos) => videos.filter((video) => !(video as HTMLVideoElement).paused).length), {
      timeout: 15_000,
    }).toBe(1);

    const title = await page.locator("section[data-index]").nth(0).getAttribute("aria-label");
    await page.evaluate(() => {
      const scroller = document.querySelector<HTMLElement>(".feed-scroll");
      scroller?.scrollTo({ top: scroller.clientHeight, behavior: "instant" });
    });
    await expect.poll(async () => page.locator("video").evaluateAll((videos) => videos.filter((video) => !(video as HTMLVideoElement).paused).length), {
      timeout: 15_000,
    }).toBe(1);
    const nextTitle = await page.locator("section[data-index]").nth(1).getAttribute("aria-label");
    expect(nextTitle).not.toBe(title);
  });

  test("tap toggles playback and double tap likes", async ({ page }) => {
    await waitForFeed(page);
    const firstSlide = page.locator("section[data-index]").first();
    const tapLayer = firstSlide.locator('[role="presentation"]');
    const box = await tapLayer.boundingBox();
    expect(box).not.toBeNull();
    // Tap the open area of the video (upper third), not the controls that sit lower on the slide.
    const center = { x: box!.x + box!.width / 2, y: box!.y + box!.height * 0.3 };

    // Wait for autoplay so the first tap is a pause, not a play.
    await expect(firstSlide.locator("video")).toHaveJSProperty("paused", false, { timeout: 15_000 });
    await page.mouse.click(center.x, center.y);
    await expect(firstSlide.locator("video")).toHaveJSProperty("paused", true, { timeout: 5_000 });
    // Two taps closer than 320 ms are a double tap by design (it likes), so wait before the next single tap.
    await page.waitForTimeout(450);
    await page.mouse.click(center.x, center.y);
    await expect(firstSlide.locator("video")).toHaveJSProperty("paused", false, { timeout: 5_000 });

    const likeButton = firstSlide.getByRole("button", { name: /إعجاب/ });
    const before = await likeButton.innerText();
    await page.mouse.dblclick(center.x, center.y);
    await expect(firstSlide.getByRole("button", { name: "إلغاء الإعجاب" })).toBeVisible({ timeout: 10_000 });
    expect(await likeButton.innerText()).not.toBe(before);
  });

  test("switches to the latest tab", async ({ page }) => {
    await waitForFeed(page);
    await page.getByRole("button", { name: "الأحدث" }).click();
    await expect(page.getByRole("button", { name: "الأحدث" })).toHaveAttribute("aria-pressed", "true");
    await expect(page.locator("section[data-index]").first()).toBeVisible();
  });

  test("opens the comments sheet and posts a comment", async ({ page }) => {
    await waitForFeed(page);
    const slide = page.locator("section[data-index]").first();
    await slide.getByRole("button", { name: "التعليقات" }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await dialog.getByLabel("اكتب تعليقًا").fill("شرح مفيد جدًا، شكرًا لكم.");
    await dialog.getByRole("button", { name: "إرسال التعليق" }).click();
    await expect(dialog.getByText(/تم نشر تعليقك|يحتاج مراجعة/)).toBeVisible({ timeout: 15_000 });
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
  });
});

test.describe("discovery and navigation", () => {
  test("explore lists categories, playlists, and trending topics", async ({ page }) => {
    await page.goto("/explore");
    await expect(page.getByRole("heading", { name: "استكشف", level: 1 })).toBeVisible();
    await expect(page.getByRole("link", { name: /العلوم/ }).first()).toBeVisible();
    await expect(page.getByText("مسارات تعلّم")).toBeVisible();
    await expect(page.getByRole("heading", { name: "مواضيع متداولة" })).toBeVisible();
  });

  test("category page shows its videos", async ({ page }) => {
    await page.goto("/category/space");
    await expect(page.getByRole("heading", { name: "الفضاء", level: 1 })).toBeVisible();
    await expect(page.getByText("كم يستغرق ضوء الشمس").first()).toBeVisible();
  });

  test("search finds videos by Arabic text and by hashtag", async ({ page }) => {
    await page.goto("/search");
    await page.getByRole("searchbox").fill("الفضاء");
    await expect(page.getByText("كم يستغرق ضوء الشمس").first()).toBeVisible({ timeout: 15_000 });
    await page.getByRole("searchbox").fill("#رياضيات");
    await expect(page.getByText("ما معنى العدد").first()).toBeVisible({ timeout: 15_000 });
  });

  test("search explains empty results helpfully", async ({ page }) => {
    await page.goto("/search");
    await page.getByRole("searchbox").fill("كلمةغيرموجودةإطلاقًا");
    await expect(page.getByText("لا توجد نتائج مطابقة")).toBeVisible({ timeout: 15_000 });
  });

  test("creator page is pseudonymous and shows totals", async ({ page }) => {
    await page.goto("/creator/10000000-0000-4000-8000-000000000001");
    await expect(page.getByText("اسم مستعار غير موثّق")).toBeVisible();
    await expect(page.getByText("إجمالي المشاهدات")).toBeVisible();
  });

  test("unknown pages show a friendly not-found screen", async ({ page }) => {
    await page.goto("/this-page-does-not-exist");
    await expect(page.getByRole("heading", { name: "هذه الصفحة غير موجودة" })).toBeVisible();
  });

  test("more page is the device center and links to the policies", async ({ page }) => {
    await page.goto("/more");
    await expect(page.getByRole("heading", { name: "المزيد", level: 1 })).toBeVisible();
    await expect(page.getByRole("link", { name: "سياسة الخصوصية" })).toBeVisible();
    await expect(page.getByText("وضع تجريبي")).toBeVisible();
  });
});

test.describe("upload entry point", () => {
  test("rejects a non-video file before any upload starts", async ({ page }) => {
    await page.goto("/add");
    await page.locator('input[type="file"]').setInputFiles({
      name: "notes.txt",
      mimeType: "text/plain",
      buffer: Buffer.from("not a video"),
    });
    await expect(page.getByRole("alert").or(page.getByText("صيغة الملف غير مدعومة"))).toBeVisible({ timeout: 10_000 });
  });

  test("explains the review rule and the limits", async ({ page }) => {
    await page.goto("/add");
    await expect(page.getByText("كل فيديو يُراجع بشريًا قبل ظهوره للجميع")).toBeVisible();
  });
});

test.describe("administrator gate", () => {
  test("the admin API refuses unauthenticated requests", async ({ request }) => {
    const response = await request.get("/api/admin/overview");
    expect(response.status()).toBe(401);
    const body = await response.json();
    expect(body.error.code).toBe("admin_required");
  });

  test("the admin page asks for a password and rejects a wrong one", async ({ page }) => {
    await page.goto("/admin");
    await expect(page.getByRole("heading", { name: "دخول المشرفين" })).toBeVisible();
    await page.getByLabel("كلمة المرور").fill("wrong-password-value");
    await page.getByRole("button", { name: "دخول" }).click();
    await expect(page.getByText("كلمة المرور غير صحيحة")).toBeVisible();
  });

  test("a correct password opens the moderation console", async ({ page }) => {
    await page.goto("/admin");
    await page.getByLabel("كلمة المرور").fill("e2e-admin-password-long-enough");
    await page.getByRole("button", { name: "دخول" }).click();
    await expect(page.getByRole("button", { name: "نظرة عامة" })).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText("بانتظار المراجعة").first()).toBeVisible();
  });
});

test.describe("installable web app", () => {
  test("serves a manifest with the Arabic name, RTL direction, and icons", async ({ request }) => {
    const response = await request.get("/manifest.webmanifest");
    expect(response.ok()).toBeTruthy();
    const manifest = await response.json();
    expect(manifest.name).toContain("علم توك");
    expect(manifest.display).toBe("standalone");
    expect(manifest.dir).toBe("rtl");
    expect(manifest.icons.length).toBeGreaterThanOrEqual(3);
  });

  test("the offline fallback page renders on its own", async ({ page }) => {
    await page.goto("/offline");
    await expect(page.getByRole("heading", { name: "لا يوجد اتصال بالإنترنت" })).toBeVisible();
  });

  test("the health endpoint reports demo mode without leaking secrets", async ({ request }) => {
    const response = await request.get("/api/health");
    const body = await response.json();
    expect(body.demoMode).toBe(true);
    // Flags such as secretIsEphemeral are allowed; actual secret values must never appear.
    expect(JSON.stringify(body)).not.toContain("e2e-secret-value");
    expect(JSON.stringify(body)).not.toContain("e2e-admin");
  });
});
