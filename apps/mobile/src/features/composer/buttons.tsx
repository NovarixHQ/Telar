import { Button, Host } from "@expo/ui/swift-ui";
import { Animation, accessibilityLabel, animation, background, disabled, frame, shapes, symbolEffect } from "@expo/ui/swift-ui/modifiers";
import { faded, Icon, Theme } from "../../ui";
import type { Slot } from "./slot";

export const ROW = 44;

/** Send, Queue or Stop: accent when there is something to send, red while it would stop the turn. */
export function SlotButton({ slot, onPress }: { slot: Slot; onPress: () => void }) {
  const stop = slot.kind === "stop";
  const primary = !stop && slot.enabled;
  const spring = Animation.spring({ duration: 0.25 });
  return (
    <Host matchContents>
      <Button onPress={onPress} modifiers={[disabled(!slot.enabled), accessibilityLabel(slot.label), animation(spring, primary), animation(spring, stop)]}>
        <Icon
          name={stop ? "stop.fill" : "arrow.up"}
          size={17}
          weight="semibold"
          color={primary ? Theme.accentGlyph : stop ? Theme.red : Theme.textMuted}
          modifiers={[frame({ width: ROW, height: ROW }), background(primary ? Theme.accent : stop ? faded("red", 0.14) : Theme.subtleStrong, shapes.circle())]}
        />
      </Button>
    </Host>
  );
}

export function MicButton({ listening, busy, onPress }: { listening: boolean; busy: boolean; onPress: () => void }) {
  return (
    <Host matchContents>
      <Button onPress={onPress} modifiers={[disabled(busy), accessibilityLabel(listening ? "Stop dictating" : "Dictate")]}>
        <Icon
          name={listening ? "mic.fill" : "mic"}
          size={17}
          weight="medium"
          color={listening ? Theme.red : Theme.textMuted}
          modifiers={[frame({ width: ROW, height: ROW }), ...(listening ? [symbolEffect({ effect: "pulse" }, { options: { repeat: "continuous" } })] : [])]}
        />
      </Button>
    </Host>
  );
}
