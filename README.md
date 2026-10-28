# Phoenix Mobile

A mobile companion for connecting to and monitoring self-hosted [Arize Phoenix](https://github.com/Arize-ai/phoenix) instances.

## Quick start with Expo Go

The fastest way to run the app on your own phone. No Xcode or Android Studio is needed.

1. Install [Expo Go](https://expo.dev/go) from the App Store or Google Play. The store build must support Expo SDK 58 (version 58 or newer).
2. Have a Phoenix server the phone can reach. If you do not have one, see [Run Phoenix locally](#run-phoenix-locally).
3. Put the phone and the computer on the same Wi-Fi network, then on the computer:

   ```bash
   npm ci
   npm run start:go
   ```

4. Scan the QR code that Metro prints: with the Camera app on iOS, or from inside Expo Go on Android. Accept the local-network prompt the first time; iOS asks because Expo Go loads the JavaScript bundle from your computer.
5. Tap **Add instance** and enter the computer's LAN address and Phoenix port, such as `192.168.1.20:6006`. `localhost` on the phone is the phone itself.

To hand someone a connection instead of making them type it, open a link that prefills the sheet. In Expo Go the link is:

```text
exp://<computer-ip>:8081/--/instances/new?host=<computer-ip>:6006
```

On a development build the same link is `phoenixmobile://instances/new?host=<computer-ip>:6006`. An optional `name` parameter sets the display name. Nothing is saved until the server is verified.

`npm run start:go` serves Metro over the LAN. If the phone cannot reach the computer (guest Wi-Fi, client isolation, a strict firewall), start a tunnel instead; it is slower but works from any network:

```bash
npm run start:go -- --tunnel
```

macOS may ask whether Node can accept incoming connections the first time Metro starts. Allow it, or the phone cannot fetch the bundle.

### What Expo Go cannot show

Everything the app uses is bundled in Expo Go except two things that need a [development build](#development-builds):

- **Trailing sheets on iPhone Duo.** The local `modules/duo-sheets` module docks form sheets beside the vertical system bar on the open inner display. It is a no-op in Expo Go, so sheets dock to the leading edge there.
- **OAuth sign-in.** Authenticated Phoenix servers return to the app through the private `phoenixmobile://oauth/callback` redirect, which Expo Go does not own. Use unauthenticated instances in Expo Go.

## Run Phoenix locally

Phoenix runs on the development computer and the phone connects over the LAN. Either of these starts a server on port 6006 with no authentication:

```bash
# with uv (https://docs.astral.sh/uv/)
uvx --from 'arize-phoenix[pg]' phoenix serve

# with Docker
docker run -p 6006:6006 -p 4317:4317 arizephoenix/phoenix:latest
```

Find the address to enter on the phone:

```bash
ipconfig getifaddr en0   # macOS, Wi-Fi
hostname -I              # Linux
```

Send some traces to the server so the app has projects to show; the [Phoenix tracing quickstart](https://arize.com/docs/phoenix/tracing/llm-traces-1) covers the few lines of setup.

## Current scope

- Save multiple Phoenix server connections on-device
- Verify a server before saving it
- Display the Phoenix server version and projects through `@arizeai/phoenix-client`
- Refresh server data through TanStack Query
- Stream PXI conversations against persisted server-side agent sessions, with chat history shared across every PXI client (Phoenix 20.0.0+)
- Run contextual PXI actions, like open coding a session into PXI notes that reviewers read before annotating (Phoenix 20.11.0+)
- Support light, dark, mobile, tablet, and web layouts, with two-pane iPhone Duo layouts, trailing sheets, and a PXI companion column on the inner display (see [docs/iphone-duo-preview.md](./docs/iphone-duo-preview.md))
- Connect to unauthenticated servers or Phoenix 19+ instances through native OAuth 2; web currently supports unauthenticated connections only

## Stack

- Expo SDK 58 and Expo Router
- React Native and strict TypeScript
- TanStack Query for Phoenix server state
- Zustand and AsyncStorage for persisted instance metadata
- Native Markdown rendering for streamed PXI responses
- React Hook Form and Zod for connection validation
- Expo SecureStore for native OAuth access and rotating refresh tokens

## Development

Node 22 or newer is required; `.nvmrc` pins the version used for development. The repository commits `package-lock.json`, so use `npm` for every install and script.

```bash
npm ci
npm start
```

`npm start` targets the installed development build. Use `npm run start:go` for Expo Go, and `npm run ios`, `npm run android`, or `npm run web` to build and launch a platform directly.

```bash
npm run check
```

That runs the TypeScript typecheck, oxlint (with the vendored anti-slop rules in `tools/oxlint/anti-slop`), the oxfmt format check, and the Vitest suite. `npm run lint:fix` and `npm run fmt` apply autofixes. The oxc VS Code extension is recommended in `.vscode/extensions.json`.

Before contributing, read:

- [`AGENTS.md`](./AGENTS.md) for development and collaboration guidelines
- [`FINDINGS.md`](./FINDINGS.md) for current technical knowledge and constraints
- [`GOALS.md`](./GOALS.md) for ordered product priorities

### Development builds

A development build is the app compiled with its native modules plus the Expo dev client. It is needed for the two features listed under [What Expo Go cannot show](#what-expo-go-cannot-show), and for anything that changes native code or `app.json`.

- [iOS physical device](#ios-physical-device) below
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

The clean script selects `/Applications/Xcode.app`, completes Xcode's first-launch setup, installs locked JavaScript dependencies, regenerates the iOS project, installs CocoaPods dependencies, and builds and installs Phoenix Mobile. Xcode discovers a locally configured development team for signing; a free Personal Team is enough, and no team identifier is stored in the repository. Set `XCODE_APP` when Xcode is installed elsewhere.

For normal JavaScript and TypeScript development, leave the installed development client on the phone and run `npm start` for Fast Refresh. Use `npm run ios:device` only when an incremental native rebuild is needed.

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
