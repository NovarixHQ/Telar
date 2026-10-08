import { Button, ContextMenu, HStack, Menu, ScrollView, Text } from "@expo/ui/swift-ui";
import { accessibilityLabel, background, buttonStyle, contentShape, disabled, font, foregroundStyle, frame, lineLimit, onGeometryChange, padding, shadow, shapes, strokeBorder } from "@expo/ui/swift-ui/modifiers";
import { useState } from "react";
import { Icon, Radius, Theme } from "../../ui";
import { DRAWN_TABS, TAB_INFO, type PanelTab } from "./tabs";

const PILL_HEIGHT = 32;
const short = (text: string) => (text.length > 22 ? `${text.slice(0, 21)}…` : text);

// Stands in for SwiftUI's ViewThatFits: footnote glyphs run about 7.5pt, a labelled pill adds 39pt of icon and padding.
const labelledWidth = (tab: PanelTab, selected: boolean) => 39 + short(TAB_INFO[tab].label).length * 7.5 + (selected ? 22 : 0);
const iconWidth = (selected: boolean) => (selected ? 54 : 34);

type StripProps = { tabs: PanelTab[]; active: PanelTab | undefined; openable: PanelTab[]; onSelect: (tab: PanelTab) => void; onClose: (tab: PanelTab) => void; onOpen: (tab: PanelTab) => void };

function Pill({ tab, selected, labelled, onSelect, onClose }: { tab: PanelTab; selected: boolean; labelled: boolean; onSelect: () => void; onClose: () => void }) {
  const { label, icon } = TAB_INFO[tab];
  const weight = selected ? "semibold" : "medium";
  const chrome = selected
    ? [
        background(Theme.card, shapes.roundedRectangle({ cornerRadius: Radius.control, roundedCornerStyle: "continuous" })),
        strokeBorder({ color: Theme.border, style: { lineWidth: 1 }, shape: "roundedRectangle", cornerRadius: Radius.control }),
        shadow({ radius: 1, y: 1, color: "#0000000D" }),
      ]
    : [];
  return (
    <ContextMenu>
      <ContextMenu.Items>
        <Button label={`Close ${label}`} systemImage="xmark" onPress={onClose} />
      </ContextMenu.Items>
      <ContextMenu.Trigger>
        <HStack spacing={0} modifiers={[foregroundStyle(selected ? Theme.text : Theme.textMuted), frame({ height: PILL_HEIGHT }), ...chrome]}>
          <Button onPress={onSelect} modifiers={[buttonStyle("plain"), accessibilityLabel(`${label} tab`)]}>
            <HStack
              spacing={6}
              modifiers={[padding({ leading: labelled ? 11 : 0, trailing: selected ? 4 : labelled ? 11 : 0 }), frame({ ...(labelled || selected ? {} : { minWidth: 34 }), maxHeight: Infinity }), contentShape(shapes.rectangle())]}
            >
              <Icon name={icon} textStyle="footnote" weight={weight} />
              {labelled ? <Text modifiers={[font({ textStyle: "footnote", weight }), lineLimit(1)]}>{short(label)}</Text> : null}
            </HStack>
          </Button>
          {selected ? (
            <Button onPress={onClose} modifiers={[buttonStyle("plain"), padding({ trailing: 4 }), accessibilityLabel(`Close ${label}`)]}>
              <Icon name="xmark" textStyle="caption2" weight="bold" color={Theme.textMuted} modifiers={[frame({ width: 22, height: PILL_HEIGHT }), contentShape(shapes.rectangle())]} />
            </Button>
          ) : null}
        </HStack>
      </ContextMenu.Trigger>
    </ContextMenu>
  );
}

function Chooser({ openable, onOpen }: { openable: PanelTab[]; onOpen: (tab: PanelTab) => void }) {
  return (
    <Menu label={<Icon name="plus" size={13} weight="semibold" color={Theme.textMuted} modifiers={[frame({ width: 32, height: 32 }), contentShape(shapes.rectangle())]} />} modifiers={[accessibilityLabel("Open a surface")]}>
      {openable.map((tab) => (
        <Button key={tab} label={TAB_INFO[tab].label} systemImage={TAB_INFO[tab].icon} onPress={() => onOpen(tab)} modifiers={DRAWN_TABS.has(tab) ? [] : [disabled(true)]} />
      ))}
    </Menu>
  );
}

/** The panel's pills: every tab labelled when they fit, else only the active one, scrolling as a last resort. */
export function PanelTabStrip({ tabs, active, openable, onSelect, onClose, onOpen }: StripProps) {
  const [width, setWidth] = useState(0);
  const room = width - (openable.length > 0 ? 34 : 0);
  const all = tabs.reduce((sum, tab) => sum + labelledWidth(tab, tab === active) + 2, 0);
  const selectedOnly = tabs.reduce((sum, tab) => sum + (tab === active ? labelledWidth(tab, true) : iconWidth(false)) + 2, 0);
  const labelAll = width === 0 || all <= room;
  const row = (
    <HStack spacing={2}>
      {tabs.map((tab) => (
        <Pill key={tab} tab={tab} selected={tab === active} labelled={labelAll || tab === active} onSelect={() => onSelect(tab)} onClose={() => onClose(tab)} />
      ))}
    </HStack>
  );
  return (
    <HStack spacing={2} modifiers={[frame({ maxWidth: Infinity, alignment: "leading" }), onGeometryChange(({ width: next }) => setWidth(next))]}>
      {labelAll || selectedOnly <= room ? (
        row
      ) : (
        <ScrollView axes="horizontal" showsIndicators={false}>
          {row}
        </ScrollView>
      )}
      {openable.length > 0 ? <Chooser openable={openable} onOpen={onOpen} /> : null}
    </HStack>
  );
}
