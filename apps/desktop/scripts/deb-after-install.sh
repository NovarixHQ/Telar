#!/bin/bash
# electron-builder template: it substitutes the dollar-brace macros made of letters only.
# TELAR_POSTINST_ROOT prefixes every path so tests can run this against a fake root.
ROOT_DIR="${TELAR_POSTINST_ROOT:-}"
APP_DIR="$ROOT_DIR"'/opt/${sanitizedProductName}'
BIN_LINK="$ROOT_DIR"'/usr/bin/${executable}'
APP_BIN="$APP_DIR"'/${executable}'

if type update-alternatives >/dev/null 2>&1; then
  if [ -L "$BIN_LINK" ] && [ -e "$BIN_LINK" ] && [ "$(readlink "$BIN_LINK")" != '/etc/alternatives/${executable}' ]; then
    rm -f "$BIN_LINK"
  fi
  update-alternatives --install "$BIN_LINK" '${executable}' "$APP_BIN" 100 || ln -sf "$APP_BIN" "$BIN_LINK"
else
  ln -sf "$APP_BIN" "$BIN_LINK"
fi

if hash update-mime-database 2>/dev/null; then
  update-mime-database "$ROOT_DIR/usr/share/mime" || true
fi
if hash update-desktop-database 2>/dev/null; then
  update-desktop-database "$ROOT_DIR/usr/share/applications" || true
fi

PROFILE_READY=0
if apparmor_status --enabled >/dev/null 2>&1; then
  PROFILE_SOURCE="$APP_DIR/resources/apparmor-profile"
  PROFILE_TARGET="$ROOT_DIR"'/etc/apparmor.d/${executable}'
  if apparmor_parser --skip-kernel-load --debug "$PROFILE_SOURCE" >/dev/null 2>&1; then
    cp -f "$PROFILE_SOURCE" "$PROFILE_TARGET"
    if [ -x /usr/bin/ischroot ] && /usr/bin/ischroot; then
      PROFILE_READY=1
    elif apparmor_parser --replace --write-cache --skip-read-cache "$PROFILE_TARGET"; then
      PROFILE_READY=1
    fi
  else
    echo "This AppArmor cannot load Telar's profile; Telar falls back to the setuid sandbox helper if it needs one."
  fi
fi

sysctl_is() {
  [ "$(cat "$ROOT_DIR/proc/sys/$1" 2>/dev/null)" = "$2" ]
}

userns_blocked() {
  [ -e "$ROOT_DIR/proc/self/ns/user" ] || return 0
  sysctl_is kernel/unprivileged_userns_clone 0 && return 0
  sysctl_is user/max_user_namespaces 0 && return 0
  sysctl_is kernel/apparmor_restrict_unprivileged_userns 1 && [ "$PROFILE_READY" != 1 ] && return 0
  return 1
}

if userns_blocked; then
  chown root:root "$APP_DIR/chrome-sandbox" && chmod 4755 "$APP_DIR/chrome-sandbox"
else
  chmod 0755 "$APP_DIR/chrome-sandbox"
fi
