import { identifyCaller } from "@/features/remote/server";
import { engineForward, engineRoute } from "@/platform/engine/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export const GET = engineRoute(async (request: Request) => {
  const { device } = await identifyCaller(request);
  return engineForward(request, `/v2/simulators/stream-ticket${device ? `?holder=${encodeURIComponent(device.id)}` : ""}`);
});
