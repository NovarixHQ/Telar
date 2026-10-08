import { Button, HStack, Rectangle, ScrollView, Spacer, Text, VStack } from "@expo/ui/swift-ui";
import {
  background,
  buttonStyle,
  clipShape,
  contentShape,
  font,
  foregroundStyle,
  frame,
  kerning,
  lineLimit,
  navigationTitle,
  padding,
  shapes,
  textCase,
} from "@expo/ui/swift-ui/modifiers";
import type { ReactNode } from "react";
import type { ColorValue } from "react-native";
import { faded, Icon, Radius, Theme, type SymbolName } from "../../ui";

// The same API as features/settings/kit, so the hosts pages switch to it by import once it lands.

const footnote = font({ textStyle: "footnote" });
const chevron = <Icon name="chevron.right" textStyle="footnote" weight="medium" color={Theme.textMuted} />;

/** A settings screen: scrolling cards on the sheet colour, titled by the SwiftUI stack it is pushed on. */
export function SettingsPage({ title, children }: { title: string; children: ReactNode }) {
  return (
    <ScrollView modifiers={[background(Theme.sheet), navigationTitle(title)]}>
      <VStack spacing={24} modifiers={[padding({ horizontal: 20, top: 8, bottom: 32 })]}>
        {children}
      </VStack>
    </ScrollView>
  );
}

export function SettingsCard({ children }: { children: ReactNode }) {
  return (
    <VStack spacing={0} modifiers={[background(Theme.card), clipShape("roundedRectangle", Radius.settingsCard)]}>
      {children}
    </VStack>
  );
}

export function SectionLabel({ text }: { text: string }) {
  return (
    <Text
      modifiers={[
        font({ textStyle: "footnote", weight: "semibold" }),
        textCase("uppercase"),
        kerning(0.6),
        foregroundStyle(Theme.textMuted),
        frame({ maxWidth: Infinity, alignment: "leading" }),
        padding({ horizontal: 16, bottom: 8 }),
      ]}
    >
      {text}
    </Text>
  );
}

export function Footnote({ text }: { text: string }) {
  return <Text modifiers={[footnote, foregroundStyle(Theme.textMuted), frame({ maxWidth: Infinity, alignment: "leading" }), padding({ horizontal: 16, top: 8 })]}>{text}</Text>;
}

export function SettingsGroup({ label, footer, children }: { label?: string; footer?: string; children: ReactNode }) {
  return (
    <VStack spacing={0}>
      {label ? <SectionLabel text={label} /> : null}
      <SettingsCard>{children}</SettingsCard>
      {footer ? <Footnote text={footer} /> : null}
    </VStack>
  );
}

export function CardDivider() {
  return <Rectangle modifiers={[foregroundStyle(faded("border", 0.6)), frame({ height: 1 })]} />;
}

function GlyphBox({ name, color = Theme.textMuted }: { name: SymbolName; color?: ColorValue }) {
  return <Icon name={name} size={17} color={color} modifiers={[frame({ width: 27, height: 27 })]} />;
}

type RowLook = { icon: SymbolName; iconColor?: ColorValue; title: string; titleColor?: ColorValue; subtitle?: string };

function CardRow({ icon, iconColor, title, titleColor = Theme.text, subtitle, children }: RowLook & { children?: ReactNode }) {
  return (
    <HStack spacing={12} modifiers={[padding({ horizontal: 16, vertical: 14 }), contentShape(shapes.rectangle())]}>
      <GlyphBox name={icon} {...(iconColor ? { color: iconColor } : {})} />
      <VStack alignment="leading" spacing={2}>
        <Text modifiers={[font({ textStyle: "callout", weight: "semibold" }), foregroundStyle(titleColor), lineLimit(1)]}>{title}</Text>
        {subtitle ? <Text modifiers={[footnote, foregroundStyle(Theme.textMuted), lineLimit(1)]}>{subtitle}</Text> : null}
      </VStack>
      <Spacer minLength={8} />
      {children}
    </HStack>
  );
}

export function CardButtonRow({ onPress, children, ...look }: RowLook & { onPress: () => void; children?: ReactNode }) {
  return (
    <Button onPress={onPress} modifiers={[buttonStyle("plain"), contentShape(shapes.rectangle())]}>
      <CardRow {...look}>{children}</CardRow>
    </Button>
  );
}

export function CardNavRow({ onPress, ...look }: RowLook & { onPress: () => void }) {
  return (
    <CardButtonRow {...look} onPress={onPress}>
      {chevron}
    </CardButtonRow>
  );
}

export function StatusBanner({ icon, color, title, detail }: { icon: SymbolName; color: ColorValue; title: string; detail?: string }) {
  return (
    <HStack alignment="top" spacing={12} modifiers={[padding({ horizontal: 16, vertical: 14 })]}>
      <GlyphBox name={icon} color={color} />
      <VStack alignment="leading" spacing={2}>
        <Text modifiers={[font({ textStyle: "subheadline", weight: "medium" }), foregroundStyle(Theme.text)]}>{title}</Text>
        {detail ? <Text modifiers={[footnote, foregroundStyle(Theme.textMuted)]}>{detail}</Text> : null}
      </VStack>
      <Spacer minLength={0} />
    </HStack>
  );
}
