import {
  isBuiltInDriver,
  AgentOrientation as AgentOrientationSchema,
  DEFAULT_AGENT_ORIENTATION,
  DEFAULT_INBOX_POLICY,
  DEFAULT_SESSION_DEFAULTS,
  DEFAULT_SIDEBAR_LAYOUT,
  DEFAULT_SIMULATOR_SETTINGS,
  DEFAULT_TEXT_GEN_POLICY,
  InboxPolicy as InboxPolicySchema,
  MAX_AUTO_SETTLE_HOURS,
  MAX_SIDEBAR_PROJECT_ORDER,
  MAX_SIDEBAR_SESSION_ORDER,
  MIN_AUTO_SETTLE_HOURS,
  SessionDefaults as SessionDefaultsSchema,
  SidebarLayout as SidebarLayoutSchema,
  SidebarMode,
  SimulatorSettings as SimulatorSettingsSchema,
  TextGenPolicy as TextGenPolicySchema,
  type AgentOrientation,
  type InboxPolicy,
  type RuntimeMode,
  type SessionDefaults,
  type SidebarLayout,
  type SimulatorSettings,
  type TextGenPolicy,
} from "@telar/engine-client";
import { EngineStateError, STATE_VERSION, type Kernel } from "../../platform/kernel";

export const RUNTIME_MODES = new Set<RuntimeMode>(["approval-required", "auto-accept-edits", "auto", "full-access"]);

const blankSidebarLayout = (): SidebarLayout => ({ ...DEFAULT_SIDEBAR_LAYOUT, projectOrder: [], sessionOrder: {}, pinnedOrder: [] });

/** Copied out, so a caller never holds a reference into the next write. */
const cloneSidebarLayout = (layout: SidebarLayout): SidebarLayout => ({
  projectOrder: [...layout.projectOrder],
  sessionOrder: Object.fromEntries(Object.entries(layout.sessionOrder).map(([key, ids]) => [key, [...ids]])),
  pinnedOrder: [...layout.pinnedOrder],
  mode: layout.mode,
});

function boolean(value: unknown, message: string): boolean {
  if (typeof value !== "boolean") throw new EngineStateError("invalid_request", message);
  return value;
}

/** A broken file costs only its preference: getters fall back to the shipped default, setters patch only the keys present. */
export class SettingsStore {
  constructor(private readonly kernel: Kernel) {}

  inbox(): InboxPolicy {
    try {
      const stored = this.kernel.readDocument(this.kernel.paths.inbox) as { autoSettleAfterDays?: unknown } | undefined;
      const parsed = InboxPolicySchema.safeParse(stored);
      if (parsed.success) return parsed.data;
      const days = stored?.autoSettleAfterDays;
      if (days === null) return { autoSettleAfterHours: null };
      if (typeof days === "number" && Number.isInteger(days) && days >= 1 && days <= 90) return { autoSettleAfterHours: days * 24 };
      return { ...DEFAULT_INBOX_POLICY };
    } catch {
      return { ...DEFAULT_INBOX_POLICY };
    }
  }

  setInbox(patch: { autoSettleAfterHours?: unknown }): InboxPolicy {
    const next: InboxPolicy = { ...this.inbox() };
    if (patch.autoSettleAfterHours !== undefined) {
      const parsed = InboxPolicySchema.shape.autoSettleAfterHours.safeParse(patch.autoSettleAfterHours);
      if (!parsed.success) {
        throw new EngineStateError(
          "invalid_request",
          `auto-settle window must be a whole number of hours between ${MIN_AUTO_SETTLE_HOURS} and ${MAX_AUTO_SETTLE_HOURS}, or null`,
        );
      }
      next.autoSettleAfterHours = parsed.data;
    }
    this.kernel.writeDocument(this.kernel.paths.inbox, { version: STATE_VERSION, ...next });
    return { ...next };
  }

  orientation(): AgentOrientation {
    try {
      const parsed = AgentOrientationSchema.safeParse(this.kernel.readDocument(this.kernel.paths.orientation));
      return parsed.success ? parsed.data : { ...DEFAULT_AGENT_ORIENTATION };
    } catch {
      return { ...DEFAULT_AGENT_ORIENTATION };
    }
  }

  setOrientation(patch: { preamble?: unknown; skill?: unknown }): AgentOrientation {
    const next: AgentOrientation = { ...this.orientation() };
    for (const key of ["preamble", "skill"] as const) {
      if (patch[key] !== undefined) next[key] = boolean(patch[key], `${key} must be true or false`);
    }
    this.kernel.writeDocument(this.kernel.paths.orientation, { version: STATE_VERSION, ...next });
    return { ...next };
  }

  /** Read on the create path, so a broken file must never make sessions unopenable. */
  sessionDefaults(): SessionDefaults {
    try {
      const parsed = SessionDefaultsSchema.safeParse(this.kernel.readDocument(this.kernel.paths.sessionDefaults));
      return parsed.success ? parsed.data : { ...DEFAULT_SESSION_DEFAULTS };
    } catch {
      return { ...DEFAULT_SESSION_DEFAULTS };
    }
  }

  setSessionDefaults(patch: { envMode?: unknown; resumeAfterRestart?: unknown; whileWorking?: unknown; runtimeMode?: unknown; defaultModel?: unknown }): SessionDefaults {
    const next: SessionDefaults = { ...this.sessionDefaults() };
    if (patch.envMode !== undefined) {
      const parsed = SessionDefaultsSchema.shape.envMode.safeParse(patch.envMode);
      if (!parsed.success) throw new EngineStateError("invalid_request", "default workspace must be local or worktree");
      next.envMode = parsed.data;
    }
    if (patch.resumeAfterRestart !== undefined) next.resumeAfterRestart = boolean(patch.resumeAfterRestart, "resumeAfterRestart must be true or false");
    if (patch.whileWorking !== undefined) {
      const parsed = SessionDefaultsSchema.shape.whileWorking.safeParse(patch.whileWorking);
      if (!parsed.success || !parsed.data) throw new EngineStateError("invalid_request", "whileWorking must be steer or queue");
      next.whileWorking = parsed.data;
    }
    if (patch.runtimeMode !== undefined) {
      if (patch.runtimeMode === null) delete next.runtimeMode;
      else if (RUNTIME_MODES.has(patch.runtimeMode as RuntimeMode)) next.runtimeMode = patch.runtimeMode as RuntimeMode;
      else throw new EngineStateError("invalid_request", "unknown runtime mode");
    }
    if (patch.defaultModel === null) delete next.defaultModel;
    else if (patch.defaultModel !== undefined) {
      const parsed = SessionDefaultsSchema.shape.defaultModel.safeParse(patch.defaultModel);
      if (!parsed.success || !parsed.data) throw new EngineStateError("invalid_request", "defaultModel must name a login and at least a model or an option");
      next.defaultModel = parsed.data;
    }
    this.kernel.writeDocument(this.kernel.paths.sessionDefaults, { version: STATE_VERSION, ...next });
    return { ...next };
  }

  simulators(): SimulatorSettings {
    try {
      const parsed = SimulatorSettingsSchema.safeParse(this.kernel.readDocument(this.kernel.paths.simulatorSettings));
      return parsed.success ? parsed.data : { ...DEFAULT_SIMULATOR_SETTINGS };
    } catch {
      return { ...DEFAULT_SIMULATOR_SETTINGS };
    }
  }

  setSimulators(patch: { enabled?: unknown; agentAccess?: unknown }): SimulatorSettings {
    const next: SimulatorSettings = { ...this.simulators() };
    if (patch.enabled !== undefined) next.enabled = boolean(patch.enabled, "enabled must be true or false");
    if (patch.agentAccess !== undefined) next.agentAccess = boolean(patch.agentAccess, "agentAccess must be true or false");
    if (!next.enabled) {
      if (patch.agentAccess === true) throw new EngineStateError("invalid_request", "turn simulators on before giving agents access to them");
      next.agentAccess = false;
    }
    this.kernel.writeDocument(this.kernel.paths.simulatorSettings, { version: STATE_VERSION, ...next });
    return { ...next };
  }

  /** Grouped was the old default, so a layout without the marker moves to one list once; a later choice is kept. */
  sidebarLayout(): SidebarLayout {
    try {
      const stored = this.kernel.readDocument(this.kernel.paths.sidebarLayout);
      const parsed = SidebarLayoutSchema.safeParse(stored);
      if (!parsed.success) return blankSidebarLayout();
      if ((stored as { flatDefault?: unknown }).flatDefault === true) return parsed.data;
      const migrated = { ...parsed.data, mode: "flat" as const };
      this.writeSidebarLayout(migrated);
      return migrated;
    } catch {
      return blankSidebarLayout();
    }
  }

  private writeSidebarLayout(layout: SidebarLayout): void {
    this.kernel.writeDocument(this.kernel.paths.sidebarLayout, { version: STATE_VERSION, flatDefault: true, ...layout });
  }

  /** Each field is its own patch, and a key listed twice is kept once, at its first position. */
  setSidebarLayout(patch: { projectOrder?: unknown; sessionOrder?: unknown; pinnedOrder?: unknown; mode?: unknown }): SidebarLayout {
    const next: SidebarLayout = { ...this.sidebarLayout() };
    if (patch.projectOrder !== undefined) {
      const parsed = SidebarLayoutSchema.shape.projectOrder.safeParse(patch.projectOrder);
      if (!parsed.success) {
        throw new EngineStateError("invalid_request", `projectOrder must be a list of up to ${MAX_SIDEBAR_PROJECT_ORDER} non-empty project group keys`);
      }
      next.projectOrder = [...new Set(parsed.data)];
    }
    if (patch.sessionOrder !== undefined) {
      const parsed = SidebarLayoutSchema.shape.sessionOrder.safeParse(patch.sessionOrder);
      if (!parsed.success) {
        throw new EngineStateError(
          "invalid_request",
          `sessionOrder must map a project group key to a list of up to ${MAX_SIDEBAR_SESSION_ORDER} non-empty session keys`,
        );
      }
      next.sessionOrder = Object.fromEntries(Object.entries(parsed.data).map(([key, ids]) => [key, [...new Set(ids)]]));
    }
    if (patch.pinnedOrder !== undefined) {
      const parsed = SidebarLayoutSchema.shape.pinnedOrder.safeParse(patch.pinnedOrder);
      if (!parsed.success) {
        throw new EngineStateError("invalid_request", `pinnedOrder must be a list of up to ${MAX_SIDEBAR_SESSION_ORDER} non-empty session keys`);
      }
      next.pinnedOrder = [...new Set(parsed.data)];
    }
    if (patch.mode !== undefined) {
      const parsed = SidebarMode.safeParse(patch.mode);
      if (!parsed.success) throw new EngineStateError("invalid_request", 'mode must be "grouped" or "flat"');
      next.mode = parsed.data;
    }
    this.writeSidebarLayout(next);
    return cloneSidebarLayout(next);
  }

  textGen(): TextGenPolicy {
    try {
      const parsed = TextGenPolicySchema.safeParse(this.kernel.readDocument(this.kernel.paths.textGen));
      return parsed.success ? parsed.data : { ...DEFAULT_TEXT_GEN_POLICY };
    } catch {
      return { ...DEFAULT_TEXT_GEN_POLICY };
    }
  }

  /** A driver change drops the model: model ids mean nothing across harnesses. */
  setTextGen(patch: { titles?: unknown; driver?: unknown; model?: unknown; effort?: unknown }): TextGenPolicy {
    const next: TextGenPolicy = { ...this.textGen() };
    if (patch.titles !== undefined) next.titles = boolean(patch.titles, "titles must be a boolean");
    if (patch.driver !== undefined) {
      if (!isBuiltInDriver(patch.driver)) {
        throw new EngineStateError("invalid_request", "text generation driver must be claude, codex or opencode");
      }
      if (patch.driver !== next.driver) delete next.model;
      next.driver = patch.driver;
    }
    if (patch.model !== undefined) {
      if (patch.model === null) delete next.model;
      else {
        const parsed = TextGenPolicySchema.shape.model.safeParse(patch.model);
        if (!parsed.success || parsed.data === undefined) {
          throw new EngineStateError("invalid_request", "text generation model must be a short model id, or null for the driver's default");
        }
        next.model = parsed.data;
      }
    }
    if (patch.effort !== undefined) {
      if (patch.effort === null) delete next.effort;
      else {
        const parsed = TextGenPolicySchema.shape.effort.safeParse(patch.effort);
        if (!parsed.success || parsed.data === undefined) throw new EngineStateError("invalid_request", "text generation effort must be low, medium or high, or null for low");
        next.effort = parsed.data;
      }
    }
    this.kernel.writeDocument(this.kernel.paths.textGen, { version: STATE_VERSION, ...next });
    return { ...next };
  }
}
