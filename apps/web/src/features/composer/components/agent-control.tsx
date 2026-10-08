"use client";

import { ProviderIcon, driverLabel } from "@/features/providers";
import { effortLabel } from "@telar/client/providers";
import { Popover, PopoverContent } from "@/ui/popover";
import { useModelPicker, type ModelPickerProps } from "../hooks/use-model-picker";
import { PillTrigger, useSummon } from "./control-primitives";
import { ModelPickerList, ModelPickerRail } from "./model-picker-list";

/** The model pill. A model change, or a switch to another provider's model, applies from the next turn. */
export function AgentControl({ summon, ...props }: ModelPickerProps & { summon?: number | undefined }) {
  const { driver, choice, onChange, onDriverChange, onSwitchProvider } = props;
  const picker = useModelPicker(props);
  useSummon(summon, () => picker.setOpen(true));
  const { open, label, models, catalogue, defaultEffort } = picker;
  const readOnly = !onChange;
  const effort = choice.effort ?? defaultEffort;

  return (
    <Popover open={open} onOpenChange={(next: boolean) => (next ? picker.setOpen(true) : picker.close(driver))}>
      <PillTrigger
        tip="Model"
        open={open}
        icon={<ProviderIcon provider={driver} size={14} />}
        label={label}
        {...(effort ? { detail: effortLabel(effort) } : {})}
        ariaLabel={`Model: ${label} on ${driverLabel(driver)}`}
        className="min-w-0 max-w-56 justify-start"
      />
      <PopoverContent
        align="start"
        side="top"
        sideOffset={8}
        // A fixed size on every provider and view, so switching the rail never reshapes the box under the pointer.
        className="h-[min(26rem,70vh)] w-[22rem] flex-col gap-0 overflow-hidden rounded-xl p-0"
      >
        <div className="flex min-h-0 flex-1">
          {!picker.searching && <ModelPickerRail picker={picker} driver={driver} {...(onDriverChange ? { onDriverChange } : {})} />}
          <ModelPickerList picker={picker} driver={driver} choice={choice} readOnly={readOnly} canSwitch={picker.canSwitch} />
        </div>
        <p className="border-t border-border px-2.5 py-1.5 text-2xs leading-snug text-muted-foreground">
          {readOnly
            ? "Chosen when the session starts."
            : onDriverChange
              ? "Applies to the first message."
              : onSwitchProvider
                ? "Takes effect next turn. Another provider's model switches provider and hands it this session."
                : "Takes effect next turn."}
          {catalogue?.source === "builtin" && models.some((row) => row.source !== "user") ? " Built-in list." : ""}
          {models.some((row) => row.source === "user") ? " Includes models you added." : ""}
        </p>
      </PopoverContent>
    </Popover>
  );
}
