/**
 * Pure rules for projecting one stack history into native split columns
 * (iPhone Duo, iPad). List screens stack in the sidebar column; the things a
 * list selects stack in the detail column. Sheets are presentations over both
 * and are recognized by their options, not by name.
 */
const SidebarRoutes = new Set([
  'index',
  // Redirects to the root; kept a sidebar route so it never opens the detail column.
  'instances/[id]/index',
  'instances/[id]/projects/[projectId]',
  'instances/[id]/projects/[projectId]/sessions/index',
]);

export type ColumnRole = 'sidebar' | 'detail';

type RouteLike = { readonly key: string; readonly name: string };

type StackLike<Route extends RouteLike> = {
  readonly key: string;
  readonly index: number;
  readonly routes: readonly Route[];
};

export function columnRoleOf(routeName: string): ColumnRole {
  return SidebarRoutes.has(routeName) ? 'sidebar' : 'detail';
}

/**
 * Applies the column rules to the state a push, navigate, or replace produced.
 * Opening a sidebar page clears the detail column, because a selection belongs
 * to the list that made it. A selection replaces the detail column's pages,
 * while drilling in from a detail page stacks on top so Back returns. Together
 * they keep the history ordered as sidebar pages followed by detail pages.
 */
export function applyColumnRules<Route extends RouteLike, State extends StackLike<Route>>(
  previous: Pick<State, 'routes'>,
  next: State,
  selecting: boolean,
): State {
  const top = next.routes[next.index];
  const known = new Set(previous.routes.map((route) => route.key));

  if (top === undefined || known.has(top.key)) return next;

  if (columnRoleOf(top.name) === 'detail' && !selecting) return next;

  const active = next.routes.slice(0, next.index + 1);
  const preloaded = next.routes.slice(next.index + 1);

  const routes = active.filter(
    (route) => route.key === top.key || columnRoleOf(route.name) === 'sidebar',
  );

  return { ...next, index: routes.length - 1, routes: [...routes, ...preloaded] };
}

/**
 * The POP that removes a route a native gesture already dismissed, together
 * with everything above it. Native callbacks can arrive after a JavaScript pop
 * or replace, so a route that is no longer active pops nothing.
 */
export function nativePopAction(state: StackLike<RouteLike>, dismissedKey: string) {
  const index = state.routes.findIndex((route) => route.key === dismissedKey);
  const count = index <= 0 || index > state.index ? 0 : state.index - index + 1;
  const source = state.routes[state.index]?.key;

  return count > 0 && source !== undefined
    ? { type: 'POP' as const, payload: { count }, source, target: state.key }
    : null;
}

/** Keeps outgoing screens mounted until UIKit finishes removing them. */
export function reconcileScreens<T extends { readonly key: string }>(
  previous: readonly T[],
  current: readonly T[],
  completed: ReadonlySet<string>,
): T[] {
  const active = new Set(current.map((route) => route.key));
  const screens = [...current];

  previous.forEach((route, index) => {
    if (!active.has(route.key) && !completed.has(route.key)) {
      screens.splice(Math.min(index, screens.length), 0, route);
    }
  });

  return screens;
}
