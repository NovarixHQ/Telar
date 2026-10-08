import { Button, HStack, ProgressView, Text, TextField, useNativeState, VStack, type TextFieldProps } from "@expo/ui/swift-ui";
import {
  autocorrectionDisabled,
  background,
  buttonStyle,
  clipShape,
  contentShape,
  font,
  foregroundStyle,
  frame,
  keyboardType,
  onSubmit,
  padding,
  shapes,
  submitLabel,
  textInputAutocapitalization,
  tint,
} from "@expo/ui/swift-ui/modifiers";
import { useState } from "react";
import { Radius, Theme } from "../../ui";

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

/** Swift's CardField: an optional footnote label over a plain field, inside a settings card. */
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
