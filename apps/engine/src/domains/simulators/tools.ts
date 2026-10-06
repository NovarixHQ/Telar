import { z } from "zod";
import type { SimulatorsState, SimulatorSummary } from "@telar/engine-client";
import { err, failure, json, ok, type ToolFactory } from "../agent-tools";

export type SimulatorCapability = {
  agentDevice: string | undefined;
  list(): Promise<SimulatorsState>;
  open(id: string): Promise<SimulatorSummary>;
  screenshot(id: string): Promise<{ data: Uint8Array; mediaType: string }>;
  close(id: string, shutdown: boolean): Promise<void>;
};

const simulatorId = z.string().min(1).describe("The id simulator_list gives.");
const idOf = (args: Record<string, unknown>) => (typeof args.simulatorId === "string" ? args.simulatorId.trim() : "");
const NO_ID = "Name the simulator (simulatorId from simulator_list).";

async function attempt<T>(what: string, run: () => Promise<T>, answer: (value: T) => { content: unknown[] }) {
  try {
    return answer(await run());
  } catch (error) {
    return err(`Could not ${what}: ${failure(error)}`);
  }
}

function quickStart(simulator: SimulatorSummary, command: string | undefined): string {
  const opened = `${simulator.name} (${simulator.version}) is running, and the person can watch it in this conversation. Its id is ${simulator.id}.`;
  if (!command) return `${opened}\nThe agent-device command is still installing; until then use simulator_screenshot to look, and xcrun simctl or adb to act.`;
  const target = simulator.platform === "ios" ? `--platform ios --udid ${simulator.id}` : `--platform android --serial ${simulator.id}`;
  return [
    opened,
    `Drive it with ${command} (use this exact path; a login shell may reset PATH) and always pass ${target}.`,
    `A typical loop: open <bundle-id>, snapshot -i, click @e3, fill @e5 "text". Prefer snapshot refs over coordinates.`,
    simulator.platform === "ios" ? "The first command on an iOS Simulator builds a test runner and can take a couple of minutes." : "",
  ]
    .filter(Boolean)
    .join("\n");
}

export function simulatorTools(tool: ToolFactory, capability: SimulatorCapability): unknown[] {
  return [
    tool(
      "simulator_list",
      "List the iOS Simulators and Android emulators on this Mac, with their ids and whether each is running. Call it before simulator_open when you do not know an id.",
      {},
      () =>
        attempt("list simulators", () => capability.list(), (state) => {
          if (state.status !== "ready") return ok(`Simulators are not ready yet (${state.status}${state.detail ? `: ${state.detail}` : ""}). Try again shortly.`);
          return json({ simulators: state.simulators, ...(state.errors.length > 0 ? { errors: state.errors } : {}) });
        }),
    ),
    tool(
      "simulator_open",
      "Open a simulator for this conversation: starts it if it is off and shows it to the person. Returns the agent-device command to drive it with.",
      { simulatorId },
      async (args) => {
        const id = idOf(args);
        if (!id) return err(NO_ID);
        return attempt(`open ${id}`, () => capability.open(id), (simulator) => ok(quickStart(simulator, capability.agentDevice)));
      },
    ),
    tool("simulator_screenshot", "See a running simulator's screen as a PNG image. For taps and text, use the agent-device command.", { simulatorId }, async (args) => {
      const id = idOf(args);
      if (!id) return err(NO_ID);
      return attempt(`take a screenshot of ${id}`, () => capability.screenshot(id), (shot) => ({
        content: [{ type: "image", data: Buffer.from(shot.data).toString("base64"), mimeType: shot.mediaType }],
      }));
    }),
    tool(
      "simulator_close",
      "Stop showing a simulator in this conversation. Pass shutdown to also turn it off.",
      { simulatorId, shutdown: z.boolean().optional().describe("Also turn the simulator off. Defaults to false.") },
      async (args) => {
        const id = idOf(args);
        if (!id) return err(NO_ID);
        const shutdown = args.shutdown === true;
        return attempt(`close ${id}`, () => capability.close(id, shutdown), () => ok(shutdown ? `${id} is closed and turned off.` : `${id} is closed; it keeps running.`));
      },
    ),
  ];
}
