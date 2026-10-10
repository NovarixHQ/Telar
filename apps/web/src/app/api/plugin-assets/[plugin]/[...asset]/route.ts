import { engineClient, engineRoute } from "@/platform/engine/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Context = { params: Promise<{ plugin: string; asset: string[] }> };

/** A file from a plugin's `views/` folder, which its sandboxed frames are drawn from. */
export const GET = engineRoute(async (_request: Request, context: Context) => {
  const { plugin, asset } = await context.params;
  const { text, contentType } = await (await engineClient()).pluginAsset(plugin, asset.join("/"));
  return new Response(text, { headers: { "content-type": contentType, "cache-control": "no-store", "x-content-type-options": "nosniff" } });
});
