import { z } from "zod";
import { adminHandler } from "@/lib/server/admin-route";
import { json, readJson } from "@/lib/server/http";
import { createQuizByAdmin, deleteQuizByAdmin } from "@/lib/server/services/admin";

export const dynamic = "force-dynamic";

export const POST = adminHandler(async (req) => {
  const id = await createQuizByAdmin(await readJson(req), "admin");
  return json({ ok: true, id }, { status: 201 });
});

const deleteSchema = z.object({ id: z.string() });

export const DELETE = adminHandler(async (req) => {
  const { id } = deleteSchema.parse(await readJson(req));
  await deleteQuizByAdmin(id, "admin");
  return json({ ok: true });
});
