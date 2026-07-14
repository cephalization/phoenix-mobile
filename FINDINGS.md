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
