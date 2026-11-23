import { afterAll, describe, expect, it } from "vitest";
import { randomBytes, randomUUID } from "node:crypto";
import { resetDbForTests, getDb } from "@/lib/server/db/client";
import { issuePowChallenge, leadingZeroBits, powDigest } from "@/lib/server/pow";
import {
  completeUpload,
  createRecoveryCode,
  deleteOwnerVideo,
  getOwnerStatus,
  initUpload,
  receiveDemoContent,
  recoverOwnership,
} from "@/lib/server/services/uploads";
import { approveVideo, hideVideo, rejectVideo, restoreVideo } from "@/lib/server/services/moderation";
import { fetchFeed, getPublicVideo } from "@/lib/server/repo/videos";
import { GET as mediaGet } from "@/app/api/media/[bucket]/[...key]/route";
import { buildMp4 } from "../helpers/mp4";
import { bodyFrom } from "@/lib/server/range";

afterAll(async () => {
  await resetDbForTests();
});

let ipCounter = 0;
function nextIp(): string {
  ipCounter += 1;
  return `203.0.113.${ipCounter}`;
}

function newDevice(): string {
  return randomUUID();
}

function solvePow(prefix: string, bits: number): string {
  for (let nonce = 0; nonce < 5_000_000; nonce += 1) {
    if (leadingZeroBits(powDigest(prefix, String(nonce))) >= bits) return String(nonce);
  }
  throw new Error("pow not solved");
}

function jsonRequest(url: string, device: string, ip: string, body: unknown, extra: Record<string, string> = {}): Request {
  return new Request(url, {
    method: "POST",
    headers: { "content-type": "application/json", "x-ilmtok-device": device, "x-forwarded-for": ip, ...extra },
    body: JSON.stringify(body),
  });
}

function baseBody(overrides: Record<string, unknown> = {}) {
  const challenge = issuePowChallenge();
  return {
    fileName: "lesson.mp4",
    mimeType: "video/mp4",
    sizeBytes: 0,
    nickname: "معلّم الفضاء",
    title: "شرح تجريبي للاختبار",
    description: "وصف قصير للاختبار",
    keyFact: "معلومة أساسية",
    categoryId: "science",
    hashtags: "علوم فيزياء",
    acceptedGuidelines: true,
    creatorId: null,
    challenge: { token: challenge.token, nonce: solvePow(challenge.prefix, challenge.difficultyBits) },
    ...overrides,
  };
}

async function startUpload(bytes: Buffer, device = newDevice(), overrides: Record<string, unknown> = {}) {
  const ip = nextIp();
  const body = baseBody({ sizeBytes: bytes.length, ...overrides });
  const init = await initUpload(jsonRequest("http://localhost/api/uploads", device, ip, body), body);
  return { device, ip, init };
}

async function sendContent(videoId: string, ownerToken: string, device: string, bytes: Buffer) {
  const request = new Request(`http://localhost/api/uploads/${videoId}/content`, {
    method: "PUT",
    headers: { authorization: `Bearer ${ownerToken}`, "x-ilmtok-device": device, "content-length": String(bytes.length) },
    body: bodyFrom(bytes),
  });
  await receiveDemoContent(request, videoId);
}

function completeRequest(videoId: string, ownerToken: string): Request {
  return new Request(`http://localhost/api/uploads/${videoId}/complete`, {
    method: "POST",
    headers: { authorization: `Bearer ${ownerToken}` },
  });
}

describe("anonymous upload pipeline", () => {
  it("keeps a new upload out of the public feed until a human approves it", async () => {
    const bytes = buildMp4({ durationMs: 12_000 });
    const { device, init } = await startUpload(bytes);
    expect(init.status).toBe("pending_upload");
    expect(init.upload.method).toBe("PUT");
    expect(init.upload.headers.Authorization).toBe(`Bearer ${init.ownerToken}`);

    await sendContent(init.videoId, init.ownerToken, device, bytes);
    const result = await completeUpload(completeRequest(init.videoId, init.ownerToken), init.videoId);
    expect(result.status).toBe("pending_review");

    const db = await getDb();
    const latest = await fetchFeed(db, { tab: "latest", categoryId: null, preferCategories: [], offset: 0, limit: 200, deviceHash: null, now: new Date() });
    expect(latest.map((card) => card.id)).not.toContain(init.videoId);
    expect(await getPublicVideo(db, init.videoId, null)).toBeNull();

    await approveVideo(init.videoId, "admin");
    const after = await getPublicVideo(db, init.videoId, null);
    expect(after).not.toBeNull();
    expect(after?.mediaUrl).toMatch(/^\/api\/media\/ilmtok-public\//);
    expect(after?.isDemo).toBe(false);
  });

  it("serves approved media with HTTP Range support (required by iPhone Safari)", async () => {
    const bytes = buildMp4({ durationMs: 4000, padBytes: 20_000 });
    const { device, init } = await startUpload(bytes);
    await sendContent(init.videoId, init.ownerToken, device, bytes);
    await completeUpload(completeRequest(init.videoId, init.ownerToken), init.videoId);
    await approveVideo(init.videoId, "admin");

    const db = await getDb();
    const card = await getPublicVideo(db, init.videoId, null);
    const key = card!.mediaUrl.replace("/api/media/ilmtok-public/", "");
    const response = await mediaGet(
      new Request(`http://localhost${card!.mediaUrl}`, { headers: { range: "bytes=0-99" } }),
      { params: Promise.resolve({ bucket: "ilmtok-public", key: key.split("/") }) },
    );
    expect(response.status).toBe(206);
    expect(response.headers.get("content-range")).toBe(`bytes 0-99/${bytes.length}`);
    expect(response.headers.get("accept-ranges")).toBe("bytes");
    expect(Buffer.from(await response.arrayBuffer()).equals(bytes.subarray(0, 100))).toBe(true);
  });

  it("refuses pending media through the public media route", async () => {
    const bytes = buildMp4();
    const { device, init } = await startUpload(bytes);
    await sendContent(init.videoId, init.ownerToken, device, bytes);
    await completeUpload(completeRequest(init.videoId, init.ownerToken), init.videoId);
    const response = await mediaGet(new Request(`http://localhost/api/media/ilmtok-pending/${init.videoId}/x.mp4`), {
      params: Promise.resolve({ bucket: "ilmtok-pending", key: [init.videoId, "x.mp4"] }),
    });
    expect(response.status).toBe(404);
  });

  it("rejects a file that is not a real MP4 and deletes it immediately", async () => {
    const bytes = randomBytes(5000);
    const { device, init } = await startUpload(bytes);
    await sendContent(init.videoId, init.ownerToken, device, bytes);
    const result = await completeUpload(completeRequest(init.videoId, init.ownerToken), init.videoId);
    expect(result.status).toBe("rejected");
    expect(result.rejectionReason).toContain("ليس فيديو");
    const status = await getOwnerStatus(
      new Request(`http://localhost/api/videos/${init.videoId}/owner`, { headers: { authorization: `Bearer ${init.ownerToken}` } }),
      init.videoId,
    );
    expect(status.status).toBe("rejected");
  });

  it("rejects when the stored size differs from the declared size", async () => {
    const bytes = buildMp4();
    const { device, init } = await startUpload(bytes, newDevice(), { sizeBytes: bytes.length + 500 });
    await sendContent(init.videoId, init.ownerToken, device, bytes);
    const result = await completeUpload(completeRequest(init.videoId, init.ownerToken), init.videoId);
    expect(result.status).toBe("rejected");
    expect(result.rejectionReason).toContain("لا يطابق");
  });

  it("rejects videos longer than the configured maximum duration", async () => {
    const bytes = buildMp4({ durationMs: 120_000 });
    const { device, init } = await startUpload(bytes);
    await sendContent(init.videoId, init.ownerToken, device, bytes);
    const result = await completeUpload(completeRequest(init.videoId, init.ownerToken), init.videoId);
    expect(result.status).toBe("rejected");
    expect(result.rejectionReason).toContain("90");
  });

  it("requires the owner token for completion, and refuses a wrong token", async () => {
    const bytes = buildMp4();
    const { device, init } = await startUpload(bytes);
    await sendContent(init.videoId, init.ownerToken, device, bytes);
    await expect(
      completeUpload(new Request(`http://localhost/api/uploads/${init.videoId}/complete`, { method: "POST" }), init.videoId),
    ).rejects.toMatchObject({ status: 401, code: "owner_token_required" });
    const wrong = randomBytes(32).toString("base64url");
    await expect(completeUpload(completeRequest(init.videoId, wrong), init.videoId)).rejects.toMatchObject({ status: 403, code: "owner_mismatch" });
  });

  it("allows one pending submission per device at a time", async () => {
    const device = newDevice();
    await startUpload(buildMp4(), device);
    await expect(startUpload(buildMp4(), device)).rejects.toMatchObject({ status: 409, code: "pending_exists" });
  });

  it("refuses unsupported formats, oversize files, and bad proof-of-work", async () => {
    const device = newDevice();
    const ip = nextIp();
    const bytes = buildMp4();
    const webm = baseBody({ sizeBytes: bytes.length, fileName: "clip.webm", mimeType: "video/webm" });
    await expect(initUpload(jsonRequest("http://localhost/api/uploads", device, ip, webm), webm)).rejects.toMatchObject({ status: 415 });

    const huge = baseBody({ sizeBytes: 104_857_601 });
    await expect(initUpload(jsonRequest("http://localhost/api/uploads", newDevice(), nextIp(), huge), huge)).rejects.toMatchObject({ status: 413 });

    const bad = baseBody({ sizeBytes: bytes.length, challenge: { token: "x".repeat(20), nonce: "1" } });
    await expect(initUpload(jsonRequest("http://localhost/api/uploads", newDevice(), nextIp(), bad), bad)).rejects.toMatchObject({ status: 400, code: "challenge_invalid" });
  });

  it("prevents replaying a solved proof-of-work challenge", async () => {
    const challenge = issuePowChallenge();
    const nonce = solvePow(challenge.prefix, challenge.difficultyBits);
    const first = baseBody({ sizeBytes: buildMp4().length, challenge: { token: challenge.token, nonce } });
    await initUpload(jsonRequest("http://localhost/api/uploads", newDevice(), nextIp(), first), first);
    const replay = baseBody({ sizeBytes: buildMp4().length, challenge: { token: challenge.token, nonce } });
    await expect(initUpload(jsonRequest("http://localhost/api/uploads", newDevice(), nextIp(), replay), replay)).rejects.toMatchObject({
      status: 409,
      code: "challenge_reused",
    });
  });

  it("supports owner edits only while pending, and owner deletion", async () => {
    const bytes = buildMp4();
    const { device, init } = await startUpload(bytes);
    await sendContent(init.videoId, init.ownerToken, device, bytes);
    await completeUpload(completeRequest(init.videoId, init.ownerToken), init.videoId);
    const status = await getOwnerStatus(
      new Request("http://localhost/x", { headers: { authorization: `Bearer ${init.ownerToken}` } }),
      init.videoId,
    );
    expect(status.canEdit).toBe(true);

    await deleteOwnerVideo(new Request("http://localhost/x", { headers: { authorization: `Bearer ${init.ownerToken}` } }), init.videoId);
    const deleted = await getOwnerStatus(
      new Request("http://localhost/x", { headers: { authorization: `Bearer ${init.ownerToken}` } }),
      init.videoId,
    ).catch((error: unknown) => error);
    expect(deleted).toMatchObject({ status: 404 });
  });

  it("issues a one-time recovery code that restores management on another device", async () => {
    const bytes = buildMp4();
    const { device, init } = await startUpload(bytes);
    await sendContent(init.videoId, init.ownerToken, device, bytes);
    await completeUpload(completeRequest(init.videoId, init.ownerToken), init.videoId);

    const { code } = await createRecoveryCode(new Request("http://localhost/x", { headers: { authorization: `Bearer ${init.ownerToken}` } }), init.videoId);
    expect(code).toMatch(/^[A-Z2-9]{4}(-[A-Z2-9]{4}){3}$/);

    const restored = await recoverOwnership(
      new Request("http://localhost/api/recover", { method: "POST", headers: { "x-forwarded-for": nextIp() } }),
      { videoId: init.videoId, code: code.toLowerCase() },
    );
    expect(restored.ownerToken).not.toBe(init.ownerToken);

    // The old token stops working, and the code cannot be reused.
    await expect(
      getOwnerStatus(new Request("http://localhost/x", { headers: { authorization: `Bearer ${init.ownerToken}` } }), init.videoId),
    ).rejects.toMatchObject({ status: 403 });
    await expect(
      recoverOwnership(new Request("http://localhost/api/recover", { method: "POST", headers: { "x-forwarded-for": nextIp() } }), {
        videoId: init.videoId,
        code,
      }),
    ).rejects.toMatchObject({ status: 404 });
  });

  it("supports the moderation transitions (reject, hide, restore) with audit-safe rules", async () => {
    const bytes = buildMp4();
    const { device, init } = await startUpload(bytes);
    await sendContent(init.videoId, init.ownerToken, device, bytes);
    await completeUpload(completeRequest(init.videoId, init.ownerToken), init.videoId);
    await approveVideo(init.videoId, "admin");
    await hideVideo(init.videoId, "admin", "اختبار");
    const db = await getDb();
    expect(await getPublicVideo(db, init.videoId, null)).toBeNull();
    await restoreVideo(init.videoId, "admin");
    expect(await getPublicVideo(db, init.videoId, null)).not.toBeNull();
    await rejectVideo(init.videoId, "admin", "اختبار الرفض");
    expect(await getPublicVideo(db, init.videoId, null)).toBeNull();
    await expect(approveVideo("00000000-0000-4000-8000-00000000dead", "admin")).rejects.toMatchObject({ status: 404 });
  });
});
