import { promises as fs } from "node:fs";
import path from "node:path";
import { getConfig } from "../config";
import { ApiError } from "../http";

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
  readonly mode: "supabase" | "demo";
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
    private readonly maxBytes: number,
  ) {}

  private apiUrl(suffix: string): string {
    return `${this.baseUrl}/storage/v1${suffix}`;
  }

  private authHeaders(extra: Record<string, string> = {}): Record<string, string> {
    return { Authorization: `Bearer ${this.serviceKey}`, apikey: this.serviceKey, ...extra };
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
            file_size_limit: this.maxBytes,
          }),
        });
        // 400/409 usually mean "already exists". Anything else is a real configuration problem.
        if (!response.ok && response.status !== 409 && response.status !== 400) {
          this.bucketsReady = null;
          throw new Error(`Supabase bucket setup failed for ${bucket.id}: HTTP ${response.status}`);
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
  if (cachedStore) return cachedStore;
  if (config.storageMode === "supabase" && config.supabaseUrl && config.supabaseServiceKey) {
    cachedStore = new SupabaseBlobStore(config.supabaseUrl, config.supabaseServiceKey, 524_288_000);
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
