import { z } from "zod";
import { MAX_SIMULATOR_INPUT_EVENTS, SimulatorAction, SimulatorInput } from "@telar/engine-client";
import { HttpError } from "../../platform/http/http";
import { ok, type Route } from "../../platform/http/route";
import { hubProxyRoute } from "./proxy";
import type { Simulators } from "./service";

const InputBody = z.object({ events: z.array(SimulatorInput).min(1).max(MAX_SIMULATOR_INPUT_EVENTS) });

function parse<T>(schema: z.ZodType<T>, body: unknown, what: string): T {
  const parsed = schema.safeParse(body);
  if (!parsed.success) throw new HttpError(400, "invalid_request", `${what}: ${parsed.error.issues[0]?.message ?? "invalid"}`);
  return parsed.data;
}

const simulatorRoute = (verb: string) => new RegExp(`^/v2/simulators/([^/]+)/${verb}$`);

export function simulatorsRoutes(simulators: Simulators, fetchImpl?: typeof fetch): Route[] {
  return [
    { method: "GET", path: "/v2/simulators", auth: "engine", handle: async () => ok({ simulators: await simulators.state() }) },
    {
      method: "GET",
      path: "/v2/simulators/stream-ticket",
      auth: "engine",
      handle: ({ query }) => ({ status: 200, body: simulators.tickets.mint(query.get("holder")), headers: { "cache-control": "no-store" } }),
    },
    { method: "POST", path: simulatorRoute("boot"), auth: "engine", handle: async ({ params }) => ok({ simulator: await simulators.boot(params[0]!) }) },
    { method: "POST", path: simulatorRoute("shutdown"), auth: "engine", handle: async ({ params }) => ok({ simulator: await simulators.shutdown(params[0]!) }) },
    { method: "GET", path: simulatorRoute("detail"), auth: "engine", handle: async ({ params }) => ok({ detail: await simulators.detail(params[0]!) }) },
    {
      method: "POST",
      path: simulatorRoute("action"),
      auth: "engine",
      handle: async ({ params, body }) => ok({ detail: await simulators.action(params[0]!, parse(SimulatorAction, body, "action")) }),
    },
    {
      method: "POST",
      path: simulatorRoute("input"),
      auth: "engine",
      async handle({ params, body }) {
        const { events } = parse(InputBody, body, "input");
        await simulators.sendInput(params[0]!, events);
        return ok({ sent: events.length });
      },
    },
    hubProxyRoute(() => simulators.origin(), fetchImpl),
  ];
}
