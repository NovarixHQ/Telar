import { afterAll, expect, test } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { runCli } from "./cli";
import { installService, restartService, serviceCommand, serviceStatus, uninstallService, type Exec, type ServiceContext } from "./service";
import { launchdPlist, systemdUnit } from "./service-unit";

const dirs: string[] = [];
const temp = (): string => {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "telar-service-")));
  dirs.push(dir);
  return dir;
};
afterAll(() => dirs.forEach((dir) => fs.rmSync(dir, { recursive: true, force: true })));

const FLAGS = { host: "0.0.0.0", port: 7420, tailscaleServe: false };
const capture = () => {
  const lines: string[] = [];
  return { lines, io: { out: (line: string) => void lines.push(line), err: (line: string) => void lines.push(line) } };
};
function context(platform: NodeJS.Platform, overrides: Partial<ServiceContext> = {}) {
  const calls: string[] = [];
  const exec: Exec = async (file, args) => (calls.push([file, ...args].join(" ")), { code: 0, stdout: "", stderr: "" });
  const userHome = temp();
  const ctx: ServiceContext = { home: path.join(userHome, "data", "telar"), userHome, platform, uid: 501, user: "ada", exec, env: {}, ...overrides };
  return { ctx, calls };
}

test("the systemd unit kills the whole cgroup, restarts on failure and avoids the oomd and resource-weight settings", () => {
  const text = systemdUnit({ command: ["/home/ada/.telar/runtime/current/telar", "serve", "--home", "/home/ada/my data/telar", "--host", "0.0.0.0", "--port", "7420"], home: "/h", logFile: "/l" });
  expect(text).toBe(`[Unit]
Description=Telar engine
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
ExecStart="/home/ada/.telar/runtime/current/telar" "serve" "--home" "/home/ada/my data/telar" "--host" "0.0.0.0" "--port" "7420"
Restart=on-failure
RestartSec=3
KillMode=control-group
TimeoutStopSec=20

[Install]
WantedBy=default.target
`);
  expect(text).not.toMatch(/ManagedOOMPreference|CPUWeight|IOWeight/);
});

test("the launchd plist keeps the engine alive after a failure and logs to a file", () => {
  const text = launchdPlist({ command: ["/Users/ada/.telar/runtime/current/telar", "serve", "--home", "/Users/ada/A&B"], home: "/Users/ada/A&B", logFile: "/Users/ada/A&B/logs/engine.log" });
  expect(text).toBe(`<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>com.telar.cli</string>
  <key>ProgramArguments</key>
  <array>
    <string>/Users/ada/.telar/runtime/current/telar</string>
    <string>serve</string>
    <string>--home</string>
    <string>/Users/ada/A&amp;B</string>
  </array>
  <key>WorkingDirectory</key>
  <string>/Users/ada/A&amp;B</string>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <dict>
    <key>SuccessfulExit</key>
    <false/>
  </dict>
  <key>ProcessType</key>
  <string>Interactive</string>
  <key>StandardOutPath</key>
  <string>/Users/ada/A&amp;B/logs/engine.log</string>
  <key>StandardErrorPath</key>
  <string>/Users/ada/A&amp;B/logs/engine.log</string>
</dict>
</plist>
`);
});

test("a binary inside the runtime is run through the current link so an update takes effect on restart", () => {
  const { ctx } = context("linux");
  const runtime = path.join(ctx.userHome, ".telar", "runtime");
  expect(serviceCommand(ctx, FLAGS, path.join(runtime, "versions", "1.2.3", "telar"))).toEqual([path.join(runtime, "current", "telar"), "serve", "--home", ctx.home, "--host", "0.0.0.0", "--port", "7420"]);
  expect(serviceCommand(ctx, { ...FLAGS, tailscaleServe: true }, "/usr/bin/node", "/opt/telar.mjs").slice(0, 2)).toEqual(["/usr/bin/node", "/opt/telar.mjs"]);
});

test("installing on Linux writes the user unit, enables it and turns linger on", async () => {
  const { ctx, calls } = context("linux");
  const { lines, io } = capture();
  await installService(ctx, FLAGS, io, ["/bin/telar", "serve"]);
  const unit = path.join(ctx.userHome, ".config", "systemd", "user", "telar.service");
  expect(fs.readFileSync(unit, "utf8")).toContain('ExecStart="/bin/telar" "serve"');
  expect(calls).toEqual(["systemctl --user daemon-reload", "systemctl --user enable --now telar.service", "loginctl enable-linger ada"]);
  expect(lines[0]).toContain("journalctl --user -u telar.service -f");
  await restartService(ctx, io);
  expect(calls.at(-1)).toBe("systemctl --user restart telar.service");
  await uninstallService(ctx, io);
  expect(fs.existsSync(unit)).toBe(false);
  expect(calls).toContain("systemctl --user disable --now telar.service");
});

test("a failed linger is reported with the command to run", async () => {
  const { ctx } = context("linux", { exec: async (file) => (file === "loginctl" ? { code: 1, stdout: "", stderr: "denied" } : { code: 0, stdout: "", stderr: "" }) });
  const { lines, io } = capture();
  await installService(ctx, FLAGS, io, ["/bin/telar"]);
  expect(lines.join("\n")).toContain("sudo loginctl enable-linger ada");
});

test("installing on macOS writes a LaunchAgent and bootstraps it in the user's domain", async () => {
  const { ctx, calls } = context("darwin");
  const { io } = capture();
  await installService(ctx, FLAGS, io, ["/bin/telar", "serve"]);
  const plist = path.join(ctx.userHome, "Library", "LaunchAgents", "com.telar.cli.plist");
  expect(fs.existsSync(plist)).toBe(true);
  expect(calls.at(-1)).toBe(`launchctl bootstrap gui/501 ${plist}`);
  await restartService(ctx, io);
  expect(calls.at(-1)).toBe("launchctl kickstart -k gui/501/com.telar.cli");
});

test("status before install says so, and an unknown action is a usage error", async () => {
  const { io, lines } = capture();
  expect(await serviceStatus(context("linux").ctx, io)).toBe(3);
  expect(lines[0]).toContain("Not installed");
  expect(await runCli(["service", "frobnicate", "--home", temp()], io)).toBe(2);
});
