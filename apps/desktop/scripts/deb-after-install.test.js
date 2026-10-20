const { afterEach, describe, expect, test } = require("bun:test");
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const manifest = require("../package.json");

const TEMPLATE = path.join(__dirname, "..", manifest.build.deb.afterInstall);

function render() {
  const macros = { executable: manifest.build.linux.executableName, sanitizedProductName: manifest.build.productName };
  return fs.readFileSync(TEMPLATE, "utf8").replace(/\${([a-zA-Z]+)}/g, (_, name) => {
    if (!(name in macros)) throw new Error(`electron-builder would refuse the undefined macro ${name}`);
    return macros[name];
  });
}

const STUBS = {
  apparmor_status: `[ "$FAKE_APPARMOR" = 1 ]`,
  apparmor_parser: `echo "apparmor_parser $*" >> "$FAKE_LOG"; case "$*" in *--skip-kernel-load*) [ "$FAKE_PARSER_ACCEPTS" = 1 ] ;; *) exit 0 ;; esac`,
  chown: `echo "chown $*" >> "$FAKE_LOG"`,
  "update-alternatives": `exit 0`,
  "update-mime-database": `exit 0`,
  "update-desktop-database": `exit 0`,
};

const roots = [];
afterEach(() => {
  for (const dir of roots.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

function install({ apparmor = false, parserAccepts = true, sysctls = {}, userns = true, sandboxMode = 0o755 } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "telar-postinst-"));
  roots.push(root);
  const app = path.join(root, "opt", manifest.build.productName);
  fs.mkdirSync(path.join(app, "resources"), { recursive: true });
  fs.mkdirSync(path.join(root, "usr", "bin"), { recursive: true });
  fs.mkdirSync(path.join(root, "etc", "apparmor.d"), { recursive: true });
  fs.writeFileSync(path.join(app, "resources", "apparmor-profile"), "profile telar /opt/Telar/telar flags=(unconfined) { userns, }\n");
  fs.writeFileSync(path.join(app, "chrome-sandbox"), "");
  fs.chmodSync(path.join(app, "chrome-sandbox"), sandboxMode);
  if (userns) {
    fs.mkdirSync(path.join(root, "proc", "self", "ns"), { recursive: true });
    fs.writeFileSync(path.join(root, "proc", "self", "ns", "user"), "");
  }
  for (const [name, value] of Object.entries(sysctls)) {
    fs.mkdirSync(path.dirname(path.join(root, "proc", "sys", name)), { recursive: true });
    fs.writeFileSync(path.join(root, "proc", "sys", name), `${value}\n`);
  }
  const bin = path.join(root, "stubs");
  fs.mkdirSync(bin);
  for (const [name, body] of Object.entries(STUBS)) fs.writeFileSync(path.join(bin, name), `#!/bin/sh\n${body}\n`, { mode: 0o755 });
  const script = path.join(root, "postinst");
  fs.writeFileSync(script, render(), { mode: 0o755 });

  const log = path.join(root, "calls.log");
  fs.writeFileSync(log, "");
  const result = spawnSync("bash", [script, "configure"], {
    encoding: "utf8",
    env: {
      PATH: `${bin}:/usr/bin:/bin`,
      TELAR_POSTINST_ROOT: root,
      FAKE_LOG: log,
      FAKE_APPARMOR: apparmor ? "1" : "0",
      FAKE_PARSER_ACCEPTS: parserAccepts ? "1" : "0",
    },
  });
  expect(result.status, result.stderr).toBe(0);
  return {
    sandboxMode: fs.statSync(path.join(app, "chrome-sandbox")).mode & 0o7777,
    profileInstalled: fs.existsSync(path.join(root, "etc", "apparmor.d", manifest.build.linux.executableName)),
    calls: fs.readFileSync(log, "utf8"),
  };
}

describe("the .deb's postinst keeps Chromium's sandbox on", () => {
  test("Ubuntu 24.04: the AppArmor profile allows user namespaces for Telar, so chrome-sandbox stays unprivileged", () => {
    const done = install({ apparmor: true, sysctls: { "kernel/apparmor_restrict_unprivileged_userns": 1 } });
    expect(done.profileInstalled).toBe(true);
    expect(done.sandboxMode).toBe(0o755);
    expect(done.calls).not.toContain("chown");
  });

  test("an AppArmor that restricts namespaces but cannot load the profile gets the setuid helper", () => {
    const done = install({ apparmor: true, parserAccepts: false, sysctls: { "kernel/apparmor_restrict_unprivileged_userns": 1 } });
    expect(done.profileInstalled).toBe(false);
    expect(done.sandboxMode).toBe(0o4755);
    expect(done.calls).toContain("chown root:root");
  });

  test("a kernel that forbids unprivileged namespaces gets the setuid helper", () => {
    expect(install({ sysctls: { "kernel/unprivileged_userns_clone": 0 } }).sandboxMode).toBe(0o4755);
    expect(install({ sysctls: { "user/max_user_namespaces": 0 } }).sandboxMode).toBe(0o4755);
    expect(install({ userns: false }).sandboxMode).toBe(0o4755);
  });

  test("a system where namespaces work drops a setuid bit an earlier install left behind", () => {
    const done = install({ sysctls: { "kernel/unprivileged_userns_clone": 1, "user/max_user_namespaces": 63000 }, sandboxMode: 0o4755 });
    expect(done.sandboxMode).toBe(0o755);
    expect(done.calls).not.toContain("chown");
  });
});
