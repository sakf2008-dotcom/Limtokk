import { ZodError } from "zod";
import { hmacHex } from "./crypto";

/** Error with an HTTP status and a stable machine-readable code. Messages are shown to users (Arabic). */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export function json(body: unknown, init: ResponseInit = {}): Response {
  const headers = new Headers(init.headers);
  headers.set("Cache-Control", "no-store");
  headers.set("Content-Type", "application/json; charset=utf-8");
  return new Response(JSON.stringify(body), { ...init, headers });
}

export function errorResponse(error: unknown): Response {
  if (error instanceof ApiError) {
    return json({ error: { code: error.code, message: error.message, ...(error.details ?? {}) } }, { status: error.status });
  }
  if (error instanceof ZodError) {
    return json(
      {
        error: {
          code: "invalid_input",
          message: "بعض البيانات غير صحيحة. راجع الحقول وحاول مرة أخرى.",
          issues: error.issues.map((issue) => ({ path: issue.path.join("."), message: issue.message })),
        },
      },
      { status: 400 },
    );
  }
  // Log the details server-side only. Never send stack traces or SQL errors to clients.
  console.error("[api] unexpected error:", error instanceof Error ? error.stack ?? error.message : error);
  return json(
    { error: { code: "internal_error", message: "حدث خطأ غير متوقع. حاول مرة أخرى بعد قليل." } },
    { status: 500 },
  );
}

type RouteHandler<C> = (req: Request, context: C) => Promise<Response>;

/** Wraps a route handler so that thrown errors become consistent JSON responses. */
export function handle<C = unknown>(fn: RouteHandler<C>): RouteHandler<C> {
  return async (req, context) => {
    try {
      return await fn(req, context);
    } catch (error) {
      return errorResponse(error);
    }
  };
}

const MAX_JSON_BYTES = 64 * 1024;

export async function readJson(req: Request, maxBytes = MAX_JSON_BYTES): Promise<unknown> {
  const declared = Number(req.headers.get("content-length") ?? "0");
  if (Number.isFinite(declared) && declared > maxBytes) {
    throw new ApiError(413, "payload_too_large", "حجم البيانات المُرسلة كبير جدًا.");
  }
  const text = await req.text();
  if (Buffer.byteLength(text, "utf8") > maxBytes) {
    throw new ApiError(413, "payload_too_large", "حجم البيانات المُرسلة كبير جدًا.");
  }
  if (text.trim() === "") return {};
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new ApiError(400, "invalid_json", "صيغة البيانات المُرسلة غير صحيحة.");
  }
}

const DEVICE_ID_PATTERN = /^[A-Za-z0-9_-]{16,80}$/;

/** HMAC of the anonymous device id sent by the browser, or null if absent or malformed. */
export function deviceHashFrom(req: Request): string | null {
  const raw = req.headers.get("x-ilmtok-device")?.trim() ?? "";
  if (!DEVICE_ID_PATTERN.test(raw)) return null;
  return hmacHex(raw, "device");
}

export function requireDeviceHash(req: Request): string {
  const hash = deviceHashFrom(req);
  if (!hash) {
    throw new ApiError(400, "device_required", "تعذّر التعرف على جهازك. أعد تحميل الصفحة ثم حاول مرة أخرى.");
  }
  return hash;
}

/** Hashed client IP used only for coarse rate limiting. The raw IP is never stored. */
export function clientIpHash(req: Request): string {
  const forwarded = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  const ip = forwarded || req.headers.get("x-real-ip")?.trim() || "unknown";
  return hmacHex(ip, "ip");
}

export function bearerToken(req: Request): string | null {
  const header = req.headers.get("authorization") ?? "";
  const match = /^Bearer\s+([A-Za-z0-9_-]{20,200})$/.exec(header.trim());
  return match?.[1] ?? null;
}

/** Rejects cross-site state-changing requests (basic CSRF protection in addition to SameSite cookies). */
export function assertSameOrigin(req: Request): void {
  if (req.method === "GET" || req.method === "HEAD") return;
  const origin = req.headers.get("origin");
  const expected = new URL(req.url).origin;
  if (!origin || origin !== expected) {
    throw new ApiError(403, "bad_origin", "طلب غير مسموح به من هذا المصدر.");
  }
}

export function clampInt(value: string | null, fallback: number, min: number, max: number): number {
  const parsed = Number.parseInt(value ?? "", 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}
