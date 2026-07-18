# Findings

This is the project's living technical memory. Record discoveries that would otherwise require another developer or agent to repeat an investigation.

## How To Use This Log

- Add new findings near the top of the relevant section.
- Use a date and one of these statuses: `Active`, `Resolved`, `Decision`, or `Watch`.
- State the observed behavior or evidence, not speculation.
- Include the practical implication for future work.
- Move obsolete findings to `Superseded` rather than silently deleting useful history.
- Keep implementation tasks in issues or working notes, not here.

## Active Constraints

### 2026-07-16 - Xcode 27 Beta Requires The UIKit Scene Lifecycle

**Status:** Active
**Area:** iOS, Expo, Xcode

Building the generated SDK 57 app with Xcode 27 beta raises `SIGTRAP` in `UIApplicationEvaluateRuntimeIssueForNoSceneLifecycleAdoption` because the template uses the legacy application lifecycle. Expo accepted [expo/expo#46664](https://github.com/expo/expo/issues/46664) for the same failure on SDK 56 and tracks it as an iOS 27 issue with upstream React Native work.

The local `with-ios-scene-lifecycle` config plugin moves React startup into `SceneDelegate`, assigns the scene window to both `SceneDelegate.window` and `AppDelegate.window`, and forwards scene URL opens through the existing AppDelegate path. Assigning `AppDelegate.window` is essential: without it, Expo Dev Launcher can load while the React root stays detached and black. This exact flow was verified on a physical iOS 27 device with Expo SDK 57.0.6 and Xcode 27 beta.

The App Store version of Expo Go does not yet include SDK 57. `eas go` and EAS physical-device builds require a paid Apple Developer membership, so local Xcode builds signed by the configured Personal Team are the available no-cost device workflow.

**Implication:** Keep the local scene plugin and regenerate iOS through `npm run ios:device:clean` until Expo resolves the accepted lifecycle issue. Revalidate React mounting, Expo Dev Launcher, initial URLs, and deep links whenever the generated AppDelegate changes.

### 2026-07-14 - PXI Uses The External Server-Agent Stream

**Status:** Decision
**Area:** PXI, networking

Phoenix Mobile sends AI SDK 6 `UIMessage` history to `/agents/server/sessions/{sessionId}/chat`, not the browser-mounted `/agents/assistant` route. The contract was verified against Phoenix 17.29.0 with `x-vercel-ai-ui-message-stream: v1`: plain text produced progressive snapshots, and a GraphQL question streamed a server-executed tool through `output-available` before the final answer.

Requests always set GraphQL mutations to disabled and edit permission to manual. AI SDK `ai@6.0.225` and `@ai-sdk/react@3.0.227` are installed within the Phoenix-compatible major versions, and Expo exports their transport for iOS, Android, and web.

**Implication:** Keep the mobile transport aligned with the Phoenix CLI contract and re-run a live text, tool, and abort probe when either side changes AI SDK versions. Never switch to bypass permissions or the web assistant route to work around a protocol mismatch.

### 2026-07-14 - PXI Sessions Persist In Platform Storage

**Status:** Decision
**Area:** PXI, security, persistence

PXI session metadata and complete ordered AI SDK messages persist in normalized `pxi_sessions` and `pxi_messages` tables through Expo SQLite on native. Web uses an IndexedDB implementation behind the same repository API. The app restores the most recently updated session for an instance, loads other message bodies only when selected from history, and sends restored history back to the server-agent endpoint when the conversation continues.

Database writes are serialized within each runtime, parameterized, and transactional. Durable deletion barriers plus a history generation prevent late stream completions from recreating cleared sessions. Optimistic session revisions reject competing web-tab branches instead of silently overwriting one transcript with another. Chat content is not written to AsyncStorage or logs.

The native SQLite file is app-private but not encrypted. Web records are scoped to the browser origin in IndexedDB and are likewise unencrypted. Expo's SQLCipher option is not enabled because it is unavailable in Expo Go and requires a separate key-management and native-build decision.

**Implication:** Treat local chat storage as sensitive user data, preserve explicit per-session and global deletion, and do not copy transcripts into Zustand or AsyncStorage. Encryption at rest remains a release-hardening decision.

### 2026-07-14 - Safari Web Uses IndexedDB Instead Of Expo SQLite

**Status:** Resolved
**Area:** persistence, web, Safari

Expo SQLite web support uses a WASM worker and `SharedArrayBuffer`. Even with COEP/COOP headers, an iPhone loading Metro over a plain HTTP LAN address is not in a secure context, so Safari cannot initialize the worker. PXI storage now resolves to IndexedDB on web and remains Expo SQLite on native; the web repository preserves revisions, deletion barriers, and history generations without requiring isolation headers.

**Implication:** Keep web storage free of Expo SQLite imports unless all supported web origins can guarantee secure-context isolation. Changes to the PXI repository contract must be implemented and verified in both storage backends.

### 2026-07-14 - PXI Model Availability Comes From GraphQL Preflight

**Status:** Decision
**Area:** PXI, model providers

The mobile model catalog queries `modelProviders` and `playgroundModels`, then applies the same ordered allowlist as Phoenix's `AgentModelMenu`. Only curated built-in models whose provider dependencies and credentials are ready are selectable. Other built-in and custom-provider models stay hidden, matching the main agent menu's default `limitToCuratedModels` behavior.

**Implication:** Revalidate before each new app session, keep the allowlist synchronized with Phoenix's `agentCuratedModels.ts`, and show an actionable no-model state. Never request or persist model provider credentials on the phone.

### 2026-07-14 - Authentication Is Deliberately Incomplete

**Status:** Active  
**Area:** Connections, security

`PhoenixInstance.auth` supports `none` and reserves an `oauth2` shape, but client creation currently rejects authenticated instances. SecureStore is installed for the future token flow.

**Implication:** Do not represent OAuth connections as unauthenticated requests or persist credentials in AsyncStorage. The eventual flow needs secure token storage, refresh behavior, and authenticated client construction.

### 2026-07-14 - Phoenix Client Requires A Native Metro Shim

**Status:** Active  
**Area:** Metro, Phoenix SDK

`@arizeai/phoenix-client` imports `@arizeai/phoenix-config`, whose ESM entry eagerly imports `node:fs` and `node:path` for environment-file discovery. Mobile supplies explicit client options and never calls those helpers, but Metro still resolves the imports.

`metro.config.js` returns empty modules for only those two imports on iOS and Android.

**Implication:** Keep the shim until the upstream package offers a React Native-safe export path. Re-run native production exports when changing Phoenix client versions.

### 2026-07-14 - Web Static Rendering Needs Server-Safe Persistence

**Status:** Active  
**Area:** Zustand, AsyncStorage, Expo Router web

Expo Router statically renders routes in Node. AsyncStorage's web implementation accesses `window`, so eager persistence during SSR crashes the export.

Persisted stores use a no-op `StateStorage` adapter when rendering web routes without `window`.

**Implication:** New persisted stores must follow the same server-safe pattern. Verify with `npx expo export --platform web --clear`.

### 2026-07-14 - Local Instances Need Explicit Network Permissions

**Status:** Active  
**Area:** iOS, Android, networking

Self-hosted Phoenix commonly runs at an HTTP LAN address. Android blocks cleartext traffic by default on modern targets, while iOS applies local-network and App Transport Security restrictions.

`app.json` intentionally enables Android cleartext traffic and configures iOS local-network usage and arbitrary HTTP loads.

**Implication:** Do not remove these settings while arbitrary local Phoenix hosts remain a supported use case. Prefer HTTPS for remote deployments and revisit the broad iOS transport exception before release hardening.

### 2026-07-14 - Form Sheets Are Native-First

**Status:** Decision  
**Area:** Navigation, UI

Connection creation and settings use Expo Router `formSheet` presentations with detents, grabbers, and rounded corners. Web renders these routes as ordinary pages because native sheet presentation is unavailable.

**Implication:** Keep route content usable both inside a constrained native sheet and as a full web page. Validate sheet height, keyboard behavior, and dismissal on native.

### 2026-07-14 - Projects Use The Typed Phoenix REST Client

**Status:** Decision  
**Area:** Data fetching

The instance dashboard calls typed `GET /v1/projects` through `@arizeai/phoenix-client`. Query keys are scoped by instance ID, and TanStack Query owns the resulting server state.

**Implication:** Add new Phoenix data through query hooks with instance-scoped keys. Do not copy REST responses into Zustand.

### 2026-07-14 - Browser Chrome Has Platform Limits

**Status:** Active  
**Area:** Safari, PWA

CSS can color the document but cannot remove normal iOS Safari toolbars. The app config and `+html.tsx` provide dark theme metadata, `black-translucent` standalone status styling, and `viewport-fit=cover`.

**Implication:** Test the installed Home Screen experience separately from an ordinary Safari tab. Do not treat browser-controlled bars as React Native layout defects.

## Resolved Bugs And Reusable Patterns

### 2026-07-18 - Android Menu Triggers Consume Nested Presses

**Status:** Resolved
**Area:** Android, Expo UI, PXI, interaction

Expo SDK 57's `MenuView` uses an internal React Native `Pressable` as its Android trigger. That outer trigger claims the gesture, so nested press handlers do not fire; iOS uses a SwiftUI context-menu host and does not exhibit the same responder conflict. Wrapping a PXI tool disclosure in `MenuView` therefore prevented Android users from expanding tool and subagent details.

Tool disclosure controls now remain outside the context-menu trigger. Long-press copy actions wrap only the expanded, non-interactive detail surface.

**Implication:** Do not place pressable controls, links, or other tap interactions inside `NativeContextMenu`. Attach the menu to a non-interactive surface or provide a separate trigger, and verify both tap and long-press behavior on Android.

### 2026-07-16 - Android Chat Must Avoid The Keyboard Explicitly

**Status:** Resolved
**Area:** Android, PXI, keyboard

The generated Android activity already uses `windowSoftInputMode="adjustResize"`, but the PXI `KeyboardAvoidingView` previously enabled a behavior only on iOS. On a physical Pixel running Android 17, opening the keyboard covered the composer despite the activity resize policy. PXI now uses `height` avoidance on Android while retaining `padding` on iOS.

**Implication:** Preserve both the generated `adjustResize` policy and explicit Android keyboard avoidance. Verify the empty chat, long transcript, multiline composer, and keyboard dismissal on a physical Android device after changing chat layout or edge-to-edge configuration.

### 2026-07-16 - PXI Saves Must Not Await Session-List Refetches

**Status:** Resolved
**Area:** PXI, persistence, TanStack Query

PXI persisted each message snapshot to the serialized SQLite repository and then awaited invalidation of the active session-list query before resolving the save. On native, a completed first turn could leave that refetch pending indefinitely. The next submission waited behind the unresolved persistence queue, so its send button disabled while the text remained in the composer.

Successful saves now update both the session detail and ordered session-summary caches directly from the returned durable record. Follow-up submission proceeds as soon as the database commit completes.

**Implication:** Do not include query refetches in the serialized persistence completion path. Update caches synchronously when a mutation already returns the authoritative record, and reserve refetches for explicit reconciliation paths.

### 2026-07-16 - Form Sheet Frames Must Update Synchronously

**Status:** Resolved
**Area:** iOS, navigation, form sheets

With Fabric and fixed form-sheet detents, asynchronous React Native layout transactions could restore the smaller detent's frame after a sheet expanded. Settings and connection content then appeared clipped or disappeared entirely. `react-native-screens` tracks this frame-ordering race and provides `featureFlags.experiment.synchronousScreenUpdatesEnabled` for React Native 0.82 and newer.

The app enables synchronous screen updates before mounting navigation. Sheet routes expose their `ScrollView` as the screen root because iOS form-sheet sizing and scroll-driven expansion require a direct first-child path to the scroll view. Keyboard and safe-area spacing are applied as scroll insets and content padding instead of adding layout wrappers around the scroll view.

**Implication:** Keep synchronous screen updates enabled while these routes use fixed native detents. Preserve the root-scroll-view hierarchy and re-test both detents, keyboard presentation, top and bottom scroll extents, and settled content after React Native or `react-native-screens` upgrades.

### 2026-07-14 - npm ci Removes Expo SQLite's Generated iOS Source

**Status:** Resolved
**Area:** iOS, Expo SQLite, setup

Expo SQLite 57 ships its SQLite amalgamation under `vendor/` and copies `sqlite3.c` and `sqlite3.h` into its `ios/` directory while CocoaPods evaluates the podspec. Running `npm ci` replaces `node_modules` and removes those generated copies, but an existing Pods project can still reference them without causing Expo CLI to reinstall pods.

The iOS device setup script now runs `pod install` after `npm ci`, which evaluates the podspec and restores the source files before building.

**Implication:** Keep CocoaPods installation after clean JavaScript dependency installation. A missing `node_modules/expo-sqlite/ios/sqlite3.c` indicates stale pods, not a source file that should be checked into the app.

### 2026-07-14 - Streaming Chat Scroll Follows Reader Intent

**Status:** Decision
**Area:** PXI, scrolling, Markdown

PXI keeps following streamed output only while the reader remains at the live edge. Sending a new turn explicitly re-engages live-edge following; touching or dragging the transcript releases it, subsequent chunks arrive without stealing position, and the Latest control explicitly returns to and re-engages the live edge. Saved threads reopen at the latest user turn, and `maintainVisibleContentPosition` limits displacement when rich content changes size.

Assistant text renders through `@ronradtke/react-native-markdown-display`'s `MarkdownStream`. It provides a pure-JavaScript native-view renderer, seals incomplete streaming fences, supports styled headings, lists, links, quotes, tables, and syntax-highlighted code, and does not require another native client rebuild. Model-generated links are restricted to HTTP and HTTPS. The AI SDK UI update throttle remains 50 ms so token chunks do not force unbounded parsing and layout work.

**Implication:** Scroll state must distinguish reader interaction from programmatic and layout-driven scroll events. Keep Markdown styles aligned with Phoenix tokens, handle external links explicitly, and re-test long code blocks, tables, selection, and mid-stream scrolling when changing the renderer or transcript list.

### 2026-07-14 - Animated Rows Dematerialized After Settling

**Status:** Resolved  
**Area:** Reanimated, Gesture Handler, lists

Connection and project rows appeared during their entrance animation, then slowly faded or collapsed after settling. The affected rows combined Reanimated entering/layout builders with swipeable or bordered list containers.

Rows now animate with persistent shared opacity and translation values. Their final opacity remains explicitly at `1`.

**Implication:** Do not reintroduce entering/layout builders around these row types. When adding list animation, wait several seconds after entrance and verify that content remains mounted and visible.

### 2026-07-14 - Expo Router Link Wrappers Broke Pressable Layout On Web

**Status:** Resolved  
**Area:** Expo Router, React Native web

`Link` with `asChild` caused styled Pressable connection rows and the primary add action to lose their expected web layout. Content rendered as unstyled vertical text.

The app now uses `router.push` from MotionPressable or Pressable components.

**Implication:** Exercise any new `Link asChild` composition on web before adopting it for a complex styled control.

### 2026-07-14 - AsyncStorage Hydration Crashed Static Export

**Status:** Resolved  
**Area:** SSR, persistence

The Zustand hydration completion callback wrote to AsyncStorage while Expo Router rendered in Node, producing `ReferenceError: window is not defined`.

The persisted stores now choose no-op server storage during SSR.

**Implication:** Persistence callbacks can write as well as read. Both directions must be safe on the server.

### 2026-07-14 - Phoenix Client Failed Native Bundling

**Status:** Resolved with active workaround  
**Area:** Metro, native builds

Native export originally failed to resolve `node:fs` from `@arizeai/phoenix-config`.

The targeted Metro resolver shim fixed iOS and Android bundling without polyfilling Node APIs that the app never uses.

**Implication:** Prefer a narrow empty-module shim over broad Node polyfills. Track upstream compatibility when upgrading.

## Design Decisions

### 2026-07-14 - Chat Overlays Use Expo UI Native Surfaces

**Status:** Decision
**Area:** chat, native UI, sheets, menus

Model selection and chat history use the universal `@expo/ui` `BottomSheet`, which maps to SwiftUI presentation detents, Material 3 `ModalBottomSheet`, and a Vaul drawer on web. Their React Native list content is hosted through `RNHostView`. On iOS, the universal sheet adds native content margins around that host; applying the canvas color to `RNHostView` creates a rectangular surface inside the rounded sheet. The sheet instead sets its SwiftUI presentation background while leaving the hosted subtree transparent. Transcript long-press actions use `@expo/ui/community/menu` on iOS and Android, with a pass-through web implementation where text remains selectable.

**Implication:** Keep React Native sheet content inside `RNHostView`, apply native sheet chrome at the presentation boundary rather than the inset host, test nested scrolling and gestures on both native platforms, and preserve a functional web fallback when adding menu actions that are otherwise only available through native context menus.

### 2026-07-14 - Phoenix Visual Language

**Status:** Decision  
**Area:** Design system

The app uses Phoenix's Geist typography, monochrome semantic primary controls, `#0E0E0E` and `#FDFDFD` canvases, and cyan/seafoam brand accents. The official Phoenix bird asset is bundled at `assets/images/phoenix-logo.png`.

**Implication:** New UI should extend these tokens rather than introducing an unrelated accent palette or generic card-heavy dashboard styling.

### 2026-07-14 - Home Is A Collection Screen, Not A Landing Page

**Status:** Decision  
**Area:** Product UI

The home route shows `Instances`, the instance collection, and bottom thumb-reachable settings/add controls. Marketing headlines and persistent promotional copy were removed.

**Implication:** Prioritize immediate utility and current state. Product education belongs in contextual empty states or onboarding, not recurring home-screen copy.

### 2026-07-14 - Motion Must Explain State

**Status:** Decision  
**Area:** Interaction design

Reanimated provides press response, loading motion, staggered row entrance, and state transitions. Gesture Handler provides swipe actions, and Expo Haptics confirms meaningful touch interactions. Reduced-motion settings are respected.

**Implication:** Add animation to improve causality, touch response, or continuity. Avoid long decorative sequences that delay access to Phoenix data.

## Watch

### 2026-07-14 - Dependency Audit Reports Moderate Advisories

**Status:** Watch  
**Area:** Dependencies

The current npm install reports moderate transitive advisories, including advisories inherited from the Expo and Phoenix dependency trees. No forced upgrade has been applied.

**Implication:** Review advisories before production release. Do not run a breaking `npm audit fix --force` without evaluating Expo SDK compatibility.

## Superseded

No entries yet.
