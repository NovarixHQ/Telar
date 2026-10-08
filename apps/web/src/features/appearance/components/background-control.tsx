"use client";

import { useRef, useState, type DragEvent } from "react";
import { DEFAULT_BACKGROUND, MAX_BACKGROUND_STRENGTH, MIN_BACKGROUND_STRENGTH, type Background, type BackgroundGradient, type BackgroundKind } from "@telar/engine-client";
import { cn } from "@/ui/utils";
import { Row, Segmented } from "@/features/settings";
import { customGradient, GRADIENT_PRESETS, PRESET_IDS } from "../background";
import { compressImageFile } from "../background-image";

type SwatchProps = { id: BackgroundGradient; label: string; light: string; dark: string; on: boolean; onPick: (id: BackgroundGradient) => void };

function GradientSwatch({ id, label, light, dark, on, onPick }: SwatchProps) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={on}
      aria-label={label}
      title={label}
      onClick={() => onPick(id)}
      className={cn(
        "h-8 w-12 rounded-md border border-border transition-transform [background-image:var(--swatch-light)] hover:scale-105 dark:[background-image:var(--swatch-dark)]",
        on && "ring-2 ring-primary ring-offset-2 ring-offset-card",
      )}
      style={{ ["--swatch-light" as string]: light, ["--swatch-dark" as string]: dark }}
    />
  );
}

function GradientPicker({ value, onChange }: { value: Background; onChange: (patch: Partial<Background>) => void }) {
  const pick = (gradient: BackgroundGradient) => onChange({ gradient });
  const colour = (index: 0 | 1, next: string) => onChange({ gradient: "custom", colours: index === 0 ? [next, value.colours[1]] : [value.colours[0], next] });
  return (
    <div className="flex flex-wrap items-center gap-2" role="radiogroup" aria-label="Gradient">
      {PRESET_IDS.map((id) => (
        <GradientSwatch key={id} id={id} {...GRADIENT_PRESETS[id]} on={value.gradient === id} onPick={pick} />
      ))}
      <GradientSwatch id="custom" label="Custom" light={customGradient(value.colours)} dark={customGradient(value.colours)} on={value.gradient === "custom"} onPick={pick} />
      {value.gradient === "custom" && (
        <span className="flex items-center gap-1">
          <input type="color" aria-label="First colour" value={value.colours[0]} onChange={(event) => colour(0, event.target.value)} className="size-7 cursor-pointer rounded border border-border bg-transparent" />
          <input type="color" aria-label="Second colour" value={value.colours[1]} onChange={(event) => colour(1, event.target.value)} className="size-7 cursor-pointer rounded border border-border bg-transparent" />
        </span>
      )}
    </div>
  );
}

export function BackgroundControl({ value, onChange }: { value: Background; onChange: (patch: Partial<Background>) => void }) {
  const [error, setError] = useState<string>();
  const [dragging, setDragging] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  const take = (file: File | undefined) => {
    if (!file) return;
    setError(undefined);
    compressImageFile(file).then(
      (image) => onChange({ kind: "image", image }),
      (cause: unknown) => setError(cause instanceof Error ? cause.message : "That image could not be read."),
    );
  };

  const drop = (event: DragEvent) => {
    event.preventDefault();
    setDragging(false);
    take(event.dataTransfer.files[0]);
  };

  const isDefault = value.kind === DEFAULT_BACKGROUND.kind;

  return (
    <>
      <div
        className={cn("transition-colors", dragging && "bg-muted/50")}
        onDragOver={(event) => {
          event.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={drop}
      >
        <Row
          keywords={["wallpaper", "image", "picture", "gradient", "backdrop", "photo"]}
          label="Background"
          hint="A gradient or picture behind the whole window."
          error={error}
          {...(isDefault ? {} : { onRevert: () => onChange({ kind: "none" }) })}
          control={
            <Segmented<BackgroundKind>
              value={value.kind}
              onChange={(kind) => onChange({ kind })}
              options={[
                { value: "none", label: "None" },
                { value: "gradient", label: "Gradient" },
                { value: "image", label: "Image" },
              ]}
            />
          }
        >
          {value.kind === "gradient" && (
            <div className="mt-2.5">
              <GradientPicker value={value} onChange={onChange} />
            </div>
          )}
          {value.kind === "image" && (
            <div className="mt-2.5 flex items-center gap-2.5">
              {value.image && <div role="img" aria-label="Chosen image" className="h-10 w-16 rounded-md border border-border bg-cover bg-center" style={{ backgroundImage: `url("${value.image}")` }} />}
              <button type="button" onClick={() => input.current?.click()} className="rounded-md border border-dashed border-border px-3 py-2 text-xs text-muted-foreground hover:bg-muted/50 hover:text-foreground">
                {value.image ? "Choose another image or drop one here" : "Choose an image or drop one here"}
              </button>
              <input
                ref={input}
                type="file"
                accept="image/*"
                aria-label="Image file"
                className="hidden"
                onChange={(event) => {
                  take(event.target.files?.[0]);
                  event.target.value = "";
                }}
              />
            </div>
          )}
        </Row>
      </div>
      {value.kind !== "none" && (
        <Row
          keywords={["opacity", "intensity", "fade", "wallpaper", "backdrop"]}
          label="Strength"
          hint="How strongly the background shows behind the interface."
          {...(value.strength === DEFAULT_BACKGROUND.strength ? {} : { onRevert: () => onChange({ strength: DEFAULT_BACKGROUND.strength }) })}
          control={
            <div className="flex items-center gap-2.5">
              <input
                type="range"
                min={MIN_BACKGROUND_STRENGTH}
                max={MAX_BACKGROUND_STRENGTH}
                step={5}
                value={value.strength}
                aria-label="Strength"
                className="w-36 accent-primary"
                onChange={(event) => onChange({ strength: Number(event.target.value) })}
              />
              <span className="w-9 shrink-0 text-right text-xs tabular-nums text-muted-foreground">{value.strength}%</span>
            </div>
          }
        />
      )}
    </>
  );
}
