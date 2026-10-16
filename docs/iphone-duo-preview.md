# iPhone Duo preview

Phoenix Mobile adapts to iPhone Duo (iOS 27.1) by size class: the outer 5.4 in display is compact width and behaves like today's phone, the inner 7.6 in display is regular width and shows two panes. The layout model lives in `src/features/duo/layout.ts`, the pane container in `src/components/duo/arrangement.tsx`, and the design notes in `FINDINGS.md` ("iPhone Duo Layouts Are Size-Class Arrangements").

## Two-pane screens on the inner display

| Screen   | Primary (leading or top)            | Secondary (trailing or bottom)                                            |
| -------- | ----------------------------------- | ------------------------------------------------------------------------- |
| Project  | Trace feed with summary and filters | Selected trace detail                                                     |
| Sessions | Review queue and session list       | Selected session's conversation and review tools                          |
| Session  | Conversation transcript             | Review form, PXI notes, actions (controls on the bottom in tabletop pose) |
| PXI chat | Conversation and composer           | Chat history rail                                                         |

When the device is partially folded (book or tabletop), each split snaps to 50/50 around the fold with a gutter and animates between states.

## The vertical system bar

On both Duo displays, except the inner display in portrait, iOS stacks the status cluster, the stack's Back button, and icon bar items in a vertical bar on the trailing edge (safe-area inset `right: 84`, `bottom: 34`, nothing on top). The app follows it:

- `useDuoLayout().systemBarEdge` is `trailing`, `leading`, or `top`, derived from the insets.
- Screens pass `nativeHeaderTitle(systemBarEdge, title)` as their native title. It is empty beside a vertical bar, so the horizontal navigation bar collapses and the screen's own title starts at the top edge.
- The PXI button is a native bar item with a template image (`usePxiHeaderOptions`), which iOS places in the vertical bar directly under Back. Custom-view header items would stay in a horizontal bar.
- Content columns use `useContentColumnStyle(padding)` or `ContentColumn` inside a pane: the column grows by the horizontal insets and pads each side by its own inset, so content stays centered in the safe width and clear of the bar. `DuoArrangement` republishes clipped insets per pane, so only the trailing pane pads for the bar.

## The PXI pane

On a regular-width window the PXI button opens the PXI chat as a column over the trailing edge of the window (the bottom of the window in portrait) instead of pushing the chat route. The column is as wide as a trailing form sheet (the sheet's leading edge sits at 310 pt of the 951 pt window), so every surface that docks beside the vertical bar shares one leading edge, and its header uses the same treatment as a sheet: a title and a Done button, no close glyph. `PxiPaneShell` in the root layout keeps the native stack at full window width, pads screen content away from the column (`contentStyle` from `usePxiPaneStore().stackContentInset`), and reports the uncovered size through `DuoViewportContext`, so the screens beside PXI switch to their compact single-screen layouts. The screen that opened PXI pushes whatever its detail pane was showing (the selected trace or session) so the leading side keeps that content as the active screen; Back walks the stack as usual, and pressing the PXI bar item again or Done restores the two-pane layout. The stack is never placed in a narrower pane because UIKit stops delivering touches to the vertical bar of a navigation controller that does not span the window (see `FINDINGS.md`).

The column hosts only the chat. "Investigate with PXI" is a task, so `openPxiAction` always pushes the action sheet route (see "Surface model" below).

## Surface model

Every tap is one of three verbs, and the window's size class decides how each verb renders. New screens fit into one of these rows or need a design conversation first.

| Verb      | What it is                                                                                                                        | Compact (phone, closed Duo)                        | Regular (open Duo, iPad, wide web)                                                                             | Leaves by                                               |
| --------- | --------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------- |
| Navigate  | Picking a thing: instance, project, trace, session, a turn's trace                                                                | Pushes a page                                      | Fills the detail pane of the current split; a screen without a split pushes a page                             | Back                                                    |
| Task      | A job with a result and an end: Add instance, Settings, Review queue, New annotation config, Add to dataset, Investigate with PXI | Native bottom sheet with two detents and a grabber | Full-height native form sheet docked beside the vertical bar, page dimmed; a nested step stacks a second sheet | Swipe down or the sheet's own Done; never a close glyph |
| Companion | The PXI chat, kept beside the content                                                                                             | Full-screen chat route                             | Trailing column as wide as a sheet, title and Done header                                                      | The PXI bar item or Done                                |

The one exception to "navigate never rearranges the stack": opening the companion from a split pushes the selected detail as the page, so the chat has the thing the person was looking at beside it.

## Sheets on the trailing side

On the open Duo every sheet presentation docks a phone-width column to the leading edge and dims the display, covering the list the person is working from. The app keeps its native form sheets and moves them instead: the local Expo module in `modules/duo-sheets` sets `UISheetPresentationController.preferredPlacement` (iOS 27) on form sheets as they are presented, and `DuoSheetPlacement` in the root layout asks for `trailing` whenever the window is regular width with a vertical system bar. The root layout also drops the detents and grabber on regular width, so each sheet fills the column beside the bar. Compact width keeps the bottom sheets. After changing the module, run `pod install` in `ios` and rebuild.

## Preview harness

The Duo simulator ships only inside Xcode 27.1, so the app includes a harness that frames itself at Duo point sizes on any simulator. Turn it on from Settings ("iPhone Duo preview") or open `phoenixmobile://duo-preview?enabled=1&display=inner&pose=book&angle=120`. The floating controls switch display (outer or inner), orientation, pose (flat, book, tabletop), and hinge angle.

Run it on the iPad Pro 11-inch simulator, which has the inner display's regular size class, and on an iPhone simulator for the outer display:

```bash
export DEVELOPER_DIR=/Applications/Xcode-beta.app/Contents/Developer
npx expo prebuild --platform ios --no-install && (cd ios && pod install)
xcodebuild -workspace ios/PhoenixMobile.xcworkspace -scheme PhoenixMobile -configuration Debug \
  -sdk iphonesimulator -destination 'platform=iOS Simulator,name=iPad Pro 11-inch (M5)' \
  -derivedDataPath ios/build CODE_SIGNING_ALLOWED=NO build
xcrun simctl install booted ios/build/Build/Products/Debug-iphonesimulator/PhoenixMobile.app
npx expo start --dev-client   # bind to all interfaces; --localhost binds IPv6 only on this Mac
```

Add `DEV_CLIENT_DEFAULT_LAUNCHER_URL = http://localhost:8081` to the generated `ios/PhoenixMobile/Info.plist` to skip the dev launcher, because `simctl openurl` prompts "Open in Phoenix Mobile?" on iOS 27 and the prompt cannot be accepted from the command line.

## Scripted poses

`useDuoPreviewStore` persists under the `phoenix-duo-preview` key in AsyncStorage, including a `launchRoute` the harness opens once at startup. Seeding that key in the simulator's `RCTAsyncLocalStorage_V1/manifest.json` and relaunching lands the app on any screen in any pose without taps; that is how the screenshots in `FINDINGS.md` were produced.

## Real iPhone Duo simulator (Xcode 27.1)

With Xcode 27.1 RC installed at `/Applications/Xcode.app`, the `iPhone Duo` device type needs the iOS 27.1 simulator runtime (build 24A94232), which `xcodebuild -downloadPlatform iOS` fetches after the 27.0 image. Create and boot it, then install the app built against the 27.1 SDK:

```bash
export DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer
xcrun simctl create "iPhone Duo" com.apple.CoreSimulator.SimDeviceType.iPhone-Duo com.apple.CoreSimulator.SimRuntime.iOS-27-1
xcrun simctl boot "iPhone Duo"
open /Applications/Xcode.app/Contents/Applications/DeviceHub.app
```

The device boots closed. Opening, closing, rotating, and folding are bezel controls in Device Hub; `simctl` has no posture command. Device Hub exposes no accessibility tree, so System Events cannot press its buttons, but with Accessibility and Screen Recording granted to the terminal a CGEvent click (a ten-line Swift tool) at the button's screen position works: capture the window with `screencapture -l <windowId>` to find the posture buttons in the bottom bar (rotate, closed, open, folded) and to map app points to screen points for taps inside the device. Screenshots take a display ID: `--display=1` is the outer panel (1398 × 2034), `--display=3` the inner panel (2853 × 2007 open with a vertical hinge, 2007 × 2853 rotated, black while closed). The open window is 951 × 669 pt and the closed one 466 × 678 pt, both with insets `{ top: 0, right: 84, bottom: 34, left: 0 }`. On the real Duo the app needs no preview harness: the outer display is compact width and the inner display regular width through the window size alone, and the 27.1 SDK build runs edge to edge with the system's vertical status bar on the trailing edge.

## Upgrading to the real APIs

Expo SDK 58 adds `expo-hinge` and Expo UI's `ArrangementView` (Xcode 27.1 required). Replace the simulated division region in `useDuoLayout` with the hinge and a reserved-region binding, and `DuoArrangement` with the native arrangement, keeping the same primary/secondary boundaries.
