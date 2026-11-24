import { promises as fs } from "node:fs";
import path from "node:path";
import { getConfig } from "../config";
import { ApiError } from "../http";
import { cloudflareBinding } from "../runtime";

/**
 * Object storage abstraction.
 *
 * Two private/public buckets are used in production:
 *  - BUCKET_PENDING: private. Uploaded files wait here until a human approves them.
 *  - BUCKET_PUBLIC:  public read. Approved files only. Nothing is ever written to it directly by clients.
 *
 * Clients never receive a write permission on a bucket. They receive a short-lived, single-object
 * upload URL that the server creates after validating quotas, and the upload is confirmed by the
 * server before the file is trusted.
 */

export const BUCKET_PENDING = "ilmtok-pending";
export const BUCKET_PUBLIC = "ilmtok-public";
export type BucketName = typeof BUCKET_PENDING | typeof BUCKET_PUBLIC;

export interface UploadTarget {
  method: "PUT";
  url: string;
  headers: Record<string, string>;
  expiresInSeconds: number;
}

export interface StoredObjectInfo {
  size: number;
}

export interface BlobStore {
  readonly mode: "supabase" | "demo" | "r2";
  createUploadTarget(args: {
    videoId: string;
    bucket: BucketName;
    key: string;
    contentType: string;
  }): Promise<UploadTarget>;
  stat(bucket: BucketName, key: string): Promise<StoredObjectInfo | null>;
  readRange(bucket: BucketName, key: string, start: number, length: number): Promise<Uint8Array>;
  copy(fromBucket: BucketName, fromKey: string, toBucket: BucketName, toKey: string): Promise<void>;
  remove(bucket: BucketName, keys: string[]): Promise<void>;
  signedReadUrl(bucket: BucketName, key: string, ttlSeconds: number): Promise<string>;
  publicUrl(bucket: BucketName, key: string): string | null;
  /** Reads a whole object for demo-mode streaming. Only used by the demo storage implementation. */
  readFile(bucket: BucketName, key: string): Promise<Buffer>;
  writeFile(bucket: BucketName, key: string, data: Buffer): Promise<void>;
  /** Streams a stored object, or one byte range of it. Null when the object does not exist. */
  openStream(bucket: BucketName, key: string, range?: { offset: number; length: number }): Promise<ReadableStream<Uint8Array> | null>;
  /** Stores a body of known length. R2 streams it; demo storage buffers it. */
  putStream(bucket: BucketName, key: string, body: ReadableStream<Uint8Array>, length: number): Promise<void>;
}

const UPLOAD_URL_TTL_SECONDS = 15 * 60;

function assertSafeKey(key: string): void {
  if (!/^[A-Za-z0-9/_.-]{1,200}$/.test(key) || key.includes("..") || key.startsWith("/")) {
    throw new ApiError(400, "invalid_storage_key", "مسار الملف غير صالح.");
  }
}

function encodeKey(key: string): string {
  return key.split("/").map(encodeURIComponent).join("/");
}

class SupabaseBlobStore implements BlobStore {
  readonly mode = "supabase" as const;
  private bucketsReady: Promise<void> | null = null;

  constructor(
    private readonly baseUrl: string,
    private readonly serviceKey: string,
  ) {}

  private apiUrl(suffix: string): string {
    return `${this.baseUrl}/storage/v1${suffix}`;
  }

  private authHeaders(extra: Record<string, string> = {}): Record<string, string> {
    return { Authorization: `Bearer ${this.serviceKey}`, apikey: this.serviceKey, ...extra };
  }

  /** True when a bucket with this id exists. Used to confirm a "duplicate" answer from Supabase. */
  private async bucketExists(id: string): Promise<boolean> {
    const response = await fetch(this.apiUrl(`/bucket/${id}`), { headers: this.authHeaders() });
    await response.arrayBuffer().catch(() => undefined);
    return response.ok;
  }

  /** Creates the two buckets once per process. Existing buckets are left as they are. */
  ensureBuckets(): Promise<void> {
    this.bucketsReady ??= (async () => {
      const wanted = [
        { id: BUCKET_PENDING, public: false },
        { id: BUCKET_PUBLIC, public: true },
      ];
      for (const bucket of wanted) {
        const response = await fetch(this.apiUrl("/bucket"), {
          method: "POST",
          headers: this.authHeaders({ "Content-Type": "application/json" }),
          body: JSON.stringify({
            id: bucket.id,
            name: bucket.id,
            public: bucket.public,
          }),
        });
        // Supabase answers 400 or 409 when a bucket already exists. A lookup confirms that, so a real
        // configuration problem is never hidden behind a "duplicate" answer.
        if (!response.ok) {
          const exists = (response.status === 400 || response.status === 409) && (await this.bucketExists(bucket.id));
          if (!exists) {
            this.bucketsReady = null;
            throw new Error(`Supabase bucket setup failed for ${bucket.id}: HTTP ${response.status}`);
          }
        }
      }
    })();
    return this.bucketsReady;
  }

  async createUploadTarget(args: {
    videoId: string;
    bucket: BucketName;
    key: string;
    contentType: string;
  }): Promise<UploadTarget> {
    assertSafeKey(args.key);
    await this.ensureBuckets();
    const response = await fetch(this.apiUrl(`/object/upload/sign/${args.bucket}/${encodeKey(args.key)}`), {
      method: "POST",
      headers: this.authHeaders({ "Content-Type": "application/json", "x-upsert": "false" }),
      body: "{}",
    });
    if (!response.ok) {
      throw new Error(`Supabase signed upload failed: HTTP ${response.status}`);
    }
    const body = (await response.json()) as { url?: string; signedURL?: string };
    const relative = body.url ?? body.signedURL;
    if (!relative) throw new Error("Supabase signed upload response did not include a URL.");
    return {
      method: "PUT",
      url: relative.startsWith("http") ? relative : this.apiUrl(relative),
      headers: { "Content-Type": args.contentType, "x-upsert": "false" },
      expiresInSeconds: UPLOAD_URL_TTL_SECONDS,
    };
  }

  async stat(bucket: BucketName, key: string): Promise<StoredObjectInfo | null> {
    assertSafeKey(key);
    // A one-byte range request returns the total size in Content-Range, without downloading the file.
    const response = await fetch(this.apiUrl(`/object/${bucket}/${encodeKey(key)}`), {
      method: "GET",
      headers: this.authHeaders({ Range: "bytes=0-0" }),
    });
    if (response.status === 404 || response.status === 400) return null;
    if (!response.ok && response.status !== 206) {
      throw new Error(`Supabase stat failed: HTTP ${response.status}`);
    }
    await response.arrayBuffer();
    const range = response.headers.get("content-range");
    const total = range?.split("/")[1];
    const size = total ? Number(total) : Number(response.headers.get("content-length") ?? "NaN");
    if (!Number.isFinite(size)) return null;
    return { size };
  }

  async readRange(bucket: BucketName, key: string, start: number, length: number): Promise<Uint8Array> {
    assertSafeKey(key);
    const response = await fetch(this.apiUrl(`/object/${bucket}/${encodeKey(key)}`), {
      method: "GET",
      headers: this.authHeaders({ Range: `bytes=${start}-${start + length - 1}` }),
    });
    if (!response.ok && response.status !== 206) {
      throw new Error(`Supabase range read failed: HTTP ${response.status}`);
    }
    const buffer = new Uint8Array(await response.arrayBuffer());
    if (response.status === 200 && buffer.length !== length) {
      // The server ignored the Range header; slice locally.
      return buffer.subarray(start, start + length);
    }
    return buffer.subarray(0, length);
  }

  async copy(fromBucket: BucketName, fromKey: string, toBucket: BucketName, toKey: string): Promise<void> {
    assertSafeKey(fromKey);
    assertSafeKey(toKey);
    const response = await fetch(this.apiUrl("/object/copy"), {
      method: "POST",
      headers: this.authHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify({
        bucketId: fromBucket,
        sourceKey: fromKey,
        destinationBucket: toBucket,
        destinationKey: toKey,
      }),
    });
    if (!response.ok) throw new Error(`Supabase copy failed: HTTP ${response.status}`);
  }

  async remove(bucket: BucketName, keys: string[]): Promise<void> {
    const safeKeys = keys.filter((key) => key && /^[A-Za-z0-9/_.-]{1,200}$/.test(key));
    if (safeKeys.length === 0) return;
    const response = await fetch(this.apiUrl(`/object/${bucket}`), {
      method: "DELETE",
      headers: this.authHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify({ prefixes: safeKeys }),
    });
    if (!response.ok && response.status !== 404) {
      throw new Error(`Supabase delete failed: HTTP ${response.status}`);
    }
  }

  async signedReadUrl(bucket: BucketName, key: string, ttlSeconds: number): Promise<string> {
    assertSafeKey(key);
    const response = await fetch(this.apiUrl(`/object/sign/${bucket}/${encodeKey(key)}`), {
      method: "POST",
      headers: this.authHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify({ expiresIn: ttlSeconds }),
    });
    if (!response.ok) throw new Error(`Supabase signed read failed: HTTP ${response.status}`);
    const body = (await response.json()) as { signedURL?: string; signedUrl?: string };
    const relative = body.signedURL ?? body.signedUrl;
    if (!relative) throw new Error("Supabase signed read response did not include a URL.");
    return relative.startsWith("http") ? relative : this.apiUrl(relative);
  }

  publicUrl(bucket: BucketName, key: string): string | null {
    if (bucket !== BUCKET_PUBLIC) return null;
    return this.apiUrl(`/object/public/${bucket}/${encodeKey(key)}`);
  }

  async readFile(): Promise<Buffer> {
    throw new Error("readFile is only available in demo storage.");
  }

  async writeFile(): Promise<void> {
    throw new Error("writeFile is only available in demo storage.");
  }

  async openStream(): Promise<ReadableStream<Uint8Array> | null> {
    throw new Error("With Supabase Storage, media is served from Supabase public URLs.");
  }

  async putStream(): Promise<void> {
    throw new Error("With Supabase Storage, uploads use signed URLs.");
  }
}

/** Local disk storage for development. Not durable on serverless hosts. */
class DemoBlobStore implements BlobStore {
  readonly mode = "demo" as const;
  private readonly root = path.join(process.cwd(), ".ilmtok-demo", "storage");

  private filePath(bucket: BucketName, key: string): string {
    assertSafeKey(key);
    const target = path.resolve(this.root, bucket, key);
    if (!target.startsWith(path.resolve(this.root, bucket) + path.sep)) {
      throw new ApiError(400, "invalid_storage_key", "مسار الملف غير صالح.");
    }
    return target;
  }

  async createUploadTarget(args: { videoId: string; bucket: BucketName; key: string; contentType: string }): Promise<UploadTarget> {
    assertSafeKey(args.key);
    return {
      method: "PUT",
      url: `/api/uploads/${args.videoId}/content`,
      headers: { "Content-Type": args.contentType },
      expiresInSeconds: UPLOAD_URL_TTL_SECONDS,
    };
  }

  async stat(bucket: BucketName, key: string): Promise<StoredObjectInfo | null> {
    try {
      const stats = await fs.stat(this.filePath(bucket, key));
      return { size: stats.size };
    } catch {
      return null;
    }
  }

  async readRange(bucket: BucketName, key: string, start: number, length: number): Promise<Uint8Array> {
    const handle = await fs.open(this.filePath(bucket, key), "r");
    try {
      const buffer = Buffer.alloc(length);
      const { bytesRead } = await handle.read(buffer, 0, length, start);
      return buffer.subarray(0, bytesRead);
    } finally {
      await handle.close();
    }
  }

  async copy(fromBucket: BucketName, fromKey: string, toBucket: BucketName, toKey: string): Promise<void> {
    const destination = this.filePath(toBucket, toKey);
    await fs.mkdir(path.dirname(destination), { recursive: true });
    await fs.copyFile(this.filePath(fromBucket, fromKey), destination);
  }

  async remove(bucket: BucketName, keys: string[]): Promise<void> {
    for (const key of keys) {
      if (!key) continue;
      await fs.rm(this.filePath(bucket, key), { force: true });
    }
  }

  async signedReadUrl(bucket: BucketName, key: string): Promise<string> {
    assertSafeKey(key);
    return `/api/media/${bucket}/${key}`;
  }

  publicUrl(bucket: BucketName, key: string): string | null {
    if (bucket !== BUCKET_PUBLIC) return null;
    return `/api/media/${bucket}/${key}`;
  }

  async readFile(bucket: BucketName, key: string): Promise<Buffer> {
    return fs.readFile(this.filePath(bucket, key));
  }

  async writeFile(bucket: BucketName, key: string, data: Buffer): Promise<void> {
    const target = this.filePath(bucket, key);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, data);
  }

  async openStream(bucket: BucketName, key: string, range?: { offset: number; length: number }): Promise<ReadableStream<Uint8Array> | null> {
    const info = await this.stat(bucket, key);
    if (!info) return null;
    const bytes = range ? await this.readRange(bucket, key, range.offset, range.length) : await this.readFile(bucket, key);
    return new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(bytes));
        controller.close();
      },
    });
  }

  async putStream(bucket: BucketName, key: string, body: ReadableStream<Uint8Array>): Promise<void> {
    const reader = body.getReader();
    const parts: Uint8Array[] = [];
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      parts.push(value);
    }
    await this.writeFile(bucket, key, Buffer.concat(parts));
  }
}

/** The part of the R2 bucket binding that this code uses. Cloudflare's own types are not needed here. */
export interface R2ObjectLike {
  size: number;
  body: ReadableStream<Uint8Array>;
  arrayBuffer(): Promise<ArrayBuffer>;
}

export interface R2BucketLike {
  head(key: string): Promise<{ size: number } | null>;
  get(key: string, options?: { range?: { offset: number; length: number } }): Promise<R2ObjectLike | null>;
  put(key: string, value: ReadableStream<Uint8Array> | Uint8Array): Promise<unknown>;
  delete(keys: string[]): Promise<void>;
}

type FixedLengthStreamCtor = new (length: number) => TransformStream<Uint8Array, Uint8Array>;

/** Workers-only stream that enforces an exact length, which R2 needs for streamed writes. */
function fixedLength(length: number): TransformStream<Uint8Array, Uint8Array> {
  const Ctor = (globalThis as { FixedLengthStream?: FixedLengthStreamCtor }).FixedLengthStream;
  if (!Ctor) throw new Error("FixedLengthStream is only available on Cloudflare Workers.");
  return new Ctor(length);
}

/**
 * Cloudflare R2 through the MEDIA binding. Bytes stream through the Worker, so a 50 MB upload is never
 * held whole in memory. Object names are "<bucket>/<key>" in one R2 bucket.
 */
class R2BlobStore implements BlobStore {
  readonly mode = "r2" as const;

  constructor(private readonly bucket: R2BucketLike) {}

  private objectName(bucket: BucketName, key: string): string {
    assertSafeKey(key);
    return `${bucket}/${key}`;
  }

  async createUploadTarget(args: { videoId: string; bucket: BucketName; key: string; contentType: string }): Promise<UploadTarget> {
    assertSafeKey(args.key);
    return {
      method: "PUT",
      url: `/api/uploads/${args.videoId}/content`,
      headers: { "Content-Type": args.contentType },
      expiresInSeconds: UPLOAD_URL_TTL_SECONDS,
    };
  }

  async stat(bucket: BucketName, key: string): Promise<StoredObjectInfo | null> {
    const head = await this.bucket.head(this.objectName(bucket, key));
    return head ? { size: head.size } : null;
  }

  async readRange(bucket: BucketName, key: string, start: number, length: number): Promise<Uint8Array> {
    const object = await this.bucket.get(this.objectName(bucket, key), { range: { offset: start, length } });
    return object ? new Uint8Array(await object.arrayBuffer()) : new Uint8Array(0);
  }

  async openStream(bucket: BucketName, key: string, range?: { offset: number; length: number }): Promise<ReadableStream<Uint8Array> | null> {
    const object = await this.bucket.get(this.objectName(bucket, key), range ? { range } : undefined);
    return object ? object.body : null;
  }

  async putStream(bucket: BucketName, key: string, body: ReadableStream<Uint8Array>, length: number): Promise<void> {
    await this.bucket.put(this.objectName(bucket, key), body.pipeThrough(fixedLength(length)));
  }

  async copy(fromBucket: BucketName, fromKey: string, toBucket: BucketName, toKey: string): Promise<void> {
    const source = await this.bucket.get(this.objectName(fromBucket, fromKey));
    if (!source) throw new Error("Source object is missing.");
    await this.bucket.put(this.objectName(toBucket, toKey), source.body.pipeThrough(fixedLength(source.size)));
  }

  async remove(bucket: BucketName, keys: string[]): Promise<void> {
    const names = keys
      .filter((key) => key && /^[A-Za-z0-9/_.-]{1,200}$/.test(key) && !key.includes("..") && !key.startsWith("/"))
      .map((key) => `${bucket}/${key}`);
    if (names.length > 0) await this.bucket.delete(names);
  }

  async signedReadUrl(): Promise<string> {
    throw new Error("Signed URLs are not used with R2 bindings.");
  }

  publicUrl(bucket: BucketName, key: string): string | null {
    return bucket === BUCKET_PUBLIC ? `/api/media/${BUCKET_PUBLIC}/${encodeKey(key)}` : null;
  }

  async readFile(bucket: BucketName, key: string): Promise<Buffer> {
    const object = await this.bucket.get(this.objectName(bucket, key));
    if (!object) throw new Error("Object is missing.");
    return Buffer.from(await object.arrayBuffer());
  }

  async writeFile(bucket: BucketName, key: string, data: Buffer): Promise<void> {
    await this.bucket.put(this.objectName(bucket, key), new Uint8Array(data));
  }
}

let cachedStore: BlobStore | null = null;

export class StorageUnavailableError extends ApiError {
  constructor() {
    super(
      503,
      "storage_unavailable",
      "رفع الفيديوهات غير مُفعّل في هذه النسخة. ستظهر لك رسالة واضحة عند تفعيل التخزين الدائم.",
    );
  }
}

/** Returns the configured storage, or throws StorageUnavailableError when uploads must be refused. */
export function getBlobStore(): BlobStore {
  const config = getConfig();
  if (config.storageMode === "disabled") throw new StorageUnavailableError();
  if (config.storageMode === "r2") {
    // Bindings belong to the request, so the adapter is created per request and not cached.
    const bucket = cloudflareBinding<R2BucketLike>("MEDIA");
    if (!bucket) throw new StorageUnavailableError();
    return new R2BlobStore(bucket);
  }
  if (cachedStore) return cachedStore;
  if (config.storageMode === "supabase" && config.supabaseUrl && config.supabaseServiceKey) {
    cachedStore = new SupabaseBlobStore(config.supabaseUrl, config.supabaseServiceKey);
  } else {
    cachedStore = new DemoBlobStore();
  }
  return cachedStore;
}

/** Storage is only "available" for uploads when it is not disabled. */
export function isStorageAvailable(): boolean {
  return getConfig().storageMode !== "disabled";
}

/** Test helper. */
export function resetBlobStoreForTests(): void {
  cachedStore = null;
}
