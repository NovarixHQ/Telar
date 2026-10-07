const PARTITION = "telar-preview";
const WIDTH = { min: 240, max: 1600 };
const INITIAL_HEIGHT = 600;
const MAX_CAPTURE_HEIGHT = 4000;
const MAX_HTML_CHARS = 1_500_000;
const MAX_TIMEOUT_MS = 30_000;
const MAX_PNG_BYTES = 3_500_000;
const MAX_ENTRIES = 50;
const MAX_TEXT_CHARS = 2_000;
const ALLOWED_URL = /^(data|blob|about|devtools):/i;

const MEASURE = `(() => {
  const body = document.body;
  if (!body) return 0;
  const range = document.createRange();
  range.selectNodeContents(body);
  const style = getComputedStyle(body);
  const tail = [style.paddingBottom, style.borderBottomWidth, style.marginBottom].reduce((sum, value) => sum + (parseFloat(value) || 0), 0);
  return Math.ceil(range.getBoundingClientRect().bottom + scrollY + tail);
})()`;

const BROKEN_IMAGES = `[...document.images].filter((image) => image.complete && image.naturalWidth === 0).map((image) => image.currentSrc || image.getAttribute("src") || "")`;

const settle = (ms) =>
  `document.fonts.ready.then(() => new Promise((done) => setTimeout(done, ${ms}))).then(() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))))`;

function checked(request) {
  const { html, width, appearance, timeoutMs } = request ?? {};
  if (typeof html !== "string" || html.length === 0) throw new Error("A preview needs its html.");
  if (html.length > MAX_HTML_CHARS) throw new Error("The preview is too large.");
  if (!Number.isInteger(width) || width < WIDTH.min || width > WIDTH.max) throw new Error(`The width is ${WIDTH.min} to ${WIDTH.max} pixels.`);
  if (appearance !== "light" && appearance !== "dark") throw new Error("The appearance is light or dark.");
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1) throw new Error("A preview needs a timeout.");
  return { html, width, appearance, timeoutMs: Math.min(timeoutMs, MAX_TIMEOUT_MS) };
}

const clip = (text) => String(text ?? "").slice(0, MAX_TEXT_CHARS);
const shortUrl = (url) => (url.length > 120 ? `${url.slice(0, 117)}…` : url);

function stackOf(trace) {
  const frames = trace?.callFrames ?? [];
  if (frames.length === 0) return undefined;
  return clip(frames.map((frame) => `at ${frame.functionName || "<anonymous>"} (${frame.url || "page"}:${frame.lineNumber + 1}:${frame.columnNumber + 1})`).join("\n"));
}

const argText = (arg) => arg.value ?? arg.unserializableValue ?? arg.description ?? arg.type;

function watchPage(debuggee) {
  const messages = [];
  const failedLoads = [];
  const urls = new Map();
  const note = (entry) => {
    if (messages.length < MAX_ENTRIES) messages.push(entry.stack ? entry : { level: entry.level, text: entry.text });
  };
  debuggee.on("message", (_event, method, params) => {
    if (method === "Runtime.consoleAPICalled" && ["error", "warning", "assert"].includes(params.type)) {
      note({ level: params.type === "warning" ? "warning" : "error", text: clip(params.args.map(argText).join(" ")), stack: stackOf(params.stackTrace) });
    } else if (method === "Runtime.exceptionThrown") {
      const details = params.exceptionDetails;
      const [text, ...rest] = String(details.exception?.description ?? details.text).split("\n");
      note({ level: "error", text: clip(`Uncaught ${text}`), stack: stackOf(details.stackTrace) ?? (rest.length ? clip(rest.map((line) => line.trim()).join("\n")) : undefined) });
    } else if (method === "Log.entryAdded" && params.entry.source !== "network" && (params.entry.level === "error" || params.entry.level === "warning")) {
      note({ level: params.entry.level, text: clip(params.entry.text) });
    } else if (method === "Network.requestWillBeSent") {
      urls.set(params.requestId, params.request.url);
    } else if (method === "Network.loadingFailed" && failedLoads.length < MAX_ENTRIES) {
      const reason = params.blockedReason === "csp" ? "blocked by the artifact's content security policy" : params.blockedReason ? `blocked (${params.blockedReason})` : params.errorText;
      failedLoads.push({ url: shortUrl(urls.get(params.requestId) ?? "unknown"), reason });
    }
  });
  return { messages, failedLoads };
}

async function evaluate(debuggee, expression) {
  const answer = await debuggee.sendCommand("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
  if (answer.exceptionDetails) throw new Error("The page could not be measured.");
  return answer.result.value;
}

async function capture(window, { html, width, appearance }) {
  const contents = window.webContents;
  const debuggee = contents.debugger;
  debuggee.attach("1.3");
  const page = watchPage(debuggee);
  for (const domain of ["Runtime", "Log", "Network"]) await debuggee.sendCommand(`${domain}.enable`);
  await debuggee.sendCommand("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: appearance }] });
  await contents.loadURL(`data:text/html;charset=utf-8;base64,${Buffer.from(html, "utf8").toString("base64")}`);
  await evaluate(debuggee, settle(150));
  const contentHeight = Math.max(1, Number(await evaluate(debuggee, MEASURE)) || 1);
  const capturedHeight = Math.min(contentHeight, MAX_CAPTURE_HEIGHT);
  window.setContentSize(width, capturedHeight);
  await evaluate(debuggee, settle(0));
  const broken = await evaluate(debuggee, BROKEN_IMAGES);
  let image = await contents.capturePage({ x: 0, y: 0, width, height: capturedHeight });
  let png = image.toPNG();
  if (png.length > MAX_PNG_BYTES) {
    image = image.resize({ width: Math.round(width / 2) });
    png = image.toPNG();
  }
  const failed = new Set(page.failedLoads.map((load) => load.url));
  const missing = (Array.isArray(broken) ? broken : []).map(shortUrl).filter((url) => !failed.has(url)).map((url) => ({ url, reason: "the image did not load" }));
  return { png: png.toString("base64"), contentHeight, capturedHeight, console: page.messages, failedLoads: [...page.failedLoads, ...missing].slice(0, MAX_ENTRIES) };
}

/**
 * Screenshots an artifact in a hidden offscreen window with no network, one at a time.
 * `BrowserWindow` and `session` are Electron's, injected so the render can be tested without it.
 */
function createPreviewRenderer({ BrowserWindow, session }) {
  let sealed = false;
  let queue = Promise.resolve();

  function seal() {
    if (sealed) return;
    sealed = true;
    const preview = session.fromPartition(PARTITION);
    preview.webRequest.onBeforeRequest((details, callback) => callback({ cancel: !ALLOWED_URL.test(details.url) }));
    preview.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  }

  async function renderOnce(input) {
    seal();
    const window = new BrowserWindow({
      show: false,
      width: input.width,
      height: INITIAL_HEIGHT,
      useContentSize: true,
      enableLargerThanScreen: true,
      webPreferences: { offscreen: true, partition: PARTITION, sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false, spellcheck: false },
    });
    window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    window.webContents.on("will-navigate", (event) => event.preventDefault());
    let timer;
    const expired = new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`The page did not settle within ${Math.ceil(input.timeoutMs / 1000)} s.`)), input.timeoutMs);
    });
    try {
      return await Promise.race([capture(window, input), expired]);
    } finally {
      clearTimeout(timer);
      if (!window.isDestroyed()) window.destroy();
    }
  }

  return {
    render(request) {
      const input = checked(request);
      const run = queue.then(() => renderOnce(input));
      queue = run.catch(() => undefined);
      return run;
    },
  };
}

module.exports = { createPreviewRenderer };
