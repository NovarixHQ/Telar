const fs = require("node:fs");
const path = require("node:path");
const { app } = require("electron");
const { DEV_BUILD } = require("./flags");
const { resolveHelperExec } = require("./helper-exec");

function buildInfoPath() {
  return app.isPackaged ? path.join(process.resourcesPath, "build-info.json") : path.join(__dirname, "..", "..", "..", "web", "build-info.json");
}

function readBuildInfo() {
  try {
    return JSON.parse(fs.readFileSync(buildInfoPath(), "utf8"));
  } catch {
    return null;
  }
}

function windowTitle() {
  if (!app.isPackaged) return "Telar Dev";
  const info = readBuildInfo();

  const name = DEV_BUILD ? "Telar Dev" : "Telar";
  if (!info || !info.shortSha) return name;
  return `${name} ${info.shortSha}${DEV_BUILD && info.dirty ? "+dirty" : ""}`;
}

function developmentIconPath() {
  if (app.isPackaged) return undefined;

  for (const name of ["icon-dev.png", "icon.png"]) {
    const icon = path.join(__dirname, "..", "..", "assets", name);
    if (fs.existsSync(icon)) return icon;
  }
  return undefined;
}

function applyDevelopmentAppIcon() {
  const icon = developmentIconPath();
  if (icon && process.platform === "darwin" && app.dock) app.dock.setIcon(icon);
  return icon;
}

function bundledPlaywrightMcpCli() {
  return app.isPackaged
    ? path.join(process.resourcesPath, "engine", "playwright-mcp", "node_modules", "@playwright", "mcp", "cli.js")
    : path.join(__dirname, "..", "..", "..", "engine", "dist", "playwright-mcp", "node_modules", "@playwright", "mcp", "cli.js");
}

function bundledAgentSdkEntry() {
  return app.isPackaged
    ? path.join(process.resourcesPath, "engine", "node_modules", "@anthropic-ai", "claude-agent-sdk", "sdk.mjs")
    : path.join(__dirname, "..", "..", "..", "engine", "dist", "node_modules", "@anthropic-ai", "claude-agent-sdk", "sdk.mjs");
}

function cockpitDir() {
  const dir = app.isPackaged ? path.join(process.resourcesPath, "cockpit") : path.join(__dirname, "..", "..", "..", "web", "out");
  if (!fs.existsSync(path.join(dir, "index.html"))) throw new Error(`cockpit not found at ${dir}. Run \`bun run build:app\` first.`);
  return dir;
}

function resolveEngineJs() {
  const candidates = app.isPackaged
    ? [path.join(process.resourcesPath, "engine", "engine.mjs")]
    : [path.join(__dirname, "..", "..", "..", "engine", "dist", "engine.mjs")];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }
  throw new Error(
    `engine bundle not found (looked in: ${candidates.join(", ")}). Run \`bun run build:app\` first.`,
  );
}

function nodeExecPath() {
  if (app.isPackaged && process.platform === "darwin") {
    const frameworks = path.join(path.dirname(process.execPath), "..", "Frameworks");
    const helper = resolveHelperExec(frameworks, app.getName());
    if (helper) return helper;
  }
  return process.execPath;
}

function computerUseHelperPath() {
  if (!app.isPackaged || process.platform !== "darwin") return null;
  const { appName } = require("./computer-use-helper.json");
  const helper = path.join(path.dirname(process.resourcesPath), "Helpers", `${appName}.app`);
  return fs.existsSync(helper) ? helper : null;
}

module.exports = {
  applyDevelopmentAppIcon,
  bundledAgentSdkEntry,
  buildInfoPath,
  bundledPlaywrightMcpCli,
  cockpitDir,
  computerUseHelperPath,
  developmentIconPath,
  nodeExecPath,
  resolveEngineJs,
  windowTitle,
};
