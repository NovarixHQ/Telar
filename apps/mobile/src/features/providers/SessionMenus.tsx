import { Button, Label, Menu, Section, Text } from "@expo/ui/swift-ui";
import { disabled } from "@expo/ui/swift-ui/modifiers";
import type { ProviderDriverKind, RuntimeMode, Session } from "@telar/engine-client";
import { choiceOf, type ModelChoice } from "@telar/client/providers";
import type { HostConnection } from "../../platform/connection";
import { setAccessMode, setSessionModel } from "./actions";
import { useModelCatalogue, useProviderInstances } from "./catalogue";
import { accessMenu, modelMenu, providerFamilies, type MenuOption, type ModelMenu } from "./model-menu";

type Props = { host: HostConnection; session: Session; onChanged: (work: Promise<unknown>) => void };

function Option({ option, onPick }: { option: Pick<MenuOption, "label" | "subtitle" | "selected">; onPick: () => void }) {
  const check = option.selected ? ({ systemImage: "checkmark" } as const) : {};
  if (!option.subtitle) return <Button label={option.label} onPress={onPick} {...check} />;
  return (
    <Button onPress={onPick}>
      {option.selected ? <Label title={option.label} systemImage="checkmark" /> : <Text>{option.label}</Text>}
      <Text>{option.subtitle}</Text>
    </Button>
  );
}

const PROVIDERS: { driver: ProviderDriverKind; title: string }[] = [
  { driver: "claude", title: "Claude" },
  { driver: "codex", title: "Codex" },
  { driver: "opencode", title: "OpenCode" },
];

type SectionProps = { host: HostConnection; session: Session; driver: ProviderDriverKind; title: string; menu: ModelMenu | undefined; choose: (next: ModelChoice, instanceId: string) => void };

/** One provider's families; a family on another provider switches the session to it. */
function ProviderSection({ host, session, driver, title, menu, choose }: SectionProps) {
  const own = driver === session.driver;
  const instances = useProviderInstances(host);
  const instanceId = own ? session.providerInstanceId : instances?.find((instance) => instance.enabled && instance.driver === driver)?.id;
  const models = useModelCatalogue(host, driver, own ? undefined : instanceId);
  if (!instanceId) return null;
  const options = own ? menu?.families : models && providerFamilies(models, choiceOf(session.model), menu?.window ?? "standard", driver);
  return (
    <Section title={title}>
      {options ? options.map((option) => <Option key={option.key} option={option} onPick={() => choose(option.choice, instanceId)} />) : <Button label="Loading models…" modifiers={[disabled(true)]} />}
    </Section>
  );
}

/** The model and access menus the composer's plus button carries, as native SwiftUI submenus. */
export function SessionMenus({ host, session, onChanged }: Props) {
  const models = useModelCatalogue(host, session.driver, session.providerInstanceId);
  const choice = choiceOf(session.model);
  const menu = models ? modelMenu(models, choice, session.driver) : undefined;
  const access = accessMenu(session.runtimeMode);
  const choose = (next: ModelChoice, instanceId: string = session.providerInstanceId) => onChanged(setSessionModel(host, session.id, instanceId, next));
  const pickAccess = (mode: RuntimeMode) => mode !== session.runtimeMode && onChanged(setAccessMode(host, session.id, mode));

  return (
    <>
      <Menu label={menu?.label ?? "Model"} systemImage="cpu">
        {PROVIDERS.map(({ driver, title }) => (
          <ProviderSection key={driver} host={host} session={session} driver={driver} title={title} menu={menu} choose={choose} />
        ))}
        {(menu?.sections ?? []).map((section) => (
          <Section key={section.title} title={section.title}>
            {section.options.map((option) => (
              <Option key={option.key} option={option} onPick={() => choose(option.choice)} />
            ))}
          </Section>
        ))}
      </Menu>
      <Menu label={access.label} systemImage="slider.horizontal.3">
        {access.options.map((option) => (
          <Option key={option.value} option={option} onPick={() => pickAccess(option.value)} />
        ))}
      </Menu>
    </>
  );
}
