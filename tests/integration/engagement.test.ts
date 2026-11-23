import { afterAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { resetDbForTests, getDb } from "@/lib/server/db/client";
import { consumeRate } from "@/lib/server/rate-limit";
import { deleteOwnComment, listCommentsForVideo, postComment, recordViewForDevice, setLikeForDevice, submitReport } from "@/lib/server/services/engagement";
import { getPublicVideo } from "@/lib/server/repo/videos";
import { issuePowChallenge, leadingZeroBits, powDigest } from "@/lib/server/pow";

afterAll(async () => {
  await resetDbForTests();
});

let counter = 0;
function device(): string {
  counter += 1;
  return `${randomUUID()}-${counter}`;
}

function request(url: string, deviceId: string, init: RequestInit & { bearer?: string } = {}): Request {
  const headers = new Headers(init.headers);
  headers.set("x-ilmtok-device", deviceId);
  headers.set("x-forwarded-for", `198.51.100.${(counter % 200) + 1}`);
  if (init.bearer) headers.set("authorization", `Bearer ${init.bearer}`);
  if (init.body && !headers.has("content-type")) headers.set("content-type", "application/json");
  return new Request(url, { ...init, headers });
}

const SLEEP_VIDEO = "20000000-0000-4000-8000-000000000005";
const PI_VIDEO = "20000000-0000-4000-8000-000000000003";
const SUN_VIDEO = "20000000-0000-4000-8000-000000000002";

describe("likes and views", () => {
  it("counts one like per device and removes it on unlike", async () => {
    const db = await getDb();
    const before = (await getPublicVideo(db, PI_VIDEO, null))!.likeCount;
    const deviceA = device();
    const first = await setLikeForDevice(request("http://localhost/x", deviceA), PI_VIDEO, { liked: true });
    const again = await setLikeForDevice(request("http://localhost/x", deviceA), PI_VIDEO, { liked: true });
    expect(first.likeCount).toBe(before + 1);
    expect(again.likeCount).toBe(before + 1);
    const removed = await setLikeForDevice(request("http://localhost/x", deviceA), PI_VIDEO, { liked: false });
    expect(removed.liked).toBe(false);
    expect(removed.likeCount).toBe(before);
  });

  it("refuses likes on videos that are not public", async () => {
    await expect(
      setLikeForDevice(request("http://localhost/x", device()), "30000000-0000-4000-8000-000000000001", { liked: true }),
    ).rejects.toMatchObject({ status: 404 });
  });

  it("counts a view once per device per day", async () => {
    const db = await getDb();
    const before = (await getPublicVideo(db, SUN_VIDEO, null))!.viewCount;
    const viewer = device();
    await recordViewForDevice(request("http://localhost/x", viewer), SUN_VIDEO);
    await recordViewForDevice(request("http://localhost/x", viewer), SUN_VIDEO);
    expect((await getPublicVideo(db, SUN_VIDEO, null))!.viewCount).toBe(before + 1);
  });

  it("rate-limits likes from one device", async () => {
    const spammer = device();
    let limited = false;
    for (let i = 0; i < 200 && !limited; i += 1) {
      try {
        await setLikeForDevice(request("http://localhost/x", spammer), SUN_VIDEO, { liked: i % 2 === 0 });
      } catch (error) {
        limited = (error as { status?: number }).status === 429;
      }
    }
    expect(limited).toBe(true);
  });
});

describe("comments and replies", () => {
  it("publishes ordinary comments immediately and holds suspicious ones", async () => {
    const author = device();
    const normal = await postComment(request("http://localhost/x", author), PI_VIDEO, { nickname: "طالب", body: "شرح مفيد جدًا، شكرًا!" });
    expect(normal.status).toBe("visible");

    const held = await postComment(request("http://localhost/x", device()), PI_VIDEO, {
      nickname: "إعلان",
      body: "تابع القناة على https://example.com/ads الآن",
    });
    expect(held.status).toBe("pending");

    const visible = await listCommentsForVideo(PI_VIDEO, 0, 50);
    expect(visible.map((item) => item.body)).toContain("شرح مفيد جدًا، شكرًا!");
    expect(visible.map((item) => item.body)).not.toContain("تابع القناة على https://example.com/ads الآن");
  });

  it("lets a reply attach to a visible top-level comment, and the author delete with a token", async () => {
    const parentAuthor = device();
    const parent = await postComment(request("http://localhost/x", parentAuthor), PI_VIDEO, { nickname: "أحمد", body: "سؤال عن π" });
    const replier = device();
    const reply = await postComment(request("http://localhost/x", replier), PI_VIDEO, { nickname: "سارة", body: "π تقريبًا 3.14", parentId: parent.id });
    const thread = await listCommentsForVideo(PI_VIDEO, 0, 50);
    const top = thread.find((item) => item.id === parent.id);
    expect(top?.replies.map((item) => item.id)).toContain(reply.id);

    await expect(
      deleteOwnComment(request("http://localhost/x", device(), { method: "DELETE", bearer: parent.deleteToken }), reply.id),
    ).rejects.toMatchObject({ status: 403 });
    await deleteOwnComment(request("http://localhost/x", parentAuthor, { method: "DELETE", bearer: parent.deleteToken }), parent.id);
    const after = await listCommentsForVideo(PI_VIDEO, 0, 50);
    expect(after.map((item) => item.id)).not.toContain(parent.id);
  });

  it("rejects duplicate comments within ten minutes from the same device", async () => {
    const author = device();
    await postComment(request("http://localhost/x", author), SUN_VIDEO, { nickname: "زائر", body: "تعليق متكرر للاختبار" });
    await expect(
      postComment(request("http://localhost/x", author), SUN_VIDEO, { nickname: "زائر", body: "تعليق متكرر للاختبار" }),
    ).rejects.toMatchObject({ status: 409, code: "duplicate_comment" });
  });

  it("asks for a proof-of-work challenge after a burst of comments, and accepts a solved one", async () => {
    const burster = device();
    const texts = ["الأول", "الثاني", "الثالث", "الرابع"];
    for (const text of texts.slice(0, 3)) {
      await postComment(request("http://localhost/x", burster), SUN_VIDEO, { nickname: "متعلّم", body: `تعليق ${text} مختلف` });
    }
    let challengeRequired: { challenge: { token: string; prefix: string; difficultyBits: number } } | null = null;
    try {
      await postComment(request("http://localhost/x", burster), SUN_VIDEO, { nickname: "متعلّم", body: "تعليق رابع مختلف" });
    } catch (error) {
      const details = error as { code?: string; details?: { challenge?: { token: string; prefix: string; difficultyBits: number } } };
      if (details.code === "challenge_required") challengeRequired = { challenge: details.details!.challenge! };
    }
    expect(challengeRequired).not.toBeNull();
    const challenge = challengeRequired!.challenge;
    let nonce = 0;
    while (leadingZeroBits(powDigest(challenge.prefix, String(nonce))) < challenge.difficultyBits) nonce += 1;
    const solved = await postComment(request("http://localhost/x", burster), SUN_VIDEO, {
      nickname: "متعلّم",
      body: "تعليق رابع مختلف",
      challenge: { token: challenge.token, nonce: String(nonce) },
    });
    expect(solved.status).toBe("visible");
  });
});

describe("reports", () => {
  it("hides a video automatically when enough distinct devices report it, pending human review", async () => {
    const db = await getDb();
    expect(await getPublicVideo(db, SLEEP_VIDEO, null)).not.toBeNull();
    for (let i = 0; i < 3; i += 1) {
      await submitReport(request("http://localhost/x", device()), {
        targetType: "video",
        targetId: SLEEP_VIDEO,
        reason: "misleading",
        details: "معلومة تحتاج مراجعة",
      });
    }
    expect(await getPublicVideo(db, SLEEP_VIDEO, null)).toBeNull();
  });

  it("counts each device once per target", async () => {
    const reporter = device();
    const first = await submitReport(request("http://localhost/x", reporter), { targetType: "video", targetId: PI_VIDEO, reason: "spam" });
    const second = await submitReport(request("http://localhost/x", reporter), { targetType: "video", targetId: PI_VIDEO, reason: "spam" });
    expect(first.alreadyReported).toBe(false);
    expect(second.alreadyReported).toBe(true);
  });
});

describe("generic rate limiter", () => {
  it("blocks after the limit within the window and resets after it", async () => {
    const db = await getDb();
    const key = `test:${randomUUID()}`;
    const start = new Date("2030-01-01T00:00:00Z");
    expect((await consumeRate(db, key, 2, 60, start)).allowed).toBe(true);
    expect((await consumeRate(db, key, 2, 60, start)).allowed).toBe(true);
    const blocked = await consumeRate(db, key, 2, 60, start);
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfterSeconds).toBeGreaterThan(0);
    expect((await consumeRate(db, key, 2, 60, new Date(start.getTime() + 61_000))).allowed).toBe(true);
  });
});

describe("proof-of-work challenges", () => {
  it("issues challenges that a real solver can satisfy", () => {
    const challenge = issuePowChallenge();
    let nonce = 0;
    while (leadingZeroBits(powDigest(challenge.prefix, String(nonce))) < challenge.difficultyBits) nonce += 1;
    expect(leadingZeroBits(powDigest(challenge.prefix, String(nonce)))).toBeGreaterThanOrEqual(challenge.difficultyBits);
    expect(challenge.token.split(".")).toHaveLength(2);
  });
});
