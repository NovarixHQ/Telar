const fs = require("node:fs");
const path = require("node:path");

const FILE_NAME = "surface-windows.json";
const VERSION = 1;
const MIN_SIDE = 100;

function cleanBounds(value) {
  if (!value || typeof value !== "object") return null;
  const [x, y, width, height] = [value.x, value.y, value.width, value.height].map((n) => Math.round(Number(n)));
  if (![x, y, width, height].every(Number.isFinite) || width < MIN_SIDE || height < MIN_SIDE) return null;
  return { x, y, width, height };
}

function cleanEntry(value) {
  if (!value || typeof value !== "object" || typeof value.kind !== "string" || typeof value.key !== "string" || !value.key) return null;
  const bounds = cleanBounds(value.bounds);
  if (!bounds) return null;
  return {
    kind: value.kind,
    key: value.key,
    bounds,
    ...(Number.isFinite(value.displayId) ? { displayId: value.displayId } : {}),
    fullscreen: value.fullscreen === true,
    compact: value.compact === true,
    ...(cleanBounds(value.expanded) ? { expanded: cleanBounds(value.expanded) } : {}),
  };
}

const idOf = (kind, key) => `${kind}\u0000${key}`;

function createSurfaceWindowStore(userDataDir, { fsImpl = fs, setTimer = setTimeout, clearTimer = clearTimeout, writeDelayMs = 250 } = {}) {
  const file = path.join(userDataDir, FILE_NAME);
  const entries = new Map();
  let timer = null;
  let held = false;

  try {
    const document = JSON.parse(fsImpl.readFileSync(file, "utf8"));
    for (const raw of Array.isArray(document?.windows) ? document.windows : []) {
      const entry = cleanEntry(raw);
      if (entry) entries.set(idOf(entry.kind, entry.key), entry);
    }
  } catch (error) {
    if (error?.code !== "ENOENT") console.error(`[telar-desktop] ignoring unreadable surface windows: ${error?.message || error}`);
  }

  function write() {
    timer = null;
    const tmp = `${file}.${process.pid}.tmp`;
    try {
      fsImpl.mkdirSync(userDataDir, { recursive: true });
      fsImpl.writeFileSync(tmp, JSON.stringify({ version: VERSION, windows: [...entries.values()] }), "utf8");
      fsImpl.renameSync(tmp, file);
    } catch (error) {
      console.error(`[telar-desktop] could not save surface windows: ${error?.message || error}`);
      try { fsImpl.unlinkSync(tmp); } catch {}
    }
  }

  function schedule() {
    if (!timer) timer = setTimer(write, writeDelayMs);
  }

  function flush() {
    if (!timer) return;
    clearTimer(timer);
    write();
  }

  return {
    file,
    list(kind) {
      return [...entries.values()].filter((entry) => entry.kind === kind);
    },
    get(kind, key) {
      return entries.get(idOf(kind, key)) || null;
    },
    remember(kind, key, state) {
      const entry = cleanEntry({ ...state, kind, key });
      if (!entry) return;
      entries.set(idOf(kind, key), entry);
      schedule();
    },
    forget(kind, key) {
      if (held || !entries.delete(idOf(kind, key))) return;
      schedule();
    },
    holdForQuit() {
      held = true;
      flush();
    },
    release() {
      held = false;
    },
    flush,
  };
}

function overlap(a, b) {
  const width = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
  const height = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
  return width > 0 && height > 0 ? width * height : 0;
}

const clamp = (value, low, high) => Math.min(Math.max(value, low), Math.max(low, high));

function placeOnDisplays(saved, displays, primary) {
  const byOverlap = [...displays].sort((a, b) => overlap(saved.bounds, b.workArea) - overlap(saved.bounds, a.workArea))[0];
  const display = displays.find((candidate) => candidate.id === saved.displayId)
    || (byOverlap && overlap(saved.bounds, byOverlap.workArea) > 0 ? byOverlap : null)
    || primary
    || displays[0];
  if (!display) return { ...saved.bounds };
  const area = display.workArea;
  const width = Math.min(saved.bounds.width, area.width);
  const height = Math.min(saved.bounds.height, area.height);
  return {
    x: clamp(saved.bounds.x, area.x, area.x + area.width - width),
    y: clamp(saved.bounds.y, area.y, area.y + area.height - height),
    width,
    height,
  };
}

module.exports = { createSurfaceWindowStore, placeOnDisplays };
