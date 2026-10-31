# iPhone Duo

Phoenix Mobile follows Apple's iPhone Duo guidance (the HIG page "Designing for iPhone Duo", "Preparing your app for iPhone Duo", and Tech Talk 111466) by letting UIKit's split view do the work: one layout per size class, columns that adapt to the fold, bars that move to the side, and a split that collapses when the device closes and expands when it opens. The decision and its history are in `FINDINGS.md` ("iPhone Duo And iPad Use Native Split Columns").

## Two navigators, chosen once

The root layout waits for the first native metrics (`NativeMetricsProvider`, at most a second) and picks a navigator for the session:

- **Native split columns** (`SplitStack`, `src/components/duo/split-stack.tsx`) on iPhone Duo and iPad, when the binary carries the split host from the vendored react-native-screens fork.
- **Expo Router's `Stack`** everywhere else (iPhone, Android, web, Expo Go), with PXI as the JavaScript pane (`PxiPaneShell`) on wide windows.

The choice never changes while the app runs, so screens never remount. The split itself collapses to one column on the closed Duo and expands again when it opens.

## Columns

| Column    | Holds                                                                                 | Bars                                  |
| --------- | ------------------------------------------------------------------------------------- | ------------------------------------- |
| Sidebar   | Projects, then a project's traces or sessions (a native stack), on the `sidebar` tint | Horizontal, above the column          |
| Detail    | The selected trace or session, and pages drilled into from it                         | The vertical bar on the trailing edge |
| Inspector | PXI chat, while open; a full-height sheet while collapsed                             | The chat's own header                 |

Route roles live in `src/features/duo/split-columns.ts`. One router history projects into the columns, ordered as sidebar pages followed by detail pages:

- Opening a sidebar page clears the detail column, because a selection belongs to the list that made it.
- `selectDetail(href)` opens a page the way a list row does: it replaces the detail column, so Back returns to the list.
- `router.push` from a detail page drills in on top, so Back returns to that page.

List screens mark the row the detail column shows with `useSplitDetail()`. A session page selects the next session after "Submit & next" from the order the sessions list publishes (`useSessionQueueOrder`). With room for it, PXI floats over the columns beside the vertical bar and the columns keep their layout; on the closed Duo it is a sheet. Done, the PXI bar item, or swiping the sheet away closes it.

## Measuring a column

Every column body contains the `LayoutMetrics` view from `modules/duo-native`, so `useDuoLayout()` inside it answers for that column:

- `horizontalSizeClass` and `isRegularWidth` from UIKit's trait,
- `width` as the usable width: the column minus its side safe-area insets (the vertical bar, and the inspector, which overlays the detail column),
- `systemBarEdge` from UIKit's `verticalBarEdge`,
- `division`, the active fold region, for JavaScript layouts such as `DuoArrangement`.

Without the native module (Android, web, Expo Go) the window width decides the size class and there is no fold.

## Bar items

Actions are native header items so iPhone Duo can stack them in its vertical bar. Build them with `barButton` from `src/components/duo/column-header.tsx` and give each an SF Symbol, a label (shown in the overflow menu), and a `visibilityPriority` (`low` items overflow first). A custom glyph must come from the asset catalog (`xcasset`, added by a config plugin such as `plugins/with-pxi-glyph.js`); an image source loads after every navigation and flashes the label first. Trailing items stack from the bar's far end, so the last item sits at the top of a vertical bar. The items on each screen are listed in `docs/design.md`. Android and web keep their pressables.

## Sheets

Every task is a native `formSheet` route. Compact width uses detents `[initial, 1]`: the closed Duo moves its status bar above a sheet only at the full detent. On the open Duo, `modules/duo-native` docks form sheets beside the vertical bar on the trailing edge (`DuoSheetPlacement`), with no detents. Sheet content uses `useContentColumnStyle(20)` so it stops short of the sheet's own vertical bar, where Done sits.

## Surface model

Every tap is one of three verbs, and the window's size class decides how each verb renders. New screens fit into one of these rows or need a design conversation first.

| Verb      | What it is                                                                                                                                     | Compact (phone, closed Duo)                        | Regular (open Duo, iPad)                                     | Leaves by                                               |
| --------- | ---------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------- | ------------------------------------------------------------ | ------------------------------------------------------- |
| Navigate  | Picking a thing: project, trace, session, a turn's trace                                                                                       | Pushes a page                                      | Drills the sidebar, or selects into the detail column        | Back                                                    |
| Task      | A job with a result and an end: Add instance, Connections, Settings, Review queue, New annotation config, Add to dataset, Investigate with PXI | Native bottom sheet with two detents and a grabber | Full-height native form sheet docked beside the vertical bar | Swipe down or the sheet's own Done; never a close glyph |
| Companion | The PXI chat, kept beside the content                                                                                                          | Full-screen chat route, or the inspector's sheet   | A floating panel from the trailing edge                      | The PXI bar item, Done, or swiping the sheet away       |

## The vendored react-native-screens fork

`deps/react-native-screens-5.0.0-t3.48-phoenix.1.tgz` is T3 Code's fork (`t3-fork.json` names the source commit and upstream base) with Phoenix patches listed under `phoenixPatches`. To change it, extract the tarball, edit `package/`, and repack without macOS metadata, then reinstall it explicitly so npm does not reuse the cached copy:

```bash
COPYFILE_DISABLE=1 tar --no-xattrs -czf deps/<name>.tgz package
npm install ./deps/<name>.tgz
(cd ios && pod install)
```

Native changes need a rebuild.

## Running on the Duo simulator

With Xcode 27.1 at `/Applications/Xcode.app` and the iOS 27.1 runtime, create and boot an `iPhone Duo`, then build and install:

```bash
export DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer
xcodebuild -workspace ios/PhoenixMobile.xcworkspace -scheme PhoenixMobile -configuration Debug \
  -sdk iphonesimulator -destination 'platform=iOS Simulator,name=iPhone Duo' \
  -derivedDataPath ios/build CODE_SIGNING_ALLOWED=NO build
xcrun simctl install booted ios/build/Build/Products/Debug-iphonesimulator/PhoenixMobile.app
npx expo start --dev-client
```

Add `DEV_CLIENT_DEFAULT_LAUNCHER_URL = http://localhost:8081` to the generated `ios/PhoenixMobile/Info.plist` to skip the dev launcher. Device Hub's bezel controls open, close, rotate, and fold the device; T3 Code's `agent-device fold closed|half-open|open` does the same from a script. The open inner window is 951 × 669 pt and the closed outer one 466 × 678 pt, both with the vertical bar inset `{ right: 84, bottom: 34 }`.
