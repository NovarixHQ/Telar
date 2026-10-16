const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { app, BrowserWindow, session } = require("electron");
const { attachExtensionSupport } = require("./extension-compat");

const PARTITION = "persist:telar-native-messaging";
const HOST_NAME = "com.telar.native_messaging_test";
const BIG = 300_000;
const work = fs.mkdtempSync(path.join(os.tmpdir(), "telar-native-messaging-"));
app.setPath("userData", path.join(work, "userData"));

function assert(condition, message) { if (!condition) throw new Error(message); }

function extensionKey() {
  const { publicKey } = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
  const der = publicKey.export({ type: "spki", format: "der" });
  const digest = crypto.createHash("sha256").update(der).digest().subarray(0, 16);
  const id = [...digest].map((b) => String.fromCharCode(97 + (b >> 4)) + String.fromCharCode(97 + (b & 15))).join("");
  return { key: der.toString("base64"), id };
}

const HOST_SOURCE = `
const frame = (message) => {
  const body = Buffer.from(JSON.stringify(message));
  const head = Buffer.alloc(4);
  head.writeUInt32LE(body.length, 0);
  return Buffer.concat([head, body]);
};
let inbox = Buffer.alloc(0);
process.stdin.on("data", (chunk) => {
  inbox = Buffer.concat([inbox, chunk]);
  if (inbox.length < 4 || inbox.length < 4 + inbox.readUInt32LE(0)) return;
  let echo;
  try { echo = { kind: "echo", text: JSON.parse(inbox.subarray(4, 4 + inbox.readUInt32LE(0)).toString()).text }; }
  catch { echo = { kind: "echo", text: null }; }
  process.stdout.write(Buffer.concat([frame(echo), frame({ kind: "a" }), frame({ kind: "b" }), frame({ kind: "big", blob: "x".repeat(${BIG}) })]));
});
`;

function writeHost(dir, extensionId) {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "host.js"), HOST_SOURCE);
  const launcher = path.join(dir, "host.sh");
  fs.writeFileSync(launcher, `#!/bin/sh\nELECTRON_RUN_AS_NODE=1 exec "${process.execPath}" "${path.join(dir, "host.js")}"\n`, { mode: 0o755 });
  const manifests = path.join(app.getPath("userData"), "NativeMessagingHosts");
  fs.mkdirSync(manifests, { recursive: true });
  fs.writeFileSync(path.join(manifests, `${HOST_NAME}.json`), JSON.stringify({
    name: HOST_NAME, description: "Telar native messaging fixture", path: launcher, type: "stdio",
    allowed_origins: [`chrome-extension://${extensionId}/`],
  }));
}

function writeExtension(dir, key) {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "manifest.json"), JSON.stringify({
    manifest_version: 3, name: "Telar native messaging fixture", version: "1.0.0", key,
    permissions: ["nativeMessaging"], background: { service_worker: "worker.js" },
  }));
  fs.writeFileSync(path.join(dir, "worker.js"), `
const got = [];
const port = chrome.runtime.connectNative(${JSON.stringify(HOST_NAME)});
port.onMessage.addListener((message) => {
  got.push({ kind: message.kind, text: message.text, size: message.blob ? message.blob.length : 0 });
  if (got.length === 4) console.warn("NATIVE_RESULT " + JSON.stringify(got));
});
port.postMessage({ text: "héllo ✓" });
`);
  return dir;
}

async function main() {
  const { key, id } = extensionKey();
  writeHost(path.join(work, "host"), id);
  const ses = session.fromPartition(PARTITION);
  const window = new BrowserWindow({ show: false, width: 400, height: 300 });
  await window.webContents.loadURL("data:text/html,<title>host</title>");
  attachExtensionSupport(ses, {
    createTab: async () => { throw new Error("no tabs"); }, selectTab: () => undefined, removeTab: () => undefined,
  }, { preloadDir: work, window });

  const result = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("the worker never received four native messages")), 15_000);
    ses.serviceWorkers.on("console-message", (event, details) => {
      const message = String(details?.message ?? event?.message ?? "");
      if (!message.startsWith("NATIVE_RESULT ")) return;
      clearTimeout(timer);
      resolve(JSON.parse(message.slice("NATIVE_RESULT ".length)));
    });
  });
  const loaded = await ses.extensions.loadExtension(writeExtension(path.join(work, "ext"), key), { allowFileAccess: false });
  assert(loaded.id === id, `extension id ${loaded.id} is not the keyed ${id}`);

  const got = await result;
  console.log(`NATIVE got=${JSON.stringify(got)}`);
  assert(got[0].kind === "echo" && got[0].text === "héllo ✓", "a non-ASCII message reached the host intact");
  assert(got[1].kind === "a" && got[2].kind === "b", "messages coalesced into one read are each delivered");
  assert(got[3].kind === "big" && got[3].size === BIG, "a message split across reads is reassembled");
  console.log("NATIVE_MESSAGING_OK 3/3");
  window.destroy();
}

app.whenReady().then(main).then(() => app.exit(0), (error) => { console.error("NATIVE_MESSAGING_FAIL", error); app.exit(1); });
