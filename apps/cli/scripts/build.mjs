import { spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";

const root = path.resolve(import.meta.dirname, "..");
const { values } = parseArgs({ options: { sea: { type: "boolean" }, version: { type: "string" }, node: { type: "string" } } });
const version = values.version ?? JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8")).version;
const target = `${process.platform}-${process.arch}`;
const EXTERNALS = ["node-pty", "@anthropic-ai/claude-agent-sdk"];

// A single executable can only import built-ins, so the SDK is required from the node_modules shipped beside it.
const sidecar = {
  name: "sidecar",
  setup(build) {
    build.onResolve({ filter: /^@anthropic-ai\/claude-agent-sdk$/ }, ({ path: name }) => ({ path: name, namespace: "sidecar" }));
    build.onLoad({ filter: /.*/, namespace: "sidecar" }, async ({ path: name }) => {
      const names = Object.keys(await import(name)).filter((key) => key !== "default");
      return {
        loader: "js",
        contents: `import { createRequire } from "node:module";\nconst sdk = createRequire(import.meta.url)(${JSON.stringify(name)});\nexport const { ${names.join(", ")} } = sdk;\n`,
      };
    });
  },
};

const outdir = path.join(root, "dist");
const result = await Bun.build({
  entrypoints: [path.join(root, "src/main.ts")],
  outdir: values.sea ? path.join(outdir, "sea") : outdir,
  naming: "telar.mjs",
  banner: values.sea ? "" : "#!/usr/bin/env node",
  target: "node",
  format: "esm",
  external: values.sea ? ["node-pty"] : EXTERNALS,
  define: { "process.env.TELAR_CLI_VERSION": JSON.stringify(version) },
  plugins: values.sea ? [sidecar] : [],
});
if (!result.success) {
  for (const log of result.logs) console.error(String(log));
  process.exit(1);
}
if (!values.sea) process.exit(0);

function run(command, args, options = {}) {
  const done = spawnSync(command, args, { stdio: "inherit", ...options });
  if (done.status !== 0) throw new Error(`${command} ${args.join(" ")} exited ${done.status ?? done.signal}`);
}

const stage = path.join(outdir, "stage", target);
fs.rmSync(stage, { recursive: true, force: true });
fs.mkdirSync(stage, { recursive: true });
const seaConfig = path.join(outdir, "sea", "sea-config.json");
fs.writeFileSync(seaConfig, JSON.stringify({ main: path.join(outdir, "sea", "telar.mjs"), output: path.join(stage, "telar"), mainFormat: "module", disableExperimentalSEAWarning: true }));
run(values.node ?? "node", ["--build-sea", seaConfig]);
if (process.platform === "darwin") run("codesign", ["--force", "--sign", "-", path.join(stage, "telar")]);

const modules = path.join(stage, "node_modules");
const nodeModules = path.join(root, "node_modules");
const copy = (from, to, filter) => fs.cpSync(from, path.join(modules, to), { recursive: true, dereference: true, filter });
const pty = fs.realpathSync(path.join(nodeModules, "node-pty"));
const ownPrebuild = `${path.sep}prebuilds${path.sep}${target}`;
copy(pty, "node-pty", (file) => {
  const relative = file.slice(pty.length);
  if (/^[\\/](src|third_party|typings|scripts)/.test(relative)) return false;
  return !relative.startsWith(`${path.sep}prebuilds${path.sep}`) || relative.startsWith(ownPrebuild);
});
const sdk = fs.realpathSync(path.join(nodeModules, "@anthropic-ai", "claude-agent-sdk"));
const sdkBinary = path.join(path.dirname(sdk), `claude-agent-sdk-${target}`);
if (!fs.existsSync(sdkBinary)) throw new Error(`${sdkBinary} is missing; run bun install on a ${target} machine.`);
copy(sdk, "@anthropic-ai/claude-agent-sdk");
copy(sdkBinary, `@anthropic-ai/claude-agent-sdk-${target}`);

// The engine's browser tools run Playwright's CLI from beside the executable, through the executable itself.
const playwright = fs.realpathSync(path.join(root, "..", "engine", "node_modules", "@playwright", "mcp"));
const playwrightModules = path.resolve(playwright, "..", "..");
for (const name of ["@playwright/mcp", "playwright", "playwright-core"]) copy(fs.realpathSync(path.join(playwrightModules, name)), name);

const releases = path.join(outdir, "release");
fs.mkdirSync(releases, { recursive: true });
const archive = `telar-${version}-${target}.tar.gz`;
run("tar", ["-czf", path.join(releases, archive), "-C", stage, "."]);
const hash = crypto.createHash("sha256").update(fs.readFileSync(path.join(releases, archive))).digest("hex");
fs.writeFileSync(path.join(releases, `${archive}.sha256`), `${hash}  ${archive}\n`);
console.log(`${archive} ${hash}`);
