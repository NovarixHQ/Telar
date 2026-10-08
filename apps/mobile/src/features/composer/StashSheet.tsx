import { BottomSheet, Button, ContentUnavailableView, Host, HStack, Label, List, NavigationStack, Spacer, SwipeActions, Text, Toolbar, ToolbarItem, VStack } from "@expo/ui/swift-ui";
import {
  background,
  foregroundStyle,
  frame,
  lineLimit,
  listStyle,
  navigationBarTitleDisplayMode,
  navigationTitle,
  padding,
  presentationDetents,
  shapes,
} from "@expo/ui/swift-ui/modifiers";
import { Icon, Theme, Type } from "../../ui";
import { stashAgo, stashSummary, type StashEntry } from "./stash";

type Props = { open: boolean; entries: StashEntry[]; onClose: () => void; onPick: (entry: StashEntry) => void; onDrop: (id: string) => void };

function Row({ entry, onPick, onDrop }: { entry: StashEntry; onPick: () => void; onDrop: () => void }) {
  return (
    <SwipeActions>
      <Button onPress={onPick}>
        <HStack spacing={10}>
          <Icon name={entry.images.length ? "photo.on.rectangle" : "text.alignleft"} textStyle="subheadline" color={Theme.textMuted} modifiers={[frame({ width: 20 })]} />
          <VStack alignment="leading" spacing={2}>
            <Text modifiers={[foregroundStyle(Theme.text), lineLimit(1)]}>{stashSummary(entry)}</Text>
            <Text modifiers={[Type.metaSmall, foregroundStyle(Theme.textMuted)]}>{stashAgo(entry.at)}</Text>
          </VStack>
          <Spacer />
          {entry.images.length ? (
            <Text modifiers={[Type.metaSmallMedium, foregroundStyle(Theme.textMuted), padding({ horizontal: 6, vertical: 2 }), background(Theme.subtle, shapes.capsule())]}>{String(entry.images.length)}</Text>
          ) : null}
        </HStack>
      </Button>
      <SwipeActions.Actions edge="trailing" allowsFullSwipe>
        <Button role="destructive" onPress={onDrop}>
          <Label title="Delete" systemImage="trash" />
        </Button>
      </SwipeActions.Actions>
    </SwipeActions>
  );
}

/** The prompts set aside on this phone; picking one puts it back in the box. */
export function StashSheet({ open, entries, onClose, onPick, onDrop }: Props) {
  return (
    <Host matchContents style={{ position: "absolute" }}>
      <BottomSheet isPresented={open} onIsPresentedChange={(presented) => !presented && onClose()}>
        <NavigationStack modifiers={[presentationDetents(["medium", "large"])]}>
          <Toolbar>
            <Toolbar.Content>
              {entries.length === 0 ? (
                <ContentUnavailableView
                  title="Nothing stashed"
                  systemImage="tray"
                  description="Choose Stash this prompt from the composer's + menu to set a draft aside for another conversation."
                  modifiers={[navigationTitle("Stash"), navigationBarTitleDisplayMode("inline")]}
                />
              ) : (
                <List modifiers={[listStyle("plain"), navigationTitle("Stash"), navigationBarTitleDisplayMode("inline")]}>
                  {entries.map((entry) => (
                    <Row key={entry.id} entry={entry} onPick={() => (onPick(entry), onClose())} onDrop={() => onDrop(entry.id)} />
                  ))}
                </List>
              )}
            </Toolbar.Content>
            <ToolbarItem placement="cancellationAction">
              <Button label="Done" onPress={onClose} />
            </ToolbarItem>
          </Toolbar>
        </NavigationStack>
      </BottomSheet>
    </Host>
  );
}
