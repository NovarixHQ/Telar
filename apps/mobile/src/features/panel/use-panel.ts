import { useSyncExternalStore } from "react";
import { Settings } from "react-native";
import { createPanelModel, panelKey, type PanelModel, type PanelState } from "./model";

const defaults = { get: (key: string): unknown => Settings.get(key), set: (key: string, value: string) => Settings.set({ [key]: value }) };
const models = new Map<string, PanelModel>();

/** The one panel model for a session, shared by its header button, a pushed page and an iPad column. */
function panelFor(hostId: string, sessionId: string): PanelModel {
  const key = panelKey(hostId, sessionId);
  let model = models.get(key);
  if (!model) {
    model = createPanelModel(key, defaults);
    models.set(key, model);
  }
  return model;
}

export function usePanel(hostId: string, sessionId: string): { panel: PanelModel; state: PanelState } {
  const panel = panelFor(hostId, sessionId);
  const state = useSyncExternalStore(panel.subscribe, panel.state);
  return { panel, state };
}
