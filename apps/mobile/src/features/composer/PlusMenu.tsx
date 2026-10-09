import { memo, useRef, type ReactNode } from "react";
import { Button, Host, Menu, Section } from "@expo/ui/swift-ui";
import { accessibilityLabel, background, frame, glassEffect, menuOrder, shapes } from "@expo/ui/swift-ui/modifiers";
import { isDevice } from "expo-device";
import { faded, Icon, Theme } from "../../ui";
import { ROW } from "./buttons";
import type { PickerKind } from "./use-attachments";

export type PlusMenuProps = {
  controls?: ReactNode;
  onCommands?: () => void;
  onAttach?: (kind: PickerKind) => void;
  onStash?: () => void;
  onShowStash?: () => void;
  onStop?: () => void;
};

const same = (a: PlusMenuProps, b: PlusMenuProps) => a.controls === b.controls && (["onCommands", "onAttach", "onStash", "onShowStash", "onStop"] as const).every((key) => !a[key] === !b[key]);

/** The 44pt plus: the session's model and access, Commands and skills, Attach, the stash, and Stop while the send button can't. */
export const PlusMenu = memo(function PlusMenu(props: PlusMenuProps) {
  // Redrawn only when an item appears or goes: re-rendering the native menu on every keystroke stalls typing.
  const latest = useRef(props);
  latest.current = props;
  const { controls, onCommands, onAttach, onStash, onShowStash, onStop } = props;
  const attach = (kind: PickerKind) => latest.current.onAttach?.(kind);
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
          {onCommands ? <Button label="Commands and skills" systemImage="command" onPress={() => latest.current.onCommands?.()} /> : null}
          {onAttach ? (
            <Menu label="Attach" systemImage="paperclip">
              <Button label="Photos" systemImage="photo.on.rectangle" onPress={() => attach("photos")} />
              {isDevice ? <Button label="Camera" systemImage="camera" onPress={() => attach("camera")} /> : null}
              <Button label="Files" systemImage="folder" onPress={() => attach("files")} />
            </Menu>
          ) : null}
          {onStash ? <Button label="Stash this prompt" systemImage="tray.and.arrow.down" onPress={() => latest.current.onStash?.()} /> : null}
          {onShowStash ? <Button label="Show stashed prompts" systemImage="tray.full" onPress={() => latest.current.onShowStash?.()} /> : null}
        </Section>
        {onStop ? <Button label="Stop the running turn" systemImage="stop.fill" role="destructive" onPress={() => latest.current.onStop?.()} /> : null}
      </Menu>
    </Host>
  );
}, same);
