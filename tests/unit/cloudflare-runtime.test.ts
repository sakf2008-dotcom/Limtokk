import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { databaseSsl, getConfig } from "@/lib/server/config";
import { runtimeEnv } from "@/lib/server/runtime";
import { clientIpHash } from "@/lib/server/http";
import { BUCKET_PENDING, BUCKET_PUBLIC, getBlobStore, resetBlobStoreForTests, type R2BucketLike } from "@/lib/server/storage";

/**
 * Cloudflare behaviour without a Cloudflare account: an in-memory R2 bucket with the same method
 * shapes as the binding, and a FixedLengthStream that enforces the exact length like the runtime does.
 */

const CONTEXT = Symbol.for("__cloudflare-context__");
const DB_URL = "postgres://user:password@aws-0-eu-central-1.pooler.supabase.com:6543/postgres";
const SECRET = "cloudflare-runtime-test-secret-0123456789abcdef";

function concat(chunks: Uint8Array[]): Uint8Array {
  const total = chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
}

function streamOf(bytes: Uint8Array): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(bytes);
      controller.close();
    },
  });
}

async function readAll(stream: ReadableStream<Uint8Array>): Promise<Uint8Array> {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
  }
  return concat(chunks);
}

function fakeR2() {
  const objects = new Map<string, Uint8Array>();
  const bucket: R2BucketLike = {
    async head(key) {
      const stored = objects.get(key);
      return stored ? { size: stored.byteLength } : null;
    },
    async get(key, options) {
      const stored = objects.get(key);
      if (!stored) return null;
      const range = options?.range;
      const part = range ? stored.slice(range.offset, range.offset + range.length) : stored.slice();
      return {
        size: stored.byteLength,
        body: streamOf(part),
        async arrayBuffer() {
          return part.buffer.slice(part.byteOffset, part.byteOffset + part.byteLength) as ArrayBuffer;
        },
      };
    },
    async put(key, value) {
      objects.set(key, value instanceof ReadableStream ? await readAll(value) : new Uint8Array(value));
      return {};
    },
    async delete(keys) {
      for (const key of keys) objects.delete(key);
    },
  };
  return { bucket, objects };
}

/** Same contract as the Workers runtime: the stream must carry exactly `length` bytes. */
class FixedLengthStreamPolyfill extends TransformStream<Uint8Array, Uint8Array> {
  constructor(length: number) {
    let seen = 0;
    super({
      transform(chunk, controller) {
        seen += chunk.byteLength;
        if (seen > length) throw new Error("Stream is longer than the declared length.");
        controller.enqueue(chunk);
      },
      flush() {
        if (seen !== length) throw new Error("Stream is shorter than the declared length.");
      },
    });
  }
}

const saved: Record<string, string | undefined> = {};
// ILMTOK_DB_MODE is forced to "memory" by vitest.config; these tests need the database mode to follow DATABASE_URL.
const KEYS = ["DATABASE_URL", "ILMTOK_SECRET", "ADMIN_SESSION_SECRET", "ADMIN_PASSWORD", "VERCEL", "ILMTOK_DB_MODE"];

function enterCloudflare(env: Record<string, unknown>): void {
  (globalThis as Record<PropertyKey, unknown>)[CONTEXT] = { env };
}

beforeEach(() => {
  for (const key of KEYS) saved[key] = process.env[key];
  process.env.DATABASE_URL = DB_URL;
  process.env.ILMTOK_SECRET = SECRET;
  delete process.env.VERCEL;
  delete process.env.ILMTOK_DB_MODE;
  (globalThis as { FixedLengthStream?: unknown }).FixedLengthStream = FixedLengthStreamPolyfill;
  resetBlobStoreForTests();
});

afterEach(() => {
  delete (globalThis as Record<PropertyKey, unknown>)[CONTEXT];
  delete (globalThis as { FixedLengthStream?: unknown }).FixedLengthStream;
  for (const key of KEYS) {
    if (saved[key] === undefined) delete process.env[key];
    else process.env[key] = saved[key];
  }
  resetBlobStoreForTests();
});

describe("R2 storage on Cloudflare Workers", () => {
  it("selects R2 only on Cloudflare with the MEDIA binding", () => {
    expect(getConfig().storageMode).not.toBe("r2");
    enterCloudflare({ MEDIA: fakeR2().bucket });
    expect(getConfig().storageMode).toBe("r2");
    expect(getBlobStore().mode).toBe("r2");
  });

  it("streams uploads into R2, serves exact byte ranges, copies on approval, and deletes", async () => {
    const r2 = fakeR2();
    enterCloudflare({ MEDIA: r2.bucket });
    const store = getBlobStore();
    const bytes = new Uint8Array([10, 11, 12, 13, 14, 15, 16, 17]);
    const key = "clip/11111111-1111-4111-8111-111111111111.mp4";

    await store.putStream(BUCKET_PENDING, key, streamOf(bytes), bytes.length);
    expect(r2.objects.has(`${BUCKET_PENDING}/${key}`)).toBe(true);
    expect((await store.stat(BUCKET_PENDING, key))?.size).toBe(8);
    expect(Array.from(await store.readRange(BUCKET_PENDING, key, 2, 3))).toEqual([12, 13, 14]);
    expect(Array.from(await readAll((await store.openStream(BUCKET_PENDING, key, { offset: 6, length: 2 }))!))).toEqual([16, 17]);

    await store.copy(BUCKET_PENDING, key, BUCKET_PUBLIC, key);
    expect(Array.from(r2.objects.get(`${BUCKET_PUBLIC}/${key}`) ?? [])).toEqual(Array.from(bytes));

    await store.remove(BUCKET_PENDING, [key, "../escape.mp4", ""]);
    expect(r2.objects.has(`${BUCKET_PENDING}/${key}`)).toBe(false);
    expect(r2.objects.has(`${BUCKET_PUBLIC}/${key}`)).toBe(true);
  });

  it("refuses an upload body that does not match the declared length", async () => {
    enterCloudflare({ MEDIA: fakeR2().bucket });
    const store = getBlobStore();
    const bytes = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]);
    await expect(store.putStream(BUCKET_PENDING, "short.mp4", streamOf(bytes), 10)).rejects.toThrow();
  });

  it("gives the upload a relative content URL on the same site, like demo storage", async () => {
    enterCloudflare({ MEDIA: fakeR2().bucket });
    const target = await getBlobStore().createUploadTarget({
      videoId: "22222222-2222-4222-8222-222222222222",
      bucket: BUCKET_PENDING,
      key: "x.mp4",
      contentType: "video/mp4",
    });
    expect(target.url).toBe("/api/uploads/22222222-2222-4222-8222-222222222222/content");
    expect(target.method).toBe("PUT");
  });
});

describe("Cloudflare runtime settings", () => {
  it("passes a Hyperdrive connection string into the configuration without storing it", () => {
    delete process.env.DATABASE_URL;
    enterCloudflare({ HYPERDRIVE: { connectionString: "postgres://u:p@abc123.hyperdrive.local:5432/postgres" } });
    expect(runtimeEnv().DATABASE_URL).toBe("postgres://u:p@abc123.hyperdrive.local:5432/postgres");
    expect(getConfig().dbMode).toBe("postgres");
    expect(process.env.DATABASE_URL).toBeUndefined();
  });

  it("lets an explicit DATABASE_URL win over the Hyperdrive binding", () => {
    enterCloudflare({ HYPERDRIVE: { connectionString: "postgres://u:p@abc123.hyperdrive.local:5432/postgres" } });
    expect(runtimeEnv().DATABASE_URL).toBe(DB_URL);
  });

  it("does not use TLS for the Hyperdrive proxy, and does for remote databases", () => {
    expect(databaseSsl("postgres://u:p@abc123.hyperdrive.local:5432/postgres")).toBe(false);
    expect(databaseSsl(DB_URL)).toBe("require");
  });

  it("trusts cf-connecting-ip only on Cloudflare", () => {
    const first = new Request("https://example.test/", { headers: { "x-forwarded-for": "10.0.0.1", "cf-connecting-ip": "198.51.100.7" } });
    const second = new Request("https://example.test/", { headers: { "x-forwarded-for": "10.0.0.1", "cf-connecting-ip": "203.0.113.9" } });
    // Off Cloudflare a client could send any cf-connecting-ip, so both requests hash the same forwarded address.
    expect(clientIpHash(first)).toBe(clientIpHash(second));
    enterCloudflare({});
    expect(clientIpHash(first)).not.toBe(clientIpHash(second));
  });
});
