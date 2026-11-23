import { appendAudit } from "@/lib/server/repo/ops";
import { checkAdminPassword, isAdminConfigured, issueAdminSession, sessionCookie } from "@/lib/server/auth/admin";
import { ApiError, assertSameOrigin, clientIpHash, handle, json, readJson } from "@/lib/server/http";
import { getDb } from "@/lib/server/db/client";
import { enforceRate } from "@/lib/server/rate-limit";

export const dynamic = "force-dynamic";

/** Admin sign-in. Rate limited per client IP. Returns a session cookie on success. */
export const POST = handle(async (req) => {
  assertSameOrigin(req);
  if (!isAdminConfigured()) {
    throw new ApiError(503, "admin_not_configured", "لوحة الإدارة غير مُفعّلة. يلزم ضبط كلمة مرور المدير في إعدادات النشر.");
  }
  const db = await getDb();
  await enforceRate(db, `ip:${clientIpHash(req)}:admin-login`, 8, 900, "محاولات كثيرة. انتظر 15 دقيقة ثم حاول مرة أخرى.");

  const body = (await readJson(req)) as { password?: unknown };
  const password = typeof body.password === "string" ? body.password : "";
  const valid = await checkAdminPassword(password);
  if (!valid) {
    await appendAudit(db, { actor: "anonymous", action: "admin.login_failed", targetType: "auth", targetId: null, details: {} });
    throw new ApiError(401, "invalid_credentials", "كلمة المرور غير صحيحة.");
  }

  const { token, maxAgeSeconds } = issueAdminSession();
  await appendAudit(db, { actor: "admin", action: "admin.login", targetType: "auth", targetId: null, details: {} });
  const response = json({ ok: true });
  response.headers.append("Set-Cookie", sessionCookie(token, maxAgeSeconds));
  return response;
});
