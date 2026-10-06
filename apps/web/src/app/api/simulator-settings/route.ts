import { requestObject, engineClient, engineRoute } from "@/platform/engine/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export const GET = engineRoute(async () => {
  return Response.json(await (await engineClient()).simulatorSettings());
});

export const PATCH = engineRoute(async (request: Request) => {
  const body = await requestObject(request);
  return Response.json(
    await (await engineClient()).setSimulatorSettings({
      ...("enabled" in body ? { enabled: body.enabled as boolean } : {}),
      ...("agentAccess" in body ? { agentAccess: body.agentAccess as boolean } : {}),
    }),
  );
});
