# Agent Guidelines

This document contains stable guidance for anyone making changes in Phoenix Mobile. Read it before editing code, then read `FINDINGS.md` for current technical knowledge and `GOALS.md` for product priorities.

## Document Roles

- `AGENTS.md` defines how work should be approached. Keep it concise and stable.
- `FINDINGS.md` records technical discoveries, constraints, resolved bugs, and decisions that future work should know.
- `GOALS.md` orders the outcomes the project is pursuing. It is not a task tracker or changelog.
- `README.md` explains the project to a new developer or user.

Do not duplicate the same information across all four documents. Update the document whose role matches the new information.

## Before Making Changes

1. Read `FINDINGS.md` and `GOALS.md`.
2. Inspect the affected route, shared components, stores, and data hooks before choosing an implementation.
3. Check the exact installed package versions in `package.json`.
4. Read the versioned Expo SDK 58 documentation at `https://docs.expo.dev/versions/v58.0.0/` before relying on an Expo API. Expo and Expo Router behavior changes materially between SDK releases.
5. Preserve unrelated work in a dirty worktree.

## Product Context

Phoenix Mobile is a companion for self-hosted Arize Phoenix instances. It should feel like a focused native utility, not a marketing website or a compressed copy of the Phoenix desktop interface.

Current product boundaries:

- Multiple Phoenix instances can be stored locally.
- Connections without authentication are supported.
- The domain model reserves space for OAuth 2 credentials, but OAuth is not implemented yet.
- Phoenix server state currently includes server version and projects.
- iOS, Android, and web are supported, but mobile interaction quality has priority.

## Technology

- Expo SDK 58 and Expo Router
- React 19 and React Native 0.88
- Strict TypeScript with React Compiler enabled
- TanStack Query for Phoenix server state
- Zustand and AsyncStorage for persisted non-secret client state
- `@ronradtke/react-native-markdown-display` for streaming-safe native Markdown output
- Expo SecureStore for future credentials and tokens
- React Hook Form and Zod for forms and validation
- Reanimated 4, Gesture Handler, and Expo Haptics for interaction
- Geist typography and Phoenix design tokens
- oxlint with the vendored anti-slop ruleset, and oxfmt for formatting

Use `npm` for dependency and script commands because this repository commits `package-lock.json`.

## Repository Map

```text
src/app/                  Expo Router routes and route layouts
src/app/index.tsx         Projects of the active instance (the root) and its instance switcher
src/app/instances/index.tsx Connections sheet: instances and the active one's server details
src/app/instances/new.tsx Connection form sheet
src/app/settings.tsx      Settings form sheet
src/components/           Reusable UI and interaction primitives
src/components/ui/        Design-system primitives (see docs/design.md)
src/constants/            Theme and motion tokens
src/hooks/                TanStack Query hooks and query keys
src/lib/                  Phoenix client, haptics, and infrastructure
src/store/                Persisted local state
src/types/                Domain models
src/features/duo/         iPhone Duo layout model and split-column routing
modules/duo-native/       Local Expo module: layout metrics and trailing sheets
deps/                     Vendored react-native-screens fork (see docs/iphone-duo.md)
assets/                   Bundled application assets
tools/oxlint/anti-slop/   Vendored lint rules (see its UPSTREAM.md before editing)
```

## Architecture Rules

- Keep route files focused on composition and route-specific behavior.
- Put reusable server requests behind well-modeled TanStack Query hooks.
- Keep remote Phoenix data out of Zustand. TanStack Query owns server state.
- Use Zustand for local preferences and persisted instance metadata.
- Store secrets only in SecureStore. Never place access tokens or refresh tokens in AsyncStorage or route parameters.
- PXI chats are persisted server-side agent sessions. Treat their transcripts and history as TanStack Query server state; do not persist messages or tool payloads locally.
- Preserve the `InstanceAuth` discriminated union when adding authentication modes.
- Construct Phoenix clients with explicit options. Do not rely on Node environment discovery in the mobile runtime.
- Prefer existing components and tokens before introducing another abstraction or dependency.
- Avoid compatibility layers without a concrete shipped-data or external-consumer requirement.

## Code Quality Rules

Lint policy lives in `.oxlintrc.json` and the vendored `tools/oxlint/anti-slop` plugin. Fix the code rather than the rule: never add `oxlint-disable` comments, lower a severity, or launder a type to make lint pass. Policy changes go through `.oxlintrc.json` and `tools/oxlint/anti-slop/UPSTREAM.md`, where intentional deviations are recorded.

- Narrow untyped JSON (AI SDK tool payloads, span attributes, `JSON.parse` output) with the predicates in `src/lib/json.ts` and type it as `JsonValue`. Do not add ad hoc `typeof` checks or `unknown` parameters outside type predicates.
- A type assertion needs a `// SAFETY:` comment stating the invariant that makes it sound. Prefer fixing the types so no assertion is needed.
- Tests replace dependencies through real seams. Module mocking is allowed only for the native Expo modules listed in `.oxlintrc.json`.
- Build request objects explicitly instead of spreading conditional empty objects; the Phoenix client drops `undefined` fields.

## UI Guidelines

- Design is a primary product requirement. Inspect changes at phone dimensions in light and dark modes.
- Follow `docs/design.md`: flat full-width lists built from `src/components/ui`, actions as native bar items, monospaced figures, and colour only for errors, OK states, and the Phoenix brand.
- Prefer utility-first application layouts: direct titles, immediate content, thumb-reachable actions, and native sheets.
- Reuse Phoenix tokens from `src/constants/theme.ts`. The semantic primary is monochrome; cyan and seafoam belong to Phoenix branding and supporting states.
- Use Geist font families from `AppFonts`; do not mix arbitrary font weights with custom font files.
- Use the official Phoenix logo asset through `PhoenixLogo`.
- Keep touch targets at least 48 by 48 points.
- Use one visually dominant action per screen or sheet.
- Support long instance names, URLs, project names, small screens, and dynamic text without destructive wrapping.
- Preserve accessibility labels, roles, reduced-motion behavior, sufficient contrast, and native dismissal gestures.
- Native form sheets should use Expo Router `formSheet`; web may use a full-route fallback.

## Motion Guidelines

- Motion should communicate touch response, hierarchy, progress, or state change. Avoid decorative motion without a purpose.
- Use `MotionPressable` for standard spring feedback and haptics.
- Respect the system reduced-motion preference for every nonessential animation.
- Keep frequent transitions short and restrained. Prefer approximately 120-300 ms or a well-damped spring.
- Do not combine Reanimated entering/layout builders directly around Gesture Handler swipeables.
- Do not use shared entering/layout builders for project or connection rows. These combinations previously caused rows to fade away after settling on web.
- For animated rows, use persistent shared values whose settled opacity remains `1`.
- Verify animated content after the animation has completed, not only during its entrance.

## Platform Constraints

- A physical phone cannot reach a development computer through `localhost`; use the computer's LAN address.
- Local Phoenix deployments often use HTTP. Android cleartext traffic and iOS local-network/transport settings are intentionally configured in `app.json`.
- The Phoenix client currently imports Node-only configuration helpers. `metro.config.js` narrowly shims unused `node:fs` and `node:path` imports on native platforms.
- Static web rendering runs in Node. Persisted stores must use a server-safe storage adapter and must not access browser globals during SSR.
- Safari browser chrome cannot be fully controlled by page CSS. PWA metadata and standalone mode are configured, but normal Safari owns its toolbars.
- Native form-sheet behavior cannot be judged solely from the web fallback.

## Validation

Run these checks after code changes:

```bash
npm run check
```

`npm run check` runs `typecheck`, `lint` (oxlint), `fmt:check` (oxfmt), and `test` (Vitest). Use `npm run lint:fix` and `npm run fmt` to apply autofixes and formatting; run lint again afterwards because the spacing rule and the formatter must agree.

For changes involving routing, native modules, Metro, assets, or platform configuration, also run:

```bash
npx expo-doctor
npx expo export --platform all --clear
```

For UI work:

- Inspect a narrow mobile viewport in light and dark modes.
- Exercise populated, empty, loading, success, and error states when relevant.
- Wait until animations settle and check for disappearing or collapsed content.
- Verify native-only behavior on a simulator or device when web cannot represent it accurately.

## Documentation Updates

Update `FINDINGS.md` when work reveals a non-obvious constraint, reusable pattern, root cause, or decision. Include the date, status, affected area, and practical implication.

Update `GOALS.md` only when product priorities or completion criteria change. Do not add implementation checklists, issue-level tasks, or transient bugs there.

Change `AGENTS.md` when a new stable engineering or collaboration rule should govern future work.

## Safety

- Never commit credentials, tokens, private Phoenix data, or local environment values.
- Do not weaken TLS or storage security silently. Document intentional platform exceptions.
- Do not remove platform configuration or Metro shims without first reproducing why they were added.
- Do not commit, push, or publish unless explicitly requested.
