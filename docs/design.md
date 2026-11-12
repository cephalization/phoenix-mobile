# Design System

Phoenix Mobile is a native utility with a flat, mostly monochrome design. Its structure follows T3 Code's mobile app, and it keeps Phoenix's typography and brand. Read this before changing a screen. `docs/iphone-duo.md` covers how columns, sheets, and the vertical bar behave.

## Principles

1. **Lists, not dashboards.** The sidebar holds lists people pick from. Figures go in one strip of numbers, never in a card grid. A project's Overview is the one chart page, and it is built from the same flat parts: a stat strip, then full-width charts under section headers (see Charts).
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

| Component              | Use                                                                                                                      |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `ListRow`              | Every tappable row. `variant="sidebar"` for gutter rows with a selection fill; `variant="flat"` for full-width rows.     |
| `SwipeActionRow`       | Wraps a flat row whose item can be removed: swipe left for one destructive action. Repeat it as an accessibility action. |
| `RowSeparator`         | The hairline between flat rows, inset to the text.                                                                       |
| `SectionHeader`        | A small label followed by a hairline. Pass `onToggle` to fold the section; a folded section shows its count.             |
| `StatStrip`            | One row of figures divided by hairlines. Replaces stat cards.                                                            |
| `StatusLabel`          | A symbol and a word: `ok`, `error`, `pending`, `neutral`.                                                                |
| `EmptyState`           | Empty, loading, and error states. No card. One optional action button.                                                   |
| `SegmentedControl`     | Native segmented picker on iOS, a matching control elsewhere.                                                            |
| `Bars`, `Lines`        | Full-width charts (`charts/`), inside a `ChartSection` and a `ScrubSurface`.                                             |
| `MiniBars`, `MiniLine` | Row-sized pulse and trend, as a row's trailing element.                                                                  |

Where a screen needs something these don't cover, build it from the same tokens. A code block or JSON payload may keep its `code` background: it is content, not chrome.

## Charts

Charts answer one question each, run the full content width, and follow the colour rules: bars and lines are monochrome (`textTertiary`, the headline line in `text`), only errors take `danger`, and nothing uses `brand`. A second series is a receded dashed line, not a second colour. Each chart sits in a `ChartSection`: the header, the figure the chart is about (the selected bin's, or the range's), the scale's top value, and the first bin's time and "now" beneath.

Every chart on a page shares one selection. A horizontal drag scrubs and a tap selects a bin (tap it again to clear); vertical drags scroll the page. The selected bin is drawn in `text` over a `rowSelected` column and the rest recede. Screen readers get an adjustable element that steps through bins. The readout above the charts names the bin and opens it: **Traces** shows that span in the Traces view, and **N errors** shows only its errors there. Numbers are monospaced, as everywhere.

Rows use `MiniBars` for a project's last day of traffic (errors on top in `danger`) and `MiniLine` for an eval's trend. A pulse has no axes; the row's label speaks the figures.

## Navigation

- **Root:** the projects list for the active instance, read as a health list: a strip of the instance's last 24 hours (traces, error rate, cost, active projects), a **Needs attention** section for projects whose errors spiked, traffic stopped, or p95 slowed (rules in `src/features/metrics/health.ts`), and a 24-hour pulse on every row. The title is a native menu that switches instance, adds one, or opens Connections (`src/app/instances/index.tsx`). Connections holds the active instance's version, status, sign-in, and Remove.
- **Project:** one route, `projects/[projectId]`, showing its Overview, Traces, or Sessions by the `view` parameter. Overview leads unless a link asks for traces (a `query` filter or a time window) or the server predates project metrics (Phoenix 11.11). In an expanded split (the open iPhone Duo, iPad) the Overview divides: the sidebar keeps the figures and lists, including the hours with errors as rows that select their hour, and the empty detail column draws the charts (`ProjectOverviewBoard`) with the readout; both share one range and selection through `useOverviewStore`. A chart bin opens Traces with `from`, `to`, and `show=errors`; the window replaces the range under a "Whole range" bar until it is cleared or another range is chosen. The segmented control sets the parameter on the project's own navigation, so nothing is pushed; in split columns that also clears the detail column (`clearDetailAbove`), because a selection belongs to the list that made it. Each list stays mounted once shown and the other is hidden, so switching back neither reloads nor reflows, and only the visible list sets the bar items.
- **Detail column:** a trace, a session, or a page drilled into from one. List rows open details with `selectDetail(href)`. Pushing from a detail page drills deeper.
- **Filtering traces:** a search-field-shaped row in the Traces list opens the Filter traces sheet (Expression with suggestions, recents, and field completions; Ask for plain English). The active expression shows in mono with a clear button, and the section header reads "Filtered · …". It is an in-content field, not a bar item, because it holds text.
- **Rows say what was asked.** As T3 Code lists a thread by its prompt, a trace row is titled by its root span's input (`inputExcerpt` in `src/features/traces/excerpt.ts`) and a session row by its first trace's input (`usePhoenixTraceOpeners`); the span name or ID is the fallback. Only an error earns a status symbol, so a healthy list stays quiet.
- **Beside a vertical bar** the navigation bar has no title, so a list leads with its own (`ProjectViewPicker` shows the project name there).

## Bar items

Build items with `barButton`, and menus with `barMenu`, from `src/components/duo/column-header.tsx`. Every item needs an SF Symbol, a label (shown in the overflow menu), and a `visibilityPriority`. Trailing items stack from the far end, so **the last item sits at the top of a vertical bar**: put PXI last. Fold rarely used actions into a `More` menu (`ellipsis.circle`, `visibilityPriority: 'low'`). In an expanded split (the open Duo, iPad), PXI lives only in the detail column's bar, including while nothing is selected; the sidebar's bar keeps the list's own controls. Screens still add PXI to their items, and the split drops it from sidebar bars by its `PxiBarItemId` identifier. A filter menu's icon switches to its `.fill` variant when the view differs from the default. Android keeps pressables.

| Screen                 | Items (first to last)                                    |
| ---------------------- | -------------------------------------------------------- |
| Projects               | Settings, PXI                                            |
| Overview               | Time range, PXI                                          |
| Traces                 | Range, streaming, and Show menu, PXI                     |
| Sessions               | Review filter menu, review queue settings, PXI           |
| Trace                  | More (copy trace or span ID, open in Phoenix), PXI       |
| Session                | More (copy session ID), Add to dataset, Investigate, PXI |
| PXI sheet (closed Duo) | History, New Chat, Done                                  |
| Sheets                 | Done (`checkmark`, `variant: 'done'`, high priority)     |

## Offline

When an instance can't be reached, screens keep showing what was last loaded, with `CachedDataNotice` at the top: one quiet line, "Offline · Saved 2h ago", plus "· 3 waiting" when changes are queued (tap to open Waiting to upload). A page that was never saved shows `OfflineUnavailable`, never a raw network error. The notice leads the screen, above a list's own title and segmented control. Lists say in advance what will open: offline, a trace or session whose details were never saved, and a project with neither list saved, is dimmed with "Not saved offline" and a trailing `NotSavedOfflineGlyph`, and instances in Connections and the switcher menu read "Offline · 3 projects saved" (or "Nothing saved", dimmed with the glyph). Actions that need the server (PXI, Investigate) are disabled with a short reason; everything else works and queues.

## Motion

Rows don't animate in. A list appears settled, and pull to refresh keeps it in place. Keep animation for state changes such as sheets, the PXI panel, and folding sections, and respect Reduce Motion.
