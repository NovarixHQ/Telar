import { engineClient, requestObject, engineRoute } from "@/platform/engine/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Context = { params: Promise<{ sessionId: string; method: string[] }> };

/** Released phones still call `latex/<method>`; it is LaTeX's plugin door. Remove once they use `plugins/latex`. */
export const POST = engineRoute(async (request: Request, context: Context) => {
  const { sessionId, method } = await context.params;
  const body = await requestObject(request);
  return Response.json(await (await engineClient()).plugin(sessionId, "latex", method.map(encodeURIComponent).join("/"), body));
});
