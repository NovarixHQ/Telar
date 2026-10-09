import { BottomSheet, Button, ContextMenu, Host, HStack, Label, List, Menu, NavigationStack, Spacer, SwipeActions, Text, Toolbar, ToolbarItem } from "@expo/ui/swift-ui";
import { disabled, foregroundStyle, monospacedDigit, navigationBarTitleDisplayMode, navigationTitle, presentationDetents, tint } from "@expo/ui/swift-ui/modifiers";
import type { ReactElement } from "react";
import { Theme, type SymbolName } from "../../ui";
import { rowMenu, snoozePresets, type RailAction, type RowMenuItem } from "./rail-actions";
import type { RailRow } from "./rail";

export type Shelf = "snoozed" | "settled";

function Entry({ item, onAction }: { item: RowMenuItem; onAction: (action: RailAction) => void }) {
  const image = item.systemImage as SymbolName;
  const off = item.disabled ? [disabled(true)] : [];
  if (item.children) {
    return (
      <Menu label={item.label} systemImage={image} modifiers={off}>
        {item.children.map((child) => (
          <Entry key={child.id} item={child} onAction={onAction} />
        ))}
      </Menu>
    );
  }
  return (
    <Button
      label={item.detail ? `${item.label} · ${item.detail}` : item.label}
      systemImage={image}
      {...(item.destructive ? { role: "destructive" as const } : {})}
      modifiers={off}
      onPress={() => item.action && onAction(item.action)}
    />
  );
}

/** Swift's row gestures: pin from the leading edge, settle and snooze (or wake) from the trailing one, and the long-press menu. */
export function ActionRow({ row, shelf, link, onAction, onSnooze, children }: { row: RailRow; shelf?: Shelf; link?: string; onAction: (action: RailAction) => void; onSnooze: () => void; children: ReactElement }) {
  return (
    <SwipeActions>
      <ContextMenu>
        <ContextMenu.Items>
          {rowMenu(row, { ...(shelf ? { shelf } : {}), ...(link ? { link } : {}), now: new Date() }).map((item) => (
            <Entry key={item.id} item={item} onAction={onAction} />
          ))}
        </ContextMenu.Items>
        <ContextMenu.Trigger>{children}</ContextMenu.Trigger>
      </ContextMenu>
      <SwipeActions.Actions edge="leading" allowsFullSwipe>
        {row.pinned ? (
          <Button modifiers={[tint(Theme.textMuted)]} onPress={() => onAction({ kind: "pin", pinned: false })}>
            <Label title="Unpin" systemImage="pin.slash" />
          </Button>
        ) : (
          <Button modifiers={[tint(Theme.accent)]} onPress={() => onAction({ kind: "pin", pinned: true })}>
            <Label title="Pin" systemImage="pin" />
          </Button>
        )}
      </SwipeActions.Actions>
      <SwipeActions.Actions edge="trailing" allowsFullSwipe>
        {shelf ? (
          <Button modifiers={[tint(Theme.sky)]} onPress={() => onAction({ kind: "wake" })}>
            <Label title="Wake" systemImage="arrow.uturn.backward" />
          </Button>
        ) : (
          [
            <Button key="settle" modifiers={[tint(Theme.textMuted)]} onPress={() => onAction({ kind: "settle", settled: true })}>
              <Label title="Settle" systemImage="checkmark" />
            </Button>,
            <Button key="snooze" modifiers={[tint(Theme.amber)]} onPress={onSnooze}>
              <Label title="Snooze" systemImage="moon.zzz" />
            </Button>,
          ]
        )}
      </SwipeActions.Actions>
    </SwipeActions>
  );
}

/** The presets a trailing swipe offers, in a half-height sheet. */
export function SnoozeSheet({ row, onClose, onPick }: { row: RailRow | undefined; onClose: () => void; onPick: (until: number) => void }) {
  return (
    <Host matchContents style={{ position: "absolute" }}>
      <BottomSheet isPresented={row !== undefined} onIsPresentedChange={(presented) => !presented && onClose()}>
        <NavigationStack modifiers={[presentationDetents(["medium"])]}>
          <Toolbar>
            <Toolbar.Content>
              <List modifiers={[navigationTitle("Snooze"), navigationBarTitleDisplayMode("inline")]}>
                {snoozePresets(new Date()).map((preset) => (
                  <Button key={preset.id} onPress={() => (onClose(), onPick(preset.until))}>
                    <HStack>
                      <Text modifiers={[foregroundStyle(Theme.text)]}>{preset.label}</Text>
                      <Spacer />
                      <Text modifiers={[foregroundStyle(Theme.textMuted), monospacedDigit()]}>{preset.when}</Text>
                    </HStack>
                  </Button>
                ))}
              </List>
            </Toolbar.Content>
            <ToolbarItem placement="cancellationAction">
              <Button label="Cancel" onPress={onClose} />
            </ToolbarItem>
          </Toolbar>
        </NavigationStack>
      </BottomSheet>
    </Host>
  );
}
