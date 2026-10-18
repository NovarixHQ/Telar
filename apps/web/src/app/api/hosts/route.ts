import os from "node:os";
import { machineName } from "@/features/remote/server";
import { engineCall, engineRoute, requestObject } from "@/platform/engine/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export const POST = engineRoute(async (request: Request) => {
  const answer = await engineCall("POST", "/v2/hosts", { ...(await requestObject(request)), deviceName: machineName() ?? os.hostname() });
  return Response.json(answer.body, { status: answer.status });
});
