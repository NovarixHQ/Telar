import { createContext, useContext } from "react";
import type { ColorValue } from "react-native";

export type RailLayout = { sidebar: boolean; rowFill?: ColorValue; selected?: { hostId: string; sessionId: string } };

/** @public The iPad split view provides `sidebar: true`: rows lose the chevron, wear `rowFill` and fill the selected row with the accent. */
export const RailLayoutContext = createContext<RailLayout>({ sidebar: false });

export const useRailLayout = () => useContext(RailLayoutContext);
