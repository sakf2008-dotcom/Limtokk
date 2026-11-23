import { adminHandler } from "@/lib/server/admin-route";
import { json } from "@/lib/server/http";
import { getOverview } from "@/lib/server/services/admin";

export const dynamic = "force-dynamic";

export const GET = adminHandler(async () => json(await getOverview()));
