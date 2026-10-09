import { Button, Circle, HStack, Rectangle, Spacer, Text, VStack } from "@expo/ui/swift-ui";
import {
  accessibilityHint,
  accessibilityLabel,
  background,
  fixedSize,
  font,
  foregroundStyle,
  frame,
  lineLimit,
  monospacedDigit,
  padding,
  shapes,
  strokeBorder,
  textSelection,
  truncationMode,
} from "@expo/ui/swift-ui/modifiers";
import type { SessionActivity } from "@telar/engine-client";
import type { ReactNode } from "react";
import type { ColorValue } from "react-native";
import { ActivityBadge, bandCaption, EmptyState, faded, Icon, Radius, rowButton, Theme } from "../../../ui";
import type { State, Tone } from "./agents";

const TONE: Record<Tone, ColorValue> = { live: Theme.sky, attention: Theme.amber, done: Theme.emerald, danger: Theme.red, quiet: Theme.textMuted };
const TONE_FILL: Record<Tone, ColorValue> = { live: faded("sky", 0.12), attention: faded("amber", 0.12), done: faded("emerald", 0.12), danger: faded("red", 0.12), quiet: faded("textMuted", 0.12) };

const Rule = ({ leading }: { leading: number }) => <Rectangle modifiers={[foregroundStyle(faded("border", 0.6)), frame({ height: 1 }), padding({ leading })]} />;

export function AgentSection({ label, count, children }: { label: string; count?: number; children: ReactNode }) {
  return (
    <VStack alignment="leading" spacing={6}>
      <HStack spacing={6} modifiers={[...bandCaption, padding({ horizontal: 4 }), accessibilityLabel(count === undefined ? label : `${label}, ${count}`)]}>
        <Text>{label}</Text>
        {count === undefined ? null : <Text modifiers={[monospacedDigit()]}>{String(count)}</Text>}
      </HStack>
      <VStack
        spacing={0}
        modifiers={[
          background(Theme.card, shapes.roundedRectangle({ cornerRadius: Radius.card, roundedCornerStyle: "continuous" })),
          strokeBorder({ color: faded("border", 0.6), style: { lineWidth: 1 }, shape: "roundedRectangle", cornerRadius: Radius.card }),
        ]}
      >
        {children}
      </VStack>
    </VStack>
  );
}

type RowProps = { title: string; detail?: string | undefined; state: State; activity?: SessionActivity | undefined; onOpen?: (() => void) | undefined; last?: boolean };

export function AgentRow({ title, detail, state, activity, onOpen, last = false }: RowProps) {
  const content = (
    <HStack alignment="firstTextBaseline" spacing={10} modifiers={[padding({ horizontal: 14, vertical: 11 }), frame({ maxWidth: Infinity, alignment: "leading" })]}>
      {activity ? <ActivityBadge activity={activity} /> : <Circle modifiers={[foregroundStyle(TONE[state.tone]), frame({ width: 7, height: 7 })]} />}
      <VStack alignment="leading" spacing={3} modifiers={[frame({ maxWidth: Infinity, alignment: "leading" })]}>
        <HStack alignment="firstTextBaseline" spacing={8}>
          <Text modifiers={[font({ textStyle: "subheadline", weight: "medium" }), foregroundStyle(Theme.text), lineLimit(2)]}>{title}</Text>
          <Spacer minLength={0} />
          <Text
            modifiers={[
              font({ textStyle: "caption", weight: "semibold" }),
              foregroundStyle(TONE[state.tone]),
              lineLimit(1),
              fixedSize(),
              padding({ horizontal: 7, vertical: 2 }),
              background(TONE_FILL[state.tone], shapes.capsule()),
            ]}
          >
            {state.label}
          </Text>
        </HStack>
        {detail ? <Text modifiers={[font({ textStyle: "footnote" }), foregroundStyle(Theme.textMuted), lineLimit(2)]}>{detail}</Text> : null}
      </VStack>
      {onOpen ? <Icon name="chevron.right" textStyle="caption" weight="semibold" color={faded("textMuted", 0.6)} /> : null}
    </HStack>
  );
  return (
    <>
      {onOpen ? (
        <Button onPress={onOpen} modifiers={[...rowButton, accessibilityHint("Opens this conversation")]}>
          {content}
        </Button>
      ) : (
        content
      )}
      {last ? null : <Rule leading={31} />}
    </>
  );
}

export function FactRow({ label, last = false, children }: { label: string; last?: boolean; children: ReactNode }) {
  return (
    <>
      <HStack alignment="firstTextBaseline" spacing={10} modifiers={[padding({ horizontal: 14, vertical: 9 })]}>
        <Text modifiers={[font({ textStyle: "footnote" }), foregroundStyle(Theme.textMuted), frame({ width: 84, alignment: "leading" })]}>{label}</Text>
        {children}
        <Spacer minLength={0} />
      </HStack>
      {last ? null : <Rule leading={14} />}
    </>
  );
}

export function FactValue({ text, mono = false }: { text: string; mono?: boolean }) {
  return (
    <Text modifiers={[font(mono ? { textStyle: "footnote", design: "monospaced" } : { textStyle: "footnote", weight: "medium" }), foregroundStyle(Theme.text), lineLimit(2), truncationMode("middle"), textSelection(true)]}>
      {text}
    </Text>
  );
}

export function AgentsEmpty({ failed }: { failed: boolean }) {
  return <EmptyState inline icon="person.2" title="No other conversation is involved" detail={failed ? "The computer did not answer — retrying." : "Conversations this one hands work to appear here."} />;
}
