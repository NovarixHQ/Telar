import { engineClient, engineRoute, requestObject } from "@/platform/engine/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Context = { params: Promise<{ projectId: string }> };

export const POST = engineRoute(async (request: Request, context: Context) => {
  const { projectId } = await context.params;
  const body = await requestObject(request);
  return Response.json(await (await engineClient()).relocateProject(projectId, typeof body.root === "string" ? body.root : ""));
});
