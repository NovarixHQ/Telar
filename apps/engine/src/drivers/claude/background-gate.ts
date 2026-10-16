import { isBackgroundWork } from "@telar/engine-client";
import { gateFor } from "./permission-gate";
import { isTerminalTaskState } from "./tasks";
import { type DriverSessionHooks } from "../contract";
import { type SdkCanUseTool } from "./sdk";
import { type TurnState } from "./turn";

const NO_TASK_FOR_BACKGROUND_WORK =
  "The turn that started this agent has ended, and Telar could not tell which background task made this call, so nothing ran. " +
  "Nobody declined it — there was nobody to ask. Report what you have; the call can be made again from a new turn.";

// The sub-agent that made the call, else the one live background task (the oldest when several are live).
function askingTask(turn: TurnState, toolUseId: string): string | undefined {
  const owner = turn.toolOwners.get(toolUseId);
  if (owner) return owner;
  return [...turn.knownTasks.entries()].find(([, task]) => isBackgroundWork(task) && !isTerminalTaskState(task.state))?.[0];
}

// The gate installed while no turn owns the session; it must stay one object, since callers compare against it.
export function createBackgroundGate(turn: TurnState, sessionHooks: DriverSessionHooks | undefined): SdkCanUseTool {
  const backgroundGate: SdkCanUseTool = async (toolName, input, options) => {
    const bound = turn.runtimeRef?.bindings.current.canUseTool;
    if (bound && bound !== backgroundGate) return bound(toolName, input, options);
    const taskId = askingTask(turn, options.toolUseID);
    const ask = sessionHooks?.onTaskRequest;
    if (!taskId || !ask) return { behavior: "deny", message: NO_TASK_FOR_BACKGROUND_WORK };
    try {
      return await gateFor((request) => ask(taskId, request))(toolName, input, options);
    } catch {
      return { behavior: "deny", message: NO_TASK_FOR_BACKGROUND_WORK };
    }
  };
  return backgroundGate;
}
