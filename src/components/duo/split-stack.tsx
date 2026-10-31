import {
  createNativeStackProps,
  createStandardRouterNavigator,
  type NavigatorContentProps,
} from 'expo-router';
import {
  createStandardNativeStackNavigator,
  type StandardNativeStackEventMap,
} from 'expo-router/build/fork/native-stack/createNativeStackNavigator';
import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ComponentProps,
  type ReactNode,
} from 'react';
import { StyleSheet, View } from 'react-native';
import {
  SafeAreaInsetsContext,
  SafeAreaProvider,
  useSafeAreaInsets,
} from 'react-native-safe-area-context';
import { Split, type SplitHostCommands } from 'react-native-screens';

import type {
  NavigationAction,
  ParamListBase,
  StackNavigationState,
} from 'expo-router/react-navigation';
import type { NativeStackNavigationOptions } from 'expo-router/native-stack';

import { PxiChat } from '@/components/chat/pxi-chat';
import { EmptyState } from '@/components/ui/empty-state';
import { type Surface, SurfaceContext, useAppColors } from '@/constants/theme';
import {
  ColumnMetricsContext,
  LayoutMetricsObserver,
  type NativeLayoutMetrics,
} from '@/features/duo/native-metrics';
import {
  columnRoleOf,
  nativePopAction,
  reconcileScreens,
  SplitStackRouter,
} from '@/features/duo/split-routes';
import { SplitDetailContext, type SplitDetail } from '@/features/duo/split-detail';
import { usePxiPaneStore } from '@/features/pxi/pane-store';
import { isJsonObject } from '@/lib/json';
import { useInstanceStore } from '@/store/instances';

import { ColumnHeader } from './column-header';
import { PxiFloatingPanel } from './pxi-floating-panel';

const NativeStackContent = createStandardNativeStackNavigator.NavigatorContent;

type StackContentProps = ComponentProps<typeof NativeStackContent>;

type Descriptor = StackContentProps['descriptors'][string];

type Route = StackContentProps['state']['routes'][number];

type RouterState = StackNavigationState<ParamListBase>;

type SplitCreateProps = ReturnType<typeof createNativeStackProps> & {
  dispatch: (action: NavigationAction) => void;
  routerState: RouterState;
};

type SplitContentProps = NavigatorContentProps<
  NativeStackNavigationOptions,
  StandardNativeStackEventMap,
  object,
  SplitCreateProps
>;

/** Widths for the columns on the open iPhone Duo (951 pt) and iPad. */
const ColumnMetrics = {
  minimumPrimaryColumnWidth: 300,
  maximumPrimaryColumnWidth: 380,
  preferredPrimaryColumnWidthOrFraction: 340,
  minimumSecondaryColumnWidth: 320,
  minimumInspectorColumnWidth: 380,
  maximumInspectorColumnWidth: 380,
  preferredInspectorColumnWidthOrFraction: 380,
};

const isOverlay = (descriptor: Descriptor | undefined) => {
  const presentation = descriptor?.options.presentation;

  return presentation !== undefined && presentation !== 'card';
};

/**
 * The root navigator on devices that lay the app out in UIKit split columns
 * (iPhone Duo, iPad). One router history is projected three ways:
 *
 * - list pages stack in the sidebar column,
 * - what they select stacks in the detail column,
 * - sheets present over both from an outer native stack.
 *
 * PXI is the split's inspector column. UIKit collapses the split to one
 * column when iPhone Duo closes and expands it again when it opens, keeping
 * the pages and the inspector, which becomes a sheet while collapsed.
 * Modeled on T3 Code's workspace navigator (MIT).
 */
function SplitStackContent(props: SplitContentProps) {
  const { descriptors, state } = props;
  const active = state.routes.slice(0, state.index + 1);
  const firstOverlay = active.findIndex((route) => isOverlay(descriptors[route.key]));
  const workspace = firstOverlay < 0 ? active : active.slice(0, firstOverlay);
  const overlays = firstOverlay < 0 ? [] : active.slice(firstOverlay);
  const sidebar = workspace.filter((route) => columnRoleOf(route.name) === 'sidebar');
  const detail = workspace.filter((route) => columnRoleOf(route.name) === 'detail');
  const base = sidebar[0];

  // A history without a list page (a cold deep link) cannot fill the sidebar.
  if (base === undefined) return <NativeStackContent {...props} />;

  const baseDescriptor: Descriptor = {
    // The native stack reads the route (and more) from every descriptor.
    ...descriptors[base.key],
    options: { headerShown: false },
    render: () => (
      <SplitColumns
        descriptors={descriptors}
        detail={detail}
        dispatch={props.dispatch}
        emit={props.emitter.emit}
        routerState={props.routerState}
        sidebar={sidebar}
      />
    ),
  };

  return (
    <NativeStackContent
      {...props}
      descriptors={{ ...descriptors, [base.key]: baseDescriptor }}
      state={{ ...state, index: overlays.length, routes: [base, ...overlays] }}
    />
  );
}

export const SplitStack = createStandardRouterNavigator(SplitStackContent, SplitStackRouter, {
  createProps: (deps) => ({
    ...createNativeStackProps(deps),
    dispatch: deps.dispatch,
    routerState: deps.state,
  }),
});

type Emit = SplitContentProps['emitter']['emit'];

/** Which column UIKit shows while collapsed, and the detail root it began removing. */
type CollapsedColumn = { visible: 'primary' | 'secondary'; leaving: string | null };

function SplitColumns({
  descriptors,
  detail,
  dispatch,
  emit,
  routerState,
  sidebar,
}: {
  descriptors: StackContentProps['descriptors'];
  detail: Route[];
  dispatch: (action: NavigationAction) => void;
  emit: Emit;
  routerState: RouterState;
  sidebar: Route[];
}) {
  const colors = useAppColors();
  const hostRef = useRef<SplitHostCommands>(null);
  // Native callbacks can outlive the render that created them, so they read
  // the latest router state from here.
  const liveState = useRef(routerState);

  useLayoutEffect(() => {
    liveState.current = routerState;
  }, [routerState]);

  const pxiInstanceId = usePxiPaneStore((store) => store.instanceId);
  const closePxi = usePxiPaneStore((store) => store.close);
  const setPxiAvailable = usePxiPaneStore((store) => store.setAvailable);

  const pxiInstance = useInstanceStore((store) =>
    store.instances.find((candidate) => candidate.id === pxiInstanceId),
  );

  const primaryScreens = useRetainedScreens(sidebar, descriptors);
  const detailScreens = useRetainedScreens(detail, descriptors);

  // The inspector exists whether the split is expanded or collapsed (where UIKit
  // presents it as a sheet), so the PXI button never needs the chat route.
  useEffect(() => {
    setPxiAvailable(true);
  }, [setPxiAvailable]);

  const compactColumn = detail.length > 0 ? 'secondary' : 'primary';
  // Rendering reads the state; native callbacks read the ref, which is current
  // even before React re-renders.
  const [collapsedState, setCollapsedState] = useState(false);
  const collapsed = useRef(false);
  const collapsedColumn = useRef<CollapsedColumn>({ visible: compactColumn, leaving: null });

  // A collapsed split shows one column; follow the router when it adds the
  // first detail page or removes the last one.
  useEffect(() => {
    if (!collapsed.current || collapsedColumn.current.visible === compactColumn) return;
    collapsedColumn.current = { visible: compactColumn, leaving: null };
    hostRef.current?.show(compactColumn);
  }, [compactColumn]);

  const handleDismiss = (key: string, native: boolean) => {
    primaryScreens.complete(key);
    detailScreens.complete(key);

    if (!native) return;
    const action = nativePopAction(liveState.current, key);

    if (action) dispatch(action);
  };

  // While collapsed, UIKit nests the detail column's navigation controller in
  // the sidebar's. Back from the detail root pops that controller whole, so no
  // detail screen reports a dismissal; the list appearing after the detail
  // root began leaving is the only sign, and the router pops it then.
  const followCollapsed = (type: 'willAppear' | 'didAppear' | 'willDisappear', key: string) => {
    if (!collapsed.current) return;
    const state = liveState.current;
    const column = collapsedColumn.current;
    const sidebarTop = sidebar.at(-1)?.key;

    if (type === 'willDisappear') {
      if (
        state.routes[state.index]?.key === key &&
        columnRoleOf(state.routes[state.index]?.name ?? '') === 'detail'
      ) {
        collapsedColumn.current = { ...column, leaving: key };
      }

      return;
    }

    if (type === 'willAppear') {
      if (column.leaving === key) collapsedColumn.current = { ...column, leaving: null };

      return;
    }

    const leaving = column.leaving;
    collapsedColumn.current = {
      visible: key === sidebarTop ? 'primary' : 'secondary',
      leaving: null,
    };

    if (key !== sidebarTop || leaving === null) return;
    const firstDetail = state.routes.findIndex((route) => columnRoleOf(route.name) === 'detail');
    const detailRoot = firstDetail >= 0 ? state.routes[firstDetail]?.key : undefined;
    const action = detailRoot ? nativePopAction(state, detailRoot) : null;

    if (action) dispatch(action);
  };

  const columnScreen = (route: Route, index: number, attached: boolean, surface: Surface) => {
    const descriptor =
      descriptors[route.key] ??
      primaryScreens.descriptor(route.key) ??
      detailScreens.descriptor(route.key);

    if (!descriptor) return null;

    return (
      <ColumnScreen
        attached={attached}
        canGoBack={index > 0}
        descriptor={descriptor}
        emit={emit}
        key={route.key}
        onAppearance={followCollapsed}
        onDismiss={handleDismiss}
        routeKey={route.key}
        surface={surface}
      />
    );
  };

  const sidebarKeys = new Set(sidebar.map((route) => route.key));
  const detailKeys = new Set(detail.map((route) => route.key));
  const placeholder = emptyDetail(sidebar.at(-1)?.name);
  // Route objects keep their identity until the route changes, so the value
  // only changes when the detail column does; list screens read it, and a
  // fresh object on every render would re-render them and their header options.
  const shownDetail = detail.at(-1);

  const splitDetail = useMemo<SplitDetail>(
    () => ({
      active: true,
      route: shownDetail
        ? {
            name: shownDetail.name,
            params: isJsonObject(shownDetail.params) ? shownDetail.params : {},
          }
        : null,
    }),
    [shownDetail],
  );

  return (
    <SplitDetailContext value={splitDetail}>
      <View style={styles.fill}>
        <Split.Host
          columnMetrics={ColumnMetrics}
          displayModeButtonVisibility="never"
          onCollapse={() => {
            collapsed.current = true;
            setCollapsedState(true);
            collapsedColumn.current = { visible: compactColumn, leaving: null };
          }}
          onExpand={() => {
            collapsed.current = false;
            setCollapsedState(false);
          }}
          onInspectorHide={() => {
            // Only a swipe on the collapsed split's inspector sheet closes PXI;
            // expanding hides the inspector because the floating panel takes over.
            if (collapsed.current && pxiInstanceId !== null) closePxi();
          }}
          preferredDisplayMode="oneBesideSecondary"
          preferredSplitBehavior="tile"
          presentsWithGesture
          primaryBackgroundStyle="none"
          ref={hostRef}
          showInspector={pxiInstance !== undefined && collapsedState}
          topColumnForCollapsing={compactColumn}
        >
          <Split.Column>
            <Split.Stack>
              {primaryScreens.routes.map((route) =>
                columnScreen(
                  route,
                  sidebar.findIndex((candidate) => candidate.key === route.key),
                  sidebarKeys.has(route.key),
                  // Collapsed, the sidebar is the whole window, so it is a page.
                  collapsedState ? 'page' : 'sidebar',
                ),
              )}
            </Split.Stack>
          </Split.Column>
          <Split.Column>
            <Split.Stack>
              <Split.Screen
                activityMode={detail.length === 0 && !collapsedState ? 'attached' : 'detached'}
                screenKey="split-empty-detail"
              >
                <ColumnHeader canGoBack={false} options={{ title: '' }} />
                <ColumnContent>
                  <EmptyState
                    message={placeholder.message}
                    symbol={{ ios: placeholder.symbol }}
                    title={placeholder.title}
                  />
                </ColumnContent>
              </Split.Screen>
              {detailScreens.routes.map((route) =>
                columnScreen(
                  route,
                  detail.findIndex((candidate) => candidate.key === route.key),
                  detailKeys.has(route.key),
                  'page',
                ),
              )}
            </Split.Stack>
          </Split.Column>
          <Split.Inspector>
            <Split.HeaderConfig hidden />
            <ColumnContent>
              {pxiInstance && collapsedState ? (
                <PxiChat instance={pxiInstance} onClose={closePxi} presentation="pane" />
              ) : (
                <View style={{ flex: 1, backgroundColor: colors.background }} />
              )}
            </ColumnContent>
          </Split.Inspector>
        </Split.Host>
        {/* With room beside the columns PXI floats in from the trailing edge; a
          collapsed split shows it as the inspector's sheet instead. */}
        <PxiFloatingPanel instance={collapsedState ? undefined : pxiInstance} onClose={closePxi} />
      </View>
    </SplitDetailContext>
  );
}

function emptyDetail(sidebarRoute: string | undefined) {
  switch (sidebarRoute) {
    case 'instances/[id]/projects/[projectId]':
      return {
        title: 'No trace selected',
        message: 'Pick a trace to see its spans, input, and output.',
        symbol: 'point.3.connected.trianglepath.dotted',
      } as const;
    case 'instances/[id]/projects/[projectId]/sessions/index':
      return {
        title: 'No session selected',
        message: 'Pick a session to read the conversation and review it.',
        symbol: 'bubble.left.and.text.bubble.right',
      } as const;
    default:
      return {
        title: 'No project selected',
        message: 'Pick a project to see its traces and sessions.',
        symbol: 'sidebar.left',
      } as const;
  }
}

/**
 * Keeps a column's outgoing screens mounted until UIKit finishes animating
 * them away; unmounting earlier enqueues a second native pop.
 */
function useRetainedScreens(routes: Route[], descriptors: StackContentProps['descriptors']) {
  // The projection rebuilds route arrays every render; compare their keys.
  const signature = routes.map((route) => route.key).join('\n');

  const [screens, setScreens] = useState({
    routes,
    descriptors,
    signature,
    completed: new Set<string>(),
  });

  if (screens.signature !== signature) {
    const next = reconcileScreens(screens.routes, routes, screens.completed);
    const retained = new Set(next.map((route) => route.key));
    const active = new Set(routes.map((route) => route.key));

    setScreens({
      routes: next,
      descriptors: Object.fromEntries(
        Object.entries({ ...screens.descriptors, ...descriptors }).filter(([key]) =>
          retained.has(key),
        ),
      ),
      signature,
      completed: new Set([...screens.completed].filter((key) => active.has(key))),
    });
  }

  return {
    routes: screens.routes,
    descriptor: (key: string): Descriptor | undefined => screens.descriptors[key],
    complete: (key: string) =>
      setScreens((current) =>
        current.routes.some((route) => route.key === key)
          ? {
              ...current,
              routes: current.routes.filter((route) => route.key !== key),
              completed: new Set([...current.completed, key]),
            }
          : current,
      ),
  };
}

function ColumnScreen({
  attached,
  canGoBack,
  descriptor,
  emit,
  onAppearance,
  onDismiss,
  routeKey,
  surface,
}: {
  surface: Surface;
  attached: boolean;
  canGoBack: boolean;
  descriptor: Descriptor;
  emit: Emit;
  onAppearance: (type: 'willAppear' | 'didAppear' | 'willDisappear', key: string) => void;
  onDismiss: (key: string, native: boolean) => void;
  routeKey: string;
}) {
  return (
    <Split.Screen
      activityMode={attached ? 'attached' : 'detached'}
      onDidAppear={() => {
        onAppearance('didAppear', routeKey);
        emit({ type: 'transitionEnd', target: routeKey, data: { closing: false } });
      }}
      onDidDisappear={() =>
        emit({ type: 'transitionEnd', target: routeKey, data: { closing: true } })
      }
      onDismiss={(event) => onDismiss(routeKey, event.nativeEvent.isNativeDismiss)}
      onWillAppear={() => {
        onAppearance('willAppear', routeKey);
        emit({ type: 'transitionStart', target: routeKey, data: { closing: false } });
      }}
      onWillDisappear={() => {
        onAppearance('willDisappear', routeKey);
        emit({ type: 'transitionStart', target: routeKey, data: { closing: true } });
      }}
      screenKey={routeKey}
    >
      <SurfaceContext value={surface}>
        <ColumnHeader canGoBack={canGoBack} options={descriptor.options} />
        <ColumnContent>{descriptor.render()}</ColumnContent>
      </SurfaceContext>
    </Split.Screen>
  );
}

/**
 * The body of a column screen. Column bars are translucent and float over the
 * column, so the body starts below them; screens still pad their own sides
 * for the vertical bar, which reaches only the trailing column. The body is
 * measured so `useDuoLayout` inside answers for the column, not the window.
 */
function ColumnContent({ children }: { children: ReactNode }) {
  const colors = useAppColors();
  const [metrics, setMetrics] = useState<NativeLayoutMetrics | null>(null);

  return (
    <SafeAreaProvider style={[styles.fill, { backgroundColor: colors.background }]}>
      <BelowColumnBar>
        <LayoutMetricsObserver onChange={setMetrics} />
        <ColumnMetricsContext value={metrics}>{children}</ColumnMetricsContext>
      </BelowColumnBar>
    </SafeAreaProvider>
  );
}

function BelowColumnBar({ children }: { children: ReactNode }) {
  const insets = useSafeAreaInsets();
  const below = useMemo(() => ({ ...insets, top: 0 }), [insets]);

  return (
    <View style={[styles.fill, { paddingTop: insets.top }]}>
      <SafeAreaInsetsContext.Provider value={below}>{children}</SafeAreaInsetsContext.Provider>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
});
