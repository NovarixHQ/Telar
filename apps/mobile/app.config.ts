import { cpSync, readdirSync } from "node:fs";
import { join } from "node:path";
import type { ExpoConfig } from "expo/config";
import { withDangerousMod, type ConfigPlugin } from "expo/config-plugins";
import { appVariant } from "./config/variant.ts";

// The provider marks and logo are asset-catalog images so SwiftUI can draw them by name.
const withCatalogImages: ConfigPlugin = (config) =>
  withDangerousMod(config, [
    "ios",
    (modConfig) => {
      const { projectRoot, platformProjectRoot, projectName } = modConfig.modRequest;
      const source = join(projectRoot, "assets/catalog");
      const catalog = join(platformProjectRoot, projectName ?? "", "Images.xcassets");
      for (const imageset of readdirSync(source)) cpSync(join(source, imageset), join(catalog, imageset), { recursive: true });
      return modConfig;
    },
  ]);

const variant = appVariant(process.env.APP_VARIANT);
const MICROPHONE = "Telar sends what you say to the transcription service your computer is set up with, so it can be typed into the message box.";

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
    appleTeamId: "MM74W7WGAM",
    // The nightly mints a minute-stamp here; TestFlight refuses a build number it has seen.
    buildNumber: process.env.TELAR_BUILD_NUMBER ?? "1",
    supportsTablet: true,
    // Live Activity push tokens need it; distribution signing switches it to production.
    entitlements: { "aps-environment": "development" },
    infoPlist: {
      CFBundleDisplayName: variant.name,
      ITSAppUsesNonExemptEncryption: false,
      // Hosts are dialed over plain http on tailnet 100.x addresses, which ATS cannot except by domain.
      NSAppTransportSecurity: { NSAllowsArbitraryLoads: true },
      NSSupportsLiveActivities: true,
      NSSupportsLiveActivitiesFrequentUpdates: true,
      NSLocalNetworkUsageDescription:
        "Telar talks to the cockpit on your computer over your local network when you pair by its LAN address.",
      UIDesignRequiresCompatibility: false,
    },
  },
  plugins: [
    "@bacons/apple-targets",
    ["expo-build-properties", { ios: { deploymentTarget: "18.0" } }],
    ["expo-camera", { cameraPermission: "Telar scans the pairing code shown in the cockpit's Connections settings.", microphonePermission: MICROPHONE, recordAudioAndroid: false }],
    ["expo-audio", { microphonePermission: MICROPHONE, recordAudioAndroid: false }],
    ["expo-image-picker", { photosPermission: false, microphonePermission: MICROPHONE, cameraPermission: "Telar takes the photos you attach to a message." }],
  ],
};

export default withCatalogImages(config);
