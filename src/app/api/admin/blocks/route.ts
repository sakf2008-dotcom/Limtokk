import { z } from "zod";
import { adminHandler } from "@/lib/server/admin-route";
import { json, readJson } from "@/lib/server/http";
import { blockDeviceByAdmin, unblockDeviceByAdmin } from "@/lib/server/services/admin";

export const dynamic = "force-dynamic";

export const POST = adminHandler(async (req) => {
  await blockDeviceByAdmin(await readJson(req), "admin");
  return json({ ok: true });
});

const unblockSchema = z.object({ deviceHash: z.string().regex(/^[0-9a-f]{64}$/) });

export const DELETE = adminHandler(async (req) => {
  const { deviceHash } = unblockSchema.parse(await readJson(req));
  await unblockDeviceByAdmin(deviceHash, "admin");
  return json({ ok: true });
});
