import { expect, test } from "bun:test";
import type { LiveSessionsAnswer } from "@telar/engine-client";
import { HostConnection, HostRegistry } from "../../platform/connection";
import { fakeClock, fakeNetwork, identityOf, until } from "../../platform/connection/testing";
import { branchRows, createdRoute, pickerSections, targetState, workspaceLabel as label, preferredTarget, projectActivity, projectTargets, sessionTitle, startSession, workspaceLabel, type NewSession } from "./new-session";

const MAC = "http://192.168.1.20:3000";
const HOST = "host_00000000-0000-0000-0000-000000000001";

const project = (id: string, name: string) => ({ id, name, root: `/code/${name}` }) as LiveSessionsAnswer["projects"][number];
const answer = (projects: ReturnType<typeof project>[], sessions: { projectId: string; updatedAt: number }[] = []) => ({ projects, sessions }) as unknown as LiveSessionsAnswer;

function online(routes: Record<string, () => Response>) {
  const calls: { method: string; path: string; body?: unknown }[] = [];
  const network = fakeNetwork({
    [MAC]: (path, init) => {
      if (path === "/api/identity") return identityOf(HOST);
      const method = init.method ?? "GET";
      const json = (init.headers as Record<string, string> | undefined)?.["content-type"]?.includes("json");
      calls.push({ method, path, ...(init.body ? { body: json ? JSON.parse(String(init.body)) : "bytes" } : {}) });
      return routes[`${method} ${path}`]?.() ?? Response.json({ error: { code: "not_found", message: "nope" } }, { status: 404 });
    },
  });
  const host = new HostConnection({ hostId: HOST, name: "Mini", token: "tlr_phone", paired: [MAC] }, { fetch: network.fetch, clock: fakeClock(), random: () => 0 });
  host.start();
  return { host, calls };
}

const created = () => Response.json({ session: { id: "s1", providerInstanceId: "claude" } }, { status: 201 });
const accepted = () => Response.json({ turn: { runId: "run_1" } }, { status: 202 });
const draft: NewSession = { projectId: "p1", workspace: { envMode: "worktree", branchName: "" }, driver: "claude", prompt: "Fix   the\nlogin bug", runId: "run_1" };

test("targets list each computer's projects by name, and the last one used comes first", () => {
  const computers = [
    { hostId: "a", name: "Mini", answer: answer([project("p2", "web"), project("p1", "api")], [{ projectId: "p2", updatedAt: 5 }]) },
    { hostId: "b", name: "Studio", answer: answer([project("p3", "app")], [{ projectId: "p3", updatedAt: 9 }]) },
  ];
  const targets = projectTargets(computers);
  expect(targets.map((target) => target.project.name)).toEqual(["api", "web", "app"]);
  const activity = projectActivity(computers);
  expect(preferredTarget(targets, activity, undefined)?.project.id).toBe("p3");
  expect(preferredTarget(targets, activity, "a:p1")?.project.id).toBe("p1");
  expect(pickerSections(targets, activity, "a:p1").map((section) => [section.title, section.targets.map((target) => target.project.id)])).toEqual([["Recent", ["p1", "p3", "p2"]]]);
});

test("one computer's projects outside Recent sit under All projects, and a search narrows by name or folder", () => {
  const targets = projectTargets([{ hostId: "a", name: "Mini", answer: answer([project("p1", "api"), project("p2", "web")]) }]);
  expect(pickerSections(targets, new Map(), undefined)).toEqual([{ targets }]);
  expect(pickerSections(targets, new Map([["a:p2", 1]]), undefined).map((section) => section.title)).toEqual(["Recent", "All projects"]);
  expect(pickerSections(targets, new Map(), undefined, "/code/we")[0]?.targets.map((target) => target.project.id)).toEqual(["p2"]);
});

test("the workspace reads as the Swift app labels it", () => {
  expect(workspaceLabel({ envMode: "local", branchName: "ignored" })).toBe("Current checkout");
  expect(workspaceLabel({ envMode: "worktree", branchName: "" })).toBe("New worktree");
  expect(workspaceLabel({ envMode: "worktree", branchName: "fix-login" })).toBe("New worktree · fix-login");
  expect(sessionTitle("x".repeat(100))).toHaveLength(80);
});

test("starting a session creates it on the project, then sends the first message with the minted run id", async () => {
  const { host, calls } = online({ "POST /api/projects/p1/sessions": created, "POST /api/sessions/s1/turns": accepted });
  await until(host, "online");
  const seen: string[] = [];
  expect(await startSession({ get: () => host }, HOST, { ...draft, workspace: { envMode: "worktree", branchName: " fix-login " } }, undefined, (id) => seen.push(id))).toBe("s1");
  expect(seen).toEqual(["s1"]);
  expect(calls).toEqual([
    { method: "POST", path: "/api/projects/p1/sessions", body: { title: "Fix the login bug", driver: "claude", envMode: "worktree", branchName: "fix-login" } },
    { method: "POST", path: "/api/sessions/s1/turns", body: { runId: "run_1", input: "Fix   the\nlogin bug" } },
  ]);
});

test("a chosen model and access are set on the new session before the message goes, and a checkout never names a branch", async () => {
  const { host, calls } = online({ "POST /api/projects/p1/sessions": created, "PATCH /api/sessions/s1": () => Response.json({ session: {} }), "POST /api/sessions/s1/turns": accepted });
  await until(host, "online");
  await startSession({ get: () => host }, HOST, { ...draft, workspace: { envMode: "local", branchName: "kept" }, driver: "codex", choice: { model: "gpt-5", effort: "high" }, runtimeMode: "full-access" }, undefined, () => {});
  expect(calls.map((call) => [call.method, call.path, call.body])).toEqual([
    ["POST", "/api/projects/p1/sessions", { title: "Fix the login bug", driver: "codex", envMode: "local" }],
    ["PATCH", "/api/sessions/s1", { model: { instanceId: "claude", model: "gpt-5", effort: "high" }, runtimeMode: "full-access" }],
    ["POST", "/api/sessions/s1/turns", { runId: "run_1", input: "Fix   the\nlogin bug" }],
  ]);
});

test("a retry after a failed send reuses the session already made", async () => {
  const { host, calls } = online({ "POST /api/sessions/s1/turns": accepted });
  await until(host, "online");
  await startSession({ get: () => host }, HOST, draft, "s1", () => {
    throw new Error("not created again");
  });
  expect(calls.map((call) => `${call.method} ${call.path}`)).toEqual(["POST /api/sessions/s1/turns"]);
});

test("once created, the form gives way to the new session", () => {
  expect(createdRoute(HOST, "s1", "Fix   the\nlogin bug")).toEqual({ name: "Session", params: { hostId: HOST, sessionId: "s1", title: "Fix the login bug" } });
});

test("two computers' projects merge into one list, and the picker names the computer of a recent one", () => {
  const state = targetState([
    { hostId: "a", name: "Mini", answer: answer([project("p1", "api")], [{ projectId: "p1", updatedAt: 3 }]) },
    { hostId: "b", name: "Studio", answer: answer([project("p1", "api"), project("p2", "web")]) },
  ]);
  expect(state.targets.map((target) => `${target.hostName}/${target.project.name}`)).toEqual(["Mini/api", "Studio/api", "Studio/web"]);
  expect(pickerSections(state.targets, state.activity, undefined).map((section) => [section.title, section.targets.map((target) => target.hostId)])).toEqual([
    ["Recent", ["a"]],
    ["Studio", ["b", "b"]],
  ]);
  expect(state).toMatchObject({ computers: 2, loading: false, unreachable: [] });
});

test("a computer that did not answer is named, and the other's projects still show", () => {
  const state = targetState([
    { hostId: "a", name: "Mini", failed: "offline" },
    { hostId: "b", name: "Studio", answer: answer([project("p2", "web")]) },
  ]);
  expect(state.targets.map((target) => target.project.id)).toEqual(["p2"]);
  expect(state).toMatchObject({ loading: false, unreachable: ["Mini"] });
  expect(targetState([{ hostId: "a", name: "Mini" }]).loading).toBe(true);
});

test("the session is created on the computer that owns the chosen project", async () => {
  const STUDIO = "http://192.168.1.30:3000";
  const seen: string[] = [];
  const mac = (hostId: string, origin: string) => (path: string, init: RequestInit) => {
    if (path === "/api/identity") return identityOf(hostId);
    seen.push(`${init.method} ${origin}${path}`);
    return path.endsWith("/turns") ? accepted() : created();
  };
  const network = fakeNetwork({ [MAC]: mac(HOST, MAC), [STUDIO]: mac("host_studio", STUDIO) });
  const registry = new HostRegistry({ fetch: network.fetch, clock: fakeClock(), random: () => 0 });
  await until(registry.add({ hostId: HOST, name: "Mini", token: "a", paired: [MAC] }), "online");
  await until(registry.add({ hostId: "host_studio", name: "Studio", token: "b", paired: [STUDIO] }), "online");
  await startSession(registry, "host_studio", draft, undefined, () => {});
  expect(seen).toEqual([`POST ${STUDIO}/api/projects/p1/sessions`, `POST ${STUDIO}/api/sessions/s1/turns`]);
});

test("a worktree starts from the chosen ref, and a checkout never sends one", async () => {
  const { host, calls } = online({ "POST /api/projects/p1/sessions": created, "POST /api/sessions/s1/turns": accepted });
  await until(host, "online");
  await startSession({ get: () => host }, HOST, { ...draft, workspace: { envMode: "worktree", branchName: "", baseRef: "origin/main" } }, undefined, () => {});
  await startSession({ get: () => host }, HOST, { ...draft, workspace: { envMode: "local", branchName: "", baseRef: "origin/main" } }, undefined, () => {});
  const bodies = calls.filter((call) => call.path.endsWith("/sessions")).map((call) => call.body);
  expect(bodies).toEqual([
    { title: "Fix the login bug", driver: "claude", envMode: "worktree", baseRef: "origin/main" },
    { title: "Fix the login bug", driver: "claude", envMode: "local" },
  ]);
  expect(label({ envMode: "worktree", branchName: "", baseRef: "origin/main" })).toBe("New worktree · main");
});

test("attached files are uploaded to the new session and sent with the first message", async () => {
  let uploaded = 0;
  const { host, calls } = online({
    "POST /api/projects/p1/sessions": created,
    "POST /api/sessions/s1/attachments": () => Response.json({ attachment: { id: `att_${(uploaded += 1)}` } }, { status: 201 }),
    "POST /api/sessions/s1/turns": accepted,
  });
  await until(host, "online");
  const file = (name: string) => ({ name, mediaType: "image/png", read: async () => new Uint8Array([1, 2, 3]) });
  await startSession({ get: () => host }, HOST, { ...draft, prompt: "", files: [file("a.png"), file("b.png")] }, undefined, () => {});
  expect(calls.map((call) => [call.method, call.path, call.body])).toEqual([
    ["POST", "/api/projects/p1/sessions", { title: "2 images", driver: "claude", envMode: "worktree" }],
    ["POST", "/api/sessions/s1/attachments", "bytes"],
    ["POST", "/api/sessions/s1/attachments", "bytes"],
    ["POST", "/api/sessions/s1/turns", { runId: "run_1", input: "", attachments: ["att_1", "att_2"] }],
  ]);
});

test("a file that fails to upload sends nothing", async () => {
  const { host, calls } = online({ "POST /api/projects/p1/sessions": created, "POST /api/sessions/s1/attachments": () => Response.json({ error: { code: "too_large", message: "no" } }, { status: 413 }) });
  await until(host, "online");
  const file = { name: "big.pdf", mediaType: "application/pdf", read: async () => new Uint8Array([1]) };
  await expect(startSession({ get: () => host }, HOST, { ...draft, files: [file] }, undefined, () => {})).rejects.toThrow("Couldn't upload big.pdf — nothing was sent. Try again.");
  expect(calls.some((call) => call.path.endsWith("/turns"))).toBe(false);
});

test("Start from offers HEAD, the default and current branches, then local and origin refs not already listed", () => {
  const git = {
    branch: "feature",
    defaultBase: "main",
    refs: [
      { name: "main", kind: "local" as const },
      { name: "feature", kind: "local" as const, head: true },
      { name: "spike", kind: "local" as const },
      { name: "origin/spike", kind: "remote" as const },
      { name: "origin/release", kind: "remote" as const },
    ],
  };
  const rows = branchRows(git, "");
  expect(rows.pinned.map((row) => [row.label, row.badge])).toEqual([["Current HEAD", undefined], ["main", "default"], ["feature", "current"]]);
  expect(rows.local.map((row) => row.value)).toEqual(["spike"]);
  expect(rows.origin.map((row) => [row.value, row.badge])).toEqual([["origin/release", "remote"]]);
  const found = branchRows(git, "SPI");
  expect([found.pinned, found.local.map((row) => row.value), found.origin.map((row) => row.value)]).toEqual([[], ["spike"], ["origin/spike"]]);
});
