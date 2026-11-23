import { clientIpHash, handle, json } from "@/lib/server/http";
import { getDb } from "@/lib/server/db/client";
import { enforceRate } from "@/lib/server/rate-limit";
import { issuePowChallenge } from "@/lib/server/pow";

export const dynamic = "force-dynamic";

/** Issues a proof-of-work challenge for uploads and for comments sent in bursts. */
export const GET = handle(async (req) => {
  const db = await getDb();
  await enforceRate(db, `ip:${clientIpHash(req)}:challenge`, 120, 3600);
  return json(issuePowChallenge());
});
