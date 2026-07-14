# Goals

This document records the ordered outcomes Phoenix Mobile is pursuing. It is intentionally not a todo list. Implementation tasks belong in issues, plans, or pull requests.

Priorities are ordered. A later goal should not compromise the reliability, security, or interaction quality of an earlier one.

## Product Principles

- Be a focused mobile companion to Phoenix, not a full desktop replacement.
- Make the most common information and actions reachable within a few touches.
- Treat design, motion, accessibility, and tactile feedback as product behavior rather than polish added later.
- Preserve user trust around hosts, credentials, destructive actions, and network failures.
- Prefer typed Phoenix APIs and explicit compatibility boundaries.

## Priority 1 - Trustworthy Instance Connectivity

Users can confidently add, identify, revisit, refresh, and remove Phoenix instances across app launches.

Completion means unauthenticated connections behave reliably on supported local and remote hosts; failures explain whether the address, network, server compatibility, or authorization is responsible; persisted metadata does not expose secrets; and connection state remains understandable offline or during interruption.

This priority includes hardening the current foundation rather than expanding the number of dashboards prematurely.

## Priority 2 - OAuth 2 Authentication

Phoenix Mobile supports the OAuth 2 flow provided by current Phoenix instances without weakening the unauthenticated connection path.

Completion means users can discover that authentication is required, complete authorization through a secure system browser flow, return through a validated deep link, refresh or revoke credentials, and reconnect after expiration. Tokens are held in SecureStore and are never written to logs, AsyncStorage, screenshots, or route parameters.

Authenticated and unauthenticated instances remain explicit states in the domain model and UI.

## Priority 3 - Useful Project Observability

The app becomes valuable after connection by exposing a carefully selected mobile view of Phoenix projects and their health.

Completion means users can scan projects, open a project, understand recent activity and important status, refresh data, and move into a small number of high-value trace or session workflows without reproducing desktop-scale tables on a phone.

Information architecture should be driven by mobile decisions users need to make, not by API availability alone.

## Priority 4 - Native Interaction Quality

Core flows feel intentional on touch devices and remain accessible.

Completion means navigation, sheets, keyboard handling, gestures, pull-to-refresh, haptics, loading states, error recovery, and reduced-motion behavior are coherent on iOS and Android. Important controls remain thumb reachable, long content remains legible, and animations never hide settled content or block work.

Web remains functional and visually consistent while native interaction is the reference experience.

## Priority 5 - Operational Readiness

The project can be changed and released with confidence by multiple developers and agents.

Completion means critical connection and credential logic has automated coverage; key user journeys have end-to-end validation; CI enforces type, lint, and build health; crashes and production errors are observable; dependency and platform upgrades are deliberate; and release builds can be produced repeatably for iOS and Android.

Testing and monitoring should be introduced before the app handles production OAuth credentials at scale.

## Priority 6 - Secure Distribution And Lifecycle

Phoenix Mobile has a production-grade application identity and lifecycle.

Completion means app icons and splash assets are final, bundle identifiers and signing are configured, privacy and network exceptions are reviewed, HTTPS expectations are documented, data deletion is complete, app-store metadata is prepared, and update/runtime-version policy prevents incompatible over-the-air releases.

Broad transport exceptions used during local development must be reconsidered as part of this goal.

## Priority 7 - Broader Companion Workflows

Additional Phoenix capabilities are added only when they fit a mobile workflow and the earlier priorities are dependable.

Potential directions include saved project shortcuts, recent traces, sessions, prompts, dataset and experiment summaries, notifications, and cross-instance status. These are opportunities, not commitments, until product evidence establishes their order and scope.

## Revising Priorities

Change this document when product direction, ordering, or completion criteria materially change. Record implementation discoveries in `FINDINGS.md` and implementation work in issues or plans instead of expanding these goals into checklists.
