import { afterEach, describe, expect, test } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { EngineClient } from "@telar/engine-client";
import { startEngine, type EngineDaemon } from "../../daemon";
import { ECHO_MANIFEST, writePlugin } from "../../../test/fixtures/external-plugin";
import { stubModels } from "../../../test/stub-models";
import { readFolderAsset } from "./assets";

const roots: string[] = [];
const daemons: EngineDaemon[] = [];
const tempDir = (): string => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "telar-plugin-assets-"));
  roots.push(directory);
  return directory;
};
afterEach(async () => {
  for (const daemon of daemons.splice(0).reverse()) await daemon.close();
  for (const directory of roots.splice(0)) fs.rmSync(directory, { recursive: true, force: true });
});

const VIEWER_MANIFEST = {
  ...ECHO_MANIFEST,
  viewers: [{ id: "log", label: "Log", entry: "log.html", extensions: [".log"] }],
  views: [{ id: "board", label: "Board", entry: "board.html" }],
  fileScope: [".txt"],
};

function viewerPlugin(pluginsDir: string): string {
  const dir = writePlugin(pluginsDir, "echo", VIEWER_MANIFEST);
  fs.mkdirSync(path.join(dir, "views", "lib"), { recursive: true });
  fs.writeFileSync(path.join(dir, "views", "log.html"), '<script src="lib/log.js"></script>');
  fs.writeFileSync(path.join(dir, "views", "lib", "log.js"), "telar.readFile();");
  fs.symlinkSync(path.join(dir, "server.js"), path.join(dir, "views", "leak.js"));
  return dir;
}

describe("readFolderAsset", () => {
  test("serves files under views/ and refuses a way out, a link out, or a type it does not serve", () => {
    const dir = viewerPlugin(tempDir());
    expect(readFolderAsset(dir, "log.html")).toBe('<script src="lib/log.js"></script>');
    expect(readFolderAsset(dir, "lib/log.js")).toBe("telar.readFile();");
    expect(readFolderAsset(dir, "../server.js")).toBeUndefined();
    expect(readFolderAsset(dir, "leak.js")).toBeUndefined();
    expect(readFolderAsset(dir, "../plugin.json")).toBeUndefined();
    expect(readFolderAsset(dir, "/etc/hosts.json")).toBeUndefined();
    expect(readFolderAsset(dir, "missing.html")).toBeUndefined();
  });
});

describe("the asset route, end to end", () => {
  async function ready() {
    const pluginsDir = tempDir();
    viewerPlugin(pluginsDir);
    const daemon = await startEngine({ models: stubModels, engineRoot: tempDir(), pluginsDir });
    daemons.push(daemon);
    return new EngineClient(daemon.discovery);
  }

  test("an installed plugin's viewers reach the cockpit and its frame files are served from its folder", async () => {
    const client = await ready();
    const echo = (await client.machinePlugins()).plugins.find((status) => status.meta.id === "echo");
    expect(echo?.meta.viewers).toEqual([{ id: "log", label: "Log", entry: "log.html", extensions: [".log"], mimes: [] }]);
    expect(echo?.meta.views).toEqual([{ id: "board", label: "Board", entry: "board.html" }]);
    expect(echo?.meta.fileScope).toEqual([".txt"]);

    const page = await client.pluginAsset("echo", "log.html");
    expect(page).toEqual({ text: '<script src="lib/log.js"></script>', contentType: "text/html; charset=utf-8" });
    expect((await client.pluginAsset("echo", "lib/log.js")).contentType).toBe("text/javascript; charset=utf-8");
    await expect(client.pluginAsset("echo", "leak.js")).rejects.toThrow("has no asset");
    await expect(client.pluginAsset("echo", "plugin.json")).rejects.toThrow("has no asset");
    await expect(client.pluginAsset("nobody", "log.html")).rejects.toThrow("no plugin nobody");
  });

  test("Data Science's viewers are served from the app the same way", async () => {
    const client = await ready();
    const ds = (await client.machinePlugins()).plugins.find((status) => status.meta.id === "data-science");
    expect(ds?.meta.viewers?.map((viewer) => [viewer.id, viewer.extensions])).toEqual([
      ["notebook", [".ipynb"]],
      ["table", [".csv", ".tsv", ".parquet"]],
    ]);
    expect((await client.pluginAsset("data-science", "notebook.html")).text).toContain('<link rel="stylesheet" href="views.css">');
    expect((await client.pluginAsset("data-science", "views.css")).contentType).toBe("text/css; charset=utf-8");
  });

  test("a plugin this computer turned off serves nothing", async () => {
    const client = await ready();
    await client.updateMachinePlugins({ echo: { enabled: false } });
    await expect(client.pluginAsset("echo", "log.html")).rejects.toThrow("no plugin echo");
  });
});
