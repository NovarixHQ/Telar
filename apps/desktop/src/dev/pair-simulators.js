"use strict";
const fs = require("node:fs");
const path = require("node:path");
const { execFile } = require("node:child_process");

const APP_ID = "io.github.novarix.telar";
const APPLICATIONS = "/Applications";
const POLL_MS = 500;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function execRun(file, args, options = {}) {
  return new Promise((resolve) => {
    execFile(file, args, { timeout: 15_000, ...options }, (error, stdout) => {
      resolve({ code: error ? (typeof error.code === "number" ? error.code : 1) : 0, stdout: String(stdout ?? "") });
    });
  });
}

const listDir = (dir) => {
  try {
    return fs.readdirSync(dir);
  } catch {
    return [];
  }
};

async function simctlEnv({ run, env, exists, list }) {
  if ((await run("xcrun", ["--find", "simctl"], { env })).code === 0) return env;
  const others = list(APPLICATIONS).filter((name) => name !== "Xcode.app" && /^Xcode.*\.app$/.test(name)).sort();
  for (const app of ["Xcode.app", ...others]) {
    const developerDir = path.join(APPLICATIONS, app, "Contents", "Developer");
    if (exists(path.join(developerDir, "usr", "bin", "simctl"))) return { ...env, DEVELOPER_DIR: developerDir };
  }
  return null;
}

function bootedIos(json) {
  try {
    return Object.entries(JSON.parse(json).devices ?? {})
      .filter(([runtime]) => runtime.includes("iOS"))
      .flatMap(([, devices]) => devices.filter((device) => device.state === "Booted").map(({ udid, name }) => ({ udid, name })));
  } catch {
    return [];
  }
}

const relaunchWithLink = (udid, port, code) =>
  ["simctl", "launch", "--terminate-running-process", udid, APP_ID, "-addHostLink", `http://localhost:${port}/pair#token=${code}`];

async function waitForConsumed(cockpit, wait, timeoutMs) {
  for (let waited = 0; waited < timeoutMs; waited += POLL_MS) {
    if (!(await cockpit.pending())) return true;
    await wait(POLL_MS);
  }
  await cockpit.cancel();
  return false;
}

async function pairBootedSimulators({ port, cockpit, run = execRun, env = process.env, exists = fs.existsSync, list = listDir, wait = sleep, timeoutMs = 20_000 }) {
  const simEnv = await simctlEnv({ run, env, exists, list });
  if (!simEnv) return { paired: [], failed: [], error: "Xcode is not installed." };
  const listed = await run("xcrun", ["simctl", "list", "devices", "booted", "--json"], { env: simEnv });
  const targets = [];
  for (const device of bootedIos(listed.stdout)) {
    if ((await run("xcrun", ["simctl", "get_app_container", device.udid, APP_ID], { env: simEnv })).code === 0) targets.push(device);
  }
  if (targets.length === 0) return { paired: [], failed: [], error: "No booted simulator has Telar installed." };
  const paired = [];
  const failed = [];
  for (const device of targets) {
    const { code } = await cockpit.mint();
    const opened = await run("xcrun", relaunchWithLink(device.udid, port, code), { env: simEnv });
    if (opened.code === 0 && (await waitForConsumed(cockpit, wait, timeoutMs))) paired.push(device.name);
    else failed.push(device.name);
  }
  return { paired, failed };
}

function cockpitClient(baseUrl, hostToken, fetchImpl = fetch) {
  const call = async (method, route) => {
    const response = await fetchImpl(new URL(route, baseUrl), { method, headers: { "x-telar-host": hostToken } });
    if (!response.ok) throw new Error(`${method} ${route} answered ${response.status}`);
    return response.json();
  };
  return {
    mint: () => call("POST", "/api/remote/pairing"),
    pending: async () => Boolean((await call("GET", "/api/remote")).pairing),
    cancel: () => call("DELETE", "/api/remote/pairing").catch(() => undefined),
  };
}

function summary({ paired, failed, error }) {
  if (error) return error;
  return [paired.length ? `Paired ${paired.join(", ")}.` : "", failed.length ? `Not paired: ${failed.join(", ")}.` : ""].filter(Boolean).join(" ");
}

let pairFromHost = null;

function registerDevPairing({ dev, appUrl, hostToken, ipcMain, notify, pair = pairBootedSimulators }) {
  if (!dev) return false;
  const port = Number(new URL(appUrl).port);
  pairFromHost = async () => {
    try {
      const result = await pair({ port, cockpit: cockpitClient(appUrl, hostToken) });
      return { ...result, message: summary(result) };
    } catch (error) {
      return { paired: [], failed: [], message: `Pairing failed: ${error?.message || error}` };
    }
  };
  ipcMain.handle("telar:dev:pair-simulators", () => pairFromHost());
  notifyResult = notify;
  return true;
}

let notifyResult = () => {};

function devMenuItem() {
  if (!pairFromHost) return null;
  return { label: "Pair Booted Simulators", click: () => void pairFromHost().then(({ message }) => notifyResult(message)) };
}

module.exports = { devMenuItem, pairBootedSimulators, registerDevPairing };
