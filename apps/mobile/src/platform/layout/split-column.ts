import { createContext, useContext, type ReactNode } from "react";

/** What a detail screen draws beside the card: the column, given the width the card and it share, and whether it covers the card. */
export type SplitAside = { render: (total: number) => ReactNode; full: boolean };

export type SplitColumn = {
  /** True inside the iPad sidebar, where rows drop their chevrons and wear the sidebar fill. */
  sidebar: boolean;
  /** True inside the iPad split, where the detail column is a card and owns no aside of its own. */
  split: boolean;
  /** The params of the session the detail column shows, to highlight its row. */
  selected?: object;
  sidebarHidden: boolean;
  showSidebar: () => void;
  setSidebarHidden: (hidden: boolean) => void;
  setAside: (aside: SplitAside | undefined) => void;
};

export const SplitColumnContext = createContext<SplitColumn>({ sidebar: false, split: false, sidebarHidden: false, showSidebar: () => {}, setSidebarHidden: () => {}, setAside: () => {} });

/** Where the calling screen is drawn: in the iPad sidebar, the detail column, or a phone's single stack. */
export const useSplitColumn = () => useContext(SplitColumnContext);
