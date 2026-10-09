"use client";

import { CheckIcon } from "lucide-react";
import { ACCENTS, DEFAULT_APPEARANCE, MAX_FONT_SIZE, MAX_MONO_FONT_SIZE, MIN_FONT_SIZE, MIN_MONO_FONT_SIZE, useAppearance, type Accent } from "../appearance";
import { cn } from "@/ui/utils";
import { Row, SettingsGroup, useRestoreDefaults } from "@/features/settings";
import { useTheme } from "./theme-provider";
import { SchemeTiles } from "./scheme-tiles";
import { FontPicker } from "./font-picker";
import { DepthControl } from "./depth-control";
import { BackgroundControl } from "./background-control";
import { AppearanceWindowGroup } from "./appearance-window-group";
import { CodePreviews, InterfacePreview } from "./type-previews";

const ACCENT_LABEL: Record<Accent, string> = {
  indigo: "Indigo",
  sky: "Sky",
  sea: "Sea",
  moss: "Moss",
  amber: "Amber",
  rose: "Rose",
  plum: "Plum",
  violet: "Violet",
};

function AccentSwatches({ value, onChange }: { value: Accent; onChange: (next: Accent) => void }) {
  return (
    <div className="flex items-center gap-1.5" role="radiogroup" aria-label="Accent colour">
      {ACCENTS.map((accent) => {
        const on = accent === value;
        return (
          <button
            key={accent}
            type="button"
            role="radio"
            aria-checked={on}
            aria-label={ACCENT_LABEL[accent]}
            title={ACCENT_LABEL[accent]}
            onClick={() => onChange(accent)}
            className={cn("flex size-6 items-center justify-center rounded-full transition-transform hover:scale-110", on && "ring-2 ring-offset-2 ring-offset-card")}
            data-accent={accent}
            style={{ ["--tw-ring-color" as string]: "var(--primary)" }}
          >
            <span data-accent={accent} className="flex size-5 items-center justify-center rounded-full bg-primary">
              {on && <CheckIcon className="size-3 text-primary-foreground" />}
            </span>
          </button>
        );
      })}
    </div>
  );
}

export function AppearanceSection() {
  const { appearance, setAppearance } = useAppearance();
  const { setTheme } = useTheme();
  const revert = (isDefault: boolean, patch: Parameters<typeof setAppearance>[0]) => (isDefault ? {} : { onRevert: () => setAppearance(patch) });

  useRestoreDefaults(() => {
    setAppearance({ ...DEFAULT_APPEARANCE, translucent: appearance.translucent, frost: appearance.frost });
    setTheme("system");
  });

  const sansIsDefault = appearance.fontSans === DEFAULT_APPEARANCE.fontSans && appearance.fontSize === DEFAULT_APPEARANCE.fontSize;
  const monoIsDefault = appearance.fontMono === DEFAULT_APPEARANCE.fontMono && appearance.fontMonoSize === DEFAULT_APPEARANCE.fontMonoSize;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <SettingsGroup title="Theme">
        <Row keywords={["light", "dark", "system", "theme", "mode"]} label="Colour scheme" hint="Light, dark, or whatever the system uses.">
          <SchemeTiles />
        </Row>
        <Row
          keywords={["colour", "color", "highlight", "primary", "hue"]}
          label="Accent"
          hint="The colour of buttons, links and the caret."
          {...revert(appearance.accent === DEFAULT_APPEARANCE.accent, { accent: DEFAULT_APPEARANCE.accent })}
          control={<AccentSwatches value={appearance.accent} onChange={(accent) => setAppearance({ accent })} />}
        />
        <DepthControl value={appearance.depth} onChange={(depth) => setAppearance({ depth })} />
        <BackgroundControl value={appearance.background} onChange={(patch) => setAppearance({ background: { ...appearance.background, ...patch } })} />
      </SettingsGroup>

      <SettingsGroup title="Typography">
        <Row
          keywords={["font", "typeface", "text size", "sans"]}
          label="Interface font"
          hint="Everything outside code blocks and the terminal."
          {...revert(sansIsDefault, { fontSans: DEFAULT_APPEARANCE.fontSans, fontSize: DEFAULT_APPEARANCE.fontSize })}
        >
          <FontPicker
            kind="sans"
            label="Interface font"
            value={{ family: appearance.fontSans, custom: appearance.fontSansCustom, size: appearance.fontSize }}
            min={MIN_FONT_SIZE}
            max={MAX_FONT_SIZE}
            onChange={({ family, custom, size }) =>
              setAppearance({
                ...(family !== undefined ? { fontSans: family } : {}),
                ...(custom !== undefined ? { fontSansCustom: custom } : {}),
                ...(size !== undefined ? { fontSize: size } : {}),
              })
            }
          />
          <div className="mt-2.5">
            <InterfacePreview />
          </div>
        </Row>
        <Row
          keywords={["font", "monospace", "mono", "code", "terminal", "diff"]}
          label="Code font"
          hint="Code blocks, diffs, file previews and the terminal."
          {...revert(monoIsDefault, { fontMono: DEFAULT_APPEARANCE.fontMono, fontMonoSize: DEFAULT_APPEARANCE.fontMonoSize })}
        >
          <FontPicker
            kind="mono"
            label="Code font"
            value={{ family: appearance.fontMono, custom: appearance.fontMonoCustom, size: appearance.fontMonoSize }}
            min={MIN_MONO_FONT_SIZE}
            max={MAX_MONO_FONT_SIZE}
            onChange={({ family, custom, size }) =>
              setAppearance({
                ...(family !== undefined ? { fontMono: family } : {}),
                ...(custom !== undefined ? { fontMonoCustom: custom } : {}),
                ...(size !== undefined ? { fontMonoSize: size } : {}),
              })
            }
          />
          <div className="mt-2.5 min-w-0">
            <CodePreviews />
          </div>
        </Row>
      </SettingsGroup>

      <AppearanceWindowGroup appearance={appearance} setAppearance={setAppearance} />
    </div>
  );
}
