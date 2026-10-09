import { Button, Host, HStack, Menu, ScrollView, Spacer, Text } from "@expo/ui/swift-ui";
import { accessibilityLabel, disabled, foregroundStyle, frame, lineLimit, padding, textSelection } from "@expo/ui/swift-ui/modifiers";
import type { RequestDecision } from "@telar/engine-client";
import { useState } from "react";
import type { ColorValue } from "react-native";
import { faded, Icon, rowButton, StatusCard, Theme, Type, type SymbolName } from "../../ui";
import { DeclineSheet } from "./DeclineSheet";
import { QuestionCard } from "./QuestionCard";
import type { Answer } from "./question";
import type { RequestCard } from "./requests";

type Props = { cards: RequestCard[]; deciding?: string; onDecide: (requestId: string, decision: RequestDecision, extra?: { reason?: string; answers?: Record<string, Answer> }) => void };

const GHOSTS: { decision: RequestDecision; label: string; tint: ColorValue }[] = [
  { decision: "decline", label: "Decline", tint: Theme.red },
  { decision: "acceptForSession", label: "Always allow", tint: Theme.textMuted },
  { decision: "accept", label: "Approve", tint: Theme.text },
];

function Preview({ text, maxHeight }: { text: string; maxHeight: number }) {
  const alone = maxHeight <= 80;
  const line = (
    <ScrollView axes="horizontal" showsIndicators={false} modifiers={[alone ? frame({ minHeight: 80, maxHeight: 80 }) : frame({ maxHeight: 80 })]}>
      <Text modifiers={[Type.monoSmall, foregroundStyle(faded("text", 0.85)), textSelection(true)]}>{text}</Text>
    </ScrollView>
  );
  if (alone) return line;
  return <ScrollView modifiers={[frame({ maxHeight })]}>{line}</ScrollView>;
}

function Buttons({ card, busy, onDecide, onDecline }: { card: RequestCard; busy: boolean; onDecide: Props["onDecide"]; onDecline: () => void }) {
  return (
    <HStack spacing={4} modifiers={[padding({ top: 2 }), disabled(busy)]}>
      <Menu label={<Icon name="ellipsis" size={12} color={Theme.textMuted} modifiers={[frame({ width: 28, height: 28 })]} />} modifiers={[accessibilityLabel("More")]}>
        <Button label="Withdraw the turn" role="destructive" onPress={() => onDecide(card.id, "cancel")} />
      </Menu>
      <Spacer />
      {GHOSTS.map(({ decision, label, tint }) => (
        <Button key={decision} onPress={() => (decision === "decline" ? onDecline() : onDecide(card.id, decision))} modifiers={rowButton}>
          <Text modifiers={[Type.slimMedium, foregroundStyle(tint), padding({ horizontal: 10 }), frame({ height: 30 })]}>{label}</Text>
        </Button>
      ))}
    </HStack>
  );
}

/** Each open request as the Swift app's amber status card, answered with ghost buttons in its order. */
export function RequestCards({ cards, deciding, onDecide }: Props) {
  const [declining, setDeclining] = useState<string>();
  const sheet = (
    <DeclineSheet
      key="decline"
      open={declining !== undefined}
      onCancel={() => setDeclining(undefined)}
      onDecline={(reason) => {
        if (declining) onDecide(declining, "decline", reason ? { reason } : {});
        setDeclining(undefined);
      }}
    />
  );
  if (cards.length === 0) return null;
  return [sheet, ...cards.map((card) => (
    <Host key={card.id} matchContents={{ vertical: true }}>
      <StatusCard tint="amber" spacing={8}>
        {card.question ? (
          <QuestionCard draft={card.question} busy={deciding === card.id} onSubmit={(answers) => onDecide(card.id, "accept", { answers })} />
        ) : (
          <CardBody card={card} busy={deciding === card.id} onDecide={onDecide} onDecline={() => setDeclining(card.id)} />
        )}
      </StatusCard>
    </Host>
  ))];
}

function CardBody({ card, busy, onDecide, onDecline }: { card: RequestCard; busy: boolean; onDecide: Props["onDecide"]; onDecline: () => void }) {
  return (
    <>
      <HStack spacing={6}>
        <Icon name={card.symbol as SymbolName} textStyle="footnote" weight="medium" color={Theme.amber} />
        <Text modifiers={[Type.slimMedium, foregroundStyle(Theme.text), lineLimit(2)]}>{card.title}</Text>
      </HStack>
      {card.cwd ? <Text modifiers={[Type.monoSmall, foregroundStyle(faded("textMuted", 0.7)), lineLimit(1)]}>{card.cwd}</Text> : null}
      {card.preview ? <Preview {...card.preview} /> : null}
      {card.note ? <Text modifiers={[Type.slim, foregroundStyle(Theme.text)]}>{card.note}</Text> : null}
      {card.decidable ? (
        <Buttons card={card} busy={busy} onDecide={onDecide} onDecline={onDecline} />
      ) : (
        <Text modifiers={[Type.metaSmall, foregroundStyle(Theme.textMuted)]}>Answer this one on the computer for now.</Text>
      )}
    </>
  );
}
