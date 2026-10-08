"use client";

import { useState } from "react";
import { ShieldCheckIcon } from "lucide-react";
import type { RuntimeMode } from "@telar/engine-client";
import { Popover, PopoverContent } from "@/ui/popover";
import { RUNTIME_MODE_HELP, RUNTIME_MODE_LABELS, RUNTIME_MODES } from "@/features/providers";
import { ChoiceRow, MenuHeading, PillTrigger, useSummon } from "./control-primitives";

export function AccessControl({ runtimeMode, onRuntimeMode, summon }: { runtimeMode: RuntimeMode; onRuntimeMode: (mode: RuntimeMode) => void; summon?: number | undefined }) {
  const [open, setOpen] = useState(false);
  useSummon(summon, () => setOpen(true));
  const mode = RUNTIME_MODE_LABELS[runtimeMode];
  // "Auto" would read the same as the reasoning pill's Auto beside it.
  const label = runtimeMode === "auto" ? "Access" : mode;
  const pick = (run: () => void) => () => {
    run();
    setOpen(false);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PillTrigger tip="Access" open={open} icon={<ShieldCheckIcon className="size-3.5" />} label={label} fold="xl" ariaLabel={`Access: ${mode}`} />
      <PopoverContent align="start" side="top" sideOffset={8} className="w-[min(20rem,calc(100vw-2rem))] gap-0 rounded-2xl p-1.5">
        <MenuHeading>Access</MenuHeading>
        {RUNTIME_MODES.map((option) => (
          <ChoiceRow
            key={option}
            label={RUNTIME_MODE_LABELS[option]}
            description={RUNTIME_MODE_HELP[option]}
            selected={option === runtimeMode}
            onSelect={pick(() => onRuntimeMode(option))}
          />
        ))}
      </PopoverContent>
    </Popover>
  );
}
