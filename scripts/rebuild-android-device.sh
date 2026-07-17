#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

if [[ $# -gt 1 ]]; then
  printf 'Usage: %s [device-name]\n' "$0" >&2
  exit 1
fi

if [[ "$(uname -s)" != "Darwin" ]]; then
  printf 'The automatic Android toolchain bootstrap currently requires macOS.\n' >&2
  exit 1
fi

if ! command -v brew >/dev/null 2>&1; then
  printf 'Homebrew is required to install JDK 17 and Android command-line tools.\n' >&2
  exit 1
fi

if ! command -v node >/dev/null 2>&1 || ! command -v npm >/dev/null 2>&1; then
  printf 'Node.js and npm are required. Install an active Node.js LTS release first.\n' >&2
  exit 1
fi

if ! brew list --formula openjdk@17 >/dev/null 2>&1; then
  printf 'Installing JDK 17...\n'
  brew install openjdk@17
fi

if ! brew list --cask android-commandlinetools >/dev/null 2>&1; then
  printf 'Installing Android command-line tools...\n'
  brew install --cask android-commandlinetools
fi

export JAVA_HOME="${JAVA_HOME:-$(brew --prefix openjdk@17)/libexec/openjdk.jdk/Contents/Home}"
export ANDROID_HOME="${ANDROID_HOME:-${ANDROID_SDK_ROOT:-$(brew --prefix)/share/android-commandlinetools}}"
export ANDROID_SDK_ROOT="${ANDROID_HOME}"
export PATH="${ANDROID_HOME}/platform-tools:${ANDROID_HOME}/cmdline-tools/latest/bin:${JAVA_HOME}/bin:${PATH}"

printf 'Accepting Android SDK licenses...\n'
set +o pipefail
yes | sdkmanager --sdk_root="${ANDROID_HOME}" --licenses >/dev/null
set -o pipefail

printf 'Installing Android SDK 36 build tools and platform tools...\n'
sdkmanager --sdk_root="${ANDROID_HOME}" \
  'platform-tools' \
  'platforms;android-36' \
  'build-tools;36.0.0'

adb start-server >/dev/null
printf '\nConnected Android devices:\n'
adb devices -l
printf '\nUnlock the phone and accept the USB debugging prompt if it is unauthorized.\n\n'

if ! adb devices -l | awk '$2 == "device" { found = 1 } END { exit !found }'; then
  printf 'No authorized Android device is available yet. Authorize it, then rerun this command.\n' >&2
  exit 1
fi

cd "${ROOT_DIR}"
printf 'Installing locked JavaScript dependencies...\n'
npm ci

printf 'Regenerating the Android project from app config...\n'
npx expo prebuild --clean --platform android --no-install

"${ROOT_DIR}/scripts/run-android-device.sh" "$@"
