import { enginePipe, engineRoute } from "@/platform/engine/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Context = { params: Promise<{ path: string[] }> };

const handle = engineRoute(async (request: Request, context: Context) => {
  const { path } = await context.params;
  return enginePipe(request, `/v2/simulators/${path.map(encodeURIComponent).join("/")}${new URL(request.url).search}`);
});

export const GET = handle;
export const HEAD = handle;
export const POST = handle;
