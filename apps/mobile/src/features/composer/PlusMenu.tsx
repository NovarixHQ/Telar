import type { ReactNode } from "react";
import { Button, Host, Menu, Section } from "@expo/ui/swift-ui";
import { accessibilityLabel, background, disabled, frame, glassEffect, menuOrder, shapes } from "@expo/ui/swift-ui/modifiers";
import { faded, Icon, Theme } from "../../ui";
import { ROW } from "./buttons";

type Props = { controls?: ReactNode; onCommands: () => void; onStop?: () => void };

/** The 44pt plus: the session's model and access, Commands and skills, Attach, and Stop while the send button can't. */
export function PlusMenu({ controls, onCommands, onStop }: Props) {
  const plus = (
    <Icon
      name="plus"
      size={18}
      weight="medium"
      color={Theme.text}
      modifiers={[
        frame({ width: ROW, height: ROW }),
        glassEffect({ glass: { variant: "regular" }, shape: "circle" }),
        background(faded("popover", 0.85), shapes.circle()),
      ]}
    />
  );
  return (
    <Host matchContents>
      <Menu label={plus} modifiers={[menuOrder("fixed"), accessibilityLabel("More")]}>
        {controls ? <Section>{controls}</Section> : null}
        <Section>
          <Button label="Commands and skills" systemImage="command" onPress={onCommands} />
          <Menu label="Attach" systemImage="paperclip">
            <Button label="Photos" systemImage="photo.on.rectangle" modifiers={[disabled(true)]} />
            <Button label="Camera" systemImage="camera" modifiers={[disabled(true)]} />
            <Button label="Files" systemImage="folder" modifiers={[disabled(true)]} />
          </Menu>
        </Section>
        {onStop ? <Button label="Stop the running turn" systemImage="stop.fill" role="destructive" onPress={onStop} /> : null}
      </Menu>
    </Host>
  );
}
