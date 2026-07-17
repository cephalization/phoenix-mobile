# Android Device Development

Phoenix Mobile uses an Expo development build rather than Expo Go because the app includes native modules and targets Expo SDK 57. The repository generates `android/` locally from `app.json`; the native directory is intentionally ignored by Git.

## Phone Preparation

1. On the Android phone, enable Developer options by tapping **Build number** seven times under **Settings > About phone**.
2. Enable **USB debugging** under **Settings > System > Developer options**.
3. Connect the phone over USB, unlock it, and accept **Allow USB debugging?**. Select **Always allow from this computer** when appropriate.

## First Build

On macOS, run:

```bash
npm run android:device:clean
```

The clean script:

- Installs Homebrew JDK 17 and Android command-line tools when missing.
- Accepts Android SDK licenses and installs platform tools, Android SDK 36, and Build Tools 36.0.0.
- Shows connected ADB devices and requires an authorized phone.
- Installs locked JavaScript dependencies with `npm ci`.
- Regenerates `android/` from Expo app configuration.
- Builds and installs the debug development client without starting Metro.

Pass the ADB model name when more than one Android device is connected:

```bash
npm run android:device:clean -- Pixel_9_Pro_XL
```

Set `JAVA_HOME` or `ANDROID_HOME` before running the script to use an existing JDK 17 or Android SDK installation.

## Start Metro

Keep the phone connected and run:

```bash
npm run android:device:start
```

This establishes `adb reverse tcp:8081 tcp:8081` and starts Metro on the computer's localhost interface. Open the installed Phoenix Mobile app on the phone after Metro is ready. USB reversal avoids LAN discovery, firewall, and changing Wi-Fi address issues.

When multiple phones are connected, pass the desired ADB serial:

```bash
npm run android:device:start -- DEVICE_SERIAL
```

For an incremental native rebuild after app-config or native dependency changes, run:

```bash
npm run android:device
```

Then restart Metro with `npm run android:device:start`. JavaScript and TypeScript changes normally need only the running Metro process and Fast Refresh.

## Useful Checks

```bash
adb devices -l
adb reverse --list
```

If `adb` is not globally available, the repository scripts still configure it from `ANDROID_HOME`. A device listed as `unauthorized` needs the USB debugging prompt accepted while unlocked. If the prompt does not appear, revoke USB debugging authorizations in Developer options, reconnect the cable, and retry.

The USB reverse only connects the app to Metro. A Phoenix instance running on the development computer still needs the computer's LAN address, such as `192.168.1.20:6006`; the phone's `localhost` does not refer to that Phoenix server.
