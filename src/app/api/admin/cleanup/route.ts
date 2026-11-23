import { adminHandler } from "@/lib/server/admin-route";
import { json } from "@/lib/server/http";
import { runCleanupByAdmin } from "@/lib/server/services/admin";

export const dynamic = "force-dynamic";

export const POST = adminHandler(async () => json({ summary: await runCleanupByAdmin("admin") }));
