import { Button, Host, HStack, ProgressView, Rectangle, ScrollView, Spacer, Text, TextField, useNativeState, VStack, type TextFieldProps } from "@expo/ui/swift-ui";
import {
  autocorrectionDisabled,
  background,
  buttonStyle,
  clipShape,
  contentShape,
  disabled,
  font,
  foregroundStyle,
  frame,
  kerning,
  keyboardType,
  lineLimit,
  onSubmit,
  padding,
  shapes,
  submitLabel,
  textCase,
  textInputAutocapitalization,
  tint,
} from "@expo/ui/swift-ui/modifiers";
import { useState, type ReactElement, type ReactNode } from "react";
import type { ColorValue } from "react-native";
import { faded, Icon, Radius, Theme, type SymbolName } from "../../ui";

const footnote = font({ textStyle: "footnote" });
const glyphBox = (icon: SymbolName, color: ColorValue) => <Icon name={icon} size={17} color={color} modifiers={[frame({ width: 27, height: 27 })]} />;

/** Swift's SettingsPage: a scrolling column of groups on the sheet colour. The title comes from the route. */
export function SettingsPage({ children }: { children: ReactNode }) {
  return (
    <Host style={{ flex: 1 }}>
      <ScrollView modifiers={[background(Theme.sheet)]}>
        <VStack spacing={24} modifiers={[padding({ horizontal: 20, top: 8, bottom: 32 })]}>
          {children}
        </VStack>
      </ScrollView>
    </Host>
  );
}

export function SettingsSectionLabel({ text }: { text: string }) {
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

export function SettingsFootnote({ text }: { text: string }) {
  return <Text modifiers={[footnote, foregroundStyle(Theme.textMuted), frame({ maxWidth: Infinity, alignment: "leading" }), padding({ horizontal: 16, top: 8 })]}>{text}</Text>;
}

export function SettingsCard({ children }: { children: ReactNode }) {
  return (
    <VStack spacing={0} modifiers={[background(Theme.card), clipShape("roundedRectangle", Radius.settingsCard)]}>
      {children}
    </VStack>
  );
}

export function SettingsGroup({ label, footer, children }: { label?: string; footer?: string; children: ReactNode }) {
  return (
    <VStack spacing={0}>
      {label ? <SettingsSectionLabel text={label} /> : null}
      <SettingsCard>{children}</SettingsCard>
      {footer ? <SettingsFootnote text={footer} /> : null}
    </VStack>
  );
}

export function CardDivider() {
  return <Rectangle modifiers={[foregroundStyle(faded("border", 0.6)), frame({ height: 1 })]} />;
}

type RowProps = { icon: SymbolName; iconColor?: ColorValue; title: string; titleColor?: ColorValue; subtitle?: string; trailing?: ReactElement };

function CardRow({ icon, iconColor = Theme.textMuted, title, titleColor = Theme.text, subtitle, trailing }: RowProps) {
  return (
    <HStack spacing={12} modifiers={[padding({ horizontal: 16, vertical: 14 }), contentShape(shapes.rectangle())]}>
      {glyphBox(icon, iconColor)}
      <VStack alignment="leading" spacing={2}>
        <Text modifiers={[font({ textStyle: "callout", weight: "semibold" }), foregroundStyle(titleColor), lineLimit(1)]}>{title}</Text>
        {subtitle ? <Text modifiers={[footnote, foregroundStyle(Theme.textMuted), lineLimit(1)]}>{subtitle}</Text> : null}
      </VStack>
      <Spacer minLength={8} />
      {trailing ?? null}
    </HStack>
  );
}

const chevron = <Icon name="chevron.right" textStyle="footnote" weight="medium" color={Theme.textMuted} />;

/** A tappable card row: the chevron says it pushes a page; without it, the row is an action. */
export function CardButtonRow({ onPress, enabled = true, nav = false, ...row }: RowProps & { onPress: () => void; enabled?: boolean; nav?: boolean }) {
  return (
    <Button onPress={onPress} modifiers={[buttonStyle("plain"), disabled(!enabled)]}>
      <CardRow {...row} {...(nav ? { trailing: chevron } : {})} />
    </Button>
  );
}

export function CardNavRow(props: Omit<RowProps, "trailing" | "iconColor" | "titleColor"> & { onPress: () => void }) {
  return <CardButtonRow {...props} nav />;
}

export type Field = { state: NonNullable<TextFieldProps["text"]>; value: string; onChange: (text: string) => void; set: (text: string) => void };

/** A text field's native state with a React copy, so the screen re-renders as the person types. */
export function useField(initial: string): Field {
  const state = useNativeState(initial);
  const [value, onChange] = useState(initial);
  const set = (text: string) => {
    state.value = text;
    onChange(text);
  };
  return { state, value, onChange, set };
}

type FieldProps = {
  label?: string;
  placeholder: string;
  field: Field;
  mono?: boolean;
  keyboard?: "url" | "ascii-capable-number-pad" | "default";
  onDone?: () => void;
};

export function CardField({ label, placeholder, field, mono = false, keyboard = "default", onDone }: FieldProps) {
  return (
    <VStack alignment="leading" spacing={4} modifiers={[padding({ horizontal: 16, vertical: 12 }), frame({ maxWidth: Infinity, alignment: "leading" })]}>
      {label ? <Text modifiers={[font({ textStyle: "footnote", weight: "medium" }), foregroundStyle(Theme.textMuted)]}>{label}</Text> : null}
      <TextField
        placeholder={placeholder}
        text={field.state}
        onTextChange={field.onChange}
        modifiers={[
          mono ? font({ textStyle: "subheadline", design: "monospaced" }) : font({ textStyle: "callout" }),
          foregroundStyle(Theme.text),
          keyboardType(keyboard),
          autocorrectionDisabled(),
          textInputAutocapitalization("never"),
          ...(onDone ? [submitLabel("done"), onSubmit(onDone)] : []),
        ]}
      />
    </VStack>
  );
}

/** Swift's PrimaryActionButton: a full-width 50pt accent slab, radius 16, with a spinner while busy. */
export function PrimaryActionButton({ title, busy = false, enabled = true, onPress }: { title: string; busy?: boolean; enabled?: boolean; onPress: () => void }) {
  return (
    // Not `disabled`: SwiftUI would dim the slab a second time over its own muted colours.
    <Button onPress={() => enabled && !busy && onPress()} modifiers={[buttonStyle("plain")]}>
      <HStack
        modifiers={[
          frame({ maxWidth: Infinity, minHeight: 50, maxHeight: 50 }),
          background(enabled ? Theme.accent : Theme.subtleStrong),
          clipShape("roundedRectangle", Radius.primaryButton),
          contentShape(shapes.roundedRectangle({ cornerRadius: Radius.primaryButton })),
        ]}
      >
        {busy ? (
          <ProgressView modifiers={[tint(Theme.accentGlyph)]} />
        ) : (
          <Text modifiers={[font({ textStyle: "callout", weight: "semibold" }), foregroundStyle(enabled ? Theme.accentGlyph : Theme.textMuted)]}>{title}</Text>
        )}
      </HStack>
    </Button>
  );
}

export type Banner = { icon: SymbolName; tone: "emerald" | "amber" | "red"; title: string; detail?: string };

export function StatusBanner({ icon, tone, title, detail }: Banner) {
  return (
    <HStack alignment="top" spacing={12} modifiers={[padding({ horizontal: 16, vertical: 14 })]}>
      {glyphBox(icon, Theme[tone])}
      <VStack alignment="leading" spacing={2}>
        <Text modifiers={[font({ textStyle: "subheadline", weight: "medium" }), foregroundStyle(Theme.text)]}>{title}</Text>
        {detail ? <Text modifiers={[footnote, foregroundStyle(Theme.textMuted)]}>{detail}</Text> : null}
      </VStack>
      <Spacer minLength={0} />
    </HStack>
  );
}
