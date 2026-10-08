import { engineClient, engineRoute } from "@/platform/engine/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Context = { params: Promise<{ agentId: string }> };

export const POST = engineRoute(async (_request: Request, context: Context) => {
  const { agentId } = await context.params;
  return Response.json(await (await engineClient()).installAgent(agentId));
});
