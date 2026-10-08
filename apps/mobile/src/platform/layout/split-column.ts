import { createContext, useContext } from "react";

export type SplitColumn = {
  /** True inside the iPad sidebar, where rows drop their chevrons and wear the sidebar fill. */
  sidebar: boolean;
  /** The params of the session the detail column shows, to highlight its row. */
  selected?: object;
  sidebarHidden: boolean;
  showSidebar: () => void;
};

export const SplitColumnContext = createContext<SplitColumn>({ sidebar: false, sidebarHidden: false, showSidebar: () => {} });

/** Where the calling screen is drawn: in the iPad sidebar, the detail column, or a phone's single stack. */
export const useSplitColumn = () => useContext(SplitColumnContext);
