import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const web = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const out = path.join(web, "out");
const ROUTES = [
  "index.html",
  "settings.html",
  "usage.html",
  "pair.html",
  "surface/quick.html",
  "surface/browser.html",
  "projects/_/sessions/_.html",
  "projects/_/sessions/_/solo.html",
  "projects/_/sessions/new.html",
  "hosts/_/projects/_/sessions/_.html",
  "hosts/_/projects/_/sessions/_/solo.html",
  "hosts/_/projects/_/sessions/new.html",
];

fs.rmSync(out, { recursive: true, force: true });
const build = spawnSync("bunx", ["next", "build"], { cwd: web, stdio: "inherit", env: { ...process.env, NEXT_OUTPUT: "export" } });
if (build.status !== 0) process.exit(build.status ?? 1);
const missing = ROUTES.filter((route) => !fs.existsSync(path.join(out, route)));
if (missing.length) {
  console.error(`The static export is missing: ${missing.join(", ")}`);
  process.exit(1);
}
