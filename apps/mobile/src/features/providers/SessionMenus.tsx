import { Button, Label, Menu, Section, Text } from "@expo/ui/swift-ui";
import { disabled } from "@expo/ui/swift-ui/modifiers";
import type { RuntimeMode, Session } from "@telar/engine-client";
import { choiceOf, type ModelChoice } from "@telar/client/providers";
import type { HostConnection } from "../../platform/connection";
import { setAccessMode, setSessionModel } from "./actions";
import { useModelCatalogue } from "./catalogue";
import { accessMenu, modelMenu, type MenuOption } from "./model-menu";

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

/** The model and access menus the composer's plus button carries, as native SwiftUI submenus. */
export function SessionMenus({ host, session, onChanged }: Props) {
  const models = useModelCatalogue(host, session.driver, session.providerInstanceId);
  const choice = choiceOf(session.model);
  const menu = models ? modelMenu(models, choice, session.driver) : undefined;
  const access = accessMenu(session.runtimeMode);
  const choose = (next: ModelChoice) => onChanged(setSessionModel(host, session.id, session.providerInstanceId, next));
  const pickAccess = (mode: RuntimeMode) => mode !== session.runtimeMode && onChanged(setAccessMode(host, session.id, mode));

  return (
    <>
      <Menu label={menu?.label ?? "Model"} systemImage="cpu">
        <Section>
          {menu ? menu.families.map((option) => <Option key={option.key} option={option} onPick={() => choose(option.choice)} />) : <Button label="Loading models…" modifiers={[disabled(true)]} />}
        </Section>
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
