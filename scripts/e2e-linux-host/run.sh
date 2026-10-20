#!/usr/bin/env bash
# End to end on a Linux host in Docker: install.sh, service, browser, pairing, a turn, terminals, update and rollback.
#   scripts/e2e-linux-host/run.sh        E2E_KEEP=1 leaves the containers and images; E2E_REUSE_BUILD=1 skips the CLI build.
set -euo pipefail

here="$(cd "$(dirname "$0")" && pwd)"
repo="$(cd "$here/../.." && pwd)"
work="${E2E_WORK:-/tmp/telar-e2e}"
host=telar-e2e-host
files=telar-e2e-files
net=telar-e2e-net
v1=0.1.0-e2e.1 v2=0.1.0-e2e.2 broken=0.1.0-e2e.3
base="http://$files:8080"
key="$work/ssh/id_ed25519"
control="$work/ssh/control"
failures=0
pulled_busybox=0
docker image inspect busybox:stable >/dev/null 2>&1 || pulled_busybox=1

case "$(docker info --format '{{.Architecture}}')" in
  aarch64|arm64) target=linux-arm64 ;;
  x86_64|amd64) target=linux-x64 ;;
  *) echo "unsupported docker architecture"; exit 1 ;;
esac

step() { printf '\n== %s\n' "$*"; }
pass() { echo "ok    $*"; }
fail() { echo "FAIL  $*"; failures=$((failures + 1)); }
check() { local label="$1"; shift; if "$@" >/dev/null 2>&1; then pass "$label"; else fail "$label"; fi; }

cleanup() {
  [ -S "$control" ] && ssh -F /dev/null -S "$control" -O exit dev@127.0.0.1 2>/dev/null || true
  if [ "${E2E_KEEP:-0}" != 1 ]; then
    docker rm -f "$host" "$files" >/dev/null 2>&1 || true
    docker network rm "$net" >/dev/null 2>&1 || true
    docker image rm telar-e2e-host telar-e2e-toolchain >/dev/null 2>&1 || true
    [ "$pulled_busybox" = 0 ] || docker image rm busybox:stable >/dev/null 2>&1 || true
    rm -rf "$work"
  fi
}
trap cleanup EXIT

e2e_ssh() { ssh -F /dev/null -i "$key" -o IdentitiesOnly=yes -o IdentityAgent=none -o BatchMode=yes -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -o LogLevel=ERROR -p "$(sshport)" "$@"; }
sshport() { docker port "$host" 22/tcp | head -1 | sed 's/.*://'; }
netport() { docker port "$host" 7420/tcp | head -1 | sed 's/.*://'; }
on_host() { e2e_ssh dev@127.0.0.1 "$@"; }
telar() { on_host "TELAR_DOWNLOAD_BASE=$base ~/.local/bin/telar $*"; }

wait_for() {
  local label="$1" tries="$2"; shift 2
  for _ in $(seq "$tries"); do "$@" >/dev/null 2>&1 && return 0; sleep 1; done
  echo "timed out: $label"; return 1
}
is_version() { [ "$(on_host '~/.local/bin/telar version')" = "$1" ]; }
is_current() { on_host 'readlink ~/.telar/runtime/current' | grep -q "/$1\$"; }
listed() { on_host '~/.local/bin/telar auth session list' | grep -q "$1"; }
ping_ok() { curl -fsS "http://127.0.0.1:$(netport)/v2/ping" | grep -q '"proto":2'; }
boot_host() {
  wait_for "systemd" 60 docker exec "$host" sh -c 'systemctl is-system-running | grep -qE "running|degraded"'
  wait_for "sshd" 30 on_host true
}

step "Build images and the CLI ($target)"
rm -rf "$work/www" "$work/ssh"
mkdir -p "$work/dist" "$work/www" "$work/ssh" "$work/secrets"
chmod 700 "$work/secrets"
ssh-keygen -q -t ed25519 -N '' -C telar-e2e -f "$key"
docker build -q --target toolchain -t telar-e2e-toolchain --label telar-e2e=1 "$here" >/dev/null
docker build -q --target host -t telar-e2e-host --label telar-e2e=1 "$here" >/dev/null
if [ "${E2E_REUSE_BUILD:-0}" != 1 ] || [ ! -f "$work/dist/telar-$v2-$target.tar.gz" ]; then
  (cd "$repo" && git ls-files -co --exclude-standard -z | COPYFILE_DISABLE=1 tar --null --no-xattrs -cf "$work/src.tar" -T -)
  docker run --rm --name telar-e2e-build --label telar-e2e=1 -v "$work:/e2e" -e ELECTRON_SKIP_BINARY_DOWNLOAD=1 telar-e2e-toolchain sh -euc "
    mkdir /src && tar -xf /e2e/src.tar -C /src 2>/dev/null && cd /src
    bun install --frozen-lockfile >/tmp/install.log 2>&1 || { tail -30 /tmp/install.log; exit 1; }
    for v in $v1 $v2; do bun run --cwd apps/cli build:sea --version \$v >/dev/null; done
    cp apps/cli/dist/release/* /e2e/dist/"
fi
for v in "$v1" "$v2"; do mkdir -p "$work/www/$v" && cp "$work/dist/telar-$v-$target.tar.gz"* "$work/www/$v/"; done
mkdir -p "$work/broken" "$work/www/$broken"
printf '#!/bin/sh\necho "this build is broken" >&2\nexit 1\n' > "$work/broken/telar" && chmod 755 "$work/broken/telar"
tar -czf "$work/www/$broken/telar-$broken-$target.tar.gz" -C "$work/broken" telar
(cd "$work/www/$broken" && sha256sum "telar-$broken-$target.tar.gz" 2>/dev/null || shasum -a 256 "telar-$broken-$target.tar.gz") > "$work/www/$broken/telar-$broken-$target.tar.gz.sha256"
echo "$v1" > "$work/www/stable"
cp "$repo/scripts/install.sh" "$work/www/install.sh"
printf '<!doctype html><title>Telar e2e page</title><h1>Telar e2e page</h1><button>Press</button>\n' > "$work/www/page.html"
pass "built $v1 and $v2"

step "Start the file server and the host"
docker rm -f "$host" "$files" >/dev/null 2>&1 || true
docker network rm "$net" >/dev/null 2>&1 || true
docker network create --label telar-e2e=1 "$net" >/dev/null
docker run -d --name "$files" --label telar-e2e=1 --network "$net" -v "$work/www:/srv:ro" busybox:stable httpd -f -p 8080 -h /srv >/dev/null
docker run -d --name "$host" --hostname "$host" --label telar-e2e=1 --network "$net" --privileged --cgroupns=private \
  --tmpfs /run --tmpfs /run/lock -p 127.0.0.1::7420 -p 127.0.0.1::22 telar-e2e-host >/dev/null
docker cp "$key.pub" "$host:/home/dev/.ssh/authorized_keys"
docker exec "$host" sh -c 'chown dev:dev /home/dev/.ssh/authorized_keys && chmod 600 /home/dev/.ssh/authorized_keys'
boot_host
pass "host is up with systemd and sshd"

step "Install with install.sh from the local download base"
install() { on_host "curl -fsSL $base/install.sh | TELAR_DOWNLOAD_BASE=$base sh"; }
if install > "$work/install.log" 2>&1; then fail "install.sh accepted a host that cannot run telar"; else grep -q libatomic1 "$work/install.log" && pass "install.sh names the missing libatomic1" || fail "install.sh failed without naming libatomic1"; fi
cat "$work/install.log"
on_host "sudo apt-get update -qq && sudo DEBIAN_FRONTEND=noninteractive apt-get install -y -qq libatomic1 >/dev/null"
install
check "telar version is $v1" is_version "$v1"
published="${E2E_PUBLISHED_BASE:-${UPDATE_PROXY_URL:+${UPDATE_PROXY_URL%/}/cli}}"
if [ -n "$published" ]; then
  if on_host "curl -fsSL $published/install.sh | TELAR_RUNTIME=/tmp/published TELAR_BIN_DIR=/tmp/published/bin sh -s -- --channel nightly"; then
    check "the published nightly runs" on_host /tmp/published/bin/telar version
  else
    fail "install.sh from the published base"
  fi
else
  echo "skip  published install: set E2E_PUBLISHED_BASE once a nightly is published"
fi

step "doctor"
telar doctor || true

step "Service, linger and a container restart"
telar service install --host 0.0.0.0 --port 7420 2>&1 | tee "$work/service.log"
if ! docker exec "$host" test -f /var/lib/systemd/linger/dev; then
  check "service install names the linger command it could not run" grep -q 'sudo loginctl enable-linger dev' "$work/service.log"
  on_host "sudo loginctl enable-linger dev"
fi
check "engine answers on the published port" wait_for "engine" 60 ping_ok
docker restart "$host" >/dev/null
boot_host
check "engine is back after a container restart" wait_for "engine after restart" 90 ping_ok
telar service status >/dev/null && pass "service status" || fail "service status"

step "Headless browser"
restrict=/proc/sys/kernel/apparmor_restrict_unprivileged_userns
if [ "$(docker exec "$host" cat "$restrict" 2>/dev/null)" = 1 ]; then
  telar browser setup > "$work/browser.log" 2>&1 || true
  cat "$work/browser.log"
  check "browser setup names the host's sysctl" grep -q "sysctl -w kernel.apparmor_restrict_unprivileged_userns=0" "$work/browser.log"
  # Only a throwaway CI runner gets its kernel changed; elsewhere the browser checks fail and say why.
  [ "${CI:-}" = true ] && sudo sysctl -qw kernel.apparmor_restrict_unprivileged_userns=0
fi
telar browser setup || fail "browser setup"
telar doctor | grep -i browser || true

step "Pair two devices: one over the published port (read,write), one through an SSH tunnel (all scopes)"
pair_code() {
  on_host "rm -f /tmp/pair-$1.log; nohup ~/.local/bin/telar pair $2 > /tmp/pair-$1.log 2>&1 &"
  wait_for "pairing code" 30 on_host "grep -q '^Code:' /tmp/pair-$1.log"
  on_host "sed -n 's/^Code: \\([0-9]*\\) \\([0-9]*\\)\$/\\1\\2/p' /tmp/pair-$1.log"
}
tunnel_port="$(python3 -c 'import socket; s=socket.socket(); s.bind(("127.0.0.1",0)); print(s.getsockname()[1])' 2>/dev/null || echo 17420)"
e2e_ssh -o ExitOnForwardFailure=yes -M -S "$control" -fN -L "127.0.0.1:$tunnel_port:127.0.0.1:7420" dev@127.0.0.1
net_url="http://127.0.0.1:$(netport)"
tunnel_url="http://127.0.0.1:$tunnel_port"
code="$(pair_code net '--scopes read,write --name mac-network')"
(cd "$repo" && bun "$here/client.ts" pair "$net_url" "$code" mac-network) > "$work/secrets/net.json"
code="$(pair_code tunnel '--name mac-tunnel')"
(cd "$repo" && bun "$here/client.ts" pair "$tunnel_url" "$code" mac-tunnel) > "$work/secrets/tunnel.json"
check "telar pair saw the device" wait_for "pair to finish" 10 on_host "grep -q '^Paired' /tmp/pair-net.log && grep -q '^Paired' /tmp/pair-tunnel.log"
telar auth session list | tee "$work/sessions.txt" | cut -c1-60
check "auth session list shows the network device" grep -q mac-network "$work/sessions.txt"
check "auth session list shows the tunnel device" grep -q mac-tunnel "$work/sessions.txt"
check "read,write scopes recorded" grep -qE 'mac-network +read,write( |$)' "$work/sessions.txt"
field() { sed -n "s/.*\"$2\":\"\\([^\"]*\\)\".*/\\1/p" "$work/secrets/$1.json"; }

step "Drive the engine from this machine"
on_host "mkdir -p ~/e2e-project && cd ~/e2e-project && git init -q && echo hi > README.md"
engine_token="$(on_host 'sed -n "s/.*\"token\": *\"\([^\"]*\)\".*/\1/p" ~/.local/share/telar/engine/engine.json')"
(cd "$repo" && E2E_NET_URL="$net_url" E2E_TUNNEL_URL="$tunnel_url" E2E_NET_TOKEN="$(field net deviceToken)" E2E_TUNNEL_TOKEN="$(field tunnel deviceToken)" \
  E2E_ENGINE_TOKEN="$engine_token" E2E_PAGE_URL="$base/page.html" E2E_PROJECT_ROOT=/home/dev/e2e-project bun "$here/client.ts" exercise) || failures=$((failures + 1))

step "Update to $v2, then a forced rollback from $broken"
telar update --version "$v2" || fail "update to $v2"
check "current is $v2" is_current "$v2"
check "engine healthy on $v2" wait_for "engine on $v2" 60 ping_ok
check "service runs $v2" on_host "systemctl --user show telar -p ExecStart | grep -q runtime/current"
telar update --version "$broken" && fail "the broken update reported success" || pass "the broken update was refused"
check "current is still $v2" is_current "$v2"
check "engine healthy after rollback" wait_for "engine after rollback" 60 ping_ok
check "pairings survived both updates" listed mac-tunnel
check "update log names the rollback" on_host "grep -q 'did not become healthy' ~/.local/share/telar/update.log"

step "Revoke"
telar auth session revoke "$(field net deviceId)"
(cd "$repo" && E2E_REVOKED_TOKEN="$(field net deviceToken)" bun "$here/client.ts" refused "$net_url") || failures=$((failures + 1))

step "Done"
if [ "$failures" -gt 0 ]; then echo "$failures check(s) failed"; exit 1; fi
echo "all checks passed"
