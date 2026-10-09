#!/usr/bin/env bash
# Paths that can break the iOS archive, read on stdin; matches on stdout, exit 1 when none.
# Sourced by verify.yml's self-test and by its diff step, so both use one definition.
# The Expo app, the workspaces it imports, the lockfile that pins them, and this file.
ios_paths() {
  grep -E '^(apps/mobile/|packages/engine-client/|packages/client/|bun\.lock$|\.github/workflows/ios-paths\.sh$)'
}
