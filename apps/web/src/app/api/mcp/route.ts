import { enginePipe, engineRoute } from "@/platform/engine/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const handle = engineRoute((request: Request) => enginePipe(request, "/v2/mcp", { asCaller: true }));

export const GET = handle;
export const POST = handle;
export const DELETE = handle;
