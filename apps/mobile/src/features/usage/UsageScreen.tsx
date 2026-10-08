import { Button, ContentUnavailableView, HStack, Host, NavigationStack, Picker, ProgressView, Spacer, Text, Toolbar, ToolbarItem, VStack } from "@expo/ui/swift-ui";
import { font, foregroundStyle, frame, lineLimit, monospacedDigit, padding, pickerStyle, tag, tint } from "@expo/ui/swift-ui/modifiers";
import type { UsageReport } from "@telar/engine-client";
import { Fragment, useCallback, useEffect, useState } from "react";
import { Icon, Theme } from "../../ui";
import { hosts, useHosts } from "../hosts";
import { CardButtonRow, CardDivider, failureText, Footnote, SectionLabel, SettingsCard, SettingsPage, StatusBanner } from "../settings";
import { driverLabel, foldUsage, formatShare, formatTokens, formatUsd, headline, scannedNote, usageWindows, type UsageFold, type UsageWindow } from "./fold";

type Loaded = { key: string; report: UsageReport };

function Headline({ fold }: { fold: UsageFold }) {
  return (
    <SettingsCard>
      <VStack alignment="leading" spacing={4} modifiers={[frame({ maxWidth: Infinity, alignment: "leading" }), padding({ horizontal: 16, vertical: 14 })]}>
        <Text modifiers={[font({ textStyle: "largeTitle", weight: "semibold" }), monospacedDigit(), foregroundStyle(Theme.text)]}>{formatUsd(fold.total.costUsd)}</Text>
        <Text modifiers={[font({ textStyle: "footnote" }), foregroundStyle(Theme.textMuted)]}>{headline(fold)}</Text>
        {fold.total.priced ? null : <Text modifiers={[font({ textStyle: "footnote" }), foregroundStyle(Theme.textMuted)]}>Some models have no known rate; their cost is not counted.</Text>}
      </VStack>
    </SettingsCard>
  );
}

function Providers({ fold }: { fold: UsageFold }) {
  return (
    <VStack spacing={0}>
      <SectionLabel text="By provider" />
      <SettingsCard>
        {fold.providers.map((provider, index) => (
          <Fragment key={provider.driver}>
            {index > 0 ? <CardDivider /> : null}
            <HStack spacing={12} modifiers={[padding({ horizontal: 16, vertical: 12 })]}>
              <Text modifiers={[font({ textStyle: "callout", weight: "semibold" }), foregroundStyle(Theme.text), lineLimit(1)]}>{driverLabel(provider.driver)}</Text>
              <Spacer minLength={8} />
              <Text modifiers={[font({ textStyle: "footnote" }), monospacedDigit(), foregroundStyle(Theme.textMuted)]}>{formatShare(provider.share)}</Text>
              <Text modifiers={[font({ textStyle: "subheadline", weight: "medium" }), monospacedDigit(), foregroundStyle(Theme.text), frame({ width: 72, alignment: "trailing" })]}>
                {provider.totals.costUsd > 0 ? formatUsd(provider.totals.costUsd) : "—"}
              </Text>
            </HStack>
          </Fragment>
        ))}
      </SettingsCard>
    </VStack>
  );
}

function Totals({ fold }: { fold: UsageFold }) {
  const rows: [string, number][] = [
    ["Processed tokens", fold.total.processed],
    ["Uncached input", fold.total.tokens.input],
    ["Cached input", fold.total.tokens.cacheRead],
    ["Output", fold.total.tokens.output],
    ["Requests", fold.total.turns],
  ];
  return (
    <VStack spacing={0}>
      <SectionLabel text="Totals" />
      <SettingsCard>
        {rows.map(([label, value], index) => (
          <Fragment key={label}>
            {index > 0 ? <CardDivider /> : null}
            <HStack modifiers={[padding({ horizontal: 16, vertical: 12 })]}>
              <Text modifiers={[font({ textStyle: "subheadline" }), foregroundStyle(Theme.textMuted)]}>{label}</Text>
              <Spacer minLength={8} />
              <Text modifiers={[font({ textStyle: "subheadline", weight: "medium" }), monospacedDigit(), foregroundStyle(Theme.text)]}>{formatTokens(value)}</Text>
            </HStack>
          </Fragment>
        ))}
      </SettingsCard>
    </VStack>
  );
}

function Computers({ selected, onSelect }: { selected: string | undefined; onSelect: (hostId: string) => void }) {
  const rows = useHosts(hosts);
  if (rows.length < 2) return null;
  return (
    <VStack spacing={0}>
      <SectionLabel text="Computer" />
      <SettingsCard>
        {rows.map(({ connection }, index) => (
          <Fragment key={connection.hostId}>
            {index > 0 ? <CardDivider /> : null}
            <CardButtonRow icon="desktopcomputer" title={connection.name} onPress={() => onSelect(connection.hostId)}>
              {selected === connection.hostId ? <Icon name="checkmark" textStyle="footnote" weight="semibold" color={Theme.accent} /> : null}
            </CardButtonRow>
          </Fragment>
        ))}
      </SettingsCard>
      <Footnote text="Each computer counts what it ran, by reading its own provider transcripts. There is no combined figure." />
    </VStack>
  );
}

function Report({ report }: { report: UsageReport }) {
  const fold = foldUsage(report);
  return (
    <>
      {fold.total.turns === 0 ? (
        <ContentUnavailableView title="No activity in this window" systemImage="chart.bar" description="Nothing this computer ran was counted between then and now." />
      ) : (
        <>
          <Headline fold={fold} />
          <Providers fold={fold} />
          <Totals fold={fold} />
        </>
      )}
      <Footnote text={scannedNote(report)} />
    </>
  );
}

/** What one computer's providers spent in a window. `hostId` picks the computer; the first one otherwise. */
function UsagePage({ hostId }: { hostId?: string }) {
  const [window, setWindow] = useState<UsageWindow>(usageWindows[1]);
  const [selected, setSelected] = useState(hostId);
  const [loaded, setLoaded] = useState<Loaded>();
  const [error, setError] = useState<string>();
  const host = selected ?? hosts.list()[0]?.hostId;
  const key = `${window.id}:${host ?? "-"}`;

  const load = useCallback(async () => {
    const connection = host ? hosts.get(host) : undefined;
    if (!connection) return setError("This computer is not paired.");
    const untilMs = Date.now();
    const input = { sinceMs: untilMs - window.ms, untilMs, resolution: window.resolution, timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone };
    try {
      const { usage } = await connection.call(true, () => connection.client.usageReport(input));
      setLoaded({ key, report: usage });
      setError(undefined);
    } catch (failure) {
      setError(failureText(failure));
    }
  }, [key]);
  useEffect(() => {
    void load();
  }, [load]);

  const report = loaded?.key === key ? loaded.report : undefined;
  return (
    <SettingsPage title="Usage" inline onRefresh={load}>
      <Picker<string> selection={window.id} onSelectionChange={(id) => setWindow(usageWindows.find((candidate) => candidate.id === id) ?? usageWindows[1])} modifiers={[pickerStyle("segmented")]}>
        {usageWindows.map((option) => (
          <Text key={option.id} modifiers={[tag(option.id)]}>
            {option.id}
          </Text>
        ))}
      </Picker>
      <Computers selected={host} onSelect={setSelected} />
      {error ? (
        <SettingsCard>
          <StatusBanner icon="exclamationmark.triangle" color={Theme.amber} title="Could not read usage" detail={error} />
        </SettingsCard>
      ) : report ? (
        <Report report={report} />
      ) : (
        <ProgressView modifiers={[frame({ maxWidth: Infinity }), padding({ top: 24 })]} />
      )}
    </SettingsPage>
  );
}

/** The rail's chart.bar sheet: present it modally with no header. */
export function UsageScreen({ hostId, onDone }: { hostId?: string; onDone: () => void }) {
  return (
    <Host style={{ flex: 1 }}>
      <NavigationStack modifiers={[tint(Theme.accent)]}>
        <Toolbar>
          <UsagePage {...(hostId ? { hostId } : {})} />
          <Toolbar.Content>
            <ToolbarItem placement="confirmationAction">
              <Button label="Done" onPress={onDone} />
            </ToolbarItem>
          </Toolbar.Content>
        </Toolbar>
      </NavigationStack>
    </Host>
  );
}
