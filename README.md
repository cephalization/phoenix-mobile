# Phoenix Mobile

A mobile companion for connecting to and monitoring self-hosted [Arize Phoenix](https://github.com/Arize-ai/phoenix) instances.

## Current scope

- Save multiple Phoenix server connections on-device
- Verify a server before saving it
- Display the Phoenix server version and projects through `@arizeai/phoenix-client`
- Refresh server data through TanStack Query
- Stream PXI conversations and restore local chat history through Expo SQLite on native and IndexedDB on web
- Support light, dark, mobile, tablet, and web layouts
- Model connections for future OAuth 2 credentials while currently allowing unauthenticated servers only

## Stack

- Expo SDK 57 and Expo Router
- React Native and strict TypeScript
- TanStack Query for Phoenix server state
- Zustand and AsyncStorage for persisted instance metadata
- Native Markdown rendering for streamed PXI responses
- React Hook Form and Zod for connection validation
- SecureStore installed for the upcoming OAuth credential flow

## Development

```bash
npm install
npm start
```

Use `npm run ios`, `npm run android`, or `npm run web` to target a platform directly.

Physical-device setup is documented separately:

- [iOS setup below](#ios-physical-device)
- [Android device development](./docs/android-development.md)

### iOS physical device

For the first development build on a connected iPhone, or after native dependency and app-config changes, enable Developer Mode on the phone and run:

```bash
npm run ios:device:clean
```

Pass a device name or UDID to skip Expo's device prompt:

```bash
npm run ios:device:clean -- "My iPhone"
```

The clean script selects `/Applications/Xcode.app`, completes Xcode's first-launch setup, installs locked JavaScript dependencies, regenerates the iOS project with the Xcode 27 scene-lifecycle workaround, installs CocoaPods dependencies, and builds and installs Phoenix Mobile. Xcode discovers a locally configured development team for signing; no team identifier is stored in the repository. Set `XCODE_APP` when Xcode is installed elsewhere.

For normal JavaScript and TypeScript development, leave the installed development client on the phone and run `npm start` for Fast Refresh. Use `npm run ios:device` only when an incremental native rebuild is needed.

```bash
npm run typecheck
npm run lint
```

Before contributing, read:

- [`AGENTS.md`](./AGENTS.md) for development and collaboration guidelines
- [`FINDINGS.md`](./FINDINGS.md) for current technical knowledge and constraints
- [`GOALS.md`](./GOALS.md) for ordered product priorities

## Connecting locally

Enter a full URL or a host and port, such as `192.168.1.20:6006`. When using a physical device, `localhost` refers to the phone, not the computer running Phoenix, so use the computer's LAN address instead.

The native configuration permits HTTP connections because local Phoenix deployments commonly do not use TLS. Prefer HTTPS for remotely accessible servers.

## Structure

```text
src/app/                 Expo Router screens
src/components/          Shared UI components
src/hooks/               TanStack Query data hooks
src/lib/                 Phoenix client and URL utilities
src/store/               Persisted client-side state
src/types/               Connection domain types
```
