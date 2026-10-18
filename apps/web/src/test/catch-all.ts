import { engineApi } from "@/platform/engine/engine-api";

/** Sends a request written as `/api/<path>` through the catch-all, as the legacy-path rewrite does. */
export const catchAll = (request: Request): Promise<Response> =>
  engineApi(request, { params: Promise.resolve({ path: ["v2", ...new URL(request.url).pathname.split("/").slice(2).map(decodeURIComponent)] }) });
