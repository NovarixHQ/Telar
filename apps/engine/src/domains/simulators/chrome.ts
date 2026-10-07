import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { SimulatorChrome } from "@telar/engine-client";
import type { ProcessRunner } from "../../platform/process/runner";

const DEVICEKIT_CHROME_DIR = "/Library/Developer/DeviceKit/Chrome";
const CHROME_PREFIX = "com.apple.dt.devicekit.chrome.";
const RENDER_SCALE = 3;
const SLICES = ["topLeft", "top", "topRight", "left", "right", "bottomLeft", "bottom", "bottomRight"] as const;

type Frame = NonNullable<SimulatorChrome["frame"]>;
type Image = Frame["slices"]["top"];
type Anchor = "left" | "right" | "top" | "bottom";
type Offset = { x: number; y: number };
type Input = { image: string; anchor: Anchor; align: string; onTop: boolean; normal: Offset; rollover: Offset };
type Json = Record<string, unknown>;

export type ChromeDeps = { run: ProcessRunner["run"]; chromeDir?: string };

const record = (value: unknown): Json => (value && typeof value === "object" && !Array.isArray(value) ? (value as Json) : {});
const num = (value: unknown) => (typeof value === "number" && Number.isFinite(value) ? value : 0);
const offset = (value: unknown): Offset => ({ x: num(record(value).x), y: num(record(value).y) });

async function readPlist(deps: ChromeDeps, file: string): Promise<Json> {
  if (!fs.existsSync(file)) return {};
  const { code, stdout } = await deps.run("plutil", ["-convert", "json", "-o", "-", file], { timeoutMs: 5_000 });
  try {
    return code === 0 ? record(JSON.parse(stdout)) : {};
  } catch {
    return {};
  }
}

async function render(deps: ChromeDeps, pdf: string): Promise<Image | undefined> {
  if (!fs.existsSync(pdf)) return undefined;
  const probe = await deps.run("sips", ["-g", "pixelWidth", "-g", "pixelHeight", pdf], { timeoutMs: 10_000 });
  const width = Number(/pixelWidth:\s*([\d.]+)/.exec(probe.stdout)?.[1]);
  const height = Number(/pixelHeight:\s*([\d.]+)/.exec(probe.stdout)?.[1]);
  if (!(width > 0 && height > 0)) return undefined;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "telar-chrome-"));
  try {
    const out = path.join(dir, "image.png");
    const size = (side: number) => String(Math.max(1, Math.round(side * RENDER_SCALE)));
    const { code } = await deps.run("sips", ["-s", "format", "png", "-z", size(height), size(width), pdf, "--out", out], { timeoutMs: 10_000 });
    if (code !== 0 || !fs.existsSync(out)) return undefined;
    return { src: `data:image/png;base64,${fs.readFileSync(out).toString("base64")}`, width, height };
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

function placeButton(input: Input, image: Image, body: { width: number; height: number }): Offset {
  const dx = 2 * input.normal.x - input.rollover.x;
  const dy = 2 * input.normal.y - input.rollover.y;
  const along = input.align === "trailing" ? body.width + dx - image.width : input.align === "center" ? (body.width - image.width) / 2 + dx : dx;
  if (input.anchor === "left") return { x: input.rollover.x - image.width / 2, y: input.rollover.y };
  if (input.anchor === "right") return { x: body.width + dx, y: dy };
  return { x: along, y: input.anchor === "top" ? dy - image.height : body.height + dy };
}

function readInputs(value: unknown): Input[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    const input = record(entry);
    const offsets = record(input.offsets);
    if (typeof input.image !== "string" || !["left", "right", "top", "bottom"].includes(String(input.anchor))) return [];
    return [{ image: input.image, anchor: input.anchor as Anchor, align: String(input.align ?? "leading"), onTop: input.onTop === true, normal: offset(offsets.normal), rollover: offset(offsets.rollover ?? offsets.normal) }];
  });
}

async function readFrame(deps: ChromeDeps, chromeId: string, screen: { width: number; height: number }): Promise<Frame | null> {
  const name = chromeId.startsWith(CHROME_PREFIX) ? chromeId.slice(CHROME_PREFIX.length) : "";
  if (!/^[A-Za-z0-9_-]+$/.test(name)) return null;
  const resources = path.join(deps.chromeDir ?? DEVICEKIT_CHROME_DIR, `${name}.devicechrome`, "Contents", "Resources");
  let chrome: Json;
  try {
    chrome = record(JSON.parse(fs.readFileSync(path.join(resources, "chrome.json"), "utf8")));
  } catch {
    return null;
  }
  const images = record(chrome.images);
  const pdf = (image: unknown) => (typeof image === "string" && !image.includes("/") ? path.join(resources, `${image}.pdf`) : "");
  const pieces = await Promise.all(SLICES.map((slice) => render(deps, pdf(images[slice]))));
  if (pieces.some((piece) => !piece)) return null;
  const slices = Object.fromEntries(SLICES.map((slice, index) => [slice, pieces[index]!])) as Frame["slices"];
  const sizing = record(images.sizing);
  const inset = { left: num(sizing.leftWidth), right: num(sizing.rightWidth), top: num(sizing.topHeight), bottom: num(sizing.bottomHeight) };
  const body = { width: screen.width + inset.left + inset.right, height: screen.height + inset.top + inset.bottom };
  const buttons = await Promise.all(
    readInputs(chrome.inputs).map(async (input) => {
      const image = await render(deps, pdf(input.image));
      return image ? [{ ...image, ...placeButton(input, image, body), onTop: input.onTop }] : [];
    }),
  );
  return { ...body, screen: { x: inset.left, y: inset.top }, slices, buttons: buttons.flat() };
}

export async function readDeviceType(deps: ChromeDeps, bundlePath: string): Promise<SimulatorChrome | null> {
  const resources = path.join(bundlePath, "Contents", "Resources");
  const [profile, capabilities] = await Promise.all([readPlist(deps, path.join(resources, "profile.plist")), readPlist(deps, path.join(resources, "capabilities.plist"))]);
  const caps = record(capabilities.capabilities);
  const displays = Array.isArray(caps.displays) ? caps.displays.map(record) : [];
  const display = displays.find((entry) => entry.displayType === "integrated") ?? displays[0] ?? {};
  const scale = num(display.scale);
  if (!(scale > 0 && num(display.width) > 0 && num(display.height) > 0)) return null;
  const screen = { width: num(display.width) / scale, height: num(display.height) / scale, cornerRadius: num(display.cornerRadiusUL) || num(caps.DeviceCornerRadius) };
  const chromeId = typeof display.chromeIdentifier === "string" ? display.chromeIdentifier : typeof profile.chromeIdentifier === "string" ? profile.chromeIdentifier : "";
  return { screen, frame: chromeId ? await readFrame(deps, chromeId, screen) : null };
}

type SimctlList = { devices?: Record<string, Array<{ udid?: unknown; deviceTypeIdentifier?: unknown }>>; devicetypes?: Array<{ identifier?: unknown; bundlePath?: unknown }> };

export class DeviceChrome {
  private readonly byType = new Map<string, Promise<SimulatorChrome | null>>();
  private readonly typeOf = new Map<string, string>();
  private bundles = new Map<string, string>();

  constructor(private readonly deps: ChromeDeps) {}

  async read(udid: string): Promise<SimulatorChrome | null> {
    if (!this.typeOf.has(udid)) await this.list();
    const type = this.typeOf.get(udid);
    const bundle = type ? this.bundles.get(type) : undefined;
    if (!type || !bundle) return null;
    if (!this.byType.has(type)) this.byType.set(type, readDeviceType(this.deps, bundle).catch(() => null));
    return this.byType.get(type)!;
  }

  private async list(): Promise<void> {
    const { code, stdout } = await this.deps.run("xcrun", ["simctl", "list", "--json", "devices", "devicetypes"], { timeoutMs: 15_000 }).catch(() => ({ code: 1, stdout: "" }));
    if (code !== 0) return;
    let list: SimctlList;
    try {
      list = JSON.parse(stdout) as SimctlList;
    } catch {
      return;
    }
    for (const devices of Object.values(list.devices ?? {})) {
      for (const device of Array.isArray(devices) ? devices : []) {
        if (typeof device.udid === "string" && typeof device.deviceTypeIdentifier === "string") this.typeOf.set(device.udid, device.deviceTypeIdentifier);
      }
    }
    this.bundles = new Map((list.devicetypes ?? []).flatMap((type) => (typeof type.identifier === "string" && typeof type.bundlePath === "string" ? [[type.identifier, type.bundlePath] as const] : [])));
  }
}
