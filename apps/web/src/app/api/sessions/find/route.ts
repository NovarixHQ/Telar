import { engineClient, engineRoute, invalidRequest } from "@/platform/engine/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export const GET = engineRoute(async (request: Request) => {
  const query = new URL(request.url).searchParams;
  const q = query.get("q")?.trim();
  if (!q) throw invalidRequest("q is required");
  const settled = query.get("settled");
  const limit = Number(query.get("limit"));
  return Response.json(
    await (await engineClient()).findSessions({
      q,
      ...(query.get("projectId") ? { projectId: query.get("projectId")! } : {}),
      ...(settled === null ? {} : { settled: settled === "1" || settled === "true" }),
      ...(Number.isSafeInteger(limit) && limit > 0 ? { limit } : {}),
    }),
  );
});
