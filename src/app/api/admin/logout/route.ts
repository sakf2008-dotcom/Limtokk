import { assertSameOrigin, handle, json } from "@/lib/server/http";
import { clearSessionCookie } from "@/lib/server/auth/admin";

export const dynamic = "force-dynamic";

export const POST = handle(async (req) => {
  assertSameOrigin(req);
  const response = json({ ok: true });
  response.headers.append("Set-Cookie", clearSessionCookie());
  return response;
});
