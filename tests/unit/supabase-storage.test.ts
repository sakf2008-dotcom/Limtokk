import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BUCKET_PENDING, getBlobStore, resetBlobStoreForTests } from "@/lib/server/storage";

/**
 * The Supabase adapter is checked against a fake HTTP server (a mocked fetch), because the real
 * project is not reachable from tests. The point is the request shapes and the bucket-setup rules.
 */

const SUPABASE_URL = "https://example-project.supabase.co";
const ENV_KEYS = ["ILMTOK_DB_MODE", "DATABASE_URL", "SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "ILMTOK_SECRET", "VERCEL"] as const;

type FetchCall = { url: string; method: string; body: string | undefined };

function fakeSupabase(options: { bucketCreate: number; bucketLookup: number }) {
  const calls: FetchCall[] = [];
  const handler = async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    calls.push({ url, method, body: typeof init?.body === "string" ? init.body : undefined });
    if (method === "POST" && url === `${SUPABASE_URL}/storage/v1/bucket`) {
      return new Response(JSON.stringify({ error: "Duplicate", message: "The resource already exists" }), { status: options.bucketCreate });
    }
    if (method === "GET" && /\/storage\/v1\/bucket\/ilmtok-/.test(url)) {
      return new Response(JSON.stringify({ id: "bucket" }), { status: options.bucketLookup });
    }
    if (method === "POST" && url.includes("/storage/v1/object/upload/sign/")) {
      const suffix = url.slice(url.indexOf("/object/upload/sign/") + "/object/upload/sign/".length);
      return new Response(JSON.stringify({ url: `/object/upload/sign/${suffix}?token=test-token` }), { status: 200 });
    }
    return new Response("unexpected request in test", { status: 500 });
  };
  return { calls, handler };
}

describe("Supabase storage adapter", () => {
  const saved: Record<string, string | undefined> = {};

  beforeEach(() => {
    for (const key of ENV_KEYS) saved[key] = process.env[key];
    // Override the memory-mode default from vitest.config so that Supabase mode is selected.
    delete process.env.ILMTOK_DB_MODE;
    process.env.DATABASE_URL = "postgres://user:password@localhost:6543/postgres";
    process.env.SUPABASE_URL = SUPABASE_URL;
    process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role-test-key-not-real";
    process.env.ILMTOK_SECRET = "storage-test-secret-value-long-enough-0123456789";
    delete process.env.VERCEL;
    resetBlobStoreForTests();
  });

  afterEach(() => {
    for (const key of ENV_KEYS) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
    resetBlobStoreForTests();
    vi.unstubAllGlobals();
  });

  it("accepts buckets that already exist, creates no size limit, and signs upload URLs on the project host", async () => {
    const fake = fakeSupabase({ bucketCreate: 400, bucketLookup: 200 });
    vi.stubGlobal("fetch", vi.fn(fake.handler));

    const store = getBlobStore();
    expect(store.mode).toBe("supabase");
    const target = await store.createUploadTarget({
      videoId: "00000000-0000-4000-8000-000000000001",
      bucket: BUCKET_PENDING,
      key: "pending/00000000-0000-4000-8000-000000000001.mp4",
      contentType: "video/mp4",
    });

    expect(target.method).toBe("PUT");
    expect(target.url.startsWith(`${SUPABASE_URL}/storage/v1/object/upload/sign/${BUCKET_PENDING}/`)).toBe(true);
    expect(target.url).toContain("token=test-token");

    const bucketCreates = fake.calls.filter((call) => call.method === "POST" && call.url.endsWith("/storage/v1/bucket"));
    expect(bucketCreates.length).toBe(2);
    for (const call of bucketCreates) {
      // A bucket-level size limit above the project's plan limit would make bucket creation fail.
      expect(call.body ?? "").not.toContain("file_size_limit");
    }
    expect(fake.calls.some((call) => call.method === "GET" && call.url.endsWith(`/storage/v1/bucket/${BUCKET_PENDING}`))).toBe(true);
  });

  it("fails with a clear error when a bucket is missing and cannot be created", async () => {
    const fake = fakeSupabase({ bucketCreate: 400, bucketLookup: 404 });
    vi.stubGlobal("fetch", vi.fn(fake.handler));

    const store = getBlobStore();
    await expect(
      store.createUploadTarget({
        videoId: "00000000-0000-4000-8000-000000000002",
        bucket: BUCKET_PENDING,
        key: "pending/00000000-0000-4000-8000-000000000002.mp4",
        contentType: "video/mp4",
      }),
    ).rejects.toThrow(`Supabase bucket setup failed for ${BUCKET_PENDING}`);
  });
});
