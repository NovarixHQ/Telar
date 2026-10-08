import type { EngineIdentity, HostIdentity } from "@telar/engine-client";
import { advertisedAddresses } from "@/features/remote/server";
import { engineCall, engineRoute } from "@/platform/engine/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export const GET = engineRoute(async () => {
  const answer = await engineCall("GET", "/v2/identity");
  if (answer.status !== 200) return Response.json(answer.body, { status: answer.status, headers: { "cache-control": "no-store" } });
  const identity: HostIdentity = { ...(answer.body as EngineIdentity), addresses: advertisedAddresses() };
  return Response.json(identity, { headers: { "cache-control": "no-store" } });
});
