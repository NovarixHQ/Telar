import { Button, HStack, Spacer, Text, TextField, VStack, type TextFieldRef } from "@expo/ui/swift-ui";
import {
  accessibilityLabel,
  background,
  buttonBorderShape,
  buttonStyle,
  clipShape,
  disabled,
  fixedSize,
  font,
  foregroundStyle,
  frame,
  monospacedDigit,
  padding,
  strokeBorder,
  tint,
} from "@expo/ui/swift-ui/modifiers";
import { useEffect, useRef, useState } from "react";
import { faded, Icon, Radius, rowButton, Theme, Type } from "../../ui";
import { answers, canAdvance, currentPage, customText, isLast, isPicked, move, setCustom, toggle, type Answer, type QuestionDraft } from "./question";

type Props = { draft: QuestionDraft; busy: boolean; onSubmit: (answers: Record<string, Answer>) => void };

function Option({ choice, description, multiple, picked, onPress }: { choice: string; description?: string; multiple: boolean; picked: boolean; onPress: () => void }) {
  const glyph = multiple ? (picked ? "checkmark.square.fill" : "square") : picked ? "checkmark.circle.fill" : "circle";
  return (
    <Button onPress={onPress} modifiers={[...rowButton, accessibilityLabel(description ? `${choice}. ${description}` : choice)]}>
      <HStack
        alignment="firstTextBaseline"
        spacing={10}
        modifiers={[
          padding({ horizontal: 12, vertical: 10 }),
          background(picked ? faded("accent", 0.12) : Theme.fill),
          clipShape("roundedRectangle", Radius.row),
          strokeBorder({ content: picked ? faded("accent", 0.6) : "clear", style: { lineWidth: 1 }, shape: "roundedRectangle", cornerRadius: Radius.row }),
        ]}
      >
        <Icon name={glyph} textStyle="body" color={picked ? Theme.accent : Theme.textMuted} />
        <VStack alignment="leading" spacing={2} modifiers={[fixedSize({ horizontal: false, vertical: true })]}>
          <Text modifiers={[Type.body, foregroundStyle(Theme.text)]}>{choice}</Text>
          {description ? <Text modifiers={[Type.meta, foregroundStyle(Theme.textMuted)]}>{description}</Text> : null}
        </VStack>
        <Spacer minLength={0} />
      </HStack>
    </Button>
  );
}

/** The Swift app's question card: one page per question, tappable choices, an "Other" field, and Back, Next or Submit. */
export function QuestionCard({ draft: initial, busy, onSubmit }: Props) {
  const [draft, setDraft] = useState(initial);
  const field = useRef<TextFieldRef>(null);
  const page = currentPage(draft);
  const done = answers(draft);
  const shownIndex = useRef(draft.index);
  useEffect(() => {
    if (shownIndex.current === draft.index) return;
    shownIndex.current = draft.index;
    field.current?.setText(customText(draft)).catch(() => {});
  }, [draft.index]);
  const pick = (choice: string) => {
    if (customText(draft)) field.current?.clear().catch(() => {});
    setDraft(toggle(draft, choice));
  };
  return (
    <VStack alignment="leading" spacing={10}>
      <HStack spacing={6}>
        <Icon name="questionmark.bubble" textStyle="footnote" weight="medium" color={Theme.amber} />
        <Text modifiers={[font({ textStyle: "caption", weight: "semibold" }), foregroundStyle(Theme.text), padding({ horizontal: 8, vertical: 3 }), background(Theme.subtle), clipShape("capsule")]}>
          {page.header ?? "Question"}
        </Text>
        <Spacer minLength={0} />
        {draft.pages.length > 1 ? (
          <Text modifiers={[Type.meta, foregroundStyle(Theme.textMuted), monospacedDigit(), accessibilityLabel(`Question ${draft.index + 1} of ${draft.pages.length}`)]}>
            {`${draft.index + 1} of ${draft.pages.length}`}
          </Text>
        ) : null}
      </HStack>
      <VStack alignment="leading" spacing={8} modifiers={[frame({ maxWidth: Infinity, alignment: "leading" })]}>
        <Text modifiers={[Type.bodyMedium, foregroundStyle(Theme.text), fixedSize({ horizontal: false, vertical: true })]}>{page.question}</Text>
        {page.multiple ? <Text modifiers={[Type.meta, foregroundStyle(Theme.textMuted)]}>Pick any that apply</Text> : null}
        {page.choices.map((choice) => (
          <Option key={`${page.key}:${choice}`} choice={choice} {...(page.descriptions[choice] ? { description: page.descriptions[choice] } : {})} multiple={page.multiple} picked={isPicked(draft, choice)} onPress={() => pick(choice)} />
        ))}
        <TextField
          ref={field}
          placeholder={page.choices.length ? "Other…" : "Your answer"}
          axis="vertical"
          onTextChange={(text) => setDraft((current) => setCustom(current, text))}
          modifiers={[
            Type.body,
            padding({ horizontal: 12, vertical: 10 }),
            background(Theme.fill),
            clipShape("roundedRectangle", Radius.control),
            strokeBorder({ content: Theme.border, style: { lineWidth: 1 }, shape: "roundedRectangle", cornerRadius: Radius.control }),
            accessibilityLabel(page.choices.length ? "Other answer" : "Your answer"),
          ]}
        />
      </VStack>
      <HStack spacing={8} modifiers={[disabled(busy)]}>
        {draft.index > 0 ? (
          <Button onPress={() => setDraft(move(draft, false))} modifiers={rowButton}>
            <Text modifiers={[Type.slimMedium, foregroundStyle(Theme.textMuted), padding({ horizontal: 10 }), frame({ height: 30 })]}>Back</Text>
          </Button>
        ) : null}
        <Spacer minLength={0} />
        <Button
          label={isLast(draft) ? "Submit" : "Next"}
          onPress={() => (isLast(draft) ? done && onSubmit(done) : setDraft(move(draft, true)))}
          modifiers={[font({ textStyle: "footnote", weight: "semibold" }), buttonStyle("borderedProminent"), buttonBorderShape("capsule"), tint(Theme.accent), disabled(isLast(draft) ? !done : !canAdvance(draft))]}
        />
      </HStack>
    </VStack>
  );
}
