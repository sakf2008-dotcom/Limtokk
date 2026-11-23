import { requireAdmin } from "./auth/admin";
import { assertSameOrigin, handle } from "./http";

/**
 * Wraps an admin route handler. Every admin endpoint goes through here, so the session check and
 * the same-origin check (for state-changing methods) cannot be forgotten on a single route.
 */
export function adminHandler<C = unknown>(fn: (req: Request, context: C) => Promise<Response>) {
  return handle<C>(async (req, context) => {
    requireAdmin(req);
    if (req.method !== "GET" && req.method !== "HEAD") {
      assertSameOrigin(req);
    }
    return fn(req, context);
  });
}
