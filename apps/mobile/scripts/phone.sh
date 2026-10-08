#!/usr/bin/env bash
# Build and install "Telar Dev" on a cable-connected iPhone, beside the TestFlight app.
set -euo pipefail

DEVICE="${TELAR_IPHONE_UDID:-00008150-001A7DC2367B401C}"
TEAM="${DEVELOPMENT_TEAM:-MM74W7WGAM}"
DIR="$(cd "$(dirname "$0")/.." && pwd)"
export DEVELOPER_DIR="${DEVELOPER_DIR:-/Applications/Xcode.app/Contents/Developer}"

CONFIG=Release
BUNDLE=io.github.novarix.telar.dev
DERIVED="$DIR/build/DerivedData"

cd "$DIR"
APP_VARIANT=dev EXPO_NO_GIT_STATUS=1 bunx expo prebuild --clean --platform ios --no-install
(cd ios && pod install)

xcodebuild \
  -workspace "ios/TelarDev.xcworkspace" -scheme TelarDev \
  -configuration "$CONFIG" \
  -destination "platform=iOS,id=$DEVICE" \
  -derivedDataPath "$DERIVED" \
  -allowProvisioningUpdates -allowProvisioningDeviceRegistration \
  DEVELOPMENT_TEAM="$TEAM" \
  build

APP="$DERIVED/Build/Products/$CONFIG-iphoneos/TelarDev.app"
xcrun devicectl device install app --device "$DEVICE" "$APP"
xcrun devicectl device process launch --device "$DEVICE" "$BUNDLE" || true
echo "installed Telar Dev ($BUNDLE, $CONFIG)"
