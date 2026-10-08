import { Alert, Button, Text, TextField, useNativeState } from "@expo/ui/swift-ui";
import { autocorrectionDisabled, keyboardType, textInputAutocapitalization } from "@expo/ui/swift-ui/modifiers";
import { useEffect, useRef, type ReactNode } from "react";

/** Swift's system alert for a pasted pairing link, attached to the control that opens it. */
export function PasteLinkAlert({ presented, onPresentedChange, onPair, children }: { presented: boolean; onPresentedChange: (presented: boolean) => void; onPair: (link: string) => void; children: ReactNode }) {
  const text = useNativeState("");
  const typed = useRef("");
  useEffect(() => {
    if (!presented) return;
    text.value = "";
    typed.current = "";
  }, [presented, text]);
  return (
    <Alert title="Paste the pairing link" isPresented={presented} onIsPresentedChange={onPresentedChange}>
      <Alert.Trigger>{children}</Alert.Trigger>
      <Alert.Actions>
        <TextField
          placeholder="http://…/pair#token=…"
          text={text}
          onTextChange={(value) => (typed.current = value)}
          modifiers={[keyboardType("url"), autocorrectionDisabled(), textInputAutocapitalization("never")]}
        />
        <Button label="Pair" onPress={() => onPair(typed.current)} />
        <Button label="Cancel" role="cancel" />
      </Alert.Actions>
      <Alert.Message>
        <Text>Copy it from under the QR in the computer's Connections settings.</Text>
      </Alert.Message>
    </Alert>
  );
}
