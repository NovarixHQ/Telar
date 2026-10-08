import type { Session } from "@telar/engine-client";
import { ActionSheetIOS, Pressable, StyleSheet, Text, View } from "react-native";
import type { HostConnection } from "../../platform/connection";
import { setAccessMode, setSessionModel } from "./actions";
import { useModelCatalogue } from "./catalogue";
import { accessMenu, chooseFamily, modelMenu, type MenuOption } from "./model-menu";

type Props = { host: HostConnection; session: Session; onChanged: (work: Promise<unknown>) => void };

function pick<T>(title: string, options: MenuOption<T>[], onPick: (value: T) => void): void {
  ActionSheetIOS.showActionSheetWithOptions(
    { title, options: [...options.map((option) => (option.selected ? `✓ ${option.label}` : option.label)), "Cancel"], cancelButtonIndex: options.length },
    (index) => {
      const option = options[index];
      if (option && !option.selected) onPick(option.value);
    },
  );
}

/** The model, effort and access mode of the session, each a native sheet away. */
export function SessionControls({ host, session, onChanged }: Props) {
  const models = useModelCatalogue(host, session.driver, session.providerInstanceId);
  const selection = session.model;
  const menu = models ? modelMenu(models, selection) : undefined;
  const access = accessMenu(session.runtimeMode);
  const choose = (choice: Parameters<typeof setSessionModel>[3]) => onChanged(setSessionModel(host, session.id, session.providerInstanceId, choice));

  const openEffort = () => {
    if (!menu) return;
    pick("Reasoning", menu.efforts, (effort) => choose({ ...(selection?.model ? { model: selection.model } : {}), ...(effort ? { effort } : {}) }));
  };
  const openModel = () => {
    if (!menu || !models) return;
    const reasoning: MenuOption<string> = { value: "", label: "Reasoning…", selected: false };
    const options = menu.efforts.length > 0 ? [...menu.families, reasoning] : menu.families;
    pick("Model", options, (familyId) => (familyId ? choose(chooseFamily(models, selection, familyId)) : openEffort()));
  };

  return (
    <View style={styles.row}>
      <Pressable accessibilityRole="button" accessibilityLabel="Model" onPress={openModel} style={styles.pill}>
        <Text style={styles.label} numberOfLines={1}>{menu?.label ?? "Model"}</Text>
      </Pressable>
      <Pressable accessibilityRole="button" accessibilityLabel="Access" onPress={() => pick("Access", access.options, (mode) => onChanged(setAccessMode(host, session.id, mode)))} style={styles.pill}>
        <Text style={styles.label}>{access.label}</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", gap: 6, paddingHorizontal: 10, paddingTop: 6, backgroundColor: "white" },
  pill: { maxWidth: 200, paddingHorizontal: 10, paddingVertical: 5, borderRadius: 13, backgroundColor: "#F2F2F7" },
  label: { fontSize: 13, color: "#3A3A3C", fontWeight: "500" },
});
