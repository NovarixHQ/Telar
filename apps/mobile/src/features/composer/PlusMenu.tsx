import type { ReactNode } from "react";
import { Button, Host, Menu, Section } from "@expo/ui/swift-ui";
import { accessibilityLabel, background, frame, glassEffect, menuOrder, shapes } from "@expo/ui/swift-ui/modifiers";
import { isDevice } from "expo-device";
import { faded, Icon, Theme } from "../../ui";
import { ROW } from "./buttons";
import type { PickerKind } from "./use-attachments";

export type PlusMenuProps = {
  controls?: ReactNode;
  onCommands: () => void;
  onAttach: (kind: PickerKind) => void;
  onStash?: () => void;
  onShowStash: () => void;
  onStop?: () => void;
};

/** The 44pt plus: the session's model and access, Commands and skills, Attach, the stash, and Stop while the send button can't. */
export function PlusMenu({ controls, onCommands, onAttach, onStash, onShowStash, onStop }: PlusMenuProps) {
  const plus = (
    <Icon
      name="plus"
      size={18}
      weight="medium"
      color={Theme.text}
      modifiers={[frame({ width: ROW, height: ROW }), glassEffect({ glass: { variant: "regular" }, shape: "circle" }), background(faded("popover", 0.85), shapes.circle())]}
    />
  );
  return (
    <Host matchContents>
      <Menu label={plus} modifiers={[menuOrder("fixed"), accessibilityLabel("More")]}>
        {controls ? <Section>{controls}</Section> : null}
        <Section>
          <Button label="Commands and skills" systemImage="command" onPress={onCommands} />
          <Menu label="Attach" systemImage="paperclip">
            <Button label="Photos" systemImage="photo.on.rectangle" onPress={() => onAttach("photos")} />
            {isDevice ? <Button label="Camera" systemImage="camera" onPress={() => onAttach("camera")} /> : null}
            <Button label="Files" systemImage="folder" onPress={() => onAttach("files")} />
          </Menu>
          {onStash ? <Button label="Stash this prompt" systemImage="tray.and.arrow.down" onPress={onStash} /> : null}
          <Button label="Show stashed prompts" systemImage="tray.full" onPress={onShowStash} />
        </Section>
        {onStop ? <Button label="Stop the running turn" systemImage="stop.fill" role="destructive" onPress={onStop} /> : null}
      </Menu>
    </Host>
  );
}
