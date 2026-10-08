import { HStack, RoundedRectangle, Spacer, Text, VStack } from "@expo/ui/swift-ui";
import { accessibilityElement, accessibilityHidden, accessibilityLabel, accessibilityValue, background, fixedSize, font, foregroundStyle, frame, lineLimit, monospacedDigit, padding, rotationEffect, shapes, truncationMode } from "@expo/ui/swift-ui/modifiers";
import type { GitCommitEntry, SessionDiff } from "@telar/engine-client";
import { faded, Icon, Theme, Type } from "../../ui";
import { count, fileCount, relativeTime, statBlocks, type FileLine, type StatusTone } from "./summary";

const rounded = (cornerRadius: number) => shapes.roundedRectangle({ cornerRadius, roundedCornerStyle: "continuous" });

function StatusBadge({ letter, tone, label }: { letter: string; tone: StatusTone; label: string }) {
  return (
    <Text
      modifiers={[
        font({ textStyle: "caption2", design: "monospaced", weight: "bold" }),
        foregroundStyle(Theme[tone]),
        frame({ width: 18, height: 18 }),
        background(faded(tone, 0.14), rounded(5)),
        accessibilityLabel(label),
      ]}
    >
      {letter}
    </Text>
  );
}

function DiffCounts({ added, removed }: { added?: number; removed?: number }) {
  return (
    <HStack spacing={6} modifiers={[font({ textStyle: "footnote", weight: "medium" }), monospacedDigit()]}>
      {added === undefined ? null : <Text modifiers={[foregroundStyle(Theme.emerald)]}>{`+${count(added)}`}</Text>}
      {removed === undefined ? null : <Text modifiers={[foregroundStyle(Theme.red)]}>{`−${count(removed)}`}</Text>}
    </HStack>
  );
}

function StatBar({ added, removed }: { added: number; removed: number }) {
  const blocks = statBlocks(added, removed);
  return (
    <HStack spacing={2} modifiers={[accessibilityHidden(true)]}>
      {[0, 1, 2, 3, 4].map((index) => (
        <RoundedRectangle
          key={index}
          cornerRadius={1.5}
          modifiers={[foregroundStyle(index < blocks.added ? Theme.emerald : index < blocks.added + blocks.removed ? Theme.red : Theme.border), frame({ width: 7, height: 7 })]}
        />
      ))}
    </HStack>
  );
}

function Callout({ text }: { text: string }) {
  return (
    <HStack alignment="firstTextBaseline" spacing={8} modifiers={[foregroundStyle(Theme.amber), padding({ horizontal: 10, vertical: 8 }), frame({ maxWidth: Infinity, alignment: "leading" }), background(faded("amber", 0.08), rounded(8))]}>
      <Icon name="exclamationmark.triangle.fill" textStyle="caption" />
      <Text modifiers={[Type.slim, fixedSize({ horizontal: false, vertical: true })]}>{text}</Text>
    </HStack>
  );
}

export function DiffSummary({ diff, notes }: { diff: SessionDiff; notes: string[] }) {
  return (
    <VStack alignment="leading" spacing={10}>
      {diff.branch ? (
        <HStack spacing={6} modifiers={[accessibilityElement(), accessibilityLabel(`Branch ${diff.branch}`)]}>
          <Icon name="arrow.triangle.branch" textStyle="footnote" weight="semibold" color={Theme.textMuted} />
          <Text modifiers={[font({ textStyle: "subheadline", weight: "semibold" }), foregroundStyle(Theme.text), lineLimit(1), truncationMode("middle")]}>{diff.branch}</Text>
        </HStack>
      ) : null}
      <HStack spacing={8} modifiers={[accessibilityElement("combine")]}>
        <Text modifiers={[Type.slim, foregroundStyle(Theme.textMuted)]}>{fileCount(diff.files.length)}</Text>
        <DiffCounts added={diff.linesAdded} removed={diff.linesRemoved} />
        <Spacer minLength={0} />
        <StatBar added={diff.linesAdded} removed={diff.linesRemoved} />
      </HStack>
      {notes.map((note) => (
        <Callout key={note} text={note} />
      ))}
    </VStack>
  );
}

export function DiffFileRow({ line, open }: { line: FileLine; open: boolean }) {
  return (
    <HStack spacing={10} modifiers={[padding({ vertical: 8 }), accessibilityElement("combine"), accessibilityValue(open ? "Expanded" : "Collapsed")]}>
      <Icon name="chevron.right" textStyle="caption2" weight="semibold" color={Theme.textMuted} modifiers={[rotationEffect(open ? 90 : 0)]} />
      <StatusBadge letter={line.letter} tone={line.tone} label={line.status} />
      <VStack alignment="leading" spacing={1}>
        <Text modifiers={[Type.rowTitle, foregroundStyle(Theme.text), lineLimit(1), truncationMode("middle")]}>{line.name}</Text>
        {line.detail ? <Text modifiers={[Type.meta, foregroundStyle(Theme.textMuted), lineLimit(1), truncationMode("middle")]}>{line.detail}</Text> : null}
      </VStack>
      <Spacer minLength={8} />
      {line.binary ? <Text modifiers={[Type.meta, foregroundStyle(Theme.textMuted)]}>binary</Text> : <DiffCounts {...(line.added ? { added: line.added } : {})} {...(line.removed ? { removed: line.removed } : {})} />}
    </HStack>
  );
}

export function DiffCommitRow({ commit, now }: { commit: GitCommitEntry; now: number }) {
  return (
    <HStack spacing={10} modifiers={[padding({ vertical: 4 }), accessibilityElement("combine")]}>
      <Text modifiers={[Type.mono, foregroundStyle(Theme.textMuted), padding({ horizontal: 6, vertical: 2 }), background(Theme.fill, rounded(5))]}>{commit.shortSha}</Text>
      <Text modifiers={[Type.slim, foregroundStyle(Theme.text), lineLimit(1)]}>{commit.subject}</Text>
      <Spacer minLength={4} />
      <Text modifiers={[Type.meta, foregroundStyle(Theme.textMuted)]}>{relativeTime(commit.at, now)}</Text>
    </HStack>
  );
}
