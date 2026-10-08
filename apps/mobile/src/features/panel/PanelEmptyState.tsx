import { Button, HStack, ScrollView, Spacer, Text, VStack } from "@expo/ui/swift-ui";
import {
  accessibilityHint,
  accessibilityLabel,
  background,
  buttonStyle,
  contentShape,
  disabled,
  font,
  foregroundStyle,
  frame,
  lineLimit,
  multilineTextAlignment,
  onGeometryChange,
  opacity,
  padding,
  shapes,
  strokeBorder,
} from "@expo/ui/swift-ui/modifiers";
import { useState } from "react";
import { faded, Icon, Radius, Theme, Type } from "../../ui";
import { DRAWN_TABS, TAB_INFO, type PanelTab } from "./tabs";

function Card({ tab, onOpen }: { tab: PanelTab; onOpen: () => void }) {
  const { label, icon, blurb } = TAB_INFO[tab];
  const drawn = DRAWN_TABS.has(tab);
  return (
    <Button onPress={onOpen} modifiers={[buttonStyle("plain"), accessibilityLabel(`Open ${label}`), accessibilityHint(blurb), ...(drawn ? [] : [disabled(true), opacity(0.5)])]}>
      <HStack
        spacing={10}
        modifiers={[
          padding({ horizontal: 12, vertical: 10 }),
          frame({ maxWidth: Infinity, alignment: "leading" }),
          background(Theme.card, shapes.roundedRectangle({ cornerRadius: Radius.card, roundedCornerStyle: "continuous" })),
          strokeBorder({ color: faded("border", 0.6), style: { lineWidth: 1 }, shape: "roundedRectangle", cornerRadius: Radius.card }),
          contentShape(shapes.rectangle()),
        ]}
      >
        <Icon name={icon} textStyle="footnote" weight="medium" color={Theme.textMuted} modifiers={[frame({ width: 20, height: 20 })]} />
        <VStack alignment="leading" spacing={1}>
          <Text modifiers={[Type.rowTitle, foregroundStyle(Theme.text)]}>{label}</Text>
          <Text modifiers={[Type.meta, foregroundStyle(Theme.textMuted), lineLimit(2)]}>{blurb}</Text>
        </VStack>
        <Spacer minLength={0} />
      </HStack>
    </Button>
  );
}

function pairs<T>(items: readonly T[], columns: number): T[][] {
  const rows: T[][] = [];
  for (let index = 0; index < items.length; index += columns) rows.push(items.slice(index, index + columns));
  return rows;
}

/** What an empty panel shows: every surface as a card, two columns once the panel is 420pt wide. */
export function PanelEmptyState({ offered, onOpen }: { offered: readonly PanelTab[]; onOpen: (tab: PanelTab) => void }) {
  const [width, setWidth] = useState(0);
  const columns = width >= 420 ? 2 : 1;
  return (
    <ScrollView modifiers={[onGeometryChange(({ width: next }) => setWidth(next))]}>
      <VStack spacing={6} modifiers={[frame({ maxWidth: 560 }), padding({ all: 16 }), padding({ top: 24 }), frame({ maxWidth: Infinity })]}>
        <Icon name="rectangle.3.group" size={15} weight="medium" color={Theme.textMuted} modifiers={[frame({ width: 36, height: 36 }), background(Theme.fill, shapes.circle())]} />
        <Text modifiers={[font({ textStyle: "subheadline", weight: "semibold" }), foregroundStyle(Theme.text)]}>Open a surface</Text>
        <Text modifiers={[Type.slim, foregroundStyle(Theme.textMuted), multilineTextAlignment("center")]}>Choose what to keep beside the session.</Text>
        <VStack spacing={6} modifiers={[padding({ top: 12 })]}>
          {pairs(offered, columns).map((row) => (
            <HStack key={row.join()} spacing={6}>
              {row.map((tab) => (
                <Card key={tab} tab={tab} onOpen={() => onOpen(tab)} />
              ))}
            </HStack>
          ))}
        </VStack>
      </VStack>
    </ScrollView>
  );
}
