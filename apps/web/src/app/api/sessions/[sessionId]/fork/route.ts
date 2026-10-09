import { engineClient, engineRoute, requestObject } from "@/platform/engine/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export const POST = engineRoute(async (request: Request, { params }: { params: Promise<{ sessionId: string }> }) => {
  const { sessionId } = await params;
  const input = await requestObject(request);
  return Response.json(await (await engineClient()).forkSession(sessionId, String(input.runId ?? "")), { status: 201 });
});
