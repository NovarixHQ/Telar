import { ok, type Route } from "../../platform/http/route";
import type { Simulators } from "./service";

export function simulatorsRoutes(simulators: Simulators): Route[] {
  return [
    { method: "GET", path: "/v2/simulators", auth: "engine", handle: async () => ok({ simulators: await simulators.state() }) },
    { method: "POST", path: /^\/v2\/simulators\/([^/]+)\/boot$/, auth: "engine", handle: async ({ params }) => ok({ simulator: await simulators.boot(params[0]!) }) },
    { method: "POST", path: /^\/v2\/simulators\/([^/]+)\/shutdown$/, auth: "engine", handle: async ({ params }) => ok({ simulator: await simulators.shutdown(params[0]!) }) },
  ];
}
