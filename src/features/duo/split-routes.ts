import { isActionHandled, router, type Href } from 'expo-router';
import { StackRouter as ExpoStackRouter } from 'expo-router/build/layouts/stack-router';

import type { StackRouterOptions } from 'expo-router/react-navigation';

import { applyColumnRules } from './split-columns';

export { columnRoleOf, nativePopAction, reconcileScreens } from './split-columns';

let columnsEnabled = false;

/** Turns on column routing rules. Called once, when the root layout picks its navigator. */
export function enableColumnRouting(enabled: boolean) {
  columnsEnabled = enabled;
}

/**
 * Marks a push as a selection. Expo Router copies `dangerouslySingular` into
 * the action payload, which is the only per-push value that reaches the
 * router; returning no id leaves Expo Router's own singular handling inert.
 */
const SelectDetail = (): string | undefined => undefined;

/**
 * Opens a page the way a list row does: in native columns it replaces whatever
 * the detail column shows, so Back returns to the list rather than to the
 * previous selection. Elsewhere it is a plain push. Use `router.push` for
 * drilling into a page from another detail page.
 */
export function selectDetail(href: Href) {
  router.push(href, columnsEnabled ? { dangerouslySingular: SelectDetail } : undefined);
}

function isSelection(action: { payload?: object }) {
  return (
    action.payload !== undefined &&
    'singular' in action.payload &&
    action.payload.singular === SelectDetail
  );
}

/** Expo Router's stack router with the column rules of `applyColumnRules` on top. */
export function SplitStackRouter(options: StackRouterOptions) {
  const base = ExpoStackRouter(options);

  return {
    ...base,
    getStateForAction(
      ...args: Parameters<typeof base.getStateForAction>
    ): ReturnType<typeof base.getStateForAction> {
      const [state, action] = args;
      const result = base.getStateForAction(...args);

      if (!columnsEnabled || !isActionHandled(result)) return result;

      if (action.type !== 'PUSH' && action.type !== 'NAVIGATE' && action.type !== 'REPLACE') {
        return result;
      }

      return { ...result, state: applyColumnRules(state, result.state, isSelection(action)) };
    },
  };
}
