import { engineClient, engineRoute, requestObject } from "@/platform/engine/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export const POST = engineRoute(async (request: Request, { params }: { params: Promise<{ sessionId: string }> }) => {
  const { sessionId } = await params;
  const input = await requestObject(request);
  return Response.json(await (await engineClient()).handOffSession(sessionId, typeof input.to === "string" ? { to: input.to } : {}));
});
