"use client";

import { APP_FONTS, MONOSPACED_FONTS, type AppFont } from "../appearance";
import { Input } from "@/ui/input";
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from "@/ui/select";

const SANS_LABEL: Record<AppFont, string> = {
  geist: "Geist",
  inter: "Inter",
  "plex-sans": "IBM Plex Sans",
  "source-sans": "Source Sans 3",
  roboto: "Roboto",
  "noto-sans": "Noto Sans",
  "space-grotesk": "Space Grotesk",
  lato: "Lato",
  jetbrains: "JetBrains Mono",
  "plex-mono": "IBM Plex Mono",
  "fira-code": "Fira Code",
  "geist-mono": "Geist Mono",
  "source-code-pro": "Source Code Pro",
  "roboto-mono": "Roboto Mono",
  "cascadia-code": "Cascadia Code",
  system: "System",
  custom: "Custom…",
};
const MONO_LABEL: Record<AppFont, string> = { ...SANS_LABEL, geist: "Geist Mono" };

const FONT_GROUPS: ReadonlyArray<{ heading: string; belongs: (font: string) => boolean }> = [
  { heading: "Proportional", belongs: (font) => font !== "system" && font !== "custom" && !MONOSPACED_FONTS.has(font) },
  { heading: "Monospaced", belongs: (font) => MONOSPACED_FONTS.has(font) },
  { heading: "Yours", belongs: (font) => font === "system" || font === "custom" },
];

export type FontChoice = { family: AppFont; custom: string; size: number };

export function FontPicker({
  kind,
  label,
  value,
  min,
  max,
  onChange,
}: {
  kind: "sans" | "mono";
  label: string;
  value: FontChoice;
  min: number;
  max: number;
  onChange: (patch: Partial<FontChoice>) => void;
}) {
  const items = kind === "mono" ? MONO_LABEL : SANS_LABEL;
  const sizes = Array.from({ length: max - min + 1 }, (_, index) => min + index);
  const sizeItems = Object.fromEntries(sizes.map((size) => [String(size), `${size} px`]));
  return (
    <div className="mt-2 flex flex-wrap items-center gap-1.5">
      <Select
        value={value.family}
        items={items}
        onValueChange={(next) => {
          if (typeof next === "string" && (APP_FONTS as readonly string[]).includes(next)) onChange({ family: next as AppFont });
        }}
      >
        <SelectTrigger size="sm" className="w-44" aria-label={label}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {FONT_GROUPS.map(({ heading, belongs }) => (
            <SelectGroup key={heading}>
              <SelectLabel>{heading}</SelectLabel>
              {APP_FONTS.filter(belongs).map((font) => (
                <SelectItem key={font} value={font}>
                  {items[font]}
                </SelectItem>
              ))}
            </SelectGroup>
          ))}
        </SelectContent>
      </Select>
      <Select
        value={String(value.size)}
        items={sizeItems}
        onValueChange={(next) => {
          const parsed = Number(next);
          if (Number.isInteger(parsed) && parsed >= min && parsed <= max) onChange({ size: parsed });
        }}
      >
        <SelectTrigger size="sm" className="w-24" aria-label={`${label} size`}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {sizes.map((size) => (
            <SelectItem key={size} value={String(size)}>
              {size} px
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {value.family === "custom" && (
        <Input
          className="w-full"
          value={value.custom}
          placeholder={kind === "mono" ? "e.g. SF Mono" : "e.g. Helvetica Neue"}
          aria-label={`Custom ${label.toLowerCase()}`}
          onChange={(event) => onChange({ custom: event.target.value })}
        />
      )}
    </div>
  );
}
