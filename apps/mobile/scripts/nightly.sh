#!/usr/bin/env bash
# Archive the Expo app (release variant) and upload it to TestFlight. CI calls it
# from .github/workflows/nightly-ios.yml on an ios-nightly-* tag.
#   (no argument)   prebuild → archive → export → upload → offer to external testers.
#   --no-upload     archive only; needs no credentials, so it runs by hand.
#   --export-only   archive → export, stops before altool (ios-export-probe.yml).
# Credentials: TELAR_ASC_KEY_ID, TELAR_ASC_ISSUER_ID, TELAR_ASC_KEY_PATH (the .p8).
# TELAR_DERIVED_DATA moves the build folder; archives and exports stay under the script's own folder.
set -euo pipefail

# The default publishes, so a misspelt flag must not fall through to it.
MODE="${1:-}"
case "$MODE" in
  "" | --no-upload | --export-only) ;;
  *) echo "usage: $(basename "$0") [--no-upload | --export-only]" >&2; exit 2 ;;
esac

DIR="$(cd "$(dirname "$0")" && pwd)"
MOBILE="$(dirname "$DIR")"
OUT="$MOBILE/DerivedData-nightly"
TEAM="${DEVELOPMENT_TEAM:-MM74W7WGAM}"
BUILD_NUMBER="$(date +%Y%m%d%H%M)"
ARCHIVE="$OUT/Telar-$BUILD_NUMBER.xcarchive"
EXPORT_DIR="$OUT/export-$BUILD_NUMBER"
if [[ -z "${DEVELOPER_DIR:-}" && -d /Applications/Xcode.app ]]; then
  export DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer
fi

# The build number goes in through app.config.ts, so the generated Info.plist is never edited.
(
  cd "$MOBILE"
  unset APP_VARIANT
  TELAR_BUILD_NUMBER="$BUILD_NUMBER" CI=1 bunx expo prebuild --clean --platform ios --no-install
  cd ios
  pod install
)
WORKSPACE="$(ls -d "$MOBILE"/ios/*.xcworkspace | head -1)"
SCHEME="$(basename "$WORKSPACE" .xcworkspace)"

# Unsigned: the runner has a distribution certificate but no development one. Signing happens below and in the export.
xcodebuild \
  -workspace "$WORKSPACE" -scheme "$SCHEME" \
  -configuration Release \
  -destination "generic/platform=iOS" \
  -derivedDataPath "${TELAR_DERIVED_DATA:-$OUT}" \
  -archivePath "$ARCHIVE" \
  DEVELOPMENT_TEAM="$TEAM" \
  CODE_SIGNING_ALLOWED=NO \
  archive

APP="$(ls -d "$ARCHIVE"/Products/Applications/*.app | head -1)"
APP_NAME="$(basename "$APP")"
if [[ "$(/usr/libexec/PlistBuddy -c 'Print :CFBundleVersion' "$APP/Info.plist")" != "$BUILD_NUMBER" ]]; then
  echo "archived app's CFBundleVersion is not $BUILD_NUMBER — the build number did not reach the prebuild" >&2
  exit 1
fi

# Prints the entitlement names (never values) to stderr and aps-environment's value to stdout.
aps_environment_of() {
  local app="$1" label="$2" plist value
  plist="$(mktemp)"
  codesign -d --entitlements :- "$app" > "$plist" 2>/dev/null || true
  if [[ -s "$plist" ]]; then
    echo "$label entitlements: $(/usr/bin/plutil -convert json -o - "$plist" 2>/dev/null | /usr/bin/python3 -c 'import json,sys; print(" ".join(sorted(json.load(sys.stdin))) or "<none>")' 2>/dev/null || echo "<unreadable>")" >&2
  else
    echo "$label entitlements: <none>" >&2
  fi
  value="$(/usr/libexec/PlistBuddy -c "Print :aps-environment" "$plist" 2>/dev/null)" || value=""
  rm -f "$plist"
  echo "$value"
}

# Entitlements live in the code signature and the export keeps only what the archive carries,
# so the unsigned app is signed ad hoc with the entitlements prebuild generated.
ENTITLEMENTS_SETTING="$(xcodebuild -workspace "$WORKSPACE" -scheme "$SCHEME" -configuration Release -showBuildSettings 2>/dev/null | awk -F' = ' '/^ *CODE_SIGN_ENTITLEMENTS = /{print $2; exit}')"
ENTITLEMENTS="$(mktemp)"
if [[ -n "$ENTITLEMENTS_SETTING" ]]; then
  cp "$MOBILE/ios/$ENTITLEMENTS_SETTING" "$ENTITLEMENTS"
  if grep -q '\$(' "$ENTITLEMENTS"; then
    echo "$ENTITLEMENTS_SETTING has an unexpanded build setting; ad hoc signing would embed it literally" >&2
    exit 1
  fi
else
  /usr/bin/plutil -create xml1 "$ENTITLEMENTS"
fi
DECLARED_APS="$(/usr/libexec/PlistBuddy -c "Print :aps-environment" "$ENTITLEMENTS" 2>/dev/null)" || DECLARED_APS=""
for nested in "$APP"/PlugIns/*.appex "$APP"/Frameworks/*; do
  if [[ -e "$nested" ]]; then codesign --force --sign - --timestamp=none "$nested"; fi
done
codesign --force --sign - --timestamp=none --entitlements "$ENTITLEMENTS" "$APP"
rm -f "$ENTITLEMENTS"
codesign --verify --deep --strict "$APP"

ARCHIVED_APS="$(aps_environment_of "$APP" "archived app")"
if [[ "$ARCHIVED_APS" != "$DECLARED_APS" ]]; then
  echo "archived app has aps-environment='${ARCHIVED_APS:-<missing>}', the prebuild declared '${DECLARED_APS:-<missing>}'" >&2
  exit 1
fi

if [[ "$MODE" == "--no-upload" ]]; then
  echo "archived $ARCHIVE (export and upload skipped)"
  exit 0
fi

: "${TELAR_ASC_KEY_ID:?set TELAR_ASC_KEY_ID (App Store Connect API key id)}"
: "${TELAR_ASC_ISSUER_ID:?set TELAR_ASC_ISSUER_ID}"
: "${TELAR_ASC_KEY_PATH:?set TELAR_ASC_KEY_PATH (path to the .p8)}"

# The export stages the IPA with /usr/bin/rsync but resolves the server half from PATH;
# a Homebrew rsync there speaks another dialect and the export dies with "Copy failed" (#757).
PATH="/usr/bin:/bin:$PATH" xcodebuild \
  -exportArchive \
  -archivePath "$ARCHIVE" \
  -exportOptionsPlist "$DIR/ExportOptions.plist" \
  -exportPath "$EXPORT_DIR" \
  -allowProvisioningUpdates \
  -authenticationKeyID "$TELAR_ASC_KEY_ID" \
  -authenticationKeyIssuerID "$TELAR_ASC_ISSUER_ID" \
  -authenticationKeyPath "$TELAR_ASC_KEY_PATH"

IPA="$EXPORT_DIR/${APP_NAME%.app}.ipa"
# The re-sign drops what the distribution profile does not grant; without aps-environment=production push never arrives.
if [[ -n "$DECLARED_APS" ]]; then
  IPA_CHECK="$(mktemp -d)"
  ditto -x -k "$IPA" "$IPA_CHECK"
  APS_ENVIRONMENT="$(aps_environment_of "$IPA_CHECK/Payload/$APP_NAME" "exported IPA")"
  rm -rf "$IPA_CHECK"
  if [[ "$APS_ENVIRONMENT" != "production" ]]; then
    echo "exported IPA has aps-environment='${APS_ENVIRONMENT:-<missing>}', expected 'production' — push would never arrive" >&2
    exit 1
  fi
  echo "exported IPA has aps-environment=production"
fi

if [[ "$MODE" == "--export-only" ]]; then
  ls -l "$IPA"
  echo "exported $IPA (upload skipped)"
  exit 0
fi

# Before the upload, so a missing app record fails before a build is spent on it.
"$DIR/testflight-app.sh"

# altool finds keys by name in a directory, not by path.
KEYS_DIR="$(mktemp -d)/private_keys"
mkdir -p "$KEYS_DIR"
cp "$TELAR_ASC_KEY_PATH" "$KEYS_DIR/AuthKey_$TELAR_ASC_KEY_ID.p8"
trap 'rm -rf "$(dirname "$KEYS_DIR")"' EXIT
export API_PRIVATE_KEYS_DIR="$KEYS_DIR"

# altool can print a validation ERROR and still exit 0, so its output is the verdict.
UPLOAD_LOG=$(mktemp)
xcrun altool --upload-app \
  -f "$IPA" -t ios \
  --apiKey "$TELAR_ASC_KEY_ID" --apiIssuer "$TELAR_ASC_ISSUER_ID" 2>&1 | tee "$UPLOAD_LOG"
if grep -q "ERROR" "$UPLOAD_LOG" || ! grep -q "UPLOAD SUCCEEDED" "$UPLOAD_LOG"; then
  echo "upload FAILED — see altool output above" >&2
  exit 1
fi

echo "uploaded build $BUILD_NUMBER — internal testers get it after processing (minutes)"
"$DIR/testflight-external.sh" "$BUILD_NUMBER"
