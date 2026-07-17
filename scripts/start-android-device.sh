#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
source "${ROOT_DIR}/scripts/android-env.sh"

if [[ $# -gt 1 ]]; then
  printf 'Usage: %s [device-serial]\n' "$0" >&2
  exit 1
fi

DEVICE_SERIAL="${1:-$(adb devices | awk '$2 == "device" { print $1; exit }')}"
if [[ -z "${DEVICE_SERIAL}" ]]; then
  printf 'No authorized Android device is available. Unlock the phone and allow USB debugging.\n' >&2
  adb devices -l
  exit 1
fi

printf 'Forwarding the phone\x27s localhost:8081 to Metro over USB...\n'
adb -s "${DEVICE_SERIAL}" reverse tcp:8081 tcp:8081

cd "${ROOT_DIR}"
printf 'Open Phoenix Mobile on the connected phone after Metro is ready.\n\n'
npx expo start --dev-client --localhost
