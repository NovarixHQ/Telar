import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { OWN_GROUP, signalGroup } from "../../platform/process/group";
import { CdpConnection } from "./cdp";
import { findChromium } from "./setup";

const LAUNCH_TIMEOUT_MS = 20_000;
const LISTENING = /DevTools listening on (ws:\/\/\S+)/;

export type ChromiumProcess = { wsUrl: string; kill(): void };
export type LaunchChromium = (options: { binary: string; userDataDir: string }) => Promise<ChromiumProcess>;

const launchChromium: LaunchChromium = ({ binary, userDataDir }) =>
  new Promise((resolve, reject) => {
    const child = spawn(
      binary,
      ["--headless=new", "--remote-debugging-port=0", `--user-data-dir=${userDataDir}`, "--no-first-run", "--no-default-browser-check", "--window-size=1280,800", "about:blank"],
      { stdio: ["ignore", "ignore", "pipe"], detached: OWN_GROUP },
    );
    let stderr = "";
    const timer = setTimeout(() => fail("Chromium did not start in time."), LAUNCH_TIMEOUT_MS);
    const fail = (reason: string) => {
      clearTimeout(timer);
      signalGroup(child, "SIGKILL");
      reject(new Error(stderr.trim() ? `${reason} ${stderr.trim().slice(-400)}` : reason));
    };
    child.stderr.on("data", (chunk: Buffer) => {
      stderr = `${stderr}${chunk}`.slice(-4_000);
      const match = LISTENING.exec(stderr);
      if (!match) return;
      clearTimeout(timer);
      resolve({ wsUrl: match[1]!, kill: () => signalGroup(child, "SIGKILL") });
    });
    child.once("error", (error) => fail(error.message));
    child.once("exit", (code) => fail(`Chromium exited with code ${code}.`));
  });

export type ChromiumHostOptions = {
  browsersPath: string;
  userDataDir?: string;
  launch?: LaunchChromium;
};

export class ChromiumHost {
  private starting: Promise<{ cdp: CdpConnection; endpoint: string }> | null = null;
  private process: ChromiumProcess | null = null;
  private cleanup: string | null = null;

  constructor(private readonly options: ChromiumHostOptions) {}

  get running(): boolean {
    return this.process !== null;
  }

  get installed(): boolean {
    return this.options.launch !== undefined || findChromium(this.options.browsersPath) !== null;
  }

  ensure(): Promise<{ cdp: CdpConnection; endpoint: string }> {
    this.starting ??= this.start().catch((error) => {
      this.starting = null;
      throw error;
    });
    return this.starting;
  }

  private async start(): Promise<{ cdp: CdpConnection; endpoint: string }> {
    const binary = findChromium(this.options.browsersPath) ?? "";
    const userDataDir = this.options.userDataDir ?? (this.cleanup = fs.mkdtempSync(path.join(os.tmpdir(), "telar-chromium-")));
    fs.mkdirSync(userDataDir, { recursive: true });
    this.process = await (this.options.launch ?? launchChromium)({ binary, userDataDir });
    const cdp = await CdpConnection.connect(this.process.wsUrl);
    cdp.onClose(() => void this.close());
    return { cdp, endpoint: `http://${new URL(this.process.wsUrl).host}` };
  }

  async close(): Promise<void> {
    const starting = this.starting;
    this.starting = null;
    this.process?.kill();
    this.process = null;
    if (starting) (await starting.catch(() => null))?.cdp.close();
    if (this.cleanup) fs.rmSync(this.cleanup, { recursive: true, force: true });
    this.cleanup = null;
  }
}
