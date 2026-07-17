#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
source "${ROOT_DIR}/scripts/android-env.sh"

if [[ $# -gt 1 ]]; then
  printf 'Usage: %s [device-name]\n' "$0" >&2
  exit 1
fi

adb start-server >/dev/null
if ! adb devices -l | awk '$2 == "device" { found = 1 } END { exit !found }'; then
  printf 'No authorized Android device is available. Unlock the phone and allow USB debugging.\n' >&2
  adb devices -l
  exit 1
fi

DEVICE_NAME="${1:-$(adb devices -l | awk '/ device / { for (i = 1; i <= NF; i++) if ($i ~ /^model:/) { sub(/^model:/, "", $i); print $i; exit } }')}"
if [[ -z "${DEVICE_NAME}" ]]; then
  printf 'Could not determine the Android device name. Pass it explicitly.\n' >&2
  exit 1
fi

cd "${ROOT_DIR}"
npx expo run:android --device "${DEVICE_NAME}" --no-bundler

printf '\nNative app installed. Run npm run android:device:start and open Phoenix Mobile.\n'
