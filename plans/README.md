# Implementation Plans

Plans are listed in recommended execution order. Read a plan completely before starting, honor its STOP conditions, and update its status here when work begins or completes.

## Execution Order And Status

| Plan | Title | Priority | Effort | Depends on | Status |
|------|-------|----------|--------|------------|--------|
| 001 | Ship instance-scoped PXI streaming chat | P1 | L | - | TODO |

Status values: `TODO`, `IN PROGRESS`, `DONE`, `BLOCKED`, or `REJECTED`.

## Dependency Notes

- Plan 001 is the first product feature built on the existing instance connection foundation.

## Decisions Already Made

- Keep the current React Native `StyleSheet` design system. Do not convert the application to Tailwind or attempt to run shadcn DOM components on native.
- Reproduce the useful behavior of shadcn's chat scroller with native list and scroll primitives.
- Reuse Phoenix PXI wire contracts and concepts, not the Node/Ink CLI package itself.
