import { Button, Circle, ContextMenu, Divider, HStack, Menu, Rectangle, Section, Spacer, Text } from "@expo/ui/swift-ui";
import { accessibilityHidden, accessibilityLabel, background, buttonStyle, foregroundStyle, frame, lineLimit, monospacedDigit, padding, shapes, truncationMode } from "@expo/ui/swift-ui/modifiers";
import type { ReactElement } from "react";
import { bandCaption, faded, Icon, Theme, Type } from "../../ui";
import type { GroupedRail, ProjectPlace, RailProject } from "./grouping";
import { RowAvatar } from "./RailRows";
import type { RailRow } from "./rail";

type Draw = (row: RailRow, slim?: boolean) => ReactElement;

const Chip = ({ text }: { text: string }) => (
  <Text modifiers={[Type.metaSmall, foregroundStyle(Theme.textMuted), lineLimit(1), padding({ horizontal: 4 }), background(Theme.subtle, shapes.roundedRectangle({ cornerRadius: 3 }))]}>{text}</Text>
);

type BandProps = {
  project: RailProject;
  collapsed: boolean;
  showHosts: boolean;
  hostName: (hostId: string) => string;
  onToggle: () => void;
  onCollapseOthers: () => void;
  onMove: (offset: -1 | 1) => void;
  onNewSession: (place: ProjectPlace) => void;
};

function BandHeader({ project, collapsed, showHosts, hostName, onToggle, onCollapseOthers, onMove, onNewSession }: BandProps) {
  const header = (
    <Button modifiers={[buttonStyle("plain"), accessibilityLabel(`${project.name}, ${project.rows.length} shown, ${collapsed ? "collapsed" : "expanded"}`)]} onPress={onToggle}>
      <HStack spacing={6}>
        <Icon name={collapsed ? "chevron.right" : "chevron.down"} textStyle="caption" color={Theme.textMuted} />
        <RowAvatar row={project.mark} size={16} />
        <Text modifiers={[Type.groupHeader, foregroundStyle(faded("text", 0.9)), lineLimit(1), truncationMode("tail")]}>{project.name}</Text>
        {project.away ? <Chip text={project.away} /> : null}
        {showHosts ? project.places.map((place) => <Chip key={`${place.hostId}:${place.projectId}`} text={hostName(place.hostId)} />) : null}
        <Spacer minLength={4} />
        <Text modifiers={[Type.metaSmall, foregroundStyle(Theme.textMuted), monospacedDigit()]}>{String(project.rows.length)}</Text>
      </HStack>
    </Button>
  );
  return (
    <ContextMenu>
      <ContextMenu.Items>
        {project.places.length > 1 ? (
          <Menu label="New conversation here" systemImage="square.and.pencil">
            {project.places.map((place) => (
              <Button key={`${place.hostId}:${place.projectId}`} label={hostName(place.hostId)} systemImage="desktopcomputer" onPress={() => onNewSession(place)} />
            ))}
          </Menu>
        ) : (
          <Button label="New conversation here" systemImage="square.and.pencil" onPress={() => onNewSession(project.places[0]!)} />
        )}
        <Divider />
        <Button label={collapsed ? "Expand" : "Collapse"} systemImage={collapsed ? "chevron.down" : "chevron.right"} onPress={onToggle} />
        <Button label="Collapse others" systemImage="arrow.down.right.and.arrow.up.left" onPress={onCollapseOthers} />
        <Divider />
        <Button label="Move up" systemImage="arrow.up" onPress={() => onMove(-1)} />
        <Button label="Move down" systemImage="arrow.down" onPress={() => onMove(1)} />
      </ContextMenu.Items>
      <ContextMenu.Trigger>{header}</ContextMenu.Trigger>
    </ContextMenu>
  );
}

type GroupedProps = Omit<BandProps, "project" | "collapsed" | "onToggle" | "onCollapseOthers" | "onMove"> & {
  grouped: GroupedRail;
  collapsed: ReadonlySet<string>;
  draw: Draw;
  onToggle: (id: string) => void;
  onCollapseOthers: (id: string) => void;
  onMove: (id: string, offset: -1 | 1) => void;
};

/** Group by Project: Needs you, pinned, then one collapsible band per project. */
export function GroupedBands({ grouped, collapsed, draw, onToggle, onCollapseOthers, onMove, ...band }: GroupedProps) {
  const { attention, pinned, projects } = grouped;
  return (
    <>
      {attention.length > 0 ? (
        <Section
          header={
            <HStack spacing={6} modifiers={[...bandCaption, accessibilityLabel(`Needs you, ${attention.length}`)]}>
              <Circle modifiers={[foregroundStyle(Theme.red), frame({ width: 6, height: 6 })]} />
              <Text>Needs you</Text>
              <Spacer minLength={4} />
              <Text modifiers={[monospacedDigit()]}>{String(attention.length)}</Text>
            </HStack>
          }
        >
          {attention.map((row) => draw(row))}
        </Section>
      ) : null}
      {pinned.length > 0 ? <Section>{pinned.map((row) => draw(row))}</Section> : null}
      {projects.map((project) => (
        <Section
          key={project.id}
          header={<BandHeader project={project} collapsed={collapsed.has(project.id)} onToggle={() => onToggle(project.id)} onCollapseOthers={() => onCollapseOthers(project.id)} onMove={(offset) => onMove(project.id, offset)} {...band} />}
        >
          {collapsed.has(project.id) ? [] : project.rows.map((row) => draw(row, true))}
        </Section>
      ))}
    </>
  );
}

/** A collapsible shelf under the rail. `heldBack` counts rows the computers have not sent yet. */
export function ShelfSection({ name, rows, open, heldBack = 0, limit, draw, onToggle, onMore }: { name: string; rows: RailRow[]; open: boolean; heldBack?: number; limit: number; draw: Draw; onToggle: () => void; onMore: () => void }) {
  const count = open ? rows.length : Math.max(rows.length, heldBack);
  if (rows.length === 0 && heldBack === 0) return null;
  return (
    <Section
      header={
        <Button modifiers={[buttonStyle("plain"), accessibilityLabel(`${name}, ${count}, ${open ? "expanded" : "collapsed"}`)]} onPress={onToggle}>
          <HStack spacing={6} modifiers={bandCaption}>
            <Icon name={open ? "chevron.down" : "chevron.right"} textStyle="caption" />
            <Text>{name}</Text>
            <Rectangle modifiers={[foregroundStyle(Theme.border), frame({ height: 1 }), accessibilityHidden()]} />
            <Text modifiers={[monospacedDigit()]}>{String(count)}</Text>
          </HStack>
        </Button>
      }
    >
      {open ? [...rows.slice(0, limit).map((row) => draw(row, true)), ...(rows.length > limit ? [<Button key="more" label="Show more" onPress={onMore} />] : [])] : []}
    </Section>
  );
}
