import { Button, Capsule, Circle, HStack, Overlay, Spacer, Text, VStack } from "@expo/ui/swift-ui";
import { accessibilityLabel, buttonStyle, foregroundStyle, frame, lineLimit, monospacedDigit, offset, opacity, padding, truncationMode } from "@expo/ui/swift-ui/modifiers";
import { faded, HostMark, Icon, ProjectAvatar, ProviderIcon, SteppedPulseDot, Theme, Type } from "../../ui";
import { useProjectIcon } from "../projects";
import type { RailRow, RailStatus } from "./rail";

function StatusSlot({ status }: { status: RailStatus }) {
  switch (status.kind) {
    case "snoozed":
      return (
        <HStack spacing={3} modifiers={[Type.metaSmall, foregroundStyle(faded("textMuted", 0.7))]}>
          <Icon name="alarm" textStyle="caption2" />
          <Text modifiers={[monospacedDigit()]}>{status.label}</Text>
        </HStack>
      );
    case "needs-you":
      return (
        <HStack spacing={3} modifiers={[Type.metaSmallMedium, foregroundStyle(Theme.amber)]}>
          <Icon name="circle.circle" textStyle="caption2" />
          <Text>Needs you</Text>
        </HStack>
      );
    case "working":
      return (
        <HStack spacing={3} modifiers={[Type.metaSmallMedium, foregroundStyle(Theme.sky)]}>
          <SteppedPulseDot color={Theme.sky} />
          <Text>{status.label}</Text>
        </HStack>
      );
    case "monitoring":
      return <Text modifiers={[Type.metaSmallMedium, foregroundStyle(Theme.sky)]}>Monitoring</Text>;
    case "failed":
      return <Text modifiers={[Type.metaSmallMedium, foregroundStyle(Theme.red)]}>Failed</Text>;
    case "idle":
      return <Text modifiers={[Type.metaSmall, foregroundStyle(faded("textMuted", 0.7)), monospacedDigit()]}>{status.label}</Text>;
  }
}

function RowAvatar({ row, size }: { row: RailRow; size: number }) {
  const image = useProjectIcon(row.hostId, row.projectId, row.projectIcon);
  return <ProjectAvatar name={row.projectName} iconName={row.projectIconName} iconEmoji={row.projectIconEmoji} image={image} size={size} />;
}

const UnreadDot = () => <Circle modifiers={[foregroundStyle(Theme.accent), frame({ width: 6, height: 6 }), accessibilityLabel("Unread answer")]} />;

const PinMark = () => <Icon name="pin.fill" textStyle="caption2" color={faded("textMuted", 0.7)} />;

const Faded = ({ by, children }: { by: number; children: React.ReactElement }) => <HStack modifiers={[opacity(by)]}>{children}</HStack>;

type RowProps = { row: RailRow; host: string | undefined };

/** Three lines: where (computer, pin, project) with the status, the title, and the branch. */
function CardBody({ row, host }: RowProps) {
  const provider = (size: number, by: number) => (
    <Faded by={by}>
      <ProviderIcon driver={row.driver} size={size} />
    </Faded>
  );
  return (
    <VStack alignment="leading" spacing={4} modifiers={[padding({ vertical: 4 })]}>
      <HStack spacing={5}>
        {host ? <HostMark hostId={row.hostId} name={host} size={12} /> : null}
        {row.pinned ? <PinMark /> : null}
        {row.projectName ? <RowAvatar row={row} size={12} /> : null}
        {row.projectName ? <Text modifiers={[Type.metaSmall, foregroundStyle(faded("textMuted", 0.75)), lineLimit(1)]}>{row.projectName}</Text> : null}
        <Spacer minLength={4} />
        <StatusSlot status={row.status} />
      </HStack>
      <HStack spacing={6}>
        {row.unread ? <UnreadDot /> : null}
        <Text modifiers={[Type.rowTitle, foregroundStyle(Theme.text), lineLimit(1), truncationMode("tail")]}>{row.title}</Text>
        <Spacer minLength={0} />
        {row.branch ? null : provider(11, 0.5)}
      </HStack>
      {row.branch ? (
        <HStack spacing={5} modifiers={[foregroundStyle(faded("textMuted", 0.7))]}>
          <Icon name="arrow.triangle.branch" textStyle="caption2" />
          <Text modifiers={[Type.meta, lineLimit(1), truncationMode("middle")]}>{row.branch}</Text>
          <Spacer minLength={4} />
          {provider(11, 0.6)}
        </HStack>
      ) : null}
    </VStack>
  );
}

/** One line, for search results and shelves. */
function SlimBody({ row, host }: RowProps) {
  return (
    <HStack spacing={6}>
      {host ? <HostMark hostId={row.hostId} name={host} size={13} /> : null}
      {row.pinned ? <PinMark /> : null}
      <Faded by={row.projectName ? 0.8 : 0.6}>
        {row.projectName ? <RowAvatar row={row} size={13} /> : <ProviderIcon driver={row.driver} size={12} />}
      </Faded>
      {row.unread ? <UnreadDot /> : null}
      <Text modifiers={[row.unread ? Type.slimMedium : Type.slim, foregroundStyle(row.unread ? Theme.text : faded("text", 0.7)), lineLimit(1), truncationMode("tail")]}>{row.title}</Text>
      <Spacer minLength={4} />
      <StatusSlot status={row.status} />
    </HStack>
  );
}

const accentColor = { amber: Theme.amber, accent: Theme.accent };

/** A tappable rail row with the disclosure chevron; a card row also wears the 2pt activity bar at its leading edge. */
export function RailRowView({ row, host, slim, stale, onOpen }: RowProps & { slim?: boolean; stale: boolean; onOpen: () => void }) {
  const body = slim ? <SlimBody row={row} host={host} /> : <CardBody row={row} host={host} />;
  return (
    <Button modifiers={[buttonStyle("plain")]} onPress={onOpen}>
      <HStack spacing={11}>
        <Overlay alignment="leading" modifiers={[opacity(stale ? 0.6 : 1)]}>
          {body}
          {!slim && row.accent ? (
            <Overlay.Content>
              <Capsule modifiers={[foregroundStyle(accentColor[row.accent]), frame({ width: 2 }), padding({ vertical: 2 }), offset({ x: -8 })]} />
            </Overlay.Content>
          ) : null}
        </Overlay>
        <Icon name="chevron.forward" textStyle="footnote" weight="semibold" modifiers={[foregroundStyle({ type: "hierarchical", style: "tertiary" }), padding({ trailing: 2 })]} />
      </HStack>
    </Button>
  );
}
