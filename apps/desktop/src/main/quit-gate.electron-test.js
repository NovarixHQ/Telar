const { app, dialog, powerMonitor } = require("electron");
const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const { createQuitGate, QUIT, CANCEL, QUIT_ALWAYS } = require("./quit-gate");
const { removeUserData } = require("../../test/electron/electron-test-teardown");

const userData = fs.mkdtempSync(path.join(os.tmpdir(), "telar-quit-gate-"));
app.setPath("userData", userData);
dialog.showErrorBox = (title, content) => console.error(`QUIT_GATE error dialog suppressed: ${title}: ${content}`);

const DEADLINE_MS = 60_000;
const CASES = 9;
let stage = "app.whenReady()";
let passed = 0;

function assert(condition, message) {
  if (!condition) throw new Error(message);
}
const at = (next) => {
  stage = next;
  console.log(`QUIT_GATE … ${next}`);
};

const engine = { working: 0, defaults: { envMode: "local" }, patches: [], requests: 0 };
function startFakeEngine() {
  const server = http.createServer((request, response) => {
    engine.requests += 1;
    let raw = "";
    request.on("data", (chunk) => (raw += chunk));
    request.on("end", () => {
      response.setHeader("content-type", "application/json");
      if (request.url === "/v2/sessions/working") return response.end(JSON.stringify({ count: engine.working }));
      if (request.url === "/v2/session-defaults" && request.method === "PATCH") {
        const patch = JSON.parse(raw);
        engine.patches.push(patch);
        engine.defaults = { ...engine.defaults, ...patch };
      }
      if (request.url === "/v2/session-defaults") return response.end(JSON.stringify({ sessionDefaults: engine.defaults }));
      response.statusCode = 404;
      response.end("{}");
    });
  });
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(server)));
}

let gate = null;
let quits = 0;
let cancels = 0;
let shown = [];
let answer = async () => ({ response: CANCEL, checkboxChecked: false });
let updating = false;

function freshGate(requestEngine, home) {
  quits = 0;
  cancels = 0;
  shown = [];
  engine.patches = [];
  engine.requests = 0;
  gate = createQuitGate({
    ask: () => Promise.all([
      requestEngine(home, "GET", "/v2/sessions/working").then((body) => body.count),
      requestEngine(home, "GET", "/v2/session-defaults").then((body) => body.sessionDefaults),
    ]),
    confirm: (options, signal) => {
      shown.push(options);
      return answer(options, signal);
    },
    save: (patch) => requestEngine(home, "PATCH", "/v2/session-defaults", patch),
    bypass: () => updating,
    onCancel: () => { cancels += 1; },
    power: powerMonitor,
  });
}

function settled() {
  const before = quits + cancels;
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const tick = () => {
      if (quits + cancels > before) return resolve();
      if (Date.now() - started > 5_000) return reject(new Error(`no quit and no cancel while: ${stage}`));
      setTimeout(tick, 10);
    };
    tick();
  });
}

async function quitOnce() {
  const done = settled();
  app.quit();
  await done;
}

async function main() {
  const server = await startFakeEngine();
  const home = path.join(userData, "home");
  fs.mkdirSync(path.join(home, "engine"), { recursive: true });
  fs.writeFileSync(
    path.join(home, "engine", "engine.json"),
    JSON.stringify({ host: "127.0.0.1", port: server.address().port, token: "t".repeat(32) }),
  );
  const { requestEngine } = require("./engine-child");

  app.on("before-quit", (event) => gate.hold(event, () => app.quit()));
  app.on("will-quit", (event) => {
    event.preventDefault();
    quits += 1;
  });

  try {
    at("nothing working quits without asking");
    freshGate(requestEngine, home);
    engine.working = 0;
    await quitOnce();
    assert(quits === 1 && shown.length === 0, `expected a quit and no dialog, got quits=${quits} shown=${shown.length}`);
    passed += 1;

    at("working and Cancel keeps Telar open and changes nothing");
    freshGate(requestEngine, home);
    engine.working = 2;
    answer = async () => ({ response: CANCEL, checkboxChecked: false });
    await quitOnce();
    assert(quits === 0 && cancels === 1, `Cancel quit anyway: quits=${quits} cancels=${cancels}`);
    assert(shown.length === 1 && shown[0].message === "Quit Telar while 2 sessions are still working?", `dialog said ${JSON.stringify(shown[0]?.message)}`);
    assert(shown[0].defaultId === CANCEL && shown[0].cancelId === CANCEL, "Cancel is not the default and Esc answer");
    assert(engine.patches.length === 0, `Cancel saved ${JSON.stringify(engine.patches)}`);
    passed += 1;

    at("Quit with the resume box ticked turns the shared setting on");
    freshGate(requestEngine, home);
    engine.working = 1;
    engine.defaults = { envMode: "local" };
    answer = async () => ({ response: QUIT, checkboxChecked: true });
    await quitOnce();
    assert(quits === 1, "Quit did not quit");
    assert(shown[0].message === "Quit Telar while a session is still working?" && shown[0].checkboxChecked === false, "dialog did not read the setting");
    assert(JSON.stringify(engine.patches) === JSON.stringify([{ resumeAfterRestart: true }]), `saved ${JSON.stringify(engine.patches)}`);
    passed += 1;

    at("the resume box starts from the setting, and unticking it turns it off");
    freshGate(requestEngine, home);
    answer = async () => ({ response: QUIT, checkboxChecked: false });
    await quitOnce();
    assert(shown[0].checkboxChecked === true, "the box did not start ticked");
    assert(JSON.stringify(engine.patches) === JSON.stringify([{ resumeAfterRestart: false }]), `saved ${JSON.stringify(engine.patches)}`);
    passed += 1;

    at("Quit and Don't Ask Again stops later quits from asking");
    freshGate(requestEngine, home);
    answer = async (options) => ({ response: QUIT_ALWAYS, checkboxChecked: options.checkboxChecked });
    await quitOnce();
    assert(JSON.stringify(engine.patches) === JSON.stringify([{ askBeforeQuit: false }]), `saved ${JSON.stringify(engine.patches)}`);
    freshGate(requestEngine, home);
    await quitOnce();
    assert(quits === 1 && shown.length === 0, "a quit after Don't Ask Again still asked");
    engine.defaults = { envMode: "local" };
    passed += 1;

    at("an update install quits without asking or asking the engine");
    freshGate(requestEngine, home);
    updating = true;
    await quitOnce();
    updating = false;
    assert(quits === 1 && shown.length === 0 && engine.requests === 0, `update quit asked: shown=${shown.length} requests=${engine.requests}`);
    passed += 1;

    at("a second quit while the dialog is open quits, with one dialog");
    freshGate(requestEngine, home);
    answer = (_options, signal) => new Promise((resolve) => signal.addEventListener("abort", () => resolve({ response: CANCEL, checkboxChecked: false })));
    let done = settled();
    app.quit();
    while (shown.length === 0) await new Promise((resolve) => setTimeout(resolve, 10));
    app.quit();
    await done;
    assert(quits === 1 && cancels === 0 && shown.length === 1, `second quit: quits=${quits} cancels=${cancels} shown=${shown.length}`);
    passed += 1;

    at("logout or shutdown while the dialog is open quits");
    freshGate(requestEngine, home);
    done = settled();
    app.quit();
    while (shown.length === 0) await new Promise((resolve) => setTimeout(resolve, 10));
    powerMonitor.emit("shutdown", { preventDefault() {} });
    await done;
    assert(quits === 1 && shown.length === 1, `shutdown while asking: quits=${quits} shown=${shown.length}`);

    at("after logout or shutdown starts, a quit never asks");
    shown = [];
    await quitOnce();
    assert(quits === 2 && shown.length === 0, "a quit during shutdown asked");
    passed += 1;

    at("an engine that does not answer never holds the quit");
    freshGate(requestEngine, home);
    await new Promise((resolve) => {
      server.close(resolve);
      server.closeAllConnections();
    });
    await quitOnce();
    assert(quits === 1 && shown.length === 0, "an absent engine held the quit");
    passed += 1;

    assert(passed === CASES, `ran ${passed} of ${CASES} cases`);
    console.log(`QUIT_GATE_OK ${passed}/${CASES}`);
  } finally {
    at("tearing down");
    server.close();
    await removeUserData(userData);
  }
}

const deadline = setTimeout(() => {
  console.error(`QUIT_GATE_FAIL timed out after ${DEADLINE_MS}ms while: ${stage}`);
  app.exit(1);
}, DEADLINE_MS);

app.whenReady().then(main).then(
  () => {
    clearTimeout(deadline);
    app.exit(0);
  },
  (error) => {
    clearTimeout(deadline);
    console.error("QUIT_GATE_FAIL", error);
    app.exit(1);
  },
);
