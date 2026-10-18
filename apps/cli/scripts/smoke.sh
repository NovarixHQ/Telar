#!/bin/sh
# Runs a built telar executable end to end: version, doctor, serve, pair, stop.
set -eu
telar="$1"
work="$(mktemp -d)"
export HOME="$work/user"
mkdir -p "$HOME"
home="$work/home"
serve_pid=""
pair_pid=""
cleanup() {
  [ -z "$pair_pid" ] || kill "$pair_pid" 2>/dev/null || true
  [ -z "$serve_pid" ] || kill "$serve_pid" 2>/dev/null || true
  rm -rf "$work"
}
trap cleanup EXIT

wait_for() {
  tries=0
  until grep -q "$1" "$2" 2>/dev/null; do
    tries=$((tries + 1))
    [ "$tries" -lt 300 ] || { echo "timed out waiting for '$1'"; cat "$2" || true; exit 1; }
    sleep 0.1
  done
}

"$telar" version
"$telar" doctor --home "$home" || true

"$telar" serve --home "$home" --port 0 >"$work/serve.log" 2>&1 &
serve_pid=$!
wait_for "Pair a device" "$work/serve.log"

"$telar" pair --home "$home" >"$work/pair.log" 2>&1 &
pair_pid=$!
wait_for "Waiting for a device" "$work/pair.log"
kill "$pair_pid"
wait "$pair_pid" 2>/dev/null || true
pair_pid=""

"$telar" doctor --home "$home" | tee "$work/doctor.log"
grep -q "ok    engine" "$work/doctor.log"
grep -q "ok    terminals" "$work/doctor.log"

kill -TERM "$serve_pid"
status=0
wait "$serve_pid" || status=$?
serve_pid=""
[ "$status" -eq 0 ] || { echo "serve exited $status after SIGTERM"; exit 1; }
echo "smoke ok"
