const { app, BrowserWindow, session } = require("electron");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createPreviewRenderer } = require("./preview-renderer");
const { removeUserData } = require("../../test/electron/electron-test-teardown");

const userData = fs.mkdtempSync(path.join(os.tmpdir(), "telar-preview-renderer-"));
app.setPath("userData", userData);

const DEADLINE_MS = 60_000;
let stage = "app.whenReady()";

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const note = (line) => console.log(`PREVIEW_RENDERER ${line}`);
const at = (next) => {
  stage = next;
  note(`… ${next}`);
};

async function timed(label, work) {
  const started = Date.now();
  const result = await work();
  const ms = Date.now() - started;
  note(`${label} in ${ms} ms`);
  return { result, ms };
}

const isPng = (base64) => Buffer.from(base64, "base64").subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));

async function main() {
  const renderer = createPreviewRenderer({ BrowserWindow, session });
  const request = { width: 728, appearance: "light", timeoutMs: 10_000 };
  try {
    at("previewing trivial html");
    const trivial = await timed("trivial html", () => renderer.render({ ...request, html: "<!doctype html><p>ok</p>" }));
    assert(isPng(trivial.result.png), "the trivial preview is not a PNG");
    assert(trivial.result.contentHeight > 0 && trivial.result.contentHeight < 200, `the trivial page measured ${trivial.result.contentHeight} px`);
    assert(trivial.ms < 5_000, `the trivial preview took ${trivial.ms} ms`);

    at("previewing a scripted chart with an error and a blocked load");
    const chart = await timed("chart", () =>
      renderer.render({
        ...request,
        appearance: "dark",
        html: `<!doctype html><div id="bars" style="display:flex;gap:4px;align-items:end;height:200px"></div><img src="http://127.0.0.1:9/x.png"><script>for (const h of [40,120,80,180]) { const b = document.createElement("div"); b.style.cssText = "width:40px;background:#4493f8;height:" + h + "px"; bars.append(b); } console.warn("drawn"); missing();</script>`,
      }),
    );
    assert(isPng(chart.result.png), "the chart preview is not a PNG");
    assert(chart.result.contentHeight >= 200, `the chart measured ${chart.result.contentHeight} px`);
    assert(chart.result.console.some((entry) => entry.level === "warning" && entry.text === "drawn"), `no console warning in ${JSON.stringify(chart.result.console)}`);
    assert(chart.result.console.some((entry) => entry.level === "error" && entry.text.includes("missing is not defined")), `no uncaught error in ${JSON.stringify(chart.result.console)}`);
    assert(chart.result.failedLoads.some((load) => load.url.startsWith("http://127.0.0.1:9/")), `no failed load in ${JSON.stringify(chart.result.failedLoads)}`);

    at("refusing a page that never settles, quickly");
    const started = Date.now();
    const hung = await renderer.render({ ...request, timeoutMs: 1_500, html: "<script>for(;;){}</script>" }).then(
      () => "rendered",
      (error) => error.message,
    );
    assert(/did not settle/.test(hung), `a hung page answered ${hung}`);
    assert(Date.now() - started < 4_000, `a hung page took ${Date.now() - started} ms to refuse`);

    at("previewing again after a hung page");
    const after = await timed("trivial html after a hang", () => renderer.render({ ...request, html: "<p>still ok</p>" }));
    assert(isPng(after.result.png), "the preview after a hang is not a PNG");
    assert(BrowserWindow.getAllWindows().length === 0, `${BrowserWindow.getAllWindows().length} preview windows were left open`);

    console.log(`PREVIEW_RENDERER_OK trivial=${trivial.ms}ms chart=${chart.ms}ms`);
  } finally {
    at("tearing down");
    await removeUserData(userData);
  }
}

const deadline = setTimeout(() => {
  console.error(`PREVIEW_RENDERER_FAIL timed out after ${DEADLINE_MS}ms while: ${stage}`);
  app.exit(1);
}, DEADLINE_MS);

app.on("window-all-closed", () => undefined);

app.whenReady().then(main).then(
  () => {
    clearTimeout(deadline);
    app.exit(0);
  },
  (error) => {
    clearTimeout(deadline);
    console.error("PREVIEW_RENDERER_FAIL", error);
    app.exit(1);
  },
);
