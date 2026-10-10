/**
 * WHAT THE APP CONTRIBUTES TO A TERMINAL, AND WHAT IT DELIBERATELY DOES NOT
 * (#198).
 *
 * FOUR COLOURS AND A FONT: background, foreground, cursor and its accent, plus
 * the selection wash. THE SIXTEEN ANSI COLOURS ARE NOT OURS. They are the
 * emulator's, exactly as they are in every desktop terminal where the app
 * chrome and the terminal palette are separate things — and exactly as they are
 * in T3 Code, which renders nvim correctly and contributes background,
 * foreground, cursor and selection and nothing else.
 *
 * WHY THIS IS A CHANGE. This module used to restate xterm.js's sixteen as
 * constants "so the theme is one readable object". A hand-copied table is a
 * table that drifts: the owner opened nvim and the palette was wrong, because
 * the copy is what every ANSI-colouring program (his prompt, `ls`, a
 * statusline) painted with. Omitting a key is not a gap — xterm.js fills each
 * of the sixteen from its own `DEFAULT_ANSI_COLORS` when the theme object does
 * not carry it (`ThemeService._setTheme`: `ansi = DEFAULT_ANSI_COLORS.slice()`,
 * then `ansi[n] = v(theme.black, DEFAULT_ANSI_COLORS[n])`, where `v` returns
 * its fallback for `undefined`). So the shortest correct table is no table.
 *
 * `overrides` still accepts ANSI keys, so a future appearance that genuinely carries
 * a palette can supply one without this module growing speculative
 * `--terminal-ansi-*` variables nobody has tested.
 *
 * AND WHAT IT LOOKS LIKE UNDER A LIGHT LOOK IS NOT OURS TO FIX. The owner's
 * `~/.zshrc` hardcodes `ZSH_AUTOSUGGEST_HIGHLIGHT_STYLE="fg=#666666"`, which is
 * very nearly invisible on a light background. That is correct behaviour: we
 * were asked for his colour and we drew his colour. No correction pass, no
 * injected shell config, no prompt wrapper.
 */

/** The slice of xterm's `ITheme` this builds. Declared structurally rather than
 *  imported, so the builder and its tests never pull the emulator in. */
export type TerminalTheme = {
  background: string;
  foreground: string;
  cursor: string;
  cursorAccent: string;
  selectionBackground: string;
};

/**
 * What a caller may override on top of the five above: the ANSI sixteen, each
 * optional, and typed here only so an appearance that one day carries a palette has a
 * name for the shape. Nothing in this app supplies them — the emulator's own
 * defaults stand.
 */
export type TerminalAnsiOverrides = Partial<
  Record<
    | "black" | "red" | "green" | "yellow" | "blue" | "magenta" | "cyan" | "white"
    | "brightBlack" | "brightRed" | "brightGreen" | "brightYellow"
    | "brightBlue" | "brightMagenta" | "brightCyan" | "brightWhite",
    string
  >
>;

/**
 * The three the appearance owns, and where each comes from.
 *
 * `--card` rather than `--background` for the surface: the right panel draws on
 * the raised surface, and a terminal painting the window's base colour would
 * read as a hole in it. The fallbacks are what a caller gets where there is no
 * stylesheet at all (a test, a server render) — not a second opinion about the
 * appearance.
 */
const LOOK_TOKENS = {
  background: { variable: "--card", fallback: "#111111" },
  foreground: { variable: "--foreground", fallback: "#eeeeee" },
  /** The caret takes the accent. Every other terminal defaults it to the
   *  foreground, which on a block cursor is a solid bar the same colour as the
   *  text around it — findable, but not at a glance. */
  cursor: { variable: "--primary", fallback: "#729fcf" },
} as const;

/**
 * Reads one CSS custom property.
 *
 * INJECTED, AND THAT IS THE POINT: resolving a variable needs a live document,
 * and a colour the app writes as `oklch()` needs a second step on top of that.
 * Passing the reader in leaves this module pure and puts both DOM calls in one
 * named place below.
 */
export type CssVarReader = (variable: string) => string | undefined;

/**
 * The four colours the app owns (plus the selection wash), as one theme object.
 * No ANSI keys: leaving them out is what hands the sixteen back to xterm.js.
 */
export function terminalTheme(
  read: CssVarReader,
  overrides: Partial<TerminalTheme> & TerminalAnsiOverrides = {},
): TerminalTheme & TerminalAnsiOverrides {
  const look = (token: keyof typeof LOOK_TOKENS): string => {
    const { variable, fallback } = LOOK_TOKENS[token];
    const value = read(variable);
    return value !== undefined && value.trim() !== "" ? value.trim() : fallback;
  };
  const background = look("background");
  return {
    background,
    foreground: look("foreground"),
    cursor: look("cursor"),
    // The block cursor's own text colour: the surface under it, so a character
    // sitting inside the caret stays legible whichever accent the appearance carries.
    cursorAccent: background,
    // Not an appearance token, and deliberately not the accent: a selection has to be
    // visible over the background AND over whatever truecolour the shell
    // painted, and a solid accent would hide the text it is selecting.
    selectionBackground: "rgba(120, 150, 200, 0.3)",
    ...overrides,
  };
}

/** Anything below this is a rendering artefact rather than a font size. */
const MIN_FONT_SIZE = 6;
const DEFAULT_FONT_SIZE = 12;

/** Nerd Font icons, no text. Last in the chain so it draws only what the code font lacks: it also has ❯ and ⚡, at a wider advance. */
export const TERMINAL_SYMBOLS_FONT = "Symbols Nerd Font Mono";
const TERMINAL_SYMBOLS_FONT_URL = "/fonts/SymbolsNerdFontMono-Regular.woff2";
const PLATFORM_MONO = "ui-monospace, SFMono-Regular, Menlo, monospace";

let symbolsFontLoad: Promise<void> | null = null;
const fontLoads = new Map<string, Promise<void>>();

export function forgetTerminalSymbolsFont(): void {
  symbolsFontLoad = null;
  fontLoads.clear();
}

/** Registers the bundled symbols face once per page; a failed load leaves tofu, never a broken terminal. */
function ensureTerminalSymbolsFont(): Promise<void> {
  if (symbolsFontLoad !== null) return symbolsFontLoad;
  symbolsFontLoad = (async () => {
    try {
      const face = new FontFace(TERMINAL_SYMBOLS_FONT, `url(${TERMINAL_SYMBOLS_FONT_URL})`);
      document.fonts.add(await face.load());
    } catch {
      // Whatever is installed locally still applies.
    }
  })();
  return symbolsFontLoad;
}

/** Await before the first fit: xterm sizes the grid from one measured cell. Loaded once per face and size. */
export function loadTerminalFonts(fontFamily: string, fontSize: number): Promise<void> {
  const spec = `${fontSize}px ${fontFamily}`;
  let load = fontLoads.get(spec);
  if (!load) {
    load = ensureTerminalSymbolsFont().then(async () => {
      try {
        await document.fonts.load(spec);
      } catch {
        // No Font Loading API (a test DOM), or a chain its parser refuses.
      }
    });
    fontLoads.set(spec, load);
  }
  return load;
}

/** Appearance's code stack (which ends in a bundled or platform mono), then the symbols face. */
export function terminalFont(read: CssVarReader): { fontFamily: string; fontSize: number } {
  const family = read("--app-font-mono")?.trim();
  const rawSize = read("--app-font-mono-size")?.trim();
  const parsed = rawSize === undefined ? Number.NaN : Number.parseFloat(rawSize);
  return {
    fontFamily: `${family || PLATFORM_MONO}, "${TERMINAL_SYMBOLS_FONT}"`,
    fontSize: Number.isFinite(parsed) && parsed >= MIN_FONT_SIZE ? parsed : DEFAULT_FONT_SIZE,
  };
}

/** Custom properties as the stylesheet resolved them, verbatim. */
export function cssVariableReader(element: Element): CssVarReader {
  const styles = getComputedStyle(element);
  return (variable) => {
    const raw = styles.getPropertyValue(variable).trim();
    return raw === "" ? undefined : raw;
  };
}

/** Two colours no palette would coincidentally resolve to both of. */
const SENTINELS = ["#000000", "#ffffff"] as const;

/**
 * The same reader, with every colour pushed through a canvas first.
 *
 * WHY THE CANVAS. `--card` is `oklch(0.2 0 0)`; xterm's colour parser handles
 * `#rgb`, `#rrggbb`, `rgb()` and `rgba()` and THROWS on anything else.
 * Assigning to `fillStyle` makes the browser's own CSS colour parser do the
 * conversion and hand back exactly the set xterm accepts — and it keeps working
 * the day the palette moves to a colour space that does not exist yet.
 *
 * Without a canvas (no 2D context — a test, an old engine) the raw value is
 * returned and `terminalTheme`'s fallbacks are what protect xterm, which is why
 * those fallbacks are plain hex.
 */
export function cssColorReader(element: Element, canvas?: HTMLCanvasElement | null): CssVarReader {
  const read = cssVariableReader(element);
  const context = canvas?.getContext("2d") ?? undefined;
  if (!context) return read;
  return (variable) => {
    const raw = read(variable);
    if (raw === undefined) return undefined;
    /**
     * A `fillStyle` the parser REJECTS is silently ignored — the previous value
     * stays — so assigning alone cannot tell "converted" from "refused", and
     * the refused case would hand back whatever colour was there before. Two
     * sentinels settle it: a value that comes back the same from both was
     * really parsed; one that comes back as each sentinel in turn never was.
     */
    context.fillStyle = SENTINELS[0];
    context.fillStyle = raw;
    const first = context.fillStyle;
    context.fillStyle = SENTINELS[1];
    context.fillStyle = raw;
    if (typeof first !== "string" || first !== context.fillStyle) return undefined;
    return first;
  };
}
