import { CORE_TABS, isPanelTab, type PanelTab } from "./tabs";

export type PanelState = { isOpen: boolean; tabs: PanelTab[]; active: PanelTab | undefined };

/** Where a panel's state is kept between launches: UserDefaults in the app, a map in tests. */
export type PanelStorage = { get(key: string): unknown; set(key: string, value: string): void };

export type PanelModel = {
  state(): PanelState;
  subscribe(listener: () => void): () => void;
  open(tab?: PanelTab): void;
  close(): void;
  select(tab: PanelTab): void;
  closeTab(tab: PanelTab): void;
  openable(): PanelTab[];
};

export const panelKey = (hostId: string, sessionId: string) => `telar.panel.${hostId}.${sessionId}`;

function restorePanel(raw: unknown): PanelState {
  let saved: Partial<Record<keyof PanelState, unknown>> = {};
  try {
    if (typeof raw === "string") saved = JSON.parse(raw) as typeof saved;
  } catch {}
  const tabs = Array.isArray(saved.tabs) ? [...new Set(saved.tabs.filter(isPanelTab))] : [];
  const active = isPanelTab(saved.active) && tabs.includes(saved.active) ? saved.active : tabs[0];
  return { isOpen: saved.isOpen === true && tabs.length > 0, tabs, active };
}

/** One session's panel: its tabs, the active one and whether it is open, saved on every change. */
export function createPanelModel(key: string, storage: PanelStorage): PanelModel {
  let state = restorePanel(storage.get(key));
  const listeners = new Set<() => void>();
  const commit = (next: PanelState) => {
    state = next;
    storage.set(key, JSON.stringify(state));
    listeners.forEach((listener) => listener());
  };
  return {
    state: () => state,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    open(tab) {
      const tabs = tab && !state.tabs.includes(tab) ? [...state.tabs, tab] : state.tabs;
      commit({ isOpen: true, tabs, active: tab ?? state.active });
    },
    close() {
      if (state.isOpen) commit({ ...state, isOpen: false });
    },
    select(tab) {
      if (state.active !== tab && state.tabs.includes(tab)) commit({ ...state, active: tab });
    },
    closeTab(tab) {
      const index = state.tabs.indexOf(tab);
      if (index < 0) return;
      const tabs = state.tabs.filter((other) => other !== tab);
      commit({ ...state, tabs, active: state.active === tab ? (tabs[index] ?? tabs.at(-1)) : state.active });
    },
    openable: () => CORE_TABS.filter((tab) => !state.tabs.includes(tab)),
  };
}
