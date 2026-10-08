import { enginePipe, engineRoute } from "@/platform/engine/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Context = { params: Promise<{ sessionId: string; simulatorId: string }> };

export const POST = engineRoute(async (request: Request, context: Context) => {
  const { sessionId, simulatorId } = await context.params;
  return enginePipe(request, `/v2/sessions/${encodeURIComponent(sessionId)}/simulators/${encodeURIComponent(simulatorId)}`);
});
