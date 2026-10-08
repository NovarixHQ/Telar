import type { ExpoConfig } from "expo/config";
import { appVariant } from "./config/variant.ts";

const variant = appVariant(process.env.APP_VARIANT);

const config: ExpoConfig = {
  name: variant.name,
  slug: "telar",
  scheme: "telar",
  version: "0.1.0",
  icon: variant.icon,
  userInterfaceStyle: "automatic",
  platforms: ["ios"],
  ios: {
    bundleIdentifier: variant.bundleId,
    supportsTablet: true,
    infoPlist: {
      CFBundleDisplayName: variant.name,
      ITSAppUsesNonExemptEncryption: false,
      // Hosts are dialed over plain http on tailnet 100.x addresses, which ATS cannot except by domain.
      NSAppTransportSecurity: { NSAllowsArbitraryLoads: true },
      NSLocalNetworkUsageDescription:
        "Telar talks to the cockpit on your computer over your local network when you pair by its LAN address.",
      UIDesignRequiresCompatibility: false,
    },
  },
  plugins: [["expo-build-properties", { ios: { deploymentTarget: "18.0" } }]],
};

export default config;
