import { createHmac } from "node:crypto";
import { getConfig } from "../config";
import { checkPasswordAgainst } from "./password";
import { ApiError } from "../http";
import { randomToken, safeEqualHex } from "../crypto";

/**
 * Administrator authentication (the ONLY account type in IlmTok).
 *
 * - The password comes from the environment (ADMIN_PASSWORD_HASH preferred, or ADMIN_PASSWORD).
 *   It is never stored in code.
 * - A session is an HMAC-signed, expiring token kept in an HttpOnly, SameSite=Strict cookie.
 * - Sessions use their own signing key (ADMIN_SESSION_SECRET), separate from the data secret.
 */

export const ADMIN_COOKIE_NAME = "ilmtok_admin";
export const ADMIN_SESSION_SECONDS = 8 * 60 * 60;

export function isAdminConfigured(): boolean {
  const config = getConfig();
  return Boolean(config.adminSessionSecret && (config.adminPasswordHash || config.adminPassword));
}

export async function checkAdminPassword(password: string): Promise<boolean> {
  const config = getConfig();
  return checkPasswordAgainst(password, config.adminPasswordHash, config.adminPassword);
}

function sessionSecret(): string {
  const secret = getConfig().adminSessionSecret;
  if (!secret) throw new ApiError(503, "admin_not_configured", "لوحة الإدارة غير مُفعّلة في هذه النسخة.");
  return secret;
}

function sign(payload: string): string {
  return createHmac("sha256", sessionSecret()).update(`admin-session|${payload}`).digest("hex");
}

export function issueAdminSession(now: Date = new Date()): { token: string; maxAgeSeconds: number } {
  const expires = Math.floor(now.getTime() / 1000) + ADMIN_SESSION_SECONDS;
  const payload = `${expires}.${randomToken(16)}`;
  return { token: `${payload}.${sign(payload)}`, maxAgeSeconds: ADMIN_SESSION_SECONDS };
}

export function verifyAdminSession(token: string, now: Date = new Date()): boolean {
  const parts = token.split(".");
  if (parts.length !== 3) return false;
  const [expiresRaw, nonce, signature] = parts;
  const expires = Number(expiresRaw);
  if (!Number.isInteger(expires) || !nonce || !signature) return false;
  if (expires <= Math.floor(now.getTime() / 1000)) return false;
  const payload = `${expiresRaw}.${nonce}`;
  return safeEqualHex(signature, sign(payload));
}

export function readCookie(req: Request, name: string): string | null {
  const header = req.headers.get("cookie") ?? "";
  for (const part of header.split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === name) return rest.join("=") || null;
  }
  return null;
}

export function sessionCookie(token: string, maxAgeSeconds: number): string {
  const secure = getConfig().isProduction ? "; Secure" : "";
  return `${ADMIN_COOKIE_NAME}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAgeSeconds}${secure}`;
}

export function clearSessionCookie(): string {
  const secure = getConfig().isProduction ? "; Secure" : "";
  return `${ADMIN_COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0${secure}`;
}

/** Throws 401 unless the request carries a valid, unexpired admin session. */
export function requireAdmin(req: Request, now: Date = new Date()): void {
  if (!isAdminConfigured()) {
    throw new ApiError(503, "admin_not_configured", "لوحة الإدارة غير مُفعّلة. يلزم ضبط كلمة مرور المدير في إعدادات النشر.");
  }
  const token = readCookie(req, ADMIN_COOKIE_NAME);
  if (!token || !verifyAdminSession(token, now)) {
    throw new ApiError(401, "admin_required", "يلزم تسجيل دخول المدير للوصول إلى هذه الصفحة.");
  }
}
