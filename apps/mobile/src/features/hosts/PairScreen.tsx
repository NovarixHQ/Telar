import { Button, Form, Host, ProgressView, Section, Text, TextField } from "@expo/ui/swift-ui";
import { disabled, foregroundStyle } from "@expo/ui/swift-ui/modifiers";
import { useNavigation, useRoute, type NavigationProp, type RouteProp } from "@react-navigation/native";
import { useEffect, useRef, useState } from "react";
import type { RootStack } from "../../platform/navigation/routes";
import { pair } from "./pairing";
import { rememberHost } from "./registry";
import { thisDevice } from "./this-device";

export function PairScreen() {
  const { params } = useRoute<RouteProp<RootStack, "Pair">>();
  const navigation = useNavigation<NavigationProp<RootStack>>();
  const [link, setLink] = useState(params?.link ?? "");
  const [pairing, setPairing] = useState(false);
  const [problem, setProblem] = useState<string>();

  const submit = async (text: string) => {
    setPairing(true);
    setProblem(undefined);
    const outcome = await pair(text, await thisDevice());
    setPairing(false);
    if (!outcome.ok) return setProblem(outcome.message);
    await rememberHost(outcome.host);
    if (navigation.canGoBack()) navigation.goBack();
    else navigation.navigate("Hosts");
  };

  const opened = useRef(false);
  useEffect(() => {
    if (params?.link && !opened.current) {
      opened.current = true;
      void submit(params.link);
    }
  });

  return (
    <Host style={{ flex: 1 }}>
      <Form>
        <Section title="Pairing link" footer={<Text>The link is on the computer, in Settings → Connections.</Text>}>
          <TextField placeholder="Paste the pairing link" autoFocus={!params?.link} onTextChange={setLink} />
        </Section>
        <Section>
          {pairing ? (
            <ProgressView />
          ) : (
            <Button label="Pair" onPress={() => void submit(link)} modifiers={[disabled(link.trim() === "")]} />
          )}
          {problem ? <Text modifiers={[foregroundStyle("red")]}>{problem}</Text> : null}
        </Section>
      </Form>
    </Host>
  );
}
