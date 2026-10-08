import { BottomSheet, Button, Form, Host, NavigationStack, Section, TextField, Toolbar, ToolbarItem } from "@expo/ui/swift-ui";
import { navigationBarTitleDisplayMode, navigationTitle, presentationDetents } from "@expo/ui/swift-ui/modifiers";
import { useState } from "react";

type Props = { open: boolean; onCancel: () => void; onDecline: (reason: string | undefined) => void };

/** Asks why before declining; the reason is optional and goes back to the agent. */
export function DeclineSheet({ open, onCancel, onDecline }: Props) {
  const [reason, setReason] = useState("");
  const close = () => (setReason(""), onCancel());
  return (
    <Host matchContents style={{ position: "absolute" }}>
      <BottomSheet isPresented={open} onIsPresentedChange={(presented) => !presented && close()}>
        <NavigationStack modifiers={[presentationDetents(["medium"])]}>
          <Toolbar>
            <Toolbar.Content>
              <Form modifiers={[navigationTitle("Decline"), navigationBarTitleDisplayMode("inline")]}>
                <Section title="Why? (optional — fed back to the agent)">
                  <TextField placeholder="Reason" axis="vertical" onTextChange={setReason} />
                </Section>
              </Form>
            </Toolbar.Content>
            <ToolbarItem placement="cancellationAction">
              <Button label="Cancel" onPress={close} />
            </ToolbarItem>
            <ToolbarItem placement="confirmationAction">
              <Button
                label="Decline"
                onPress={() => {
                  const why = reason.trim();
                  setReason("");
                  onDecline(why || undefined);
                }}
              />
            </ToolbarItem>
          </Toolbar>
        </NavigationStack>
      </BottomSheet>
    </Host>
  );
}
