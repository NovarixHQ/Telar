import { CameraIcon, CheckIcon, CircleDotIcon, HomeIcon, PanelRightIcon, PictureInPicture2Icon, PowerIcon, RectangleVerticalIcon, RotateCcwIcon, SlidersHorizontalIcon, XIcon } from "lucide-react";
import { Button } from "@/ui/button";
import { Spinner } from "@/ui/spinner";

type ToolbarProps = {
  phone: boolean;
  powering: boolean;
  capture: "idle" | "copying" | "copied";
  settingsOpen: boolean;
  onHome: () => void;
  onRotate: () => void;
  onCrown?: () => void;
  onSide?: () => void;
  onScreenshot?: () => void;
  onFloat?: () => void;
  onToggleSettings: () => void;
  onPowerOff: () => void;
};

export function SimulatorToolbar({ phone, powering, capture, settingsOpen, onHome, onRotate, onCrown, onSide, onScreenshot, onFloat, onToggleSettings, onPowerOff }: ToolbarProps) {
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
      {onCrown && (
        <Button size="icon-sm" variant="ghost" aria-label="Press Digital Crown" onClick={onCrown}>
          <CircleDotIcon />
        </Button>
      )}
      {onSide && (
        <Button size="icon-sm" variant="ghost" aria-label="Press side button" onClick={onSide}>
          <RectangleVerticalIcon />
        </Button>
      )}
      {onScreenshot && (
        <Button size="icon-sm" variant="ghost" aria-label="Copy screenshot" disabled={capture === "copying"} onClick={onScreenshot}>
          {capture === "copying" ? <Spinner /> : capture === "copied" ? <CheckIcon /> : <CameraIcon />}
        </Button>
      )}
      {onFloat && (
        <Button size="icon-sm" variant="ghost" aria-label="Float over chat" onClick={onFloat}>
          <PictureInPicture2Icon />
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

type PillProps = { phone: boolean; onHome: () => void; onRotate: () => void; onDock: () => void; onClose: () => void };

export function FloatPill({ phone, onHome, onRotate, onDock, onClose }: PillProps) {
  return (
    <div
      role="toolbar"
      aria-label="Floating simulator controls"
      className="absolute top-2 left-1/2 z-10 flex -translate-x-1/2 cursor-grab items-center gap-0.5 rounded-lg bg-popover/90 p-0.5 opacity-0 shadow-2 ring-1 ring-border backdrop-blur transition-opacity group-hover/float:opacity-100 group-focus-within/float:opacity-100 active:cursor-grabbing"
    >
      {phone && (
        <>
          <Button size="icon-xs" variant="ghost" aria-label="Home" onClick={onHome}>
            <HomeIcon />
          </Button>
          <Button size="icon-xs" variant="ghost" aria-label="Rotate" onClick={onRotate}>
            <RotateCcwIcon />
          </Button>
        </>
      )}
      <Button size="icon-xs" variant="ghost" aria-label="Open in right panel" onClick={onDock}>
        <PanelRightIcon />
      </Button>
      <Button size="icon-xs" variant="ghost" aria-label="Close floating simulator" onClick={onClose}>
        <XIcon />
      </Button>
    </div>
  );
}
