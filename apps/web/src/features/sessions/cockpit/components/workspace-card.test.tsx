import { afterAll, afterEach, describe, expect, mock, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { RunView, SessionChild, SessionDiff } from "@telar/engine-client";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/ui/dropdown-menu";
import { WorkspaceCardFrame, WorkspaceCardView, type WorkspaceCardViewProps } from "./workspace-card";
import { cardPlacement, DOCK_GUTTER, setCardPlacement, useWorkspaceCardOpen } from "../hooks/use-workspace-card";

GlobalRegistrator.register({ url: "http://localhost/" });
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

afterAll(async () => {
  await GlobalRegistrator.unregister();
});

const roots: Root[] = [];

afterEach(async () => {
  await act(async () => {
    for (const root of roots.splice(0)) root.unmount();
  });
  document.body.innerHTML = "";
});

const diff: SessionDiff = {
  repository: true,
  workspacePath: "/fixtures/telar-ios-panel",
  branch: "telar/ios-panel-column",
  ahead: 2,
  behind: 0,
  files: [],
  commits: [],
  linesAdded: 38,
  linesRemoved: 12,
  truncated: false,
};

const terminal = (over: Partial<RunView> = {}): RunView => ({
  terminalId: "term_1",
  runId: "term_1",
  projectId: "project_1",
  sessionId: "session_1",
  origin: "run",
  title: "bun dev",
  configName: "bun dev",
  command: "bun dev",
  worktreePath: "/fixtures/telar-ios-panel",
  cwd: "/fixtures/telar-ios-panel",
  status: "running",
  activity: "busy",
  readiness: { kind: "pending" },
  startedAt: 1,
  env: [],
  ...over,
});

const agent: SessionChild = { sessionId: "session_builder", parentSessionId: "session_1", title: "Settings mockup", state: "working", startedAt: 1 };

async function mount(over: Partial<WorkspaceCardViewProps> = {}) {
  const props: WorkspaceCardViewProps = {
    path: "/fixtures/telar-ios-panel",
    worktree: true,
    diff,
    terminals: [terminal(), terminal({ terminalId: "term_old", runId: "term_old", title: "old", status: "exited" })],
    backgroundTasks: 0,
    agents: [agent, { ...agent, sessionId: "session_done", title: "T3 research", state: "done" }],
    onOpenTerminal: mock(),
    onOpenChanges: mock(),
    onOpenAgent: mock(),
    ...over,
  };
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  roots.push(root);
  await act(async () => root.render(<WorkspaceCardView {...props} />));
  return { host, props };
}

const section = (host: HTMLElement, name: string) => host.querySelector<HTMLElement>(`section[aria-label="${name}"]`);
const button = (scope: HTMLElement, text: string) => [...scope.querySelectorAll("button")].find((entry) => entry.textContent?.includes(text));

describe("the Workspace card", () => {
  test("draws the workspace, version control and agents from what it is given", async () => {
    const { host } = await mount();
    const workspace = section(host, "Workspace")!;
    expect(workspace.textContent).toContain("telar-ios-panel");
    expect(workspace.textContent).toContain("Worktree");
    expect(workspace.textContent).toContain("bun dev");
    expect(workspace.textContent).not.toContain("old");
    const git = section(host, "Version control")!;
    expect(git.textContent).toContain("telar/ios-panel-column");
    expect(git.textContent).toContain("+38");
    expect(git.textContent).toContain("−12");
    const agents = section(host, "Agents")!;
    expect(agents.textContent).toContain("1 running");
    expect(agents.textContent).toContain("Settings mockup");
    expect(agents.textContent).toContain("Finished agents (1)");
    expect(agents.textContent).not.toContain("T3 research");
  });

  test("a checkout with no repository and no builders shows only the workspace", async () => {
    const { host } = await mount({ worktree: false, diff: { ...diff, repository: false }, agents: [] });
    expect(section(host, "Workspace")!.textContent).toContain("Checkout");
    expect(section(host, "Version control")).toBeNull();
    expect(section(host, "Agents")).toBeNull();
  });

  test("Changes opens the Diff", async () => {
    const { host, props } = await mount();
    await act(async () => button(section(host, "Version control")!, "Changes")!.click());
    expect(props.onOpenChanges).toHaveBeenCalledTimes(1);
  });

  test("lists running sub-agents beside running builders and folds every finished agent into one row", async () => {
    const { host } = await mount({
      agents: [agent, { ...agent, sessionId: "session_ok", state: "done", title: "Reply OK" }],
      subagents: [
        { id: "task_1", title: "Summarise README", state: "failed" },
        { id: "task_2", title: "List files", state: "working" },
      ],
      driver: "claude",
    });
    const agents = section(host, "Agents")!;
    expect(agents.textContent).toBe("Agents2 runningSettings mockupRunningList filesRunningFinished agents (2)");
    await act(async () => button(agents, "Finished agents (2)")!.click());
    expect(agents.textContent).toContain("Reply OKDone");
    expect(agents.textContent).toContain("Summarise READMEFailed");
  });

  test("with nothing running, Agents is only the folded row", async () => {
    const { host } = await mount({ agents: [{ ...agent, state: "done" }], subagents: [{ id: "task_1", title: "List files", state: "done" }] });
    expect(section(host, "Agents")!.textContent).toBe("AgentsFinished agents (2)");
  });

  test("an agent's row opens that agent's session", async () => {
    const { host, props } = await mount();
    await act(async () => button(section(host, "Agents")!, "Settings mockup")!.click());
    expect(props.onOpenAgent).toHaveBeenCalledWith(agent);
  });

  test("a running shell's row opens its terminal", async () => {
    const { host, props } = await mount();
    await act(async () => button(section(host, "Workspace")!, "bun dev")!.click());
    expect(props.onOpenTerminal).toHaveBeenCalledWith(terminal());
  });

  test("background processes are counted", async () => {
    const { host } = await mount({ backgroundTasks: 2 });
    expect(section(host, "Workspace")!.textContent).toContain("2 background processes");
  });
});

describe("how the Workspace card opens", () => {
  function Probe() {
    const { open, placement, toggle, close } = useWorkspaceCardOpen();
    return (
      <>
        <button type="button" aria-label="Workspace" onClick={toggle}>toggle</button>
        <p data-testid="outside">chat</p>
        <WorkspaceCardFrame open={open} placement={placement} onClose={close}>
          <span>card</span>
        </WorkspaceCardFrame>
      </>
    );
  }
  const shown = (host: HTMLElement) => !host.querySelector("[data-placement]")!.className.split(" ").includes("hidden");
  const toggle = (host: HTMLElement) => act(async () => host.querySelector<HTMLButtonElement>('[aria-label="Workspace"]')!.click());
  const clickOutside = (host: HTMLElement) => act(async () => host.querySelector("[data-testid=outside]")!.dispatchEvent(new Event("pointerdown", { bubbles: true })));
  const escape = () => act(async () => window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })));

  async function mountProbe(placement: "docked" | "popover") {
    window.localStorage.setItem("telar:workspace-card", "closed");
    setCardPlacement(placement);
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);
    roots.push(root);
    await act(async () => root.render(<Probe />));
    return host;
  }

  test("docked, the toggle opens it and it stays open through outside clicks and Escape until toggled shut", async () => {
    const host = await mountProbe("docked");
    expect(shown(host)).toBe(false);
    await toggle(host);
    expect(shown(host)).toBe(true);
    await clickOutside(host);
    await escape();
    expect(shown(host)).toBe(true);
    await toggle(host);
    expect(shown(host)).toBe(false);
  });

  test("as a popover it closes on an outside click and on Escape", async () => {
    const host = await mountProbe("popover");
    await toggle(host);
    expect(shown(host)).toBe(true);
    await clickOutside(host);
    expect(shown(host)).toBe(false);
    await toggle(host);
    expect(shown(host)).toBe(true);
    await escape();
    expect(shown(host)).toBe(false);
  });

  test("closing on an outside click keeps an open menu at its anchor until both have faded", async () => {
    let finish = () => {};
    const exit = new Promise<void>((resolve) => (finish = resolve));
    const fading = () => [{ finished: exit } as unknown as Animation];
    function WithMenu() {
      const { open, placement, toggle, close } = useWorkspaceCardOpen();
      return (
        <>
          <button type="button" aria-label="Workspace" onClick={toggle}>toggle</button>
          <p data-testid="outside">chat</p>
          <WorkspaceCardFrame open={open} placement={placement} onClose={close}>
            <DropdownMenu>
              <DropdownMenuTrigger aria-label="Branch actions">menu</DropdownMenuTrigger>
              <DropdownMenuContent>
                <DropdownMenuItem>Copy branch name</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </WorkspaceCardFrame>
        </>
      );
    }
    window.localStorage.setItem("telar:workspace-card", "closed");
    setCardPlacement("docked");
    setCardPlacement("popover");
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);
    roots.push(root);
    await act(async () => root.render(<WithMenu />));
    await toggle(host);
    const anchor = host.querySelector<HTMLElement>('[aria-label="Branch actions"]')!;
    anchor.getBoundingClientRect = () => (anchor.closest(".hidden") ? new DOMRect(0, 0, 0, 0) : new DOMRect(600, 40, 24, 24));
    host.querySelector<HTMLElement>("[data-placement]")!.getAnimations = fading;
    await act(async () => anchor.click());
    const menu = () => document.querySelector<HTMLElement>('[role="menu"]');
    menu()!.getAnimations = fading;
    const anchored = menu()!.parentElement!.style.transform;
    const positions: string[] = [];
    const record = () => {
      const transform = menu()?.parentElement?.style.transform;
      if (transform) positions.push(transform);
    };
    const observer = new MutationObserver(record);
    observer.observe(document.body, { subtree: true, attributes: true, attributeFilter: ["style"] });
    const outside = host.querySelector("[data-testid=outside]")!;
    await act(async () => {
      for (const type of ["pointerdown", "mousedown", "pointerup", "mouseup", "click"]) outside.dispatchEvent(new MouseEvent(type, { bubbles: true }));
    });
    await act(async () => window.dispatchEvent(new Event("resize")));
    await act(async () => new Promise((resolve) => requestAnimationFrame(() => resolve(undefined))));
    expect(host.querySelector("[data-placement]")!.className.split(" ")).not.toContain("hidden");
    await act(async () => finish());
    observer.disconnect();
    expect(menu()).toBeNull();
    expect(host.querySelector("[data-placement]")!.className.split(" ")).toContain("hidden");
    expect(positions.length).toBeGreaterThan(0);
    expect(positions.filter((position) => position !== anchored)).toEqual([]);
  });

  test("it docks only when the margin beside the chat lane fits it, and never with the panel open", () => {
    const lane = 800;
    const fits = lane + 2 * DOCK_GUTTER;
    expect(cardPlacement(fits, lane, false)).toBe("docked");
    expect(cardPlacement(fits, lane, true)).toBe("popover");
    expect(cardPlacement(fits - 2, lane, false)).toBe("popover");
    expect(cardPlacement(3000, 3000, false)).toBe("popover");
  });
});
