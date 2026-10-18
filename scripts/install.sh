#!/bin/sh
# Installs the telar CLI into ~/.telar/runtime and links it from ~/.local/bin.
#   sh install.sh [--channel stable|nightly] [--version <v>] [--base <url>]
# Needs only sh, tar, curl or wget, and sha256sum or shasum.
set -eu

BASE="${TELAR_DOWNLOAD_BASE:-https://downloads.example.invalid/telar}"
CHANNEL="stable"
VERSION=""
RUNTIME="${TELAR_RUNTIME:-$HOME/.telar/runtime}"
BIN_DIR="${TELAR_BIN_DIR:-$HOME/.local/bin}"

die() { echo "telar install: $*" >&2; exit 1; }

while [ $# -gt 0 ]; do
  case "$1" in
    --channel) [ $# -ge 2 ] || die "--channel needs a value"; CHANNEL="$2"; shift 2 ;;
    --version) [ $# -ge 2 ] || die "--version needs a value"; VERSION="$2"; shift 2 ;;
    --base) [ $# -ge 2 ] || die "--base needs a value"; BASE="$2"; shift 2 ;;
    -h|--help) sed -n '2,5p' "$0"; exit 0 ;;
    *) die "unknown option: $1" ;;
  esac
done

case "$CHANNEL" in stable|nightly) ;; *) die "--channel must be stable or nightly" ;; esac
case "$BASE" in *example.invalid*) die "no download host is configured; pass --base <url> or set TELAR_DOWNLOAD_BASE" ;; esac
BASE="${BASE%/}"

case "$(uname -s)-$(uname -m)" in
  Linux-x86_64|Linux-amd64) TARGET="linux-x64" ;;
  Linux-aarch64|Linux-arm64) TARGET="linux-arm64" ;;
  Darwin-arm64) TARGET="darwin-arm64" ;;
  *) die "no build for $(uname -s) $(uname -m)" ;;
esac

if command -v curl >/dev/null 2>&1; then
  fetch() { curl -fsSL "$1" -o "$2"; }
elif command -v wget >/dev/null 2>&1; then
  fetch() { wget -q "$1" -O "$2"; }
else
  die "curl or wget is required"
fi

if command -v sha256sum >/dev/null 2>&1; then
  sha256() { sha256sum "$1" | cut -d ' ' -f 1; }
elif command -v shasum >/dev/null 2>&1; then
  sha256() { shasum -a 256 "$1" | cut -d ' ' -f 1; }
else
  die "sha256sum or shasum is required"
fi

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT INT TERM

if [ -z "$VERSION" ]; then
  fetch "$BASE/$CHANNEL" "$WORK/version" || die "could not read the $CHANNEL version from $BASE/$CHANNEL"
  VERSION="$(tr -d ' \r\n' < "$WORK/version")"
fi
case "$VERSION" in ""|*[!A-Za-z0-9._+-]*) die "invalid version: $VERSION" ;; esac

ARCHIVE="telar-$VERSION-$TARGET.tar.gz"
echo "Installing telar $VERSION ($TARGET)"
fetch "$BASE/$VERSION/$ARCHIVE" "$WORK/$ARCHIVE" || die "could not download $BASE/$VERSION/$ARCHIVE"
fetch "$BASE/$VERSION/$ARCHIVE.sha256" "$WORK/$ARCHIVE.sha256" || die "could not download the checksum"

EXPECTED="$(cut -d ' ' -f 1 < "$WORK/$ARCHIVE.sha256")"
ACTUAL="$(sha256 "$WORK/$ARCHIVE")"
[ "$EXPECTED" = "$ACTUAL" ] || die "checksum mismatch for $ARCHIVE (expected $EXPECTED, got $ACTUAL)"

mkdir -p "$RUNTIME/versions" "$BIN_DIR"
STAGE="$RUNTIME/versions/.$VERSION.$$"
rm -rf "$STAGE"
mkdir -p "$STAGE"
tar -xzf "$WORK/$ARCHIVE" -C "$STAGE"
[ -x "$STAGE/telar" ] || { rm -rf "$STAGE"; die "the archive has no telar executable"; }
rm -rf "$RUNTIME/versions/$VERSION"
mv "$STAGE" "$RUNTIME/versions/$VERSION"

ln -sfn "versions/$VERSION" "$RUNTIME/current"
ln -sfn "$RUNTIME/current/telar" "$BIN_DIR/telar"

echo "Installed $BIN_DIR/telar -> $RUNTIME/versions/$VERSION"
case ":$PATH:" in *":$BIN_DIR:"*) ;; *) echo "Add $BIN_DIR to your PATH to run \`telar\`." ;; esac
echo "Next: telar serve --host 0.0.0.0   then   telar pair"
