"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { ACCENTS, MAX_FONT_SIZE, MIN_FONT_SIZE, useAppearance, useTheme, type Accent, type Theme } from "@/features/appearance";
import { desktopAppearance } from "@/platform/desktop/desktop-appearance";
import { quickSettings, type PaletteQuickSetting, type QuickSettingId } from "./palette-model";
import { runCommand } from "./commands";

export const ACCENT_LABELS: Record<Accent, string> = {
  indigo: "Indigo",
  sky: "Sky",
  sea: "Sea",
  moss: "Moss",
  amber: "Amber",
  rose: "Rose",
  plum: "Plum",
  violet: "Violet",
};

const SCHEME_CYCLE: Record<Theme, Theme> = { light: "dark", dark: "system", system: "light" };

export type QuickSettings = {
  rows: PaletteQuickSetting[];
  accent: Accent;
  apply: (id: QuickSettingId) => string | undefined;
  setAccent: (accent: Accent) => void;
};

export function useQuickSettings({ railOpen }: { railOpen: boolean }): QuickSettings {
  const { theme, setTheme } = useTheme();
  const { appearance, setAppearance } = useAppearance();

  const [translucency, setTranslucency] = useState(false);
  useEffect(() => {
    const bridge = desktopAppearance();
    if (!bridge) return;
    let live = true;
    void bridge
      .get()
      .then((state) => live && setTranslucency(state.supported))
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, []);

  const rows = useMemo(
    () =>
      quickSettings({
        scheme: theme,
        accent: ACCENT_LABELS[appearance.accent],
        fontSize: appearance.fontSize,
        translucent: appearance.translucent,
        translucency,
        railOpen,
      }),
    [theme, appearance.accent, appearance.fontSize, appearance.translucent, translucency, railOpen],
  );

  const setAccent = useCallback((accent: Accent) => setAppearance({ accent }), [setAppearance]);

  const apply = useCallback(
    (id: QuickSettingId): string | undefined => {
      switch (id) {
        case "quick-colour-scheme":
          setTheme(SCHEME_CYCLE[theme]);
          return undefined;
        case "quick-font-size-smaller":
          setAppearance({ fontSize: Math.max(MIN_FONT_SIZE, appearance.fontSize - 1) });
          return undefined;
        case "quick-font-size-larger":
          setAppearance({ fontSize: Math.min(MAX_FONT_SIZE, appearance.fontSize + 1) });
          return undefined;
        case "quick-translucency": {
          const next = !appearance.translucent;
          setAppearance({ translucent: next });
          void desktopAppearance()?.set({ translucent: next });
          return undefined;
        }
        case "quick-rail":
          runCommand("toggle-rail");
          return undefined;
        case "quick-accent":
          return undefined;
      }
    },
    [theme, setTheme, appearance.fontSize, appearance.translucent, setAppearance],
  );

  return {
    rows,
    accent: appearance.accent,
    apply,
    setAccent,
  };
}

export { ACCENTS, type Accent };
