"use client";

import { DEFAULT_DEPTH, type Depth } from "../appearance";
import { Dropdown, Row } from "@/features/settings";

const OPTIONS: { value: Depth; label: string; text: string }[] = [
  { value: "flat", label: "Flat — hairlines only", text: "Flat" },
  { value: "soft", label: "Soft — the default", text: "Soft" },
  { value: "deep", label: "Deep — a longer shadow", text: "Deep" },
];

export function DepthControl({ value, onChange }: { value: Depth; onChange: (next: Depth) => void }) {
  return (
    <Row
      keywords={["shadow", "elevation", "flat", "soft", "deep", "raised"]}
      label="Depth"
      hint="How far cards, the composer and menus lift off the page."
      {...(value === DEFAULT_DEPTH ? {} : { onRevert: () => onChange(DEFAULT_DEPTH) })}
      control={<Dropdown<Depth> value={value} onChange={onChange} options={OPTIONS} label="Depth" />}
    />
  );
}
