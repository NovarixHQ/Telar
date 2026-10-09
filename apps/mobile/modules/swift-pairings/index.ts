import { requireOptionalNativeModule } from "expo";

/** What the earlier Swift app saved: its host book's JSON and each host's Keychain token. Null in tests and older builds. */
export type SwiftPairingsModule = {
  hosts(): string | null;
  token(account: string): string | null;
};

export const swiftPairings = requireOptionalNativeModule<SwiftPairingsModule>("TelarSwiftPairings");
