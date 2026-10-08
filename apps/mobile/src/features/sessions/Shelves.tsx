import { Button, HStack, Rectangle, Section, Text } from "@expo/ui/swift-ui";
import { accessibilityLabel, buttonStyle, foregroundStyle, frame, monospacedDigit } from "@expo/ui/swift-ui/modifiers";
import { useState, type ReactElement } from "react";
import { bandCaption, Icon, Theme } from "../../ui";
import type { RailRow } from "./rail";
import { useSettledShelf, type MergedRail } from "./use-rail";

const PAGE = 25;

function Shelf({ name, rows, heldBack = 0, open, onToggle, draw }: { name: string; rows: RailRow[]; heldBack?: number; open: boolean; onToggle: () => void; draw: (row: RailRow) => ReactElement }) {
  const [limit, setLimit] = useState(PAGE);
  if (rows.length === 0 && heldBack === 0) return null;
  const count = open ? rows.length : Math.max(rows.length, heldBack);
  const header = (
    <Button modifiers={[buttonStyle("plain"), accessibilityLabel(`${name}, ${count}, ${open ? "expanded" : "collapsed"}`)]} onPress={onToggle}>
      <HStack spacing={6} modifiers={bandCaption}>
        <Icon name={open ? "chevron.down" : "chevron.right"} textStyle="caption" />
        <Text>{name}</Text>
        <Rectangle modifiers={[foregroundStyle(Theme.border), frame({ height: 1 })]} />
        <Text modifiers={[monospacedDigit()]}>{String(count)}</Text>
      </HStack>
    </Button>
  );
  return (
    <Section header={header}>
      {open ? rows.slice(0, limit).map(draw) : []}
      {open && rows.length > limit ? <Button label="Show more" onPress={() => setLimit(limit + PAGE)} /> : null}
    </Section>
  );
}

/** Snoozed rows by wake time, then settled rows, loaded in full once that shelf opens. */
export function Shelves({ rail, draw }: { rail: MergedRail; draw: (row: RailRow) => ReactElement }) {
  const [snoozedOpen, setSnoozedOpen] = useState(false);
  const [settledOpen, setSettledOpen] = useState(false);
  const settled = useSettledShelf(settledOpen, rail) ?? rail.sections.settled;
  const snoozed = [...rail.sections.snoozed].sort((left, right) => (left.snoozedUntil ?? 0) - (right.snoozedUntil ?? 0));
  return (
    <>
      <Shelf name="Snoozed" rows={snoozed} open={snoozedOpen} onToggle={() => setSnoozedOpen(!snoozedOpen)} draw={draw} />
      <Shelf name="Settled" rows={settled} heldBack={rail.heldBack} open={settledOpen} onToggle={() => setSettledOpen(!settledOpen)} draw={draw} />
    </>
  );
}
