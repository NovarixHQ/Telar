"use client";

import { TELAR_DARK, TELAR_LIGHT } from "@telar/engine-client";
import { cn } from "@/ui/utils";
import { useTheme, type Theme } from "./theme-provider";

const SCHEMES: ReadonlyArray<{ value: Theme; label: string }> = [
  { value: "system", label: "System" },
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
];

function Wireframe({ palette, clip }: { palette: Readonly<Record<string, string>>; clip?: string }) {
  const bar = (width: string, colour: string | undefined) => <span className="block h-1 rounded-full" style={{ width, background: colour }} />;
  return (
    <span className="absolute inset-0 flex" style={{ background: palette.background, ...(clip ? { clipPath: clip } : {}) }}>
      <span className="flex w-1/4 flex-col gap-1 p-1.5" style={{ background: palette.sidebar, borderRight: `1px solid ${palette.border}` }}>
        {bar("80%", palette["muted-foreground"])}
        {bar("60%", palette["muted-foreground"])}
        {bar("70%", palette["muted-foreground"])}
      </span>
      <span className="flex flex-1 flex-col justify-end gap-1.5 p-2">
        {bar("55%", palette.foreground)}
        {bar("75%", palette["muted-foreground"])}
        <span className="block h-4 rounded" style={{ background: palette.card, border: `1px solid ${palette.border}` }} />
      </span>
    </span>
  );
}

export function SchemeTiles() {
  const { theme, setTheme } = useTheme();
  return (
    <div role="group" aria-label="Colour scheme" className="mt-2 grid grid-cols-3 gap-2">
      {SCHEMES.map((scheme) => {
        const on = theme === scheme.value;
        return (
          <button
            key={scheme.value}
            type="button"
            aria-pressed={on}
            onClick={() => setTheme(scheme.value)}
            className={cn(
              "flex flex-col gap-1.5 rounded-lg border p-1.5 outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring",
              on ? "border-primary bg-primary/5" : "border-border hover:bg-accent/50",
            )}
          >
            <span className="relative h-16 overflow-hidden rounded-md border border-border bg-card">
              {scheme.value === "dark" ? <Wireframe palette={TELAR_DARK} /> : <Wireframe palette={TELAR_LIGHT} />}
              {scheme.value === "system" && <Wireframe palette={TELAR_DARK} clip="polygon(55% 0, 100% 0, 100% 100%, 45% 100%)" />}
            </span>
            <span className={cn("text-xs font-medium", on ? "text-foreground" : "text-muted-foreground")}>{scheme.label}</span>
          </button>
        );
      })}
    </div>
  );
}
