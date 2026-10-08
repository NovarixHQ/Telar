import { BACKGROUND_GRADIENTS, DEFAULT_BACKGROUND, MAX_BACKGROUND_STRENGTH, MIN_BACKGROUND_STRENGTH, type Background, type BackgroundGradient } from "@telar/engine-client";

type Preset = Exclude<BackgroundGradient, "custom">;

function ramp(angle: number, colours: readonly string[]): string {
  const last = colours.length - 1;
  return `linear-gradient(${angle}deg, ${colours.map((colour, index) => `${colour} ${Math.round((index / last) * 100)}%`).join(", ")})`;
}

export const GRADIENT_PRESETS: Record<Preset, { label: string; light: string; dark: string }> = {
  aurora: {
    label: "Aurora",
    light: ramp(165, ["#f0fbfe", "#bdf7dc", "#cae7ff", "#f0e4ff", "#e5efff"]),
    dark: ramp(165, ["#0d151c", "#005c41", "#183d6b", "#3f2d5b", "#070b14"]),
  },
  dusk: {
    label: "Dusk",
    light: ramp(180, ["#f3f4ff", "#e7d9ff", "#ffe4f2", "#ffdad0", "#ffe4e3"]),
    dark: ramp(180, ["#0e0e1a", "#3c2a58", "#442032", "#663028", "#100606"]),
  },
  "deep-sea": {
    label: "Deep Sea",
    light: ramp(175, ["#eaf8fb", "#b7f0fb", "#c3f3ef", "#d7f3ff", "#d4edf7"]),
    dark: ramp(175, ["#010d13", "#004151", "#003b38", "#002b49", "#01050a"]),
  },
  nebula: {
    label: "Nebula",
    light: ramp(150, ["#f7f2ff", "#fad6ff", "#d1e5ff", "#ffdbed", "#e3ebff"]),
    dark: ramp(150, ["#0f0a18", "#512b5a", "#1c3060", "#441b30", "#04050f"]),
  },
};

export const PRESET_IDS = BACKGROUND_GRADIENTS.filter((id): id is Preset => id !== "custom");

export const customGradient = ([from, to]: readonly [string, string]): string => `linear-gradient(160deg, ${from}, ${to})`;

function backgroundLayers(background: Background): { light: string; dark: string } | null {
  if (background.kind === "image") return background.image ? { light: `url("${background.image}")`, dark: `url("${background.image}")` } : null;
  if (background.kind !== "gradient") return null;
  if (background.gradient === "custom") return { light: customGradient(background.colours), dark: customGradient(background.colours) };
  return GRADIENT_PRESETS[background.gradient];
}

const VARS = ["--backdrop-light", "--backdrop-dark", "--backdrop-strength"] as const;

export function applyBackground(background: Background): void {
  const root = document.documentElement;
  const layers = backgroundLayers(background);
  if (layers === null) {
    root.removeAttribute("data-backdrop");
    for (const name of VARS) root.style.removeProperty(name);
    return;
  }
  root.setAttribute("data-backdrop", background.kind);
  root.style.setProperty("--backdrop-light", layers.light);
  root.style.setProperty("--backdrop-dark", layers.dark);
  root.style.setProperty("--backdrop-strength", `${background.strength}%`);
}

const PRESET_CSS = Object.fromEntries(PRESET_IDS.map((id) => [id, { light: GRADIENT_PRESETS[id].light, dark: GRADIENT_PRESETS[id].dark }]));

export const BACKGROUND_INIT_SCRIPT = `(function(){try{var b=(JSON.parse(localStorage.getItem('telar-appearance')||'{}')||{}).background;if(!b||typeof b!=='object')return;var p=${JSON.stringify(PRESET_CSS)};var h=/^#[0-9a-fA-F]{6}$/;var l,k;if(b.kind==='gradient'){var c=b.colours;if(b.gradient==='custom'){if(c&&h.test(c[0])&&h.test(c[1]))l=k='linear-gradient(160deg, '+c[0]+', '+c[1]+')';}else if(p.hasOwnProperty(b.gradient)){l=p[b.gradient].light;k=p[b.gradient].dark;}}else if(b.kind==='image'&&typeof b.image==='string'&&/^data:image\\/[a-z+]+;base64,[A-Za-z0-9+\\/]+=*$/.test(b.image)){l=k='url("'+b.image+'")';}if(!l)return;var d=document.documentElement;d.setAttribute('data-backdrop',b.kind);d.style.setProperty('--backdrop-light',l);d.style.setProperty('--backdrop-dark',k);var s=typeof b.strength==='number'&&isFinite(b.strength)?Math.min(${MAX_BACKGROUND_STRENGTH},Math.max(${MIN_BACKGROUND_STRENGTH},Math.round(b.strength))):${DEFAULT_BACKGROUND.strength};d.style.setProperty('--backdrop-strength',s+'%');}catch(e){}})();`;
