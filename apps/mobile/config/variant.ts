export type AppVariant = {
  name: string;
  bundleId: string;
  icon: string;
  apsEnvironment: "production" | "development";
};

const RELEASE: AppVariant = {
  name: "Telar",
  bundleId: "io.github.novarix.telar",
  icon: "./assets/icon.png",
  apsEnvironment: "production",
};

const DEV: AppVariant = {
  name: "Telar Dev",
  bundleId: "io.github.novarix.telar.dev",
  icon: "./assets/icon-dev.png",
  apsEnvironment: "development",
};

/** `APP_VARIANT=dev` is the cable build that sits beside the TestFlight app; anything else is the release app. */
export function appVariant(value: string | undefined): AppVariant {
  return value === "dev" ? DEV : RELEASE;
}
