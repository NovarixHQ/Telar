/** FNV-1a over UTF-16 units, mod 360: the hue Swift gives a project or computer name. */
export function nameHue(name: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < name.length; index++) {
    hash ^= name.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash % 360;
}

export function nameInitial(name: string): string {
  const first = [...name.trim()][0];
  return first ? first.toUpperCase() : "?";
}

/** SwiftUI's `Color(hue:saturation:brightness:)` as #RRGGBBAA; hue in degrees. */
export function hsb(hue: number, saturation: number, brightness: number, opacity = 1): string {
  const channel = (n: number) => {
    const k = (n + hue / 60) % 6;
    const value = brightness - brightness * saturation * Math.max(0, Math.min(k, 4 - k, 1));
    return Math.round(value * 255).toString(16).padStart(2, "0");
  };
  return `#${channel(5)}${channel(3)}${channel(1)}${Math.round(opacity * 255).toString(16).padStart(2, "0")}`.toUpperCase();
}

const telarIconSymbols: Record<string, string> = {
  globe: "globe",
  briefcase: "briefcase",
  house: "house",
  "building-2": "building.2",
  "user-round": "person",
  "users-round": "person.2",
  compass: "safari",
  map: "map",
  code: "chevron.left.forwardslash.chevron.right",
  terminal: "terminal",
  database: "cylinder.split.1x2",
  server: "server.rack",
  cloud: "cloud",
  box: "shippingbox",
  layers: "square.stack.3d.up",
  cpu: "cpu",
  bot: "brain.head.profile",
  wrench: "wrench.adjustable",
  hammer: "hammer",
  puzzle: "puzzlepiece",
  "pen-tool": "pencil.tip",
  palette: "paintpalette",
  camera: "camera",
  music: "music.note",
  film: "film",
  feather: "pencil",
  "shopping-cart": "cart",
  "credit-card": "creditcard",
  book: "book",
  "graduation-cap": "graduationcap",
  "flask-conical": "testtube.2",
  leaf: "leaf",
  "tree-pine": "tree",
  sun: "sun.max",
  moon: "moon",
  flame: "flame",
  star: "star",
  heart: "heart",
  shield: "shield",
  rocket: "paperplane",
};

/** The SF Symbol for a project's Telar icon id. */
export function telarIconSymbol(iconName: string | undefined): string | undefined {
  return iconName ? telarIconSymbols[iconName] : undefined;
}
