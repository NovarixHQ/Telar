// Exports the cockpit to apps/web/out. A static export cannot hold route handlers or proxy.ts, so the
// build runs on a copy of the web workspace without them; node_modules and public are linked, not copied. The copy sits beside apps/web because some sources import ../../../../desktop/src.
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const web = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const stage = path.join(web, "../.web-static");
const out = path.join(web, "out");
const left = [path.join(web, "src/app/api"), path.join(web, "src/app/dev"), path.join(web, "src/proxy.ts")];
const skip = (file) => /\.test\.tsx?$/.test(file) || left.some((it) => file === it || file.startsWith(`${it}/`));
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

fs.rmSync(stage, { recursive: true, force: true });
fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(stage);
fs.cpSync(path.join(web, "src"), path.join(stage, "src"), { recursive: true, filter: (file) => !skip(file) });
for (const name of ["package.json", "tsconfig.json", "next.config.ts", "postcss.config.mjs"]) fs.copyFileSync(path.join(web, name), path.join(stage, name));
for (const name of ["node_modules", "public"]) fs.symlinkSync(path.join(web, name), path.join(stage, name));

const build = spawnSync("bunx", ["next", "build"], { cwd: stage, stdio: "inherit", env: { ...process.env, NEXT_OUTPUT: "export" } });
if (build.status === 0) fs.renameSync(path.join(stage, "out"), out);
fs.rmSync(stage, { recursive: true, force: true });
if (build.status !== 0) process.exit(build.status ?? 1);
const missing = ROUTES.filter((route) => !fs.existsSync(path.join(out, route)));
if (missing.length) {
  console.error(`The static export is missing: ${missing.join(", ")}`);
  process.exit(1);
}
