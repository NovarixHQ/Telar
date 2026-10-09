import { Button, Capsule, Circle, HStack, Overlay, Spacer, Text, VStack } from "@expo/ui/swift-ui";
import {
  accessibilityAddTraits,
  accessibilityLabel,
  background,
  buttonStyle,
  contentShape,
  foregroundStyle,
  frame,
  lineLimit,
  listRowBackground,
  listRowInsets,
  monospacedDigit,
  offset,
  onTapGesture,
  opacity,
  padding,
  rotationEffect,
  shapes,
  truncationMode,
} from "@expo/ui/swift-ui/modifiers";
import type { ColorValue } from "react-native";
import { useSplitColumn } from "../../platform/layout";
import { faded, HostMark, Icon, ProjectAvatar, ProviderIcon, SteppedPulseDot, Theme, Type } from "../../ui";
import { useProjectIcon } from "../projects";
import type { RailFamily } from "./nesting";
import type { RailRow, RailStatus } from "./rail";

type Ink = { text: ColorValue; muted: (by: number) => ColorValue; tone: (color: ColorValue) => ColorValue };

const PLAIN: Ink = { text: Theme.text, muted: (by) => faded("textMuted", by), tone: (color) => color };
const ON_ACCENT: Ink = { text: Theme.accentGlyph, muted: (by) => faded("accentGlyph", Math.max(by, 0.8)), tone: () => Theme.accentGlyph };

function StatusSlot({ status, ink }: { status: RailStatus; ink: Ink }) {
  switch (status.kind) {
    case "snoozed":
      return (
        <HStack spacing={3} modifiers={[Type.metaSmall, foregroundStyle(ink.muted(0.7))]}>
          <Icon name="alarm" textStyle="caption2" />
          <Text modifiers={[monospacedDigit()]}>{status.label}</Text>
        </HStack>
      );
    case "needs-you":
      return (
        <HStack spacing={3} modifiers={[Type.metaSmallMedium, foregroundStyle(ink.tone(Theme.amber))]}>
          <Icon name="circle.circle" textStyle="caption2" />
          <Text>Needs you</Text>
        </HStack>
      );
    case "working":
      return (
        <HStack spacing={3} modifiers={[Type.metaSmallMedium, foregroundStyle(ink.tone(Theme.sky))]}>
          <SteppedPulseDot color={ink.tone(Theme.sky)} />
          <Text>{status.label}</Text>
        </HStack>
      );
    case "monitoring":
      return <Text modifiers={[Type.metaSmallMedium, foregroundStyle(ink.tone(Theme.sky))]}>Monitoring</Text>;
    case "failed":
      return <Text modifiers={[Type.metaSmallMedium, foregroundStyle(ink.tone(Theme.red))]}>Failed</Text>;
    case "idle":
      return <Text modifiers={[Type.metaSmall, foregroundStyle(ink.muted(0.7)), monospacedDigit()]}>{status.label}</Text>;
  }
}

function RowAvatar({ row, size }: { row: RailRow; size: number }) {
  const image = useProjectIcon(row.hostId, row.projectId, row.projectIcon);
  return <ProjectAvatar name={row.projectName} iconName={row.projectIconName} iconEmoji={row.projectIconEmoji} image={image} size={size} />;
}

const UnreadDot = ({ ink }: { ink: Ink }) => <Circle modifiers={[foregroundStyle(ink.tone(Theme.accent)), frame({ width: 6, height: 6 }), accessibilityLabel("Unread answer")]} />;

const PinMark = ({ ink }: { ink: Ink }) => <Icon name="pin.fill" textStyle="caption2" color={ink.muted(0.7)} />;

const Faded = ({ by, children }: { by: number; children: React.ReactElement }) => <HStack modifiers={[opacity(by)]}>{children}</HStack>;

type RowProps = { row: RailRow; host: string | undefined; ink?: Ink; disclosure?: React.ReactElement | null };

/** Three lines: where (computer, pin, project) with the status, the title, and the branch. */
function CardBody({ row, host, ink = PLAIN, disclosure = null }: RowProps) {
  const provider = (size: number, by: number) => (
    <Faded by={by}>
      <ProviderIcon driver={row.driver} size={size} />
    </Faded>
  );
  return (
    <VStack alignment="leading" spacing={4} modifiers={[padding({ vertical: 4 })]}>
      <HStack spacing={5}>
        {host ? <HostMark hostId={row.hostId} name={host} size={12} /> : null}
        {row.pinned ? <PinMark ink={ink} /> : null}
        {row.projectName ? <RowAvatar row={row} size={12} /> : null}
        {row.projectName ? <Text modifiers={[Type.metaSmall, foregroundStyle(ink.muted(0.75)), lineLimit(1)]}>{row.projectName}</Text> : null}
        <Spacer minLength={4} />
        <StatusSlot status={row.status} ink={ink} />
      </HStack>
      <HStack spacing={6}>
        {row.unread ? <UnreadDot ink={ink} /> : null}
        <Text modifiers={[Type.rowTitle, foregroundStyle(ink.text), lineLimit(1), truncationMode("tail")]}>{row.title}</Text>
        <Spacer minLength={0} />
        {row.branch ? null : disclosure}
        {row.branch ? null : provider(11, 0.5)}
      </HStack>
      {row.branch ? (
        <HStack spacing={5} modifiers={[foregroundStyle(ink.muted(0.7))]}>
          <Icon name="arrow.triangle.branch" textStyle="caption2" />
          <Text modifiers={[Type.meta, lineLimit(1), truncationMode("middle")]}>{row.branch}</Text>
          <Spacer minLength={4} />
          {disclosure}
          {provider(11, 0.6)}
        </HStack>
      ) : null}
    </VStack>
  );
}

/** One line, for search results and shelves. */
function SlimBody({ row, host, ink = PLAIN }: RowProps) {
  return (
    <HStack spacing={6}>
      {host ? <HostMark hostId={row.hostId} name={host} size={13} /> : null}
      {row.pinned ? <PinMark ink={ink} /> : null}
      <Faded by={row.projectName ? 0.8 : 0.6}>
        {row.projectName ? <RowAvatar row={row} size={13} /> : <ProviderIcon driver={row.driver} size={12} />}
      </Faded>
      {row.unread ? <UnreadDot ink={ink} /> : null}
      <Text modifiers={[row.unread ? Type.slimMedium : Type.slim, foregroundStyle(row.unread || ink !== PLAIN ? ink.text : faded("text", 0.7)), lineLimit(1), truncationMode("tail")]}>{row.title}</Text>
      <Spacer minLength={4} />
      <StatusSlot status={row.status} ink={ink} />
    </HStack>
  );
}

function FamilyToggle({ family, open, onToggle, ink }: { family: RailFamily; open: boolean; onToggle: () => void; ink: Ink }) {
  const summary = [`${family.count} ${family.count === 1 ? "session" : "sessions"}`, ...(family.working ? [`${family.working} working`] : []), ...(family.needsYou ? [`${family.needsYou} ${family.needsYou === 1 ? "needs" : "need"} you`] : [])].join(" · ");
  return (
    <Button modifiers={[buttonStyle("borderless"), accessibilityLabel(`${open ? "Hide" : "Show"} ${summary}`)]} onPress={onToggle}>
      <HStack spacing={2} modifiers={[Type.metaSmall, foregroundStyle(ink.muted(0.7)), padding({ horizontal: 4, vertical: 2 }), contentShape(shapes.rectangle())]}>
        {family.needsYou ? <Circle modifiers={[foregroundStyle(ink.tone(Theme.red)), frame({ width: 6, height: 6 })]} /> : null}
        <Text modifiers={[monospacedDigit()]}>{String(family.count)}</Text>
        <Icon name="chevron.down" textStyle="caption2" modifiers={[rotationEffect(open ? 0 : -90)]} />
      </HStack>
    </Button>
  );
}

const accentColor = { amber: Theme.amber, accent: Theme.accent };

/** iPadOS sidebar rows: plain on the glass, the chosen one on a rounded accent inset from the edges. */
const sidebarRow = (chosen: boolean) => [
  padding({ horizontal: 10, vertical: 7 }),
  background(chosen ? Theme.accent : "clear", shapes.roundedRectangle({ cornerRadius: 10, roundedCornerStyle: "continuous" })),
  listRowBackground("clear"),
  listRowInsets({ top: 1, bottom: 1, leading: 0, trailing: 0 }),
];

const isRow = (selected: object | undefined, row: RailRow) =>
  !!selected && "hostId" in selected && "sessionId" in selected && selected.hostId === row.hostId && selected.sessionId === row.sessionId;

/** A tappable rail row with the disclosure chevron; a card row also wears the 2pt activity bar at its leading edge. */
export function RailRowView({ row, host, slim, nested, stale, family, onOpen }: RowProps & { slim?: boolean; nested?: boolean; stale: boolean; family?: { family: RailFamily; open: boolean; onToggle: () => void }; onOpen: () => void }) {
  const { sidebar, selected } = useSplitColumn();
  const chosen = sidebar && isRow(selected, row);
  const ink = chosen ? ON_ACCENT : PLAIN;
  const disclosure = family ? <FamilyToggle {...family} ink={ink} /> : null;
  const body = slim || nested ? <SlimBody row={row} host={host} ink={ink} /> : <CardBody row={row} host={host} ink={ink} disclosure={disclosure} />;
  return (
    <HStack spacing={11} modifiers={[...(sidebar ? sidebarRow(chosen) : []), contentShape(shapes.rectangle()), onTapGesture(onOpen), accessibilityAddTraits(["isButton"])]}>
        <Overlay alignment="leading" modifiers={[opacity(stale ? 0.6 : 1), padding({ leading: nested ? 12 : 0 })]}>
          {body}
          {!slim && !nested && row.accent ? (
            <Overlay.Content>
              <Capsule modifiers={[foregroundStyle(ink.tone(accentColor[row.accent])), frame({ width: 2 }), padding({ vertical: 2 }), offset({ x: -8 })]} />
            </Overlay.Content>
          ) : null}
        </Overlay>
        {sidebar ? null : <Icon name="chevron.forward" textStyle="footnote" weight="semibold" modifiers={[foregroundStyle({ type: "hierarchical", style: "tertiary" }), padding({ trailing: 2 })]} />}
    </HStack>
  );
}
