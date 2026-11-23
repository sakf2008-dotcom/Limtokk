import { afterAll, describe, expect, it } from "vitest";
import { resetDbForTests } from "@/lib/server/db/client";
import { requireAdmin, issueAdminSession, ADMIN_COOKIE_NAME } from "@/lib/server/auth/admin";
import { POST as login } from "@/app/api/admin/login/route";
import { GET as overview } from "@/app/api/admin/overview/route";
import { POST as videoAction } from "@/app/api/admin/videos/[id]/route";
import { POST as logout } from "@/app/api/admin/logout/route";

afterAll(async () => {
  await resetDbForTests();
});

let ipCounter = 0;
function ip(): string {
  ipCounter += 1;
  return `192.0.2.${ipCounter}`;
}

function loginRequest(password: string, origin = "http://localhost"): Request {
  return new Request("http://localhost/api/admin/login", {
    method: "POST",
    headers: { "content-type": "application/json", origin, "x-forwarded-for": ip() },
    body: JSON.stringify({ password }),
  });
}

function cookieFrom(response: Response): string {
  const header = response.headers.get("set-cookie") ?? "";
  const match = new RegExp(`${ADMIN_COOKIE_NAME}=([^;]+)`).exec(header);
  if (!match?.[1]) throw new Error("no session cookie");
  return match[1];
}

// Route handlers convert errors into JSON responses, so these tests assert HTTP status codes.
describe("administrator authentication", () => {
  it("refuses admin pages and actions without a session", async () => {
    const page = await overview(new Request("http://localhost/api/admin/overview"), undefined as never);
    expect(page.status).toBe(401);
    expect(() => requireAdmin(new Request("http://localhost/api/admin/overview"))).toThrow();
    const action = await videoAction(
      new Request("http://localhost/api/admin/videos/x", { method: "POST", headers: { origin: "http://localhost" } }),
      { params: Promise.resolve({ id: "00000000-0000-4000-8000-000000000000" }) },
    );
    expect(action.status).toBe(401);
  });

  it("rejects a wrong password without revealing details", async () => {
    const response = await login(loginRequest("definitely-wrong-password"), undefined as never);
    expect(response.status).toBe(401);
    const body = (await response.json()) as { error: { code: string; message: string } };
    expect(body.error.code).toBe("invalid_credentials");
  });

  it("issues an HttpOnly, SameSite=Strict session cookie for the right password", async () => {
    const response = await login(loginRequest("test-admin-password-long-enough"), undefined as never);
    expect(response.status).toBe(200);
    const header = response.headers.get("set-cookie") ?? "";
    expect(header).toContain("HttpOnly");
    expect(header).toContain("SameSite=Strict");
    const token = cookieFrom(response);
    const allowed = await overview(new Request("http://localhost/api/admin/overview", { headers: { cookie: `${ADMIN_COOKIE_NAME}=${token}` } }), undefined as never);
    expect(allowed.status).toBe(200);
  });

  it("rejects tampered and expired session tokens", () => {
    const { token } = issueAdminSession();
    const tampered = token.slice(0, -2) + (token.endsWith("aa") ? "bb" : "aa");
    expect(() => requireAdmin(new Request("http://localhost/x", { headers: { cookie: `${ADMIN_COOKIE_NAME}=${tampered}` } }))).toThrow();
    const fresh = issueAdminSession(new Date("2030-01-01T00:00:00Z")).token;
    expect(() =>
      requireAdmin(new Request("http://localhost/x", { headers: { cookie: `${ADMIN_COOKIE_NAME}=${fresh}` } }), new Date("2031-01-01T00:00:00Z")),
    ).toThrow();
  });

  it("blocks cross-site state-changing requests (origin mismatch)", async () => {
    const { token } = issueAdminSession();
    const crossSite = new Request("http://localhost/api/admin/logout", {
      method: "POST",
      headers: { origin: "https://evil.example", cookie: `${ADMIN_COOKIE_NAME}=${token}` },
    });
    const response = await logout(crossSite, undefined as never);
    expect(response.status).toBe(403);
  });

  it("limits repeated login attempts from one client", async () => {
    const address = ip();
    let blocked = false;
    for (let i = 0; i < 12 && !blocked; i += 1) {
      const response = await login(
        new Request("http://localhost/api/admin/login", {
          method: "POST",
          headers: { "content-type": "application/json", origin: "http://localhost", "x-forwarded-for": address },
          body: JSON.stringify({ password: "wrong-wrong-wrong" }),
        }),
        undefined as never,
      );
      blocked = response.status === 429;
    }
    expect(blocked).toBe(true);
  });
});
