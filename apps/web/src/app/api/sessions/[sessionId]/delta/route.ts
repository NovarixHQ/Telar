import { engineClient, engineRoute, invalidRequest } from "@/platform/engine/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Context = { params: Promise<{ sessionId: string }> };

export const GET = engineRoute(async (request: Request, context: Context) => {
  const after = Number(new URL(request.url).searchParams.get("after") ?? "0");
  if (!Number.isSafeInteger(after) || after < 0) throw invalidRequest("Event cursor must be a non-negative integer.");
  const { sessionId } = await context.params;
  return Response.json(await (await engineClient()).sessionDelta(sessionId, after));
});
