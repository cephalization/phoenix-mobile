# Design System

Phoenix Mobile is a native utility with a flat, mostly monochrome design. Its structure follows T3 Code's mobile app, and it keeps Phoenix's typography and brand. Read this before changing a screen. `docs/iphone-duo.md` covers how columns, sheets, and the vertical bar behave.

## Principles

1. **Lists, not dashboards.** The sidebar holds lists people pick from. Figures go in one strip of numbers, never in a card grid.
2. **Flat and full width.** No cards around lists, no monogram tiles, no chevrons on rows, no shadows. Hierarchy comes from surface tint, hairlines, and type weight.
3. **One accent, used rarely.**
   - The semantic primary is monochrome (`accent`).
   - `danger` is only for errors and destructive actions, and `success` is only for OK states.
   - Cyan (`brand`) is only for PXI and the Phoenix mark.
   - Status never appears as a bare coloured dot.
4. **Actions live in the bar.** A screen's actions are native header items, so iPhone Duo can stack them in its trailing vertical bar. Content keeps only actions that belong to a specific row or form field.
5. **Numbers are monospaced.** Latency, tokens, counts, times, and IDs use `Type.mono` or `Type.monoValue` so they line up.

## Tokens (`src/constants/theme.ts`)

- **Surfaces:**
  - `background` is the page.
  - `sidebar` is the sidebar column's tint. Inside an expanded split's sidebar column, `useAppColors().background` already resolves to it through `SurfaceContext`.
  - `backgroundSelected` is for controls (search field, segmented track).
  - `rowSelected` is the selected or pressed row fill.
  - `backgroundElement` is only for raised controls and bubbles, never for list containers.
- **Lines:** `separator` is the hairline between rows (`StyleSheet.hairlineWidth`). `border` outlines controls such as inputs.
- **Text:** `text`, `textSecondary` for metadata, `textTertiary` for receded content and glyphs.
- **Type:** `Type.largeTitle` (a standalone page only), `Type.title`, `Type.headline` (row titles), `Type.body`, `Type.subhead`, `Type.label` (section labels, stat labels), `Type.mono`, `Type.monoValue`.
- **Spacing:** rows, headers, and strips share `RowInset` (20). Keep touch targets at least 48 points.

## Primitives (`src/components/ui/`)

| Component          | Use                                                                                                                  |
| ------------------ | -------------------------------------------------------------------------------------------------------------------- |
| `ListRow`          | Every tappable row. `variant="sidebar"` for gutter rows with a selection fill; `variant="flat"` for full-width rows. |
| `RowSeparator`     | The hairline between flat rows, inset to the text.                                                                   |
| `SectionHeader`    | A small label followed by a hairline. Pass `onToggle` to fold the section; a folded section shows its count.         |
| `StatStrip`        | One row of figures divided by hairlines. Replaces stat cards.                                                        |
| `StatusLabel`      | A symbol and a word: `ok`, `error`, `pending`, `neutral`.                                                            |
| `EmptyState`       | Empty, loading, and error states. No card. One optional action button.                                               |
| `SegmentedControl` | Native segmented picker on iOS, a matching control elsewhere.                                                        |

Where a screen needs something these don't cover, build it from the same tokens. A code block or JSON payload may keep its `code` background: it is content, not chrome.

## Navigation

- **Root:** the projects list for the active instance. The title is a native menu that switches instance, adds one, or opens Connections (`src/app/instances/index.tsx`). Connections holds the active instance's version, status, sign-in, and Remove.
- **Project:** a Traces or Sessions list. The segmented control switches between `projects/[projectId]` and `projects/[projectId]/sessions` with `router.replace`, so they act as one place.
- **Detail column:** a trace, a session, or a page drilled into from one. List rows open details with `selectDetail(href)`. Pushing from a detail page drills deeper.
- **Rows say what was asked.** As T3 Code lists a thread by its prompt, a trace row is titled by its root span's input (`inputExcerpt` in `src/features/traces/excerpt.ts`) and a session row by its first trace's input (`usePhoenixTraceOpeners`); the span name or ID is the fallback. Only an error earns a status symbol, so a healthy list stays quiet.
- **Beside a vertical bar** the navigation bar has no title, so a list leads with its own (`ProjectViewPicker` shows the project name there).

## Bar items

Build items with `barButton`, and menus with `barMenu`, from `src/components/duo/column-header.tsx`. Every item needs an SF Symbol, a label (shown in the overflow menu), and a `visibilityPriority`. Trailing items stack from the far end, so **the last item sits at the top of a vertical bar**: put PXI last. Fold rarely used actions into a `More` menu (`ellipsis.circle`, `visibilityPriority: 'low'`). A filter menu's icon switches to its `.fill` variant when the view differs from the default. Android and web keep pressables.

| Screen   | Items (first to last)                                    |
| -------- | -------------------------------------------------------- |
| Projects | Settings, PXI                                            |
| Traces   | Range, streaming, and Show menu, PXI                     |
| Sessions | Review filter menu, review queue settings, PXI           |
| Trace    | More (copy trace or span ID, open in Phoenix), PXI       |
| Session  | More (copy session ID), Add to dataset, Investigate, PXI |
| Sheets   | Done (`checkmark`, `variant: 'done'`, high priority)     |

## Motion

Rows don't animate in. A list appears settled, and pull to refresh keeps it in place. Keep animation for state changes such as sheets, the PXI panel, and folding sections, and respect Reduce Motion.
