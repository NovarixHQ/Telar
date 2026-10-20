const { app, BrowserWindow, net, protocol, session } = require("electron");
const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const { APP_URL, registerCockpitScheme, serveCockpit } = require("./cockpit-scheme");
const { migrateLegacyOrigin } = require("./origin-migration");
const { removeUserData } = require("../../test/electron/electron-test-teardown");

registerCockpitScheme(protocol);

const userData = fs.mkdtempSync(path.join(os.tmpdir(), "telar-origin-migration-"));
app.setPath("userData", userData);

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const hidden = () => new BrowserWindow({ show: false, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false } });

async function main() {
  await app.whenReady();
  const staticDir = fs.mkdtempSync(path.join(os.tmpdir(), "telar-origin-migration-static-"));
  fs.writeFileSync(path.join(staticDir, "index.html"), "<!doctype html><title>cockpit</title>");
  serveCockpit(session.defaultSession, { net, staticDir, engine: () => null });

  const legacy = http.createServer((request, response) => {
    response.writeHead(200, { "content-type": "application/json" });
    response.end(request.url === "/v2/ping" ? '{"ok":true}' : "{}");
  });
  await new Promise((resolve) => legacy.listen(0, "127.0.0.1", resolve));
  const { port } = legacy.address();

  const seed = hidden();
  const values = {
    "telar-appearance": '{"look":"paper"}',
    "telar:keybindings": '{"quick-composer":"Alt+Space"}',
    "telar:prompt-stash:v1": '[{"id":"a","text":"quote \\" and </script>"}]',
    "telar:right-panel:main": '{"open":true}',
  };
  await seed.loadURL(`http://127.0.0.1:${port}/v2/ping`);
  await seed.webContents.executeJavaScript(`Object.entries(${JSON.stringify(values)}).forEach(([k, v]) => localStorage.setItem(k, v))`);
  await new Promise((resolve) => {
    seed.once("closed", resolve);
    seed.destroy();
  });

  const lines = [];
  const run = () => migrateLegacyOrigin({ legacyPort: port, listeningPort: port, appUrl: APP_URL, createWindow: hidden, log: (line) => lines.push(line) });
  assert((await run()) === "migrated", `the first launch did not migrate:\n${lines.join("\n")}`);

  const reader = hidden();
  await reader.loadURL(`${APP_URL}migrate`);
  const moved = JSON.parse(await reader.webContents.executeJavaScript("JSON.stringify(Object.fromEntries(Object.entries(localStorage)))"));
  assert(Object.entries(values).every(([key, value]) => moved[key] === value), `the keys did not arrive intact: ${JSON.stringify(moved)}`);
  console.log("ORIGIN_MIGRATION moved the appearance, keybindings, prompt stash and panel state");

  await reader.webContents.executeJavaScript(`localStorage.setItem("telar-appearance", "changed after the move")`);
  assert((await run()) === "done", "the migration ran twice");
  const after = await reader.webContents.executeJavaScript(`localStorage.getItem("telar-appearance")`);
  assert(after === "changed after the move", "a second launch overwrote what the person changed");
  console.log("ORIGIN_MIGRATION ran once");

  reader.destroy();
  await new Promise((resolve) => legacy.close(resolve));
  fs.rmSync(staticDir, { recursive: true, force: true });
  console.log("ORIGIN_MIGRATION_OK");
}

main().then(
  async () => {
    await removeUserData(userData);
    app.exit(0);
  },
  async (error) => {
    console.error("ORIGIN_MIGRATION_FAIL", error);
    await removeUserData(userData).catch(() => {});
    app.exit(1);
  },
);
