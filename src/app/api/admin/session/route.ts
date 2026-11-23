import { adminHandler } from "@/lib/server/admin-route";
import { json } from "@/lib/server/http";

export const dynamic = "force-dynamic";

/** Lets the admin pages check whether the session is still valid. */
export const GET = adminHandler(async () => json({ authenticated: true }));
