# Plan 001: Ship Instance-Scoped PXI Streaming Chat

> **Executor instructions**: Follow this plan in order. Run every verification command and confirm the expected result before moving on. If a STOP condition occurs, stop and report it instead of inventing a new protocol or product direction. Update the status row in `plans/README.md` when work begins and when it is complete.
>
> **Drift check (run first)**: Compare the files and Phoenix references in "Current state" with the live code. This plan was authored with the initial Phoenix Mobile foundation in the same checkpoint, so the first executor should record that checkpoint's commit SHA in this document before changing implementation files.

## Status

- **Priority**: P1
- **Effort**: L
- **Risk**: HIGH
- **Depends on**: none
- **Category**: feature
- **Planned on**: 2026-07-14
- **Planned at**: commit `d7a9043`

## Why This Matters

Connecting an instance proves the mobile foundation works, but it does not yet provide a uniquely valuable workflow. PXI makes the Phoenix agent available wherever a user is reviewing their connected instance and gives the application a useful mobile-first center of gravity. The feature must preserve Phoenix's streaming protocol and tool visibility while behaving like a native, touch-oriented conversation rather than a compressed copy of the desktop panel.

## Product Decisions

- PXI is available after the user selects a Phoenix instance.
- Selecting an instance establishes a persisted, non-secret `activeInstanceId`. The selected instance remains active while the user visits other routes.
- A floating PXI button appears in the top-right of every route while the active instance still exists. Hide it only on the PXI chat route itself and when no active instance is valid.
- Pressing the button opens a full-screen chat for the active instance. Do not use a narrow popover on phones.
- The button and assistant identity use the five-cell PXI glyph from the Phoenix web application. The first version is a static SVG with no shader runtime; shader-backed treatments are a separate follow-up.
- The first release is read-only. GraphQL mutations are disabled, `editPermission` remains `manual`, and bypass permissions must not be sent.
- Sessions and complete AI SDK messages persist locally in Expo SQLite on native and IndexedDB on web so users can restore and continue prior chats. Do not put transcript or tool content in AsyncStorage.
- Keep the current React Native styles and theme tokens. NativeWind, Tailwind conversion, shadcn DOM components, and `streamdown` are out of scope.

## Current State

### Phoenix Mobile

- `src/app/_layout.tsx` owns the root Expo Router `Stack`, providers, fonts, status bar, and route presentation.
- `src/app/index.tsx` renders the instance collection. An instance is currently opened inside `InstanceCard`, without recording a global active instance.
- `src/app/instances/[id].tsx` resolves an instance from `useInstanceStore` and renders version and projects.
- `src/store/instances.ts` persists `instances` through Zustand and AsyncStorage with server-safe storage. It has no active-instance field.
- `src/components/motion-pressable.tsx` is the standard press animation and haptic primitive.
- `src/constants/theme.ts` contains light/dark tokens, Geist font names, spacing, and content width.
- There is no test runner or test suite yet. `npm run typecheck`, `npm run lint`, `npx expo-doctor`, and Expo export are the available automated gates.

### Phoenix PXI References

Treat the following paths in a local checkout of the Arize Phoenix repository as protocol and visual references. Do not import source files across repositories.

- `js/packages/phoenix-cli/src/pxi/types.ts` defines `PxiMessage`, assistant metadata, model selection, contexts, edit permissions, and the server-agent request body.
- `js/packages/phoenix-cli/src/pxi/client.ts` builds `/agents/server/sessions/{sessionId}/chat`, sends complete `UIMessage[]` history, and consumes the AI SDK UI-message stream.
- `js/packages/phoenix-cli/src/pxi/preflight.ts` queries configured providers and models before chat starts.
- `app/src/components/agent/useAgentChat.ts` is the browser `useChat` implementation and documents tool/continuation behavior.
- `app/src/components/agent/PxiGlyph.tsx` is the source of truth for the static PXI glyph used in the web FAB.
- `app/src/components/agent/PxiShaderSVG.tsx` contains the same five-cell mark at shader scale. The shader wrappers are intentionally deferred.

The static glyph is five rounded squares in a 3-by-3 grid: top-left, top-right, center, bottom-left, and bottom-right. In `PxiGlyph.tsx`, each cell is `5.5` units with radius `1.1`, a `1` unit gap, and a total view box of `18.5` square units. Preserve this geometry instead of substituting the Phoenix bird logo.

### Wire Contract

Use the external-client route:

```text
{instance.baseUrl}/agents/server/sessions/{encodedSessionId}/chat
```

Do not use `/agents/assistant/...`; that route belongs to the Phoenix web assistant and relies on browser-mounted context and tools.

Each submitted turn sends the full message history and this request shape:

```ts
type PxiChatRequest = {
  id: string;
  messages: PxiMessage[];
  trigger: 'submit-message';
  ingestTraces: boolean;
  exportRemoteTraces: boolean;
  attachUserId: boolean;
  editPermission: 'manual';
  contexts: [
    { type: 'app'; currentDateTime: string; timeZone: string },
    { type: 'graphql'; mutationsEnabled: false },
    { type: 'web_access'; enabled: boolean },
    { type: 'subagents'; enabled: boolean },
  ];
  model: ModelSelection;
};
```

Match Phoenix's currently deployed client generation by installing `ai@^6.0.219` and `@ai-sdk/react@^3.0.221`. Do not silently upgrade this feature to AI SDK 7. Use `expo/fetch` as the native streaming fetch implementation and validate its type adapter rather than replacing streaming with polling.

## Commands You Will Need

| Purpose | Command | Expected On Success |
|---------|---------|---------------------|
| Install compatible dependencies | `npm install ai@^6.0.219 @ai-sdk/react@^3.0.221` | exit 0; lockfile updated |
| Install native SVG | `npx expo install react-native-svg` | exit 0; Expo-compatible version installed |
| Typecheck | `npm run typecheck` | exit 0, no errors |
| Lint | `npm run lint` | exit 0, no errors |
| Dependency diagnostics | `npx expo-doctor` | exit 0, no actionable failures |
| Build all platforms | `npx expo export --platform all --clear` | exit 0; iOS, Android, and web bundles exported |

Use `npm`; this repository commits `package-lock.json`.

## Scope

### In Scope

- `package.json`
- `package-lock.json`
- `src/app/_layout.tsx`
- `src/app/index.tsx`
- `src/app/instances/[id].tsx`
- `src/app/instances/[id]/chat.tsx` or the equivalent valid Expo Router route after resolving the file/directory conflict described below
- `src/components/instance-card.tsx`
- `src/components/pxi-fab.tsx` (create)
- `src/components/pxi-glyph.tsx` (create)
- `src/components/chat/**` (create)
- `src/features/pxi/**` (create)
- `src/store/instances.ts`
- `src/types/instance.ts` only if the selected model is attached to instance metadata
- `src/constants/theme.ts` only for reusable semantic chat tokens
- focused test files and minimal test-runner configuration if added during this plan
- `FINDINGS.md` for confirmed non-obvious implementation constraints
- `plans/README.md` and this plan for status

Expo Router cannot have both `src/app/instances/[id].tsx` and a sibling `[id]/chat.tsx` directory on disk. Prefer moving the dashboard to `src/app/instances/[id]/index.tsx`, adding `[id]/chat.tsx`, and updating the root Stack declarations without changing the public dashboard URL `/instances/{id}`.

### Out Of Scope

- Tailwind, NativeWind, or a styling-system migration
- shadcn components or `@shadcn/react`
- `streamdown` or any dependency on `react-dom` in native chat rendering
- shader packages, WebGL shader ports, or animated shader backgrounds
- GraphQL mutations, edit execution, bypass permissions, and approval submission
- bash execution on the phone
- client-side web-browser tools
- cloud synchronization or server session history
- OAuth implementation; transport must be able to accept future headers, but this plan does not build the OAuth flow
- attachments, voice input, notifications, and background stream continuation
- complete parity with the Phoenix desktop agent panel

## Git Workflow

- Work from the current branch unless the operator requests another branch.
- Keep implementation commits logically scoped and use concise imperative messages, matching the repository's existing `Initial commit` style.
- Do not push or open a pull request unless explicitly requested.
- Do not modify unrelated user changes in a dirty worktree.

## Steps

### Step 1: Prove Native Streaming Before Building The UI

1. Install the exact AI SDK major versions listed above.
2. Create `src/features/pxi/types.ts` with the minimum protocol types mirrored from Phoenix CLI. Keep comments pointing to the upstream source paths and note the date reviewed.
3. Create `src/features/pxi/client.ts` with pure helpers for URL construction, local ISO time with UTC offset, request contexts, and request body construction.
4. Build the transport with `DefaultChatTransport` and `expo/fetch`. The endpoint must trim trailing slashes and URL-encode session IDs.
5. Inject fetch into the transport so protocol behavior can be tested independently.
6. Use `crypto.randomUUID()` only after confirming it is available on all supported targets; otherwise use an Expo/RN-safe UUID implementation already present in the runtime. Do not add a random-ID dependency without first reproducing the need.
7. Create a temporary development-only transport harness or a focused test that sends one text message, observes incremental chunks, and aborts an in-flight reply. Remove any temporary route before completing this step.

Default first-release capabilities:

```ts
{
  ingestTraces: true,
  exportRemoteTraces: false,
  attachUserId: false,
  editPermission: 'manual',
  enableGraphqlMutations: false,
  enableWebAccess: true,
  enableSubagents: true,
}
```

**Verify**: On a real Phoenix instance with a configured model, one request emits at least two incremental snapshots for a sufficiently long response, the final text is complete, and Stop produces an abort rather than an unhandled rejection. Run `npm run typecheck` and expect exit 0.

**STOP if**: `expo/fetch` cannot expose a readable UI-message stream on either iOS or Android, the server response is not compatible with AI SDK 6's UI-message stream, or the route requires browser-only client tools. Record the exact request, response headers, platform, and error without falling back to polling.

### Step 2: Discover And Select A Valid Model

1. Port the GraphQL model preflight query from `phoenix-cli/src/pxi/preflight.ts` into `src/features/pxi/model-catalog.ts` using the existing Phoenix instance request infrastructure where practical.
2. Return only providers whose dependencies are installed and whose required credentials are set, plus configured custom providers.
3. Prefer the first available model from Phoenix web's curated order in `app/src/components/agent/agentCuratedModels.ts`; otherwise present the available server models for explicit selection.
4. Persist only the selected provider/model identifiers as non-secret preferences scoped to the instance. Never persist provider credentials.
5. Show an actionable empty state when no model is usable: identify the instance and direct the user to configure an AI provider in Phoenix Settings.
6. Revalidate the model before a new session, and keep the model fixed for the duration of an active session.

**Verify**: Exercise a server with a configured built-in provider, a custom provider if available, and a server with no credentials. The first two produce a valid `ModelSelection`; the last cannot send and shows setup guidance. `npm run typecheck` exits 0.

### Step 3: Add Persistent Active-Instance Selection

1. Extend `InstanceState` in `src/store/instances.ts` with `activeInstanceId: string | null` and `setActiveInstanceId(id)`.
2. Include `activeInstanceId` in the persisted non-secret slice.
3. Set it before navigating from an instance card. Also set it when a valid instance dashboard is reached through a deep link.
4. When the active instance is removed, clear the active ID. Do not automatically select an unrelated instance.
5. After hydration, treat a stale ID that no longer matches an instance as no active instance.

**Verify**: Select an instance, visit Settings and return home, then reload the app. The same valid instance remains active. Remove it and confirm the active state and FAB disappear. Static web rendering must not access `window` through storage. Run `npm run typecheck` and `npm run lint`; both exit 0.

### Step 4: Build The Static PXI Glyph And Global FAB

1. Install Expo's compatible `react-native-svg` version.
2. Create `src/components/pxi-glyph.tsx` using the exact five rounded rectangles from Phoenix web's `PxiGlyph.tsx`. Support `size` and `color`; set the SVG and cells hidden from accessibility because the button owns the label.
3. Create `src/components/pxi-fab.tsx` using `MotionPressable`. Use a minimum 48-by-48 point target, a circular or softly squared high-contrast surface, restrained elevation, and the static glyph. The accessibility label is `Open PXI for {instanceName}`.
4. Mount the FAB once from the root layout so it survives route changes and reads the active instance from the store.
5. Position it at the top-right inside safe-area and route-header bounds. It must not overlap native back controls, route titles, sheet grabbers, status-bar content, or the home route's Phoenix logo. The implementation may use a small route-aware vertical offset, but there must remain one shared FAB component and one source of visibility state.
6. Show it on every route after selection, including home and settings, except the PXI chat route itself. Ensure native form-sheet presentation does not render the FAB behind the sheet or duplicate it.
7. Pressing it pushes the active instance's chat route. Use selection/light haptics and reduced-motion-safe press feedback.
8. Do not add shader dependencies or approximate shader animation in this step.

**Verify**: On iOS, Android, and a narrow web viewport, select an instance and navigate through home, dashboard, Add Instance, and Settings. Exactly one FAB remains reachable at top-right without covering navigation or primary actions. It disappears when the active instance is removed and while chat is open. VoiceOver/TalkBack announces the instance-specific label. `npm run typecheck` and `npm run lint` exit 0.

### Step 5: Build The Full-Screen Chat Shell

1. Move the dashboard route to `src/app/instances/[id]/index.tsx` and add `src/app/instances/[id]/chat.tsx`, preserving `/instances/{id}`.
2. Present chat as a normal full-screen pushed route with a native back affordance, the instance name, a compact model selector, and a New Chat action.
3. Generate one session ID when the route opens or New Chat is pressed. Keep session state scoped by instance and session in memory.
4. Place a multiline composer above the keyboard and bottom safe area. Enter inserts a newline on mobile; an explicit button sends. Web may support Cmd/Ctrl+Enter.
5. Change Send to Stop while streaming. Disable empty and whitespace-only submissions.
6. Dismiss the keyboard when the transcript is dragged, without shifting the reader to the bottom.
7. Include empty, preflight-loading, no-model, ready, streaming, stopped, and error states.

**Verify**: On iOS and Android, open chat from at least two routes, send text with multiple lines, stop a response, dismiss and reopen the keyboard, start a new chat, and navigate back. No content is hidden by keyboard or safe areas. `npm run typecheck` and `npm run lint` exit 0.

### Step 6: Implement Native Transcript And Streaming Behavior

1. Use `FlatList` initially. Do not embed a second virtualized list inside a message row.
2. Render user messages as compact trailing bubbles. Render PXI responses full-width and unframed.
3. Render assistant text as selectable native text in the first pass. If adding Markdown in this plan, choose a React Native renderer that does not require `react-dom` and does not create a nested virtualized list. Links must require an explicit press and use the system browser.
4. Render tool parts as a vertical timeline with clear waiting, running, completed, failed, and approval-required states. Unknown parts must degrade to a labeled disclosure rather than crash.
5. Display trace metadata as an optional `View trace` action only when a trace ID exists.
6. Throttle visual token updates if needed so the list does not rerender on every tiny chunk. Final text must never be dropped.
7. Implement live-edge behavior:
   - Follow streaming output only while the reader remains near the end.
   - Stop following as soon as the reader scrolls away.
   - Show a `Jump to latest` control when new content arrives offscreen.
   - Do not move the transcript during text selection or tool disclosure interaction.
   - Preserve visible position if older messages are prepended in a later iteration.
8. When a user submits, place that turn near the upper portion of the viewport while retaining enough preceding context to orient the reader.
9. Avoid animating row dimensions, padding, or margins. Use persistent Reanimated shared values for any opacity or translation and verify settled opacity remains `1`.
10. Respect reduced motion and dynamic text sizes.

**Verify**: Stream a long answer, scroll away during generation, select text, expand a tool card, return with Jump to latest, and wait for all animations to settle. The transcript never steals position while reading, no message disappears, and the final response exactly matches the accumulated stream. Repeat in light and dark modes at large text size.

### Step 7: Harden Errors, Cancellation, And Lifecycle

1. Map connection, authorization, missing model credentials, incompatible server, server error, malformed stream, and user cancellation to distinct messages.
2. Keep the completed portion of an interrupted assistant response and label it stopped.
3. Offer Retry from the last user turn without duplicating that turn.
4. Abort the stream when New Chat is pressed or the active instance is removed.
5. On app backgrounding, do not claim the stream continues. If the platform interrupts it, preserve received content and expose Retry after foregrounding.
6. Prevent concurrent sends in one session.
7. Never log full messages, tool payloads, credentials, or authorization headers.

**Verify**: Test airplane mode, server shutdown mid-stream, invalid model credentials, Stop, rapid double-send, app background/foreground, and active-instance removal. Every case ends in a recoverable state with no unhandled promise rejection or leaked sensitive log content.

### Step 8: Complete Cross-Platform Validation And Documentation

1. Run all automated gates.
2. Inspect populated, empty, loading, streaming, stopped, and error states in light and dark modes.
3. Validate real iOS and Android devices or simulators; browser success alone is insufficient for streaming, keyboard, haptics, and safe areas.
4. Record confirmed protocol, platform, or rendering constraints in `FINDINGS.md` without copying this implementation checklist there.
5. Update the row in `plans/README.md` to `DONE` only after every done criterion holds.

**Verify**:

```bash
npm run typecheck
npm run lint
npx expo-doctor
npx expo export --platform all --clear
```

All commands exit 0. Exported bundles exist for iOS, Android, and web.

## Test Plan

If adding a test runner, use the Expo SDK 57-supported setup and keep it minimal. At minimum, add focused tests for pure protocol and store behavior:

- URL trimming and encoded session IDs
- local ISO timestamp offset formatting
- read-only PXI contexts and request body
- custom and built-in model selections
- active-instance persistence and stale/removal cleanup
- stream snapshot accumulation and cancellation classification
- unknown message-part fallback
- live-edge state transitions as a pure reducer/helper if extracted

Manual device scenarios remain required for:

- incremental streaming through `expo/fetch`
- keyboard and safe-area behavior
- top-right FAB layering across native stack and form-sheet routes
- screen-reader labels and focus order
- long transcripts, text selection, and scroll anchoring
- app background and foreground interruption

## Done Criteria

- [x] A valid selected instance exposes exactly one top-right PXI FAB on every non-chat route.
- [x] The FAB uses the same static five-cell SVG geometry as Phoenix web and has no shader dependency.
- [x] Removing or invalidating the selected instance removes the FAB and aborts its active chat.
- [ ] Chat streams incrementally from `/agents/server/sessions/{sessionId}/chat` on iOS and Android.
- [x] AI SDK versions remain compatible with Phoenix's AI SDK 6 wire implementation.
- [x] GraphQL mutations are disabled and bypass permission is never sent.
- [x] Users can send, stop, retry, start a new session, select a configured model, and inspect tool progress.
- [ ] Scrolling away stops auto-follow; Jump to latest restores it.
- [x] Chat history persists in SQLite on native and IndexedDB on web; no transcript or tool payload is persisted to AsyncStorage or logged.
- [ ] Light, dark, reduced-motion, large-text, empty, loading, streaming, stopped, and error states are verified.
- [x] `npm run typecheck`, `npm run lint`, `npx expo-doctor`, and `npx expo export --platform all --clear` exit 0.
- [ ] `plans/README.md` marks Plan 001 `DONE`.

Implementation and live protocol verification completed on 2026-07-14. Plain text streaming produced seven progressive AI SDK snapshots, a server GraphQL tool turn produced 37 snapshots with a completed tool part, and abort propagated successfully. Native bundles export successfully, but this machine has neither Xcode simulator tools nor Android `adb`; the remaining unchecked items require native interaction QA.

## STOP Conditions

Stop and report instead of improvising if:

- Phoenix's server-agent route or request body differs from the references above.
- The target Phoenix server uses an AI SDK stream incompatible with `ai@6`.
- `expo/fetch` cannot stream or abort correctly on either native platform.
- A usable model cannot be discovered without credentials on the phone.
- The FAB cannot remain above native Stack form sheets without duplicating route-specific state.
- The implementation requires persisting full transcripts to satisfy basic route navigation.
- A read-only request can execute a GraphQL mutation despite `mutationsEnabled: false` and manual edit permission.
- Completing the feature requires OAuth credentials before the repository's OAuth flow exists.
- Any verification fails twice after a reasonable fix attempt.

## Follow-Ups Explicitly Deferred

- Port Phoenix's shader-backed PXI glyph treatment after a native rendering approach is selected and profiled.
- Add explicit mutation approvals and elicitation forms before enabling any edit capability.
- Evaluate SQLCipher and key management before promising encrypted local chat history.
- Add server session summaries, rewind/branching, generated charts, file handling, and rich artifacts.
- Reconnect interrupted streams if the server adds a resumable stream contract.
- Extract a shared, runtime-neutral PXI protocol package upstream so CLI, web, and mobile no longer mirror handwritten contracts.

## Maintenance Notes

- The complete transcript is sent on each turn, so tool payload and history growth must be measured before durable long sessions are introduced.
- Review upstream Phoenix changes to `phoenix-cli/src/pxi/types.ts`, `client.ts`, and the generated server schemas whenever Phoenix compatibility is updated.
- Keep the static glyph component independent from the future shader wrapper so the accessible button and reduced-motion fallback remain available.
- The current route-global FAB is an intentional product affordance. Do not move it into only the instance dashboard when adding more routes.
