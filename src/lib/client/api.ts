"use client";

import { getDeviceId } from "./local";

export class ClientApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = "ClientApiError";
  }
}

interface ApiInit {
  method?: string;
  body?: unknown;
  /** Owner or comment token, sent as a bearer credential. */
  bearer?: string;
  signal?: AbortSignal;
  /** Raw body (for demo uploads); when set, `body` is ignored. */
  raw?: Blob;
  headers?: Record<string, string>;
}

/** Calls an IlmTok API route with the anonymous device header. Throws ClientApiError on failure. */
export async function api<T>(path: string, init: ApiInit = {}): Promise<T> {
  const headers: Record<string, string> = { "x-ilmtok-device": getDeviceId(), ...(init.headers ?? {}) };
  if (init.bearer) headers.authorization = `Bearer ${init.bearer}`;
  let body: BodyInit | undefined;
  if (init.raw) {
    body = init.raw;
  } else if (init.body !== undefined) {
    headers["content-type"] = "application/json";
    body = JSON.stringify(init.body);
  }
  const method = init.method ?? (body !== undefined ? "POST" : "GET");
  const response = await fetch(path, { method, headers, body, signal: init.signal, cache: "no-store", credentials: "same-origin" });
  const data = (await response.json().catch(() => null)) as
    | { error?: { code?: string; message?: string } & Record<string, unknown> }
    | Record<string, unknown>
    | null;
  if (!response.ok) {
    const errorBody = (data && "error" in data ? (data.error as Record<string, unknown> | undefined) : undefined) ?? {};
    throw new ClientApiError(
      response.status,
      typeof errorBody.code === "string" ? errorBody.code : "http_error",
      typeof errorBody.message === "string" ? errorBody.message : "تعذّر إكمال الطلب. حاول مرة أخرى.",
      errorBody,
    );
  }
  return data as T;
}

/** Friendly Arabic message for any thrown value. */
export function messageOf(error: unknown): string {
  if (error instanceof ClientApiError) return error.message;
  if (error instanceof DOMException && error.name === "AbortError") return "";
  return "تعذّر الاتصال بالخادم. تحقق من الإنترنت ثم حاول مرة أخرى.";
}
