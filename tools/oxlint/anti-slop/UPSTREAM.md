# anti-slop provenance

- Source: https://github.com/dmmulroy/anti-slop
- Upstream commit: 13909c9e07590f5a85d93c62712259fe14a883f7 (`skills/install-anti-slop/assets/anti-slop`, package version 0.1.2)
- Installed: 2026-10-14 via `node skills/install-anti-slop/scripts/install.mjs` into `tools/oxlint/anti-slop/`
- Registered entry point: `tools/oxlint/anti-slop/index.ts` as the `anti-slop` plugin in `.oxlintrc.json`
- Effect plugin (`effect/index.ts`) is copied but not registered; this repository does not depend on Effect.
- Oxlint and `@oxlint/plugins` are pinned together at 1.88.0 in `package.json`.

## Intentional local deviations

- `package.json` (`{"type":"module"}`) was added in this directory so Node loads the `.ts` plugin as ESM without a `MODULE_TYPELESS_PACKAGE_JSON` warning.
- `rules/no-module-mocking.ts` gained an `allowedModules` option (exact module specifiers). The repository allows mocking native Expo modules that have no Node implementation (`expo-secure-store`, `expo-crypto`, `expo/fetch`, `expo-haptics`). Every other module mock is still rejected.
- `no-runtime-typeof` runs with `allowInTypeGuards: true`: untyped JSON from span attributes and AI SDK tool payloads is narrowed inside named type predicates, never ad hoc.

When updating from upstream, follow `.claude/skills/install-anti-slop/references/update.md` and re-apply these deviations.
