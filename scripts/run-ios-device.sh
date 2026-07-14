#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
XCODE_APP="${XCODE_APP:-/Applications/Xcode.app}"
DEVELOPER_DIR="${XCODE_APP}/Contents/Developer"

if [[ "$(uname -s)" != "Darwin" ]]; then
  printf 'This script requires macOS.\n' >&2
  exit 1
fi

if [[ ! -d "${DEVELOPER_DIR}" ]]; then
  printf 'Xcode was not found at %s.\n' "${XCODE_APP}" >&2
  printf 'Install Xcode or rerun with XCODE_APP=/path/to/Xcode.app.\n' >&2
  exit 1
fi

if ! command -v node >/dev/null 2>&1 || ! command -v npm >/dev/null 2>&1; then
  printf 'Node.js and npm are required. Install an active Node.js LTS release first.\n' >&2
  exit 1
fi

if [[ "$(xcode-select -p 2>/dev/null || true)" != "${DEVELOPER_DIR}" ]]; then
  printf 'Selecting Xcode at %s...\n' "${XCODE_APP}"
  sudo xcode-select --switch "${DEVELOPER_DIR}"
fi

printf 'Completing Xcode first-launch setup...\n'
sudo xcodebuild -runFirstLaunch

cd "${ROOT_DIR}"
printf 'Installing locked JavaScript dependencies...\n'
npm ci

printf '\nConnected Apple devices:\n'
xcrun devicectl list devices

printf '\nBefore continuing, make sure the iPhone is unlocked, trusted, and has Developer Mode enabled.\n'
printf 'Xcode may ask you to choose an Apple Development team or a unique bundle identifier.\n\n'

if [[ $# -gt 1 ]]; then
  printf 'Usage: %s [device-name-or-UDID]\n' "$0" >&2
  exit 1
fi

if [[ $# -eq 1 ]]; then
  npx expo run:ios --device "$1"
else
  npx expo run:ios --device
fi
