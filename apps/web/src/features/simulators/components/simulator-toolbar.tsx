import { CameraIcon, CheckIcon, HomeIcon, PowerIcon, RotateCcwIcon, SlidersHorizontalIcon } from "lucide-react";
import { Button } from "@/ui/button";
import { Spinner } from "@/ui/spinner";

type ToolbarProps = {
  phone: boolean;
  powering: boolean;
  capture: "idle" | "copying" | "copied";
  settingsOpen: boolean;
  onHome: () => void;
  onRotate: () => void;
  onScreenshot?: () => void;
  onToggleSettings: () => void;
  onPowerOff: () => void;
};

export function SimulatorToolbar({ phone, powering, capture, settingsOpen, onHome, onRotate, onScreenshot, onToggleSettings, onPowerOff }: ToolbarProps) {
  return (
    <div role="toolbar" aria-label="Simulator controls" aria-orientation="vertical" className="flex w-11 shrink-0 flex-col items-center gap-1 py-3">
      {phone && (
        <>
          <Button size="icon-sm" variant="ghost" aria-label="Home" onClick={onHome}>
            <HomeIcon />
          </Button>
          <Button size="icon-sm" variant="ghost" aria-label="Rotate" onClick={onRotate}>
            <RotateCcwIcon />
          </Button>
        </>
      )}
      {onScreenshot && (
        <Button size="icon-sm" variant="ghost" aria-label="Copy screenshot" disabled={capture === "copying"} onClick={onScreenshot}>
          {capture === "copying" ? <Spinner /> : capture === "copied" ? <CheckIcon /> : <CameraIcon />}
        </Button>
      )}
      <Button size="icon-sm" variant={settingsOpen ? "secondary" : "ghost"} aria-label="Simulator settings" aria-pressed={settingsOpen} onClick={onToggleSettings}>
        <SlidersHorizontalIcon />
      </Button>
      <Button size="icon-sm" variant="ghost" className="mt-auto" aria-label="Power off" disabled={powering} onClick={onPowerOff}>
        {powering ? <Spinner /> : <PowerIcon />}
      </Button>
    </div>
  );
}
