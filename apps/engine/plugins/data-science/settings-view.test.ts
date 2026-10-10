import { expect, test } from "bun:test";
import { settingsView, storedRoot, type SettingsViewInput } from "./settings-view";

const venv = {
  id: "env_venv",
  name: ".venv",
  manager: "venv" as const,
  root: "/work/project/.venv",
  python: "/work/project/.venv/bin/python",
  path: ".venv/bin/python",
  location: "project" as const,
  reason: "found in the checkout",
  preflight: { ok: true, path: "/work/project/.venv/bin/python", version: "3.12.4", modules: { pandas: true, matplotlib: false } },
};
const system = { ...venv, id: "env_sys", name: "python3.12", manager: "system" as const, root: "/usr", python: "/usr/bin/python3", path: "/usr/bin/python3", location: "user" as const };

const input = (over: Partial<SettingsViewInput> = {}): SettingsViewInput => ({
  enabled: true,
  configured: ".venv/bin/python",
  toolchain: { pythons: [{ version: "3.12.4", minor: "3.12", installed: true, prerelease: false }, { version: "3.13.1", minor: "3.13", installed: false, prerelease: false }] },
  environments: [venv, system] as SettingsViewInput["environments"],
  requirements: [],
  currentId: "env_venv",
  draft: { stack: true },
  ...over,
});

const blocks = (view: ReturnType<typeof settingsView>) => view.blocks;

test("the environment in use is selected, a bare interpreter is not offered as one, and without uv it offers to install it", () => {
  const view = settingsView(input());
  expect(blocks(view)[0]).toMatchObject({ type: "prompt", label: "Ask agent to set up" });
  const options = blocks(view).filter((block) => block.type === "option");
  expect(options.find((block) => block.title === ".venv")).toMatchObject({ selected: true });
  expect(options.some((block) => block.title === "python3.12")).toBe(false);
  expect(options.find((block) => block.title === "uv")).toMatchObject({ action: { verb: "bootstrap", input: { what: "uv" } } });
  expect(options.find((block) => block.title === ".venv in this project")).toMatchObject({ detail: "Needs uv — install it above." });
  expect(view.refreshMs).toBeUndefined();
});

test("with uv, a project that has no .venv yet can create one, and a running job asks to be read again", () => {
  const view = settingsView(
    input({
      toolchain: { uv: { path: "/bin/uv", version: "0.5.0" }, pythons: input().toolchain.pythons },
      environments: [],
      job: { title: "Creating .venv", read: { jobId: "job_1", kind: "create", status: "running", lines: ["resolving"], cursor: 1, startedAt: 1 } },
    }),
  );
  expect(blocks(view).find((block) => block.type === "option" && block.title === ".venv in this project")).toMatchObject({ action: { verb: "create", input: { manager: "venv", location: "project" } } });
  expect(blocks(view)).toContainEqual({ type: "status", text: "Creating .venv…", tone: "neutral" });
  expect(blocks(view)).toContainEqual(expect.objectContaining({ type: "select", name: "version", verb: "python" }));
  expect(view.refreshMs).toBe(1500);
});

test("an environment with no selection warns, and the packages of the one in use are listed", () => {
  const unset = settingsView(input({ configured: undefined, currentId: undefined }));
  expect(blocks(unset)).toContainEqual({ type: "status", text: "No environment selected yet", tone: "warning" });
  const listed = settingsView(input({ packages: { packages: [{ name: "pandas", version: "2.2.0", direct: true }] } }));
  expect(blocks(listed)).toContainEqual({ type: "table", columns: ["Package", "Version", "Declared"], rows: [["pandas", "2.2.0", "yes"]] });
});

test("a project environment's root is stored relative, like its interpreter path", () => {
  expect(storedRoot(venv as SettingsViewInput["environments"][number])).toBe(".venv");
  expect(storedRoot(system as SettingsViewInput["environments"][number])).toBe("/usr");
});
