import { handle, json } from "@/lib/server/http";
import { createRecoveryCode } from "@/lib/server/services/uploads";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

/**
 * Creates a one-time recovery code. It is returned once and only its keyed hash is stored, so the
 * owner must copy it. Creating a new code replaces the previous one.
 */
export const POST = handle<Ctx>(async (req, ctx) => {
  const { id } = await ctx.params;
  const { code } = await createRecoveryCode(req, id);
  return json({
    code,
    note: "احفظ هذا الرمز في مكان آمن. يُستخدم مرة واحدة فقط لاستعادة إدارة الفيديو على جهاز آخر.",
  });
});
