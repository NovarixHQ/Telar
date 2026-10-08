import { Button, ContextMenu, Menu, SwipeActions } from "@expo/ui/swift-ui";
import { disabled, tint } from "@expo/ui/swift-ui/modifiers";
import type { ReactElement } from "react";
import { Theme } from "../../ui";
import type { RailRow } from "./rail";
import { rowMenu, type RowMenuItem, type RowVerb } from "./row-actions";
import { patchRow, runVerb, wakeRow } from "./row-mutations";

type Handlers = { onSnooze: (row: RailRow) => void; onError: (message: string) => void };

function attempt(work: Promise<void>, onError: Handlers["onError"]) {
  work.catch((error: unknown) => onError(error instanceof Error ? error.message : String(error)));
}

function MenuEntry({ item, run }: { item: RowMenuItem; run: (verb: RowVerb) => void }): ReactElement {
  if (item.children) {
    return (
      <Menu label={item.label} systemImage={item.systemImage} modifiers={item.disabled ? [disabled()] : []}>
        {item.children.map((child) => (
          <MenuEntry key={child.id} item={child} run={run} />
        ))}
      </Menu>
    );
  }
  return (
    <Button
      label={item.label}
      systemImage={item.systemImage}
      {...(item.destructive ? { role: "destructive" as const } : {})}
      modifiers={item.disabled ? [disabled()] : []}
      onPress={() => item.verb && run(item.verb)}
    />
  );
}

/** A rail row with Swift's swipes (pin; settle and snooze, or wake) and its long-press menu. */
export function RowActions({ row, children, onSnooze, onError }: Handlers & { row: RailRow; children: ReactElement }) {
  const run = (verb: RowVerb) => attempt(runVerb(row, verb), onError);
  return (
    <SwipeActions>
      <ContextMenu>
        <ContextMenu.Items>
          {rowMenu(row, new Date()).map((item) => (
            <MenuEntry key={item.id} item={item} run={run} />
          ))}
        </ContextMenu.Items>
        <ContextMenu.Trigger>{children}</ContextMenu.Trigger>
      </ContextMenu>
      <SwipeActions.Actions edge="leading">
        {row.pinned ? (
          <Button label="Unpin" systemImage="pin.slash" modifiers={[tint(Theme.textMuted)]} onPress={() => attempt(patchRow(row, { settledOverride: null }), onError)} />
        ) : (
          <Button label="Pin" systemImage="pin" modifiers={[tint(Theme.accent)]} onPress={() => attempt(patchRow(row, { settledOverride: "active" }), onError)} />
        )}
      </SwipeActions.Actions>
      <SwipeActions.Actions edge="trailing">
        {row.shelf ? (
          <Button label="Wake" systemImage="arrow.uturn.backward" modifiers={[tint(Theme.sky)]} onPress={() => attempt(wakeRow(row), onError)} />
        ) : (
          [
            <Button key="settle" label="Settle" systemImage="checkmark" modifiers={[tint(Theme.textMuted)]} onPress={() => run({ kind: "settle", settled: true })} />,
            <Button key="snooze" label="Snooze" systemImage="moon.zzz" modifiers={[tint(Theme.amber)]} onPress={() => onSnooze(row)} />,
          ]
        )}
      </SwipeActions.Actions>
    </SwipeActions>
  );
}
