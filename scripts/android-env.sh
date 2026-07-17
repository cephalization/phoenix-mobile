#!/usr/bin/env bash

set -euo pipefail

if [[ -z "${JAVA_HOME:-}" ]]; then
  if [[ -x /usr/libexec/java_home ]] && /usr/libexec/java_home -v 17 >/dev/null 2>&1; then
    JAVA_HOME="$(/usr/libexec/java_home -v 17)"
  elif command -v brew >/dev/null 2>&1 && brew --prefix openjdk@17 >/dev/null 2>&1; then
    JAVA_HOME="$(brew --prefix openjdk@17)/libexec/openjdk.jdk/Contents/Home"
  fi
fi

if [[ -z "${ANDROID_HOME:-}" ]]; then
  if [[ -n "${ANDROID_SDK_ROOT:-}" ]]; then
    ANDROID_HOME="${ANDROID_SDK_ROOT}"
  elif [[ -d "${HOME}/Library/Android/sdk" ]]; then
    ANDROID_HOME="${HOME}/Library/Android/sdk"
  elif command -v brew >/dev/null 2>&1; then
    ANDROID_HOME="$(brew --prefix)/share/android-commandlinetools"
  fi
fi

if [[ -z "${JAVA_HOME:-}" || ! -x "${JAVA_HOME}/bin/java" ]]; then
  printf 'JDK 17 was not found. Run npm run android:device:clean first or set JAVA_HOME.\n' >&2
  exit 1
fi

if [[ -z "${ANDROID_HOME:-}" || ! -d "${ANDROID_HOME}" ]]; then
  printf 'The Android SDK was not found. Run npm run android:device:clean first or set ANDROID_HOME.\n' >&2
  exit 1
fi

export JAVA_HOME
export ANDROID_HOME
export ANDROID_SDK_ROOT="${ANDROID_HOME}"
export PATH="${ANDROID_HOME}/platform-tools:${ANDROID_HOME}/cmdline-tools/latest/bin:${JAVA_HOME}/bin:${PATH}"

if ! command -v adb >/dev/null 2>&1; then
  printf 'Android platform-tools are missing from %s. Run npm run android:device:clean.\n' "${ANDROID_HOME}" >&2
  exit 1
fi
