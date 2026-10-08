import { Button, HStack, Rectangle, ScrollView, Spacer, Text, Toggle, VStack } from "@expo/ui/swift-ui";
import {
  background,
  buttonStyle,
  clipShape,
  contentShape,
  font,
  foregroundStyle,
  frame,
  kerning,
  labelsHidden,
  lineLimit,
  navigationBarTitleDisplayMode,
  navigationTitle,
  padding,
  refreshable,
  shapes,
  textCase,
  tint,
  type ModifierConfig,
} from "@expo/ui/swift-ui/modifiers";
import type { ReactNode } from "react";
import type { ColorValue } from "react-native";
import { faded, Icon, Radius, Theme, type SymbolName } from "../../../ui";

const plainRow: ModifierConfig[] = [buttonStyle("plain"), contentShape(shapes.rectangle())];
const footnote = font({ textStyle: "footnote" });
const chevron = <Icon name="chevron.right" textStyle="footnote" weight="medium" color={Theme.textMuted} />;

/** A settings screen: scrolling cards on the sheet colour with Swift's 20/8/32 padding. */
export function SettingsPage({ title, inline, onRefresh, children }: { title: string; inline?: boolean; onRefresh?: () => Promise<void>; children: ReactNode }) {
  return (
    <ScrollView
      modifiers={[
        background(Theme.sheet),
        navigationTitle(title),
        ...(inline ? [navigationBarTitleDisplayMode("inline")] : []),
        ...(onRefresh ? [refreshable(onRefresh)] : []),
      ]}
    >
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

type Fix = { title: string; onPress: () => void };

/** A labelled card with a footnote, or a red error and its fix in the footnote's place. */
export function SettingsGroup({ label, footer, error, fix, children }: { label?: string; footer?: string; error?: string; fix?: Fix; children: ReactNode }) {
  return (
    <VStack spacing={0}>
      {label ? <SectionLabel text={label} /> : null}
      <SettingsCard>{children}</SettingsCard>
      {error ? (
        <HStack alignment="firstTextBaseline" spacing={6} modifiers={[footnote, foregroundStyle(Theme.red), frame({ maxWidth: Infinity, alignment: "leading" }), padding({ horizontal: 16, top: 8 })]}>
          <Icon name="exclamationmark.triangle.fill" textStyle="footnote" />
          <VStack alignment="leading" spacing={4}>
            <Text>{error}</Text>
            {fix ? <Button label={fix.title} onPress={fix.onPress} modifiers={[font({ textStyle: "footnote", weight: "semibold" }), tint(Theme.accent)]} /> : null}
          </VStack>
        </HStack>
      ) : footer ? (
        <Footnote text={footer} />
      ) : null}
    </VStack>
  );
}

export function CardDivider() {
  return <Rectangle modifiers={[foregroundStyle(faded("border", 0.6)), frame({ height: 1 })]} />;
}

export function GlyphBox({ name, color = Theme.textMuted }: { name: SymbolName; color?: ColorValue }) {
  return <Icon name={name} size={17} color={color} modifiers={[frame({ width: 27, height: 27 })]} />;
}

type RowLook = { icon: SymbolName; iconColor?: ColorValue; title: string; titleColor?: ColorValue; subtitle?: string };

/** Swift's CardRow: a 27pt glyph box, a callout title over a footnote subtitle, and a trailing accessory. */
export function CardRow({ icon, iconColor, title, titleColor = Theme.text, subtitle, children }: RowLook & { children?: ReactNode }) {
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

/** A whole-row button around a CardRow. */
export function CardButtonRow({ onPress, children, ...look }: RowLook & { onPress: () => void; children?: ReactNode }) {
  return (
    <Button onPress={onPress} modifiers={plainRow}>
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

export function CardValueRow({ icon, title, value, onPress }: { icon: SymbolName; title: string; value: string; onPress?: () => void }) {
  const trailing = (
    <HStack spacing={6}>
      <Text modifiers={[font({ textStyle: "callout" }), foregroundStyle(Theme.textMuted), lineLimit(1)]}>{value}</Text>
      {onPress ? chevron : null}
    </HStack>
  );
  if (!onPress) return <CardRow icon={icon} title={title}>{trailing}</CardRow>;
  return (
    <CardButtonRow icon={icon} title={title} onPress={onPress}>
      {trailing}
    </CardButtonRow>
  );
}

export function CardToggleRow({ icon, title, isOn, onChange }: { icon: SymbolName; title: string; isOn: boolean; onChange: (isOn: boolean) => void }) {
  return (
    <CardRow icon={icon} title={title}>
      <Toggle label={title} isOn={isOn} onIsOnChange={onChange} modifiers={[labelsHidden(), tint(Theme.accent)]} />
    </CardRow>
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
