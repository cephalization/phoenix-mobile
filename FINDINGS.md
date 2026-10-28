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

### 2026-10-27 - Expo Go Runs The App; Trailing Sheets And OAuth Need A Development Build

**Status:** Decision
**Area:** Expo Go, onboarding, iOS, OAuth

The App Store Expo Go (58.0.5, released about 5 days after SDK 58) runs this project: `@expo/ui`, `expo-glass-effect`, SecureStore, Reanimated, and the rest of the dependency list are bundled in Expo Go. Because `expo-dev-client` is installed, plain `npx expo start` serves the development build and an Expo Go scan hands off to an app the collaborator does not have, so `npm run start:go` (`expo start --go`) is the Expo Go entry point. Two features stay dev-build only: `modules/duo-sheets` is loaded with `requireOptionalNativeModule` and is a no-op in Expo Go, so form sheets dock to the leading edge of the open Duo, and OAuth returns through the exact private `phoenixmobile://oauth/callback` redirect (see the 2026-07-24 OAuth entry), which Expo Go cannot own. Deriving the redirect from `Linking.createURL` was considered and rejected: it would register an `exp://<dev-machine>:8081/--/...` redirect with the Phoenix client, relax the exact-callback check that the OAuth entry relies on, and the registered client would stop matching when the same person switches between Expo Go and a development build.

The connection sheet reads optional `host` and `name` search params, so `exp://<computer>:8081/--/instances/new?host=192.168.1.20:6006` (Expo Go) or `phoenixmobile://instances/new?host=...` (dev build) opens the sheet prefilled; verification still runs before anything is saved. The root layout declares `unstable_settings.anchor = "index"` so a cold deep link to a sheet or the OAuth callback keeps the instance list underneath. `@expo/ngrok` is a devDependency so `npm run start:go -- --tunnel` works without an install step, `packageManager` names npm (it previously named yarn while the repository commits `package-lock.json`), and the create-expo-app `reset-project` script is gone.

**Implication:** Point new collaborators at the README quick start and Expo Go first; the development build is for trailing sheets, OAuth, and native changes. Keep the OAuth redirect private and exact; do not make it environment-dependent for Expo Go. The prefill link and the anchor were verified by typecheck, lint, and tests only; exercise a cold deep link on a device when touching the root stack.

### 2026-10-16 - Expo SDK 58 Brings React Native 0.88 Strict Types And The Built-In Scene Lifecycle

**Status:** Active
**Area:** Expo, React Native, dependencies, iOS, tooling

`npx expo install expo@^58.0.0 --fix` stopped with an npm `ERESOLVE` between `expo-router@58` and `expo-symbols@57` because npm resolved against the half-updated lockfile; deleting `node_modules` and `package-lock.json` and running `npm install` produced a clean tree: expo 58.0.12, React Native 0.88.0, React 19.3, `@expo/ui` 58.0.19, expo-router 58.0.21, react-native-screens 4.30, react-native-gesture-handler 3.3, Reanimated 4.7.1, react-native-worklets 0.13, TypeScript 6.0. The upgrade forced these code changes:

- React Native's Strict TypeScript API is the default. `FlatList` header and footer components no longer accept `null` (use `undefined`), `TextInput` refs are typed `TextInputInstance`, `AccessibilityValue` is read-only (build the literal in one expression), `useColorScheme()` returns `ColorSchemeName | null` (`'unspecified'` is gone), `RefreshControl.onRefresh` must return `void`, and React Hook Form's `handleSubmit` result is no longer assignable to `onPress` (wrap it in an arrow that discards the promise).
- Vitest's oxc transform fails with `Failed to load tsconfig 'expo/tsconfig.base'` unless `tsconfig.json` extends `expo/tsconfig.base.json` with the explicit suffix; `tsc` accepts both spellings.
- The local `with-ios-scene-lifecycle` config plugin is gone: `npx expo prebuild` now generates `SceneDelegate.swift` (an `ExpoAppSceneDelegate` subclass that creates the window) and the `UIApplicationSceneManifest`, and the old plugin would have refused the new `AppDelegate` template.
- `expo-doctor` 1.21.4 reports `ios.icon - cannot access file at './assets/expo.icon'` for the Icon Composer `.icon` bundle, which is a directory. Prebuild copies and links the bundle as before, so treat that single schema failure as a false positive until doctor learns about `.icon` bundles.
- `@expo/ui` 58 top-aligns `<Host>` content on iOS instead of centering it and defaults `spacing` to the system value in stacks; the app's hosts hold single sliders and the context-menu trigger, which were re-checked on the Duo simulator.

`ios/` was regenerated with `npx expo prebuild --clean --platform ios --no-install`, `DEV_CLIENT_DEFAULT_LAUNCHER_URL` re-added to `Info.plist`, pods installed, and the app rebuilt for the iPhone Duo simulator; the `modules/duo-sheets` module compiles unchanged against the SDK 58 modules core. `npx expo export --platform all --clear` passes. `expo-hinge` and `ArrangementView` are available but not yet adopted (see the 2026-10-15 Duo decision below).

**Implication:** Regenerate every native build after this upgrade (`npm run ios:device:clean`, `npm run android:device:clean`), start Metro with `--clear` once, and prefer `undefined` over `null` for optional list slots and read-only React Native prop objects. Keep `tsconfig.json` pointing at the `.json` base. Android has not been rebuilt or exercised on SDK 58 yet; the gesture-handler 3 and R8-by-default changes still need a device pass there.

### 2026-10-14 - Phoenix 20.11 Removed write_span_note; PXI Notes Go Through createSpanNote

**Status:** Decision
**Area:** PXI, annotations, networking

Phoenix 20.11.0 (`feat(skills): add phoenix-error-analysis skill`, arize-phoenix #15727) deleted PXI's built-in `write_span_note` tool and the `span-coding` skill. Headless agent turns on 20.4.0+ receive the in-process Phoenix MCP toolset in read-only code mode (discovery tools plus a sandboxed `execute` whose `call_tool(name, params)` reaches every `GET /v1/*` operation and, by explicit allow-list, `POST /v1/{span,trace,session}_notes`). `createSpanNote` takes `{ data: { span_id, note, identifier } }`, always stamps `annotator_kind=HUMAN` and `source=API`, and upserts on `(span, 'note', identifier)` when the identifier is non-empty. The mobile investigate prompt now names that tool and the exact `pxi` identifier (shared through `PXI_NOTE_IDENTIFIER`), and the action gates on 20.11.0. Verified live on 2026-10-14 against the dev instance (20.21.3) with headless `claude-sonnet-4-6` turns from curl and from a Pixel 9 Pro XL: the agent loaded `phoenix-error-analysis`, read the session with `getSession` and `getSpans`, called `execute` with `call_tool("createSpanNote", { data: { span_id, note, identifier: "pxi" } })`, and `GET /v1/projects/{id}/span_annotations` returned the note with identifier `pxi` and `annotator_kind` `HUMAN` on the turn's root span. A looser first draft of the prompt ("retrieve the session conversation") failed three times in a row on the device: the model reached for `executeSql` inside `execute`, then called `json.loads` on the already-decoded dict (which Phoenix's own tool docstring warns against), and pydantic-ai aborted the turn after its single tool retry with `Tool 'execute' exceeded max retries count of 1`. The prompt therefore names the exact REST operations, passes the project node id, and states that `call_tool` returns decoded objects; with that wording the same model succeeded on every attempt.

Two other headless-turn changes landed in 20.4.0 (`perf(agents): make the system prompt static`): typed page contexts (`session`, `project`, `trace`) are validated but no longer rendered to the model on `headless: true` turns, and the `graphql` context is deprecated with a server warning. Because `editPermission: 'manual'` on a headless turn can never approve mutations, GraphQL mutation tools are unreachable for mobile regardless of that context. The client stops sending it; the prompt carries the raw session id itself. `requestedSkills` is likewise honoured only for browser turns, so the agent loads `phoenix-error-analysis` on its own when useful.

**Implication:** Any new contextual action must put every identifier the agent needs into the prompt text and name the REST operations to use; do not rely on `contexts` to scope a headless run, and do not leave data access to the model's discretion because the SQL path fails under the one-retry budget. When verifying prompt edits on a device, confirm the served text: on 2026-10-14 the recorded `pxi.turn` input attribute in the `pxi_dev` project exposed that the phone was still receiving the previous `actions.ts` text because Metro had been started with `CI=1`, which disables file watching and Fast Refresh. Write notes only through `createSpanNote` with the `pxi` identifier so `fetchSessionPxiNotes` keeps finding them. Expect new tool names in transcripts from headless turns (`execute`, `search`, `get_schemas`, `get_tags`, `list_tools`, `load_skill_reference`, GitHub issue tools) and keep `TOOL_LABELS` current.

### 2026-10-14 - Trace Feeds And Range Statistics Use Server Filters Where Phoenix Supports Them

**Status:** Decision
**Area:** traces, observability, networking

Phoenix 20.12.0 added `filter` expressions to the trace list (`error_count > 0`, `latency_ms >= 1000`, …; invalid expressions return 400) and to the project session list. The mobile "errors" trace feed now pages the trace list with `filter: 'error_count > 0'` on servers at or above 20.12.0, matching the Phoenix UI's definition (any span in the trace errored) and restoring token counts and start-time ordering for that feed; older servers keep the root-span `status_code=ERROR` fallback. Range statistics now request `include_spans: true` with the route's maximum `limit` of 1000: each trace carries slim span rows (id, kind, status, timing) so error counts need no second spans request. Phoenix still has no single-trace read or aggregate statistics REST endpoint; the GraphQL `Project.traceCount`/`latencyMsQuantile` fields remain the only true aggregates. Server versions are resolved through the cached `getCachedServerVersion` so the gate costs no extra request per page.

**Implication:** Gate every new filter expression on `[20, 12, 0]` and keep the fallback path alive until that floor is the project minimum. The session list `filter` (annotation name and identifier comprehensions) can replace the review queue's client-side scan in a later change; `classifySessionReview` must stay the final authority because `annotator_kind` is not filterable.

### 2026-10-14 - Lint Policy Is oxlint Plus Vendored anti-slop; ESLint Is Gone

**Status:** Decision
**Area:** tooling, code quality

The repository replaced `eslint-config-expo` with oxlint 1.88.0 and `@oxlint/plugins` pinned together, oxfmt 0.73.0 (single quotes, 100 columns, sorted `package.json`), and the vendored anti-slop ruleset at `tools/oxlint/anti-slop` (upstream commit recorded in its UPSTREAM.md, installable skill under `.claude/skills/install-anti-slop`). The config is `.oxlintrc.json` (the TypeScript config format is still marked experimental by the CLI) with every generic anti-slop rule at error and the eslint-config-expo rules mapped onto their oxlint equivalents. Intentional policy deviations: `no-module-mocking` gained an `allowedModules` option so tests may mock native Expo modules with no Node implementation; `no-runtime-typeof` runs with `allowInTypeGuards`; `eslint/no-await-in-loop` is off because cursor pagination is inherently sequential; `react/immutability` is off because Reanimated shared values are assigned by design. The migration removed every `unknown` parameter and unjustified assertion from app code by narrowing untyped JSON through `src/lib/json.ts`, and the remaining tests exercise the real AI SDK transport and `Chat` against a mocked `expo/fetch`. `tools/` is excluded from the app `tsconfig.json` because the vendored rules import `.ts` extensions.

**Implication:** `npm run check` is the validation command. Fix findings in code rather than disabling rules; record any further policy change in `tools/oxlint/anti-slop/UPSTREAM.md`. The spacing rule and oxfmt must agree, so run `lint:fix`, then `fmt`, then lint again.

### 2026-10-14 - Expo SDK 57 Patch Alignment Fixes A Hermes V1 Memory Regression

**Status:** Resolved
**Area:** Expo, React Native, dependencies

`npx expo-doctor` flagged `expo@57.0.6` with Hermes V1 250829098.0.14, which carries a known memory regression fixed in 250829098.0.16; expo 57.0.9+ and React Native 0.86.2+ include the fix. `npx expo install --fix` moved the project to expo 57.0.29, React Native 0.86.3, react-native-screens 4.26, and current patches of every Expo module; `@arizeai/phoenix-client` moved to 7.16.1 (first release with generated agent-session schemas, which now back `src/features/pxi/sessions.ts`) and the AI SDK to `ai@7.0.140` / `@ai-sdk/react@4.0.143` (abort and `stop()` cleanup fixes). Typecheck, tests, lint, `expo-doctor` (21/21), and `expo export --platform all` pass after the upgrade without code changes beyond the type adoption.

**Implication:** Re-run `expo-doctor` before each release; it catches runtime regressions that `npm outdated` does not explain. Native device builds must be regenerated (`npm run ios:device:clean`, `npm run android:device:clean`) because React Native and `react-native-screens` changed.

### 2026-08-11 - PXI Chats Are Persisted Server-Side Agent Sessions

**Status:** Decision
**Area:** PXI, networking, storage

Phoenix 20.0.0 (`feat!: agent session persistence`, arize-phoenix #14143) replaced the transient `/agents/server/sessions/{id}/chat` route with persisted agent sessions under `/v1/agent_sessions`: create (`POST`, with `title`, `is_ephemeral`, `model`), list and get (viewer-owned, cursor-paged), transcript pages (`/{id}/messages`, oldest first), model changes (`PATCH`), and chat (`POST /{id}/chat`). The chat body no longer carries the message array: it sends `headless: true`, the single trailing user `message`, and `lastMessageId` — the persisted tail this client has rendered — as an optimistic-concurrency token, and field names changed (`recordLocalTraces`/`instrumentUserId`, formerly `ingestTraces`/`attachUserId`). The model field is a precondition against the session's persisted selection. Every conflict is an HTTP 409 whose JSON body carries a `code` (`agent_session_busy`, `agent_session_messages_stale`, `agent_session_model_stale`, …); the mobile client surfaces them by substring match on the error message, mirroring `phoenix-cli`. There is no delete route — sessions expire server-side only when ephemeral.

One contract detail is invisible in the OpenAPI schema and was found live against 20.0.0: transcript message ids must be UUIDs. A turn submitted with any other id format streams normally and then fails server-side persistence — `[DONE]` is followed by an error chunk ("the conversation could not be saved") and the transcript stays empty. Both first-party clients generate UUIDs (`crypto.randomUUID()`), so mobile user messages use `createPxiMessageId()` (expo-crypto `randomUUID`) while non-message identifiers (chat/run ids) keep the readable `createPxiId` format, which the route accepts.

Consequences baked into the app: the local Expo SQLite/IndexedDB transcript store is gone (files, `expo-sqlite` dependency, and its `app.json` plugin entry); chat history and transcripts are TanStack Query server state, with transcript restores using `gcTime: 0` so reopened chats always read the server copy. The chat screen creates the server session lazily on the first send (`createPxiTransport` caches the id and retries a failed creation), pins the active chat while running, PATCHes the session model when a saved model is missing from the catalog, and offers "Reload chat" on 409 conflicts. Contextual investigation runs create `is_ephemeral` sessions (the durable output is span notes) and retry by starting a fresh run, because a turn whose prompt was persisted cannot be regenerated into the same session. The app is on AI SDK v7 (`ai@7` / `@ai-sdk/react@4`) and `@arizeai/phoenix-client@7.4.0`; the v6-to-v7 upgrade required no code changes on the surfaces the app uses (`useChat`, `Chat`, `DefaultChatTransport`, `UIMessage`, part states). Since the 2026-10-14 upgrade to `@arizeai/phoenix-client` 7.16.1 the wire types in `src/features/pxi/sessions.ts` come from the generated schemas (`AgentSessionSummary`, `AgentSessionData`, `AgentSessionConflictError`), while the routes are still called directly because pre-20.0.0 servers answer these paths with the SPA HTML fallback, which the module detects and reports as an upgrade requirement alongside the version gate.

**Implication:** All PXI chat features require Phoenix 20.0.0 (`PXI_AGENT_SESSIONS_MINIMUM_VERSION`); the dev instance at 192.168.1.65:6006 upgraded to 20.0.0 on 2026-08-11 and the create/chat/list/messages routes were verified against it. Always send UUID message ids — a non-UUID id produces a turn that looks successful in the stream but is silently absent after reload. Do not reintroduce client-side transcript persistence — the server owns chat history now.

### 2026-08-09 - Contextual PXI Actions Attach Typed Contexts And Write Span Notes

**Status:** Decision (note tool and context behavior superseded on 2026-10-14; see the Phoenix 20.11 entry above)
**Area:** PXI, sessions, annotations, navigation

The server-agent chat request's `contexts` array accepts the same typed page-context payloads the Phoenix web assistant sends. `{ "type": "session", "projectNodeId", "sessionNodeId" }` (camelCase aliases, relay GlobalIDs, Phoenix ≥ 17.7) scopes PXI to one session. PXI writes open-coding findings through its built-in `write_span_note` tool (Phoenix ≥ 17.25): a span annotation named `note` with the reserved identifier `pxi`, `HUMAN` annotator kind, upserted per span, denied to Viewer roles, and available even though the app keeps GraphQL mutations disabled. The mobile app reads these notes over `GET /v1/projects/{id}/span_annotations` filtered by the session's root-span IDs plus `include_annotation_names=["note"]` (route since 9.0), then filters to the `pxi` identifier client-side.

Investigation runs are owned by the module-level `usePxiInvestigationStore`, not by the action sheet: each run holds an AI SDK `Chat` instance keyed by action, instance, project, and session, so streaming and the finish-time note invalidation continue when the sheet — or the whole session screen — is dismissed (verified on a physical Pixel: a run finished and its notes appeared after both were closed). The sheet subscribes through `useChat({ chat })` and screens read only run status; a settled run is cleared when the sheet unmounts, while transcripts are never persisted to local chat history because the durable output is the server-side span note. Starting a new run prompts for a model through the shared catalog `ModelPicker` and updates the per-instance PXI model preference. On Android, formSheet content is laid out at full container height, so a view pinned below a flexed list is unreachable at a fractional detent — sheet controls must live inside the scrollable content (the review-queue sheets already follow this pattern).

**Implication:** Add new contextual PXI actions by extending `resolvePxiAction` with a prompt, typed contexts, and a minimum server version, and reuse the action sheet rather than building bespoke chat surfaces. Keep sheet actions inside scroll content, keep PXI note reads on the root-span ID filter, and never count `pxi`-identifier notes toward review completion. The investigate prompt requires each note to begin with a single-sentence code summary; the session screen's collapsed note preview depends on that lead line, so preserve the contract when editing the prompt.

### 2026-08-09 - Annotation Configs Are Created Over REST Then Assigned To The Project

**Status:** Decision
**Area:** sessions, annotations, networking

Annotation configuration creation does not need GraphQL: `POST /v1/annotation_configs` accepts the discriminated `CreateAnnotationConfigData` union (unified route since Phoenix 9.0.0), and `PUT /v1/projects/{project_identifier}/annotation_configs/{config_identifier}` assigns a config to a project (REST route since 17.16.0, accepting either the GlobalID or the name, idempotent on re-assignment). Because the app only lists project-assigned configs, both calls are required and the write gates on the existing `projectAnnotationConfigs: [17, 16, 0]` floor. Server-side validation observed live: duplicate names and the reserved name `note` return 409 with distinct messages, and empty categorical `values` return 400, so the client validates those cases before sending.

The two-call sequence can fail between create and assign. On a create 409 the client fetches the existing config by name and silently recovers only when its shape exactly matches the submitted draft (same type, description, direction, values, bounds); any other 409 surfaces as a duplicate-name validation error rather than adopting an unrelated config.

**Implication:** Route new annotation-config writes through `createProjectAnnotationConfig` so project assignment and matching-shape 409 recovery stay intact. Do not treat a bare create as sufficient — an unassigned config is invisible to every project-scoped consumer in the app.

### 2026-08-08 - Session Dataset Flagging Uses JSON Upload With Caught Conflicts

**Status:** Decision
**Area:** sessions, datasets, networking

Flag-to-dataset saves session turns as dataset examples through `POST /v1/datasets/upload?sync=true` with parallel `inputs`/`outputs`/`metadata` arrays and `span_ids`, which the server stores as each example's `source.span_id` link back to the originating span. JSON upload has existed since Phoenix 4.6.0, but the `span_ids` field only since 12.31.0, so the write gates on `datasetSpanLinks: [12, 31, 0]`. `action: "append"` silently creates a missing dataset, so the create path is only used to attach a description and to surface name collisions. Turns without a root span carry no input/output payload and are skipped client-side.

The `@arizeai/phoenix-client` middleware throws `Error("<url>: <status> <statusText>")` on every non-2xx response, so `response.response.status` is never reachable for error handling. The create-name 409 must be detected by catching the thrown error and matching the status in its message before rethrowing.

**Implication:** Detect Phoenix HTTP error statuses in this codebase by catching thrown client errors, not by inspecting the response object. Keep dataset uploads on the JSON body (not multipart) so `span_ids` linking works, and preserve the append-only default with create reserved for explicitly new datasets.

### 2026-07-24 - Mobile Session Queues Scan Explicitly And Write Idempotently

**Status:** Decision
**Area:** sessions, review queue, annotations

Session review settings persist required annotation configuration names per instance and project, while Phoenix remains the source of sessions, configurations, and annotations. The Needs review view classifies only loaded remote sessions and offers an explicit Continue scanning action whenever an older session cursor remains, so a page containing only complete sessions is neither presented as an empty queue nor allowed to trigger an unbounded background crawl.

Review submission sends all required structured annotations in one synchronous request with the deterministic current-viewer identifier, then writes the optional note separately with its own deterministic identifier. Authenticated prefill requires both the deterministic `px-app:<viewer.id>` identifier and matching `user_id`. Anonymous prefill requires the persisted per-instance mobile reviewer identifier and a null `user_id`, because unauthenticated server annotations cannot otherwise be safely attributed to the current device workflow.

**Implication:** Keep queue completion derived only through `classifySessionReview`, preserve the explicit pagination boundary, and keep note failures retryable without duplicating or changing already-saved structured values. Never use local PXI history as a source for these routes.

### 2026-07-24 - Session Review Uses Raw Session IDs And Explicit Root Spans

**Status:** Decision
**Area:** sessions, annotations, networking

Phoenix 19.6.0 session list and detail responses retain trace membership and aggregate prompt, completion, and total token counts. Session annotation reads are project-scoped, accept raw user-provided `session_id` values rather than session GlobalIDs, support an annotation-name allowlist, and paginate by annotation GlobalID. Session turns have no dedicated REST route: they are reconstructed from explicit `parent_id=null` spans fetched by trace ID in batches of at most 50, then ordered by trace start time and read from OpenInference `input.*` and `output.*` attributes.

The session, annotation, and project annotation-config list implementations use inclusive cursor predicates with overfetch. Session review therefore guards repeated cursors and deduplicates returned entities. Structured completion counts only valid `HUMAN` session annotations for explicitly required config names; the reserved `note` annotation and automated trace or span annotations never complete review.

**Implication:** Pass `SessionData.session_id`, not `SessionData.id`, to annotation reads and writes. Preserve the Phoenix 13.5 session, 13.9 root-span trace-filter, and 17.16 project annotation-config compatibility boundaries, and keep notes on `POST /v1/session_notes` rather than encoding them as review annotations.

### 2026-07-22 - Trace Details Are Reconstructed From Full Spans

**Status:** Decision
**Area:** traces, observability, networking

The Phoenix REST API can delete a trace by identifier but does not expose a corresponding single-trace read endpoint, and the project trace-list endpoint cannot filter by trace ID. Trace details therefore paginate `GET /v1/projects/{project_identifier}/spans` with the OpenTelemetry trace ID and reconstruct the root, hierarchy, timing, status, token totals, and attention signals from the returned full spans.

**Implication:** Keep trace detail queries scoped by instance, project, and trace ID; do not pass span payloads through route parameters or make the trace list include all spans. Token totals derived from LLM spans avoid double-counting root or agent spans that may repeat aggregate usage.

### 2026-07-22 - Trace Range Statistics Require REST Pagination

**Status:** Decision
**Area:** traces, observability, networking

The typed Phoenix REST contract supports inclusive `start_time` and exclusive `end_time` bounds on trace and span lists, but does not expose aggregate trace statistics. Project trace range statistics therefore paginate every trace summary in the selected bounded range and fetch root-span statuses in page-sized batches. The visible trace feed uses the same bounds with independent cursor pagination.

Each range selection receives a stable cache identity. Streaming can then advance that selection's boundaries and refetch all currently loaded infinite-query pages in place instead of creating a new cache entry and collapsing the feed to its first page. Streaming pauses when the route is unfocused or the app is not active.

**Implication:** Keep statistics and list queries on the same range-selection identity and request boundaries. Range-wide statistics are exact but their request cost scales with trace volume, so avoid unbounded presets and prefer a server aggregate endpoint if Phoenix adds one.

### 2026-07-17 - Android Predictive Back And Sheet Keyboard Await Device Validation

**Status:** Watch
**Area:** Android, navigation, form sheets

The Android manifest opt-out behind `predictiveBackGestureEnabled: false` is deprecated once the app targets API 36, so the app would receive predictive back unprepared. The flag is now enabled; the codebase has no `BackHandler` interception and `react-native-screens` 4.25 supports predictive back for the native stack. The connection form sheet previously relied on `automaticallyAdjustKeyboardInsets` and `contentInsetAdjustmentBehavior`, which are iOS-only; Android now wraps the sheet's root scroll view in `KeyboardAvoidingView` with `height` behavior, matching the device-verified chat fix, while iOS keeps the scroll view as the screen root per the form-sheet frame finding.

**Implication:** Verify on a physical Android device: back gesture through the chat route, open form sheets, and open bottom sheets; and keyboard behavior in the connection sheet at both detents. Also note `sheetGrabberVisible` and `sheetCornerRadius` are iOS-only in `react-native-screens`, and `@expo/ui` fractional snap points resolve to half/full on Android.

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

### 2026-07-24 - Phoenix OAuth Uses DCR, Private Callbacks, And Rotating Tokens

**Status:** Decision
**Area:** Connections, security, networking

Phoenix 19.6 OAuth is detected only after unauthenticated `GET /v1/user` returns `401`; auth-disabled servers return an `ANONYMOUS` viewer and retain the existing connection path. Authenticated connections use RFC 8414 metadata, dynamic public-client registration, the exact `phoenixmobile://oauth/callback` redirect, Authorization Code with S256 PKCE, and `resource` equal to the advertised issuer. Phoenix rotates refresh tokens and revokes the token family when a spent refresh token is replayed.

OAuth metadata and client IDs are non-secret instance metadata. A validated pending DCR client is retained for up to six days so cancelled first sign-ins do not exhaust Phoenix's registration limit. Versioned tokens and the active ten-minute login transaction are native SecureStore values. Credential records are bound to the instance ID, credential key, client ID, issuer, base URL, and transport policy; bearer and OAuth requests cannot redirect, and bearer tokens are sent only to the configured origin and root-path deployment. HTTPS is required by default. Authenticated HTTP is available only through an explicit per-connection local-development warning because credentials remain observable to the network. Web does not offer OAuth because SecureStore has no web implementation.

Refresh, replacement, revocation, and deletion are serialized per credential key. Permanent removal raises a generation barrier before waiting for active work, so a late rotating refresh cannot restore a deleted credential; cleanup after a recoverable login failure uses the same serialization without permanently blocking a new sign-in.

**Implication:** Do not silently enable authenticated HTTP, retry an ambiguous refresh, reuse an old rotating refresh token, persist callback parameters, or replay PXI stream posts. Idempotent REST reads and the read-only model-catalog GraphQL query may refresh and retry once; PXI resolves a token immediately before sending, coordinates one refresh after a `401` for the next explicit attempt, and requires a new user submission.

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

### 2026-10-15 - Bar Items In A Navigation Stack That Does Not Span The Window Ignore Touches On iPhone Duo

**Status:** Resolved
**Area:** iPhone Duo, navigation, PXI pane

With a vertical system bar (both Duo displays except the inner display in portrait), UIKit lays the stack's Back button and icon bar items along the trailing edge of the navigation controller's view. When `PxiPaneShell` first placed the native stack inside a 60 percent-wide `DuoArrangement` pane, UIKit still drew that bar at the pane's trailing edge, but neither Back nor the PXI item responded to taps, with or without a title, while React Native content in the same pane scrolled normally; even JavaScript pressables drawn over that column received nothing, and the window-edge column was dead too. The working configuration keeps the native stack at full window width: the shell is an `overlay` arrangement whose floating pane is PXI, content screens get `contentStyle` padding equal to the covered region (through `usePxiPaneStore().stackContentInset`), and the floating pane leaves the bar column transparent and `box-none` so the system's Back and PXI items stay visible and tappable above it. `useDuoLayout` inside the stack reports the uncovered size, so screens switch to their compact layouts.

**Implication:** Never host a native stack in a pane narrower than the window on iPhone Duo; pad its content instead. When the pane bug matters again (Expo SDK 58's `ArrangementView` or a react-native-screens fix), re-test Back in a narrowed stack before removing the padding approach. Expo SDK 58 (installed 2026-10-16) ships `ArrangementView` and react-native-screens 4.30; neither has been re-tested against this bug yet.

### 2026-10-15 - A Form Sheet Screen Needs A Scroll View As Its Root For Header Insets And A Frame

**Status:** Resolved
**Area:** sheets, react-native-screens, PXI action sheet

The native header of a `formSheet` route is translucent on iOS 27 and the screen's content starts under it. The existing task sheets work because their root element is a `ScrollView` with `contentInsetAdjustmentBehavior="automatic"`, which react-native-screens insets by the header height. The PXI action sheet rendered a plain `View` with its own header row, which disappeared under the bar; wrapping the state view in a `ScrollView` nested inside that `View` rendered nothing at all (no frame, not even a debug background), on the open Duo's trailing sheet. Making the scroll view the root of the screen, a `FlatList` for the transcript and a `ScrollView` for the status states, fixed both.

**Implication:** Every `formSheet` route returns a `ScrollView` or list as its root with `contentInsetAdjustmentBehavior="automatic"`; put fixed footers inside `ListFooterComponent` rather than beside the list, and let the native header carry the title instead of drawing a second one.

### 2026-10-15 - Percent Flex-Basis Does Not Wrap Inside Row Containers On iOS 27

**Status:** Resolved
**Area:** iOS, layout, Yoga

Metric tile grids built as `flexDirection: 'row', flexWrap: 'wrap'` with children using `flexBasis: '50%'` (or `'47%'`) wrapped into two rows on Android but rendered as a single crushed row on the iOS 27 simulator with React Native 0.86.3, both inside the Duo arrangement panes and at full width in tabletop pose; the containers measured the expected width and the branch that chose the percentage was correct. The project trace summary and the session metrics now lay their tiles out as explicit rows of two (`flex: 1` children) and pick one row of four only when the measured container is at least 700 pt wide.

**Implication:** Do not rely on percentage `flexBasis` to wrap rows; build the rows explicitly from a measured width. When a layout differs between Android and iOS, log the container's `onLayout` size before changing the breakpoint logic.

### 2026-10-15 - iOS Context Menus Must Pin Hosted Messages To The Row Width

**Status:** Resolved
**Area:** iOS, Expo UI, PXI, Markdown, layout

On the iPhone Duo simulator (iOS 27.1, `@expo/ui` 57.0.24) every PXI message wrapped in `NativeContextMenu` rendered unwrapped: the user bubble, paragraphs, and list items ran under the vertical system bar and off the window, while tool rows beside them respected the transcript padding. `@expo/ui/community/menu`'s iOS `MenuView` hosts its trigger in a SwiftUI `Host` plus `RNHostView`, both with `matchContents` on both axes, so the React Native subtree is measured from an unbounded root and text takes its max-content width. The same structure caused the Android bug below; iOS had shown it only on the Duo's narrower safe width. Matching only the height (`matchContents={{ vertical: true }}`) wrapped short messages but dropped long Markdown parts from the transcript entirely.

`native-context-menu.native.tsx` now builds the SwiftUI `ContextMenu` itself: an outer React Native view measures the row width with `onLayout`, and the hosted content sits in a view pinned to that width, so Yoga wraps text inside the host. The actions are `@expo/ui/swift-ui` `Button`s, and the SwiftUI preview still shows the message.

**Implication:** Content inside an Expo UI host with `matchContents` needs an explicit width from React Native layout; the host cannot bound it. Measure the row and pin an inner wrapper. Verify transcripts at the Duo's compact width, where the 84 pt bar makes overflow visible that a plain phone hides at the screen edge.

### 2026-10-14 - Android Context Menus Must Not Host Markdown Content

**Status:** Resolved
**Area:** Android, Expo UI, PXI, Markdown, layout

Every PXI transcript on Android rendered unwrapped: paragraphs, headings, list items, tables, and code blocks ran off the right edge. The `@expo/ui/community/menu` `MenuView` on Android wraps its trigger in a Compose `Host` plus `RNHostView` with `matchContents`, and that host lays the React Native subtree out from an unbounded root. Pinning an inner wrapper to the measured row width only rescued blocks with percent widths (paragraphs); rows with `flex: 1` children (list items, table cells) still measured their text at max-content width, which `dumpsys activity top` showed as `ReactTextView` nodes up to 2200 px wide inside a 1212 px parent. Rendering the same Markdown outside the host produced zero oversized views.

`native-context-menu.android.tsx` now keeps the content in ordinary React Native layout inside a `Pressable`, and opens the Material dropdown imperatively through `MenuView`'s `ref.show()` with a 1 pt anchor positioned at the long-press point, so the menu also appears next to the finger on long messages. iOS keeps a hosted structure in `native-context-menu.native.tsx` because the SwiftUI context menu previews the hosted content; it pins the content width instead (see the 2026-10-15 entry above). Markdown tables additionally render inside a horizontal `ScrollView` with a 112 pt minimum cell width, so many-column tables scroll instead of crushing cells, and heading text groups get `flexShrink: 1` so long headings and inline code wrap.

**Implication:** On Android, never place text or any auto-width layout inside an Expo UI host that uses `matchContents`; host only fixed-size anchors and keep real content in React Native views. When verifying layout on a device, `adb shell dumpsys activity top` exposes the sizes of React views inside Compose hosts that `uiautomator` cannot see. Metro only watches files when started without `CI=1`, and a newly added platform-specific file (`*.android.tsx`) still needs a Metro restart with `--clear` before it resolves.

### 2026-08-08 - Expo UI Sliders Need Explicit Colors On App Surfaces

**Status:** Resolved
**Area:** Android, Expo UI, session review, theming

The universal `@expo/ui` `Slider` derives its Android track colors from the Host's Material 3 seed theme. The light-scheme inactive track resolves to a near-white surface tone, so an unset slider on the app's white review cards rendered invisibly; the dark scheme happened to be visible. The `@expo/ui/community/slider` wrapper (jetpack-compose Host with `matchContents`) did not render at all inside the session detail's FlatList footer on a physical Pixel.

`ScoreSlider` is now a platform-split component: iOS and web keep the universal Host and Slider (their platform sliders draw visible tracks in both schemes), while `score-slider.android.tsx` hosts the `@expo/ui/jetpack-compose` `Slider` directly and passes explicit `colors` from the app tokens. The light palette also gained `brandText`/`brandSecondaryText` tokens (darkened cyan and seafoam) because raw brand accents fail text contrast on light canvases; dark mode maps them to the original brand values.

**Implication:** When an `@expo/ui`-hosted control must stay visible on app-token surfaces, pass explicit component colors rather than relying on seed-derived theming, and verify the control on a device in both color schemes, including its unset or empty state. Use `brandText`/`brandSecondaryText` for brand-colored text.

### 2026-07-18 - Android Streaming Follow Needs Exact Content Offsets

**Status:** Resolved
**Area:** Android, PXI, scrolling, Fabric

`FlatList.scrollToEnd()` calculates its target from JavaScript-side cell measurements. During rapid Android Fabric updates, a streaming Markdown row's cached measurement can lag behind the content height, so repeated follow commands target an old end. `maintainVisibleContentPosition` further preserves the previous viewport and is intended for prepended content, not bottom-follow behavior.

PXI now uses the exact height from `onContentSizeChange` with `scrollToOffset`; the native scroll view clamps that oversized coordinate to its true maximum. The transcript no longer enables `maintainVisibleContentPosition` because it appends messages and does not prepend history.

**Implication:** Follow variable-height streaming content with authoritative content-size offsets rather than `scrollToEnd()` cell metrics. Reintroduce visible-position maintenance only if history pagination prepends rows, and isolate it from active streaming.

### 2026-07-18 - Android Menu Triggers Consume Nested Presses

**Status:** Resolved
**Area:** Android, Expo UI, PXI, interaction

Expo SDK 57's `MenuView` uses an internal React Native `Pressable` as its Android trigger. That outer trigger claims the gesture, so nested press handlers do not fire; iOS uses a SwiftUI context-menu host and does not exhibit the same responder conflict. Wrapping a PXI tool disclosure in `MenuView` therefore prevented Android users from expanding tool and subagent details.

Tool disclosure controls now remain outside the context-menu trigger. Long-press copy actions wrap only non-interactive detail surfaces; scrollable JSON details use explicit copy controls instead.

**Implication:** Do not place pressable controls, links, scroll views, or other gesture interactions inside `NativeContextMenu`. Attach the menu to a non-interactive surface or provide a separate trigger, and verify tap, scroll, and long-press behavior on Android.

### 2026-07-17 - Native Surfaces Follow The Platform Scheme, Not App State

**Status:** Resolved
**Area:** theming, status bar, Android, iOS

The in-app appearance override only themed React-rendered views. `expo-status-bar`'s `auto` style, `Alert.alert`, the Material bottom sheet and menus, and other native chrome resolve from the platform scheme via the `Appearance` module, so a forced appearance produced an illegible status bar and mismatched native dialogs. The root layout now derives the status-bar style from the resolved scheme and pushes the override into `Appearance.setColorScheme` on native (`unspecified` restores system following).

**Implication:** Any future native surface (dialogs, sheets, pickers) inherits the override automatically only because of the `Appearance.setColorScheme` sync. Do not remove it, and keep web excluded — the web document theme is handled separately.

### 2026-07-17 - Interrupted Streams Persist Non-Terminal Part States

**Status:** Resolved
**Area:** PXI, persistence, AI SDK

AI SDK 6 does not finalize UI message part states on abort, disconnect, or error: text and reasoning parts keep `state: 'streaming'` and tool parts keep `input-streaming`/`input-available`. Snapshot and `onFinish` persistence captured those frozen states, so restored sessions rendered a permanent tool spinner, "Thinking…" line, and streaming Markdown with no stream attached. `finalizeInterruptedMessages` now normalizes parts to terminal states on both persist and restore (restore also repairs rows saved before the fix); interrupted tools become `output-error` with an explanatory message.

**Implication:** Keep persistence and restore routed through the finalizer, and re-check its state mapping whenever the AI SDK major version or part-state vocabulary changes.

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

PXI keeps following streamed output only while the reader remains at the live edge. Sending a new turn explicitly re-engages live-edge following; touching or dragging the transcript releases it, subsequent chunks arrive without stealing position, and the Latest control explicitly returns to and re-engages the live edge. Saved threads reopen at the latest user turn. Live-edge scrolling uses exact content-height offsets so variable-height streaming rows do not depend on delayed list-cell measurements.

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

### 2026-10-15 - iPhone Duo Vertical Bars Own Navigation; Content Uses The Top Band And The Safe Width

**Status:** Decision
**Area:** iPhone Duo, navigation, layout, PXI

Measured on the iPhone Duo simulator (iOS 27.1, build against the 27.1 SDK): the open inner display with a vertical hinge is a 951 × 669 pt window and the closed outer display 466 × 678 pt, both with safe-area insets `{ top: 0, right: 84, bottom: 34, left: 0 }`; the inner display rotated to a horizontal hinge is 669 × 951 pt with horizontal bars. The system stacks the status cluster, the stack's Back button, and any _icon_ bar item in the trailing 84 pt column; custom-view header items (`type: 'custom'`) stay in a horizontal bar at the top, and a non-empty title keeps that horizontal bar alive at roughly 66 pt even when every control has moved to the side. Three rules follow. `useDuoLayout().systemBarEdge` classifies the bar edge from the insets (one side at least 60 pt with no top inset; notched iPhones in landscape inset both sides and stay `top`). Screens whose content already carries a title pass `nativeHeaderTitle(systemBarEdge, title)`, which is empty beside a vertical bar so the horizontal bar collapses and content starts at the top edge. The PXI button is a native bar item with a template image (`usePxiHeaderOptions`, `assets/images/pxi-glyph*.png` rasterized from `PxiGlyph`), which iOS moves into the vertical bar directly under Back; Android and web keep the pressable. Content columns use `useContentColumnStyle` (or `ContentColumn` inside an arrangement pane): the column grows by the horizontal insets and pads each side by its own inset, so cards stay centered in the safe width and clear of the bar column, and `DuoArrangement` republishes clipped insets per pane so only the trailing pane pads for the bar. On regular-width windows the header button opens PXI as a floating pane beside the stack (`PxiPaneShell`); the screen that opened it pushes whatever its detail pane showed (the selected trace or session) so the leading side continues as a single screen, and a second press or the pane's close button restores the two-pane layout.

Sheets follow a system rule of their own on the open Duo: every presentation (`formSheet` with or without detents, `pageSheet`, `modal`) docks a 466 pt column, the outer display's width, to the leading edge and dims the rest, so a sheet opened from the trailing pane covers the list the person was working from. The only lever is `UISheetPresentationController.preferredPlacement` (iOS 27, `automatic`, `leading`, `center`, `trailing`), which react-native-screens 4.26 does not expose and which has to be set before presentation to avoid a visible move. The local Expo module `modules/duo-sheets` therefore exchanges `UIViewController.present(_:animated:completion:)` once and applies the app's preferred placement to form sheets on their way in; `DuoSheetPlacement` in the root layout picks `trailing` (or `leading`) whenever the window is regular width with a vertical bar, and the root layout drops detents and the grabber there so the sheet runs the full height of the column. A first attempt that drew the forms inside the detail pane as a JavaScript sheet was rejected because it only looked like a sheet; the real presentation keeps the system's gestures, dimming, and bar handling. Compact width is unchanged, and Settings, Add Instance, and the PXI action sheet use the same trailing placement.

**Implication:** Add new screens with `nativeHeaderTitle`, `usePxiHeaderOptions`, and a content column; put icons on any future bar item so it can go vertical; do not reintroduce `MaxContentWidth` padding that ignores the asymmetric insets. Keep form sheets as native `formSheet` routes; the placement module and the root layout's `formSheet` helper handle large screens. Changing `modules/duo-sheets` needs `pod install` and a native rebuild. The preview harness now uses the measured insets for both displays.

### 2026-10-15 - Every Tap Is Navigate, Task, Or Companion; The Size Class Decides The Rendering

**Status:** Decision
**Area:** navigation, sheets, PXI, iPhone Duo

After the Duo work landed, PXI reached the screen three different ways (the bar item gave a pane or a route, Investigate gave a pane or a sheet, chat history gave a rail or a bottom sheet), three different trailing columns existed at three widths with three kinds of chrome, and opening PXI from a split changed two places at once. Investigate in particular had regressed on the open Duo: it lost the sheet, its native dismissal, and its full height when it moved into the 40 percent PXI pane. The fix is a surface model with three verbs, recorded in `docs/iphone-duo-preview.md` ("Surface model") with the tap table. Navigate pushes a page on compact width and fills the detail pane on regular width. Task (every form, Settings, Add instance, and Investigate) is always the native form sheet: bottom sheet with detents on compact, full-height trailing sheet on regular, dismissed by swipe or the sheet's own Done, never a close glyph. Companion is the PXI chat only: the full-screen route on compact, a trailing column on regular whose width matches the trailing form sheet (leading edge at 310 pt of the 951 pt Duo window, measured from the review-queue sheet) and whose header is a title plus Done. Two decisions were taken deliberately: opening the companion from a split pushes the selected detail as the page (the one exception to navigate never rearranging the stack, kept so the chat has its context beside it), and the companion column matches the sheet width rather than the detail pane so every docked surface shares one leading edge. The chat's history rail is reserved for the full-screen chat on a wide window; inside the column the chat keeps the history button and sheet.

**Implication:** `usePxiPaneStore` holds only the chat (`open(instanceId)`), `openPxiAction` always pushes the action sheet route, `PxiActionView` has no pane presentation and no close glyph, and `PxiChat`'s `pane` presentation shows Done. Before adding a surface, fill in its row of the tap table; if the three verbs cannot describe it, the design needs a conversation first.

### 2026-10-15 - iPhone Duo Layouts Are Size-Class Arrangements With A Preview Harness

**Status:** Decision
**Area:** iPhone Duo, layout, navigation, tooling

iPhone Duo (iOS 27.1, shipping 2026-10-23) exposes two displays: the outer 5.4 in display is compact width (466 × 678 pt), the inner 7.6 in display is regular width in every orientation (669 × 951 pt), and a partially folded device divides the inner display with a _division_ reserved region. Apple's rule, repeated across the HIG and the Duo Tech Talks, is to design for the two size classes and let arrangement views and reserved regions handle the fold, never per pose or orientation. Expo SDK 57 has no binding for the hinge, reserved regions, or `ArrangementView` (those arrive with Expo SDK 58 and need Xcode 27.1), so the app carries a JavaScript model in `src/features/duo/layout.ts` (`useDuoLayout`: size classes from a 600 pt breakpoint, a division region active only in book or tabletop pose) and `src/components/duo/arrangement.tsx` (`DuoArrangement`, a rendition of Apple's split and overlay arrangements that snaps 50/50 around an active fold with an animated transition). Screens branch only on `isRegularWidth`: the project trace feed gains an inline trace detail pane, the sessions list an inline session detail pane, the session detail a transcript/review split that becomes content-on-top, controls-on-bottom in tabletop pose, and PXI chat a persistent history rail.

The Duo simulator ships only inside Xcode 27.1 RC; it was installed on 2026-10-15 (27A9275, replacing the 27.0 beta) and the iPhone Duo device type requires the separately downloaded iOS 27.1 simulator runtime (24A94232). The device boots closed, posture is a Device Hub bezel control with no `simctl` equivalent, and `simctl io screenshot --display=1` captures the outer panel. The 27.1 SDK build verified the outer display edge to edge with the system's vertical status bar, which confirms the compact-width path; on 2026-10-15 Device Hub (driven with CGEvent clicks once Accessibility and Screen Recording were granted, since it exposes no accessibility tree) opened the device and every screen was audited on the inner display, see the vertical-bar decision below. `DuoPreviewFrame` (`src/components/duo/preview-frame.tsx`, toggled from Settings) therefore frames the whole app at Duo point sizes on an iPad or iPhone simulator, overrides the safe-area insets with the Duo's trailing-edge bar layout, draws the fold, and drives pose and hinge angle from `useDuoPreviewStore`; `useDuoLayout` reads the framed viewport through `DuoViewportContext`. `app.json` now sets `orientation: "default"`, `ios.supportsTablet: true`, and `ios.requireFullScreen: false` because iOS 27 makes iPhone apps resizable, the inner display ignores orientation locks, and the iPad simulator is the stand-in for the inner display's regular size class.

**Implication:** Never branch Duo layouts on orientation, idiom, or `Dimensions`; read `useDuoLayout`, keep `DuoArrangement` outside scroll views and navigation containers, and give embedded detail views an `embedded` flag so nested panes do not split again. Expo SDK 58 (installed 2026-10-16) ships `expo-hinge` and Expo UI's `ArrangementView` (both iOS 27.1+); replacing the simulated division region with the hinge plus a reserved-region binding and `DuoArrangement` with the native arrangement is pending, keeping the same component boundaries (see `docs/iphone-duo-preview.md`).

### 2026-10-14 - Code Blocks Use Phoenix's Pierre Syntax Colors And Geist Mono

**Status:** Decision
**Area:** Design system, PXI, Markdown

The Markdown library's fenced-code renderer hard-codes Prism's One Dark and One Light themes, whose muted blue-gray plain text and purple keywords clash with the Phoenix canvases and brand palette. The Phoenix web app colors every code block and diff through the Pierre theme (`@pierre/theme`, translated to CodeMirror in `js/app/src/components/code/pierreCodeMirrorTheme.ts`). `src/constants/code-theme.ts` now carries the base `pierre-dark.json` and `pierre-light.json` token colors keyed by scope (comment, punctuation, keyword, string, number, constant, variable, function, type, tag, attribute, parameter) and maps Prism token types onto them; `src/components/chat/code-block.tsx` renders fences through `prism-react-renderer` with that theme, and `JsonBlock` uses the same property-name, string, and number colors Phoenix's JSON editor shows. Plain code text uses the app text color on the element background rather than Pierre's near-black editor background, so blocks sit on the same surface as the rest of a message; because that surface is lighter than Pierre's, four tokens that fell under 3:1 there (dark punctuation, light constant, regexp, and escape) are nudged within their hue to clear 3.2:1. Geist Mono (`@expo-google-fonts/geist-mono`) is loaded next to Geist and is now `Fonts.mono` on every platform, replacing the system monospace fallbacks.

**Implication:** Color code through `codeColors(dark)` and `createPrismTheme`, never through a Prism preset, and keep the scope table in sync with Phoenix's Pierre mapping when it changes. Any new monospace surface should use `Fonts.mono` / `Fonts.monoMedium`.

### 2026-07-21 - Trace Lists Combine Summaries With Root Spans

**Status:** Decision
**Area:** Projects, traces, performance

The project trace feed pages through `GET /v1/projects/{project_identifier}/traces` without `include_spans`, then fetches only root spans for that page's trace IDs. Trace summaries supply aggregate latency and token counts; root spans supply the operation name, kind, and status. Error filtering uses the root-span endpoint directly. Summary metrics are explicitly scoped to the first page of up to 30 recent traces rather than presented as project-wide aggregates.

The Phoenix client declares the project-traces route and span status filters available from Phoenix 13.15.0, while filtering spans by trace IDs requires 13.9.0.

**Implication:** Keep full span trees lazy until a trace detail view exists, preserve cursor pagination and virtualized rendering, and do not relabel sample metrics as project-wide statistics. Older Phoenix servers should receive an understandable compatibility error rather than triggering an unbounded fallback scan.

### 2026-07-17 - Touch Feedback Is Platform-Idiomatic And Haptics Are Reserved For State Changes

**Status:** Decision
**Area:** Interaction design, Android

`MotionPressable` now renders an `android_ripple` (via the theme `ripple` token) alongside its press spring so Android touches read as Material state layers, and its default haptic is `none`. Haptics are opt-in for meaningful state changes only: value selection (model, session, appearance), send/stop, destructive confirmations, swipe-action reveal, and operation results. Plain navigation, link opens, and disclosure toggles are silent, matching both HIG and Material guidance.

**Implication:** New pressables get ripple and silence for free. Pass a `haptic` value only when the interaction changes state, and let operation results keep using the success/warning/error notifications.

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

On 2026-10-14 `npm audit --omit=dev` reported 49 advisories (1 critical in `shell-quote`, 29 high) after the SDK 57 patch alignment; on 2026-10-16, after the SDK 58 upgrade, it reports 27 advisories (0 critical, 19 high, 8 moderate), all still in build-time tooling. Every critical and high finding sits in build-time tooling (Expo CLI, Metro, `@expo/config-plugins`, `node-forge`, `micromatch`) rather than in code shipped inside the app binary, and npm's proposed fixes downgrade to Expo 44 or React Native 0.72. No forced upgrade has been applied.

**Implication:** Review advisories before each release and track them against the Expo SDK changelog. Do not run `npm audit fix --force`; it would break the SDK.

## Superseded

### 2026-07-16 - Xcode 27 Beta Requires The UIKit Scene Lifecycle

**Status:** Superseded
**Area:** iOS, Expo, Xcode

Building the generated SDK 57 app with Xcode 27 beta raises `SIGTRAP` in `UIApplicationEvaluateRuntimeIssueForNoSceneLifecycleAdoption` because the template uses the legacy application lifecycle. Expo accepted [expo/expo#46664](https://github.com/expo/expo/issues/46664) for the same failure on SDK 56 and tracks it as an iOS 27 issue with upstream React Native work.

The local `with-ios-scene-lifecycle` config plugin moves React startup into `SceneDelegate`, assigns the scene window to both `SceneDelegate.window` and `AppDelegate.window`, and forwards scene URL opens through the existing AppDelegate path. Assigning `AppDelegate.window` is essential: without it, Expo Dev Launcher can load while the React root stays detached and black. This exact flow was verified on a physical iOS 27 device with Expo SDK 57.0.6 and Xcode 27 beta.

The App Store version of Expo Go does not yet include SDK 57. `eas go` and EAS physical-device builds require a paid Apple Developer membership, so local Xcode builds signed by the configured Personal Team are the available no-cost device workflow.

**Implication:** Keep the local scene plugin and regenerate iOS through `npm run ios:device:clean` until Expo resolves the accepted lifecycle issue. Revalidate React mounting, Expo Dev Launcher, initial URLs, and deep links whenever the generated AppDelegate changes.

**Superseded on 2026-10-16:** Expo SDK 58 generates `SceneDelegate.swift` and the `UIApplicationSceneManifest` itself (`ExpoAppSceneDelegate` creates the window and starts React Native), so the local plugin was deleted; see the 2026-10-16 upgrade entry under Active Constraints.
