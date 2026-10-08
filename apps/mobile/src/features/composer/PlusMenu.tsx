import { memo, useRef, type ReactNode } from "react";
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

const same = (a: PlusMenuProps, b: PlusMenuProps) => a.controls === b.controls && !a.onStash === !b.onStash && !a.onStop === !b.onStop;

/** The 44pt plus: the session's model and access, Commands and skills, Attach, the stash, and Stop while the send button can't. */
export const PlusMenu = memo(function PlusMenu(props: PlusMenuProps) {
  // Redrawn only when an item appears or goes: re-rendering the native menu on every keystroke stalls typing.
  const latest = useRef(props);
  latest.current = props;
  const { controls, onStash, onStop } = props;
  const onCommands = () => latest.current.onCommands();
  const onAttach = (kind: PickerKind) => latest.current.onAttach(kind);
  const onShowStash = () => latest.current.onShowStash();
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
          {onStash ? <Button label="Stash this prompt" systemImage="tray.and.arrow.down" onPress={() => latest.current.onStash?.()} /> : null}
          <Button label="Show stashed prompts" systemImage="tray.full" onPress={onShowStash} />
        </Section>
        {onStop ? <Button label="Stop the running turn" systemImage="stop.fill" role="destructive" onPress={() => latest.current.onStop?.()} /> : null}
      </Menu>
    </Host>
  );
}, same);
