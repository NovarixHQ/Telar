import { engineClient, engineRoute, requestObject } from "@/platform/engine/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Context = { params: Promise<{ sessionId: string }> };

export const POST = engineRoute(async (request: Request, context: Context) => {
  const [{ sessionId }, body] = await Promise.all([context.params, requestObject(request)]);
  const texts = Array.isArray(body.texts) ? body.texts.filter((text): text is string => typeof text === "string") : [];
  return Response.json(await (await engineClient()).sessionFileReferences(sessionId, texts));
});
