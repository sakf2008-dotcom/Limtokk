import { describe, expect, it } from "vitest";
import { buildSearchText, escapeLike, normalizeArabic, normalizeHashtag, parseHashtags, truncateAtWord } from "@/lib/domain/text";
import { analyzeText } from "@/lib/server/moderation";
import { parseRange, contentTypeForKey } from "@/lib/server/range";
import { resolveMime } from "@/lib/server/services/uploads";
import { avatarKeyFor } from "@/lib/server/services/uploads";
import { streakOf, dayKey, withActivity, DEFAULT_PROGRESS, earnedBadges } from "@/lib/client/library";

describe("Arabic text normalization", () => {
  it("removes diacritics and tatweel, and unifies alef and taa-marbuta variants", () => {
    expect(normalizeArabic("الْفَضَاءُ")).toBe("الفضاء");
    expect(normalizeArabic("أحمد إبراهيم آمن")).toBe("احمد ابراهيم امن");
    expect(normalizeArabic("مدرسـة")).toBe("مدرسه");
    expect(normalizeArabic("ALPHA   Beta")).toBe("alpha beta");
  });

  it("strips invisible characters that could hide words from search", () => {
    expect(normalizeArabic("ع​لم")).toBe("علم");
  });

  it("escapes LIKE wildcards so searches are literal", () => {
    expect(escapeLike("100%_done\\")).toBe("100\\%\\_done\\\\");
  });

  it("normalizes hashtags and rejects empty ones", () => {
    expect(normalizeHashtag("#علوم!!")).toBe("علوم");
    expect(normalizeHashtag("#  ")).toBeNull();
    expect(normalizeHashtag("x")).toBeNull();
  });

  it("parses free-form hashtag input, deduplicates it, and caps it at five", () => {
    expect(parseHashtags("#علوم، #فيزياء  #علوم  #ماء #فضاء #شمس #زيادة")).toEqual(["علوم", "فيزياء", "ماء", "فضاء", "شمس"]);
  });

  it("builds search text that includes hashtags and titles", () => {
    const text = buildSearchText(["العنوان", "الوصف"], ["وسم"]);
    expect(text).toContain("العنوان");
    expect(text).toContain("وسم");
  });
});

describe("content checks (rule-based, human review still applies)", () => {
  it("flags links, contact details and repeated spam patterns", () => {
    expect(analyzeText("تابع موقعي https://example.com الآن")).toContain("link");
    expect(analyzeText("راسلني واتساب 0501234567")).toContain("contact");
    expect(analyzeText("ممتازززززززززززززز")).toContain("spam_pattern");
  });

  it("flags blocked terms as whole words only, using the extra list too", () => {
    expect(analyzeText("هذا كلام شرموط")).toContain("blocked_term");
    expect(analyzeText("كلمة سيئة مؤقتة", ["مؤقتة"])).toContain("blocked_term");
    expect(analyzeText("الكسوف ظاهرة فلكية")).not.toContain("blocked_term");
  });

  it("flags text written in capital letters", () => {
    expect(analyzeText("THIS IS ALL CAPITAL TEXT FOR TESTING")).toContain("all_caps");
  });

  it("returns no flags for ordinary educational text", () => {
    expect(analyzeText("لماذا يغلي الماء عند 100 درجة مئوية؟")).toEqual([]);
  });
});

describe("upload validation helpers", () => {
  it("accepts MP4 and QuickTime and falls back to the extension when the type is blank", () => {
    expect(resolveMime("clip.mp4", "video/mp4")).toBe("video/mp4");
    expect(resolveMime("IMG_0001.MOV", "")).toBe("video/quicktime");
    expect(resolveMime("movie.webm", "video/webm")).toBeNull();
    expect(resolveMime("notes.txt", "text/plain")).toBeNull();
  });

  it("assigns a stable, cosmetic avatar from a device hash", () => {
    expect(avatarKeyFor("ff00aa")).toMatch(/^a([1-9]|1[0-2])$/);
    expect(avatarKeyFor("ff00aa")).toBe(avatarKeyFor("ff00aa"));
  });
});

describe("range requests (required for iPhone video playback)", () => {
  it("parses explicit, open-ended and suffix ranges", () => {
    expect(parseRange("bytes=0-99", 1000)).toEqual({ kind: "partial", start: 0, end: 99 });
    expect(parseRange("bytes=500-", 1000)).toEqual({ kind: "partial", start: 500, end: 999 });
    expect(parseRange("bytes=-200", 1000)).toEqual({ kind: "partial", start: 800, end: 999 });
    expect(parseRange("bytes=900-5000", 1000)).toEqual({ kind: "partial", start: 900, end: 999 });
  });

  it("reports unsatisfiable ranges and falls back to a full response for unknown syntax", () => {
    expect(parseRange("bytes=2000-3000", 1000)).toEqual({ kind: "unsatisfiable" });
    expect(parseRange(null, 1000)).toEqual({ kind: "full" });
    expect(parseRange("bytes=0-1,5-9", 1000)).toEqual({ kind: "full" });
  });

  it("maps object keys to content types", () => {
    expect(contentTypeForKey("a/b.mov")).toBe("video/quicktime");
    expect(contentTypeForKey("a/b.mp4")).toBe("video/mp4");
  });
});

describe("local learning progress (device-only, never a profile)", () => {
  it("builds streaks from consecutive active days", () => {
    const today = new Date();
    const yesterday = new Date(today.getTime() - 86_400_000);
    const twoDaysAgo = new Date(today.getTime() - 2 * 86_400_000);
    expect(streakOf([dayKey(today), dayKey(yesterday), dayKey(twoDaysAgo)], today)).toBe(3);
    expect(streakOf([dayKey(twoDaysAgo)], today)).toBe(0);
  });

  it("records watched videos once and awards badges from progress", () => {
    let progress = withActivity(DEFAULT_PROGRESS, { watchedId: "v1", watchedTitle: "أ" });
    progress = withActivity(progress, { watchedId: "v1", watchedTitle: "أ" });
    expect(progress.watched).toEqual(["v1"]);
    expect(earnedBadges(progress).map((badge) => badge.id)).toContain("first-watch");
    expect(earnedBadges(progress).map((badge) => badge.id)).not.toContain("curious-10");
  });
});

describe("caption truncation (the slide shows a short caption; the full text opens with المزيد)", () => {
  const long = "عند الضغط الجوي المعتاد على مستوى سطح البحر، يبدأ الماء في الغليان عند 100 درجة مئوية. وكلما ارتفعنا عن سطح البحر قل الضغط الجوي.";

  it("keeps short text untouched and does not offer more", () => {
    expect(truncateAtWord("وصف قصير", 60)).toEqual({ text: "وصف قصير", truncated: false });
  });

  it("cuts long text at a word boundary and marks it as truncated", () => {
    const result = truncateAtWord(long, 60);
    expect(result.truncated).toBe(true);
    expect(result.text.endsWith("…")).toBe(true);
    expect(Array.from(result.text).length).toBeLessThanOrEqual(61);
    const visible = result.text.slice(0, -1);
    expect(long.startsWith(visible)).toBe(true);
    expect(visible.endsWith(" ")).toBe(false);
  });
}); 
