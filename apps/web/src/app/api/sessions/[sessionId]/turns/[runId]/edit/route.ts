import { engineClient, engineRoute, requestObject } from "@/platform/engine/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Context = { params: Promise<{ sessionId: string; runId: string }> };

export const POST = engineRoute(async (request: Request, context: Context) => {
  const { sessionId, runId } = await context.params;
  const body = await requestObject(request);
  return Response.json(await (await engineClient()).editQueuedTurn(sessionId, runId, body.input as string));
});
