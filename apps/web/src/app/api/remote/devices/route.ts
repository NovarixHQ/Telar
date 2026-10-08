import { identifyCaller } from "@/features/remote/server";
import { engineForward, engineRoute } from "@/platform/engine/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export const DELETE = engineRoute(async (request: Request) => {
  const caller = (await identifyCaller(request)).device;
  if (!caller) {
    return Response.json(
      { error: { code: "invalid_request", message: "This device isn't paired, so there is nothing to keep." } },
      { status: 400 },
    );
  }
  return engineForward(request, `/v2/remote/devices?keep=${encodeURIComponent(caller.id)}`);
});
