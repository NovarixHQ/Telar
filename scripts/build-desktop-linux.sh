#!/usr/bin/env bash
# Build the Linux desktop app (AppImage and .deb) for this machine's architecture
# from the working tree, into apps/desktop/release/. It never uploads anything.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
CHANNEL=""
VERSION_OVERRIDE=""
FEED_PREFIX=""

usage() {
  cat <<'HELP'
Usage: build-desktop-linux.sh [--channel beta|nightly] [--version X.Y.Z-channel.N]
                              [--feed-prefix <key prefix>]

Builds Telar-<version>-linux-<arch>.AppImage and .deb for the architecture of
this machine (x64 or arm64) into apps/desktop/release/, plus the electron-updater
feed file <channel>-linux.yml (or -linux-arm64.yml) when --channel is given.
--feed-prefix bakes $UPDATE_PROXY_URL/<prefix> and $UPDATE_PROXY_KEY into the
app so it updates from the published feed. Nothing is uploaded.

Run the packaged app's smoke afterwards:
  xvfb-run -a node apps/desktop/test/electron/linux-smoke.js apps/desktop/release/linux-unpacked/telar
(linux-arm64-unpacked on arm64)
HELP
}

while [ $# -gt 0 ]; do
  case "$1" in
    --channel) CHANNEL="${2:-}"; shift 2 ;;
    --version) VERSION_OVERRIDE="${2:-}"; shift 2 ;;
    --feed-prefix) FEED_PREFIX="${2:-}"; shift 2 ;;
    -h|--help) usage; exit 0 ;;
    *) echo "build-desktop-linux: unknown option: $1" >&2; usage >&2; exit 2 ;;
  esac
done

[ "$(uname -s)" = "Linux" ] || { echo "build-desktop-linux: this builds on Linux only" >&2; exit 1; }
case "$CHANNEL" in ""|beta|nightly) ;; *) echo "build-desktop-linux: --channel must be beta or nightly" >&2; exit 2 ;; esac
# shellcheck source=feed-prefix.sh
. "$SCRIPT_DIR/feed-prefix.sh"
if [ -n "$FEED_PREFIX" ]; then
  feed_prefix_valid "$FEED_PREFIX" || { echo "build-desktop-linux: --feed-prefix '$FEED_PREFIX' is not a relative key path" >&2; exit 2; }
  [ -n "$CHANNEL" ] || { echo "build-desktop-linux: --feed-prefix needs --channel" >&2; exit 2; }
  for v in UPDATE_PROXY_URL UPDATE_PROXY_KEY; do
    [ -n "${!v:-}" ] || { echo "build-desktop-linux: --feed-prefix needs \$$v set" >&2; exit 2; }
  done
fi
case "$(uname -m)" in
  x86_64) ARCH=x64 ;;
  aarch64|arm64) ARCH=arm64 ;;
  *) echo "build-desktop-linux: unsupported architecture $(uname -m)" >&2; exit 1 ;;
esac

cd "$REPO_ROOT"
log() { printf '==> %s\n' "$*"; }

log "bun install --frozen-lockfile"
NODE_OPTIONS= bun install --frozen-lockfile

log "apps/desktop/scripts/build-app.sh (static cockpit, engine bundle, node-pty)"
NODE_OPTIONS= bash apps/desktop/scripts/build-app.sh

SHA="$(git rev-parse HEAD)"
cat > apps/web/build-info.json <<JSON
{
  "shortSha": "$(git rev-parse --short HEAD)",
  "sha": "$SHA",
  "ref": "$(git rev-parse --abbrev-ref HEAD)",
  "channel": "$CHANNEL",
  "commitDate": "$(git show -s --format=%cI HEAD)",
  "builtAt": "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
}
JSON

OVERRIDES=()
if [ -n "$CHANNEL" ]; then
  if [ -n "$VERSION_OVERRIDE" ]; then
    VERSION="$(NODE_OPTIONS= node scripts/set-desktop-version.mjs --channel "$CHANNEL" --version "$VERSION_OVERRIDE")"
  else
    VERSION="$(NODE_OPTIONS= node scripts/set-desktop-version.mjs --channel "$CHANNEL")"
  fi
  log "channel '$CHANNEL' -> version $VERSION"
  OVERRIDES+=("-c.publish.channel=$CHANNEL")
fi
if [ -n "$FEED_PREFIX" ]; then
  OVERRIDES+=("-c.publish.url=$(feed_publish_url "$UPDATE_PROXY_URL" "$FEED_PREFIX")" "-c.extraMetadata.updateProxyKey=$UPDATE_PROXY_KEY")
fi

log "electron-builder --linux AppImage deb --$ARCH"
cd apps/desktop
NODE_OPTIONS= bunx electron-builder --linux AppImage deb "--$ARCH" --publish never ${OVERRIDES[@]+"${OVERRIDES[@]}"}

UNPACKED="release/linux-unpacked"
[ "$ARCH" = "arm64" ] && UNPACKED="release/linux-arm64-unpacked"
[ -x "$UNPACKED/telar" ] || { echo "build-desktop-linux: expected $UNPACKED/telar" >&2; exit 1; }

echo "BUILD OK $ARCH"
ls -1 release | grep -E '\.(AppImage|deb)$|-linux.*\.yml$' || true
