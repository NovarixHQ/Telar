import { requireOptionalNativeModule } from "expo";

/** Quick Look over the app; false when there is no screen to show it on. Null in tests and older builds. */
export type QuickLookModule = { preview(uri: string): Promise<boolean> };

export const quickLook = requireOptionalNativeModule<QuickLookModule>("TelarQuickLook");
