import { useQueryClient } from '@tanstack/react-query';
import { router, Stack } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { useState } from 'react';
import {
  Platform,
  Pressable,
  RefreshControl,
  SectionList,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { barButton } from '@/components/duo/column-header';
import { CachedDataNotice } from '@/components/offline/cached-data-notice';
import { isDeviceOffline, isUnavailableOffline } from '@/components/offline/offline-state';
import { NotSavedOfflineGlyph } from '@/components/offline/not-saved-offline-glyph';
import { OfflineUnavailable } from '@/components/offline/offline-unavailable';
import { InstanceTitleButton, useInstanceSwitcherItem } from '@/components/instance-switcher';
import { PhoenixLogo } from '@/components/phoenix-logo';
import { PxiHeaderButton, usePxiHeaderOptions } from '@/components/pxi-header-button';
import { MiniBars } from '@/components/ui/charts/bars';
import { EmptyState } from '@/components/ui/empty-state';
import { ListRow, RowInset } from '@/components/ui/list-row';
import { SectionHeader } from '@/components/ui/section-header';
import { StatStrip } from '@/components/ui/stat-strip';
import { Type, useAppColors } from '@/constants/theme';
import { runOAuthLogin } from '@/features/auth/login';
import { useContentColumnStyle } from '@/features/duo/layout';
import { useInstanceStatus } from '@/features/instances/status';
import type { ProjectHealth } from '@/features/metrics/api';
import {
  assessProject,
  errorRate,
  formatCost,
  formatPercent,
  type HealthSignal,
  statusTotals,
} from '@/features/metrics/health';
import { createMetricsWindow, type MetricsWindow } from '@/features/metrics/window';
import { useSavedOfflineData } from '@/features/offline/persistence';
import { useInstanceReachability } from '@/features/offline/reachability';
import {
  phoenixQueryKeys,
  type PhoenixProject,
  usePhoenixProjects,
} from '@/hooks/use-phoenix-data';
import { useProjectsHealth } from '@/hooks/use-phoenix-metrics';
import { formatCompactNumber } from '@/lib/format';
import { haptics } from '@/lib/haptics';
import { useActiveInstance, useInstanceStore } from '@/store/instances';
import { useSettingsStore } from '@/store/settings';
import type { PhoenixInstance } from '@/types/instance';

const NoRecents: readonly string[] = [];

/**
 * The app's root: the active instance's projects. The instance is chosen from
 * the title menu, so the sidebar is a list from the first screen; the
 * instance's own details live in the Connections sheet.
 */
export default function ProjectsScreen() {
  const colors = useAppColors();
  const hasHydrated = useInstanceStore((state) => state.hasHydrated);
  const instance = useActiveInstance();

  if (!hasHydrated) {
    return <View style={[styles.screen, { backgroundColor: colors.background }]} />;
  }

  if (!instance) return <Welcome />;

  return <InstanceProjects instance={instance} key={instance.id} />;
}

function InstanceProjects({ instance }: { instance: PhoenixInstance }) {
  const colors = useAppColors();
  const queryClient = useQueryClient();
  const column = useContentColumnStyle(0);
  const projects = usePhoenixProjects(instance);
  const status = useInstanceStatus(instance);
  const offline = useInstanceReachability(instance.id).state === 'offline';
  const saved = useSavedOfflineData(instance.id);
  const switcher = useInstanceSwitcherItem(instance);
  const pxiHeader = usePxiHeaderOptions(instance);
  const recentIds = useSettingsStore((state) => state.recentProjects[instance.id] ?? NoRecents);
  const noteProjectOpened = useSettingsStore((state) => state.noteProjectOpened);
  const [query, setQuery] = useState('');
  const [signingIn, setSigningIn] = useState(false);
  const [healthWindow, setHealthWindow] = useState(() => createMetricsWindow('day'));
  const nativeBar = Platform.OS === 'ios';
  const projectIds = (projects.data ?? []).map((project) => project.id);
  const health = useProjectsHealth(instance, projectIds, healthWindow);
  const healthById = new Map((health.data ?? []).map((entry) => [entry.projectId, entry]));

  const signals = new Map<string, HealthSignal>();

  for (const entry of health.data ?? []) {
    const signal = assessProject(entry, healthWindow);

    if (signal) signals.set(entry.projectId, signal);
  }

  const refresh = async () => {
    if (isDeviceOffline()) {
      haptics.warning();

      return;
    }

    haptics.selection();
    // A new window refetches health for the day ending now.
    setHealthWindow(createMetricsWindow('day'));
    const results = await Promise.all([projects.refetch(), status.viewer.refetch()]);

    if (results.some((result) => result.isError)) haptics.error();
  };

  const signIn = async () => {
    if (instance.auth.type !== 'oauth2' || signingIn) return;
    setSigningIn(true);

    try {
      await runOAuthLogin(instance);
      await queryClient.invalidateQueries({ queryKey: phoenixQueryKeys.instance(instance.id) });
      haptics.success();
    } catch {
      haptics.error();
    } finally {
      setSigningIn(false);
    }
  };

  const open = (project: PhoenixProject) => {
    noteProjectOpened(instance.id, project.id);
    router.push({
      pathname: '/instances/[id]/projects/[projectId]',
      params: { id: instance.id, projectId: project.id },
    });
  };

  const sections = projectSections(projects.data ?? [], recentIds, query, signals);

  const emptyState = isUnavailableOffline(projects, offline) ? (
    <OfflineUnavailable instanceName={instance.name} onRetry={() => void refresh()} />
  ) : projects.isPending ? (
    <EmptyState loading title="Loading projects" />
  ) : status.loginRequired && instance.auth.type === 'oauth2' ? (
    <EmptyState
      action={{ label: signingIn ? 'Signing in…' : 'Sign in', onPress: () => void signIn() }}
      message={`${instance.name} needs you to sign in again.`}
      symbol={{ android: 'lock', ios: 'lock' }}
      title="Sign-in required"
    />
  ) : projects.isError ? (
    <EmptyState
      action={{ label: 'Try again', onPress: () => void refresh() }}
      message={projects.error.message}
      symbol={{ android: 'wifi_off', ios: 'wifi.exclamationmark' }}
      title={`Can’t reach ${instance.name}`}
    />
  ) : query.length > 0 ? (
    <EmptyState fill={false} title="No matching projects" />
  ) : (
    <EmptyState
      message="Projects appear here once they send traces."
      symbol={{ android: 'folder', ios: 'folder' }}
      title="No projects yet"
    />
  );

  const list = (
    <SectionList
      contentContainerStyle={[styles.list, column]}
      contentInsetAdjustmentBehavior="automatic"
      keyboardDismissMode="on-drag"
      keyboardShouldPersistTaps="handled"
      ListEmptyComponent={emptyState}
      ListHeaderComponent={
        <View>
          {nativeBar ? null : (
            <View style={styles.titleRow}>
              <InstanceTitleButton instance={instance} />
              <View style={styles.titleActions}>
                <Pressable
                  accessibilityLabel="Settings"
                  accessibilityRole="button"
                  onPress={() => router.push('/settings')}
                  style={styles.iconButton}
                >
                  <SymbolView
                    name={{ android: 'settings', ios: 'gearshape' }}
                    size={22}
                    tintColor={colors.text}
                  />
                </Pressable>
                <PxiHeaderButton
                  accessibilityLabel={`Open PXI for ${instance.name}`}
                  onPress={() =>
                    router.push({ pathname: '/instances/[id]/chat', params: { id: instance.id } })
                  }
                />
              </View>
            </View>
          )}
          <CachedDataNotice dataUpdatedAt={projects.dataUpdatedAt} instance={instance} />
          {health.data && health.data.length > 0 ? (
            <InstancePulse health={health.data} window={healthWindow} />
          ) : null}
          {(projects.data?.length ?? 0) > 6 ? (
            <View style={[styles.search, { backgroundColor: colors.backgroundSelected }]}>
              <SymbolView
                name={{ android: 'search', ios: 'magnifyingglass' }}
                size={15}
                tintColor={colors.textSecondary}
              />
              <TextInput
                accessibilityLabel="Search projects"
                autoCapitalize="none"
                autoCorrect={false}
                clearButtonMode="while-editing"
                onChangeText={setQuery}
                placeholder="Search projects"
                placeholderTextColor={colors.textSecondary}
                returnKeyType="search"
                style={[Type.body, styles.searchInput, { color: colors.text }]}
                value={query}
              />
            </View>
          ) : null}
        </View>
      }
      refreshControl={
        <RefreshControl
          colors={[colors.textSecondary]}
          onRefresh={refresh}
          refreshing={projects.isRefetching}
          tintColor={colors.textSecondary}
        />
      }
      renderItem={({ item }) => {
        // Offline, a project only opens to something if one of its views was saved.
        const unsaved = offline && !saved.projectIds.includes(item.id);
        const pulse = healthById.get(item.id);
        const signal = signals.get(item.id);
        const subtitle = unsaved ? 'Not saved offline' : projectSubtitle(item, pulse, signal);

        return (
          <ListRow
            accessibilityHint={
              unsaved ? 'Not saved for offline use' : "Opens the project's overview"
            }
            accessibilityLabel={`${item.name}${subtitle ? `, ${subtitle}` : ''}`}
            dimmed={unsaved}
            onPress={() => open(item)}
            subtitle={subtitle}
            subtitleTone={signal?.kind === 'errors' ? 'danger' : 'default'}
            title={item.name}
            trailing={
              unsaved ? (
                <NotSavedOfflineGlyph />
              ) : pulse ? (
                <MiniBars
                  values={pulse.status.map((bin) => ({ base: bin.ok, alert: bin.errors }))}
                />
              ) : null
            }
          />
        );
      }}
      renderSectionHeader={({ section }) =>
        section.title ? <SectionHeader label={section.title} /> : null
      }
      sections={sections}
      stickySectionHeadersEnabled={false}
      style={[styles.screen, { backgroundColor: colors.background }]}
    />
  );

  if (!nativeBar) {
    return (
      <SafeAreaView
        edges={['top', 'left', 'right']}
        style={[styles.screen, { backgroundColor: colors.background }]}
      >
        {list}
      </SafeAreaView>
    );
  }

  return (
    <>
      <Stack.Screen
        options={{
          headerShown: true,
          title: '',
          unstable_headerLeftItems: () => (switcher ? [switcher] : []),
          unstable_headerRightItems: (props) => [
            barButton({
              type: 'button',
              label: 'Settings',
              icon: { type: 'sfSymbol', name: 'gearshape' },
              onPress: () => router.push('/settings'),
            }),
            // PXI comes last, which puts it at the top of a vertical bar.
            ...(pxiHeader.unstable_headerRightItems?.(props) ?? []),
          ],
        }}
      />
      {list}
    </>
  );
}

type ProjectSection = { title: string | null; data: PhoenixProject[] };

const SignalOrder: Record<HealthSignal['kind'], number> = { errors: 0, quiet: 1, slower: 2 };

/**
 * Projects that need a look first, then recently opened ones, then every
 * project by name. A search collapses them into one filtered list.
 */
function projectSections(
  projects: PhoenixProject[],
  recentIds: readonly string[],
  query: string,
  signals: ReadonlyMap<string, HealthSignal>,
): ProjectSection[] {
  if (projects.length === 0) return [];
  const byName = [...projects].sort((a, b) => a.name.localeCompare(b.name));
  const needle = query.trim().toLowerCase();

  if (needle.length > 0) {
    const matches = byName.filter((project) => project.name.toLowerCase().includes(needle));

    return matches.length === 0 ? [] : [{ title: null, data: matches }];
  }

  const attention = byName
    .flatMap((project) => {
      const signal = signals.get(project.id);

      return signal ? [{ project, order: SignalOrder[signal.kind] }] : [];
    })
    .sort((left, right) => left.order - right.order)
    .map((entry) => entry.project);

  const recent = recentIds.flatMap((id) => projects.filter((project) => project.id === id));
  const sections: ProjectSection[] = [];

  if (attention.length > 0) sections.push({ title: 'Needs attention', data: attention });

  if (recent.length > 0 && projects.length > 6) sections.push({ title: 'Recent', data: recent });

  sections.push({ title: sections.length > 0 ? 'All projects' : null, data: byName });

  return sections;
}

/** The row's second line: what needs a look, the day's figures, or the description. */
function projectSubtitle(
  project: PhoenixProject,
  pulse: ProjectHealth | undefined,
  signal: HealthSignal | undefined,
): string | undefined {
  if (signal) return signal.summary;

  if (!pulse) return project.description ?? undefined;
  const totals = statusTotals(pulse.status);

  if (totals.traces === 0) return project.description ?? 'No traces in the last 24 hours';
  const rate = errorRate(totals);

  return `${formatCompactNumber(totals.traces)} traces${rate ? ` · ${formatPercent(rate)} errors` : ''}`;
}

/** The instance's last day in one strip: traffic, errors, spend, and how many projects ran. */
function InstancePulse({
  health,
  window,
}: {
  health: readonly ProjectHealth[];
  window: MetricsWindow;
}) {
  let traces = 0;
  let errors = 0;
  let cost = 0;
  let hasCost = false;
  let active = 0;

  for (const entry of health) {
    const totals = statusTotals(entry.status);
    traces += totals.traces;
    errors += totals.errors;

    if (totals.traces > 0) active += 1;

    if (entry.cost !== null) {
      cost += entry.cost;
      hasCost = true;
    }
  }

  const rate = errorRate({ traces, errors });

  return (
    <View accessibilityLabel={`Last ${window.bins.length} hours`}>
      <StatStrip
        stats={[
          { label: 'Traces · 24h', value: formatCompactNumber(traces) },
          {
            label: 'Errors',
            value: rate === null ? '—' : formatPercent(rate),
            tone: errors > 0 ? 'danger' : 'default',
          },
          { label: 'Cost', value: hasCost ? formatCost(cost) : '—' },
          { label: 'Active', value: `${active}/${health.length}` },
        ]}
      />
    </View>
  );
}

/** First launch: the one screen where the Phoenix mark leads. */
function Welcome() {
  const colors = useAppColors();

  return (
    <SafeAreaView style={[styles.screen, { backgroundColor: colors.background }]}>
      {Platform.OS === 'ios' ? (
        <Stack.Screen
          options={{
            headerShown: true,
            title: '',
            unstable_headerRightItems: () => [
              barButton({
                type: 'button',
                label: 'Settings',
                icon: { type: 'sfSymbol', name: 'gearshape' },
                onPress: () => router.push('/settings'),
              }),
            ],
          }}
        />
      ) : null}
      <EmptyState
        action={{ label: 'Add instance', onPress: () => router.push('/instances/new') }}
        art={<PhoenixLogo size={56} />}
        message="Connect to a Phoenix server to see its projects, traces, and sessions."
        title="Connect to Phoenix"
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  list: { alignSelf: 'center', flexGrow: 1, paddingBottom: 24, width: '100%' },
  titleRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 12,
    paddingHorizontal: RowInset,
    paddingTop: 12,
  },
  titleActions: { alignItems: 'center', flexDirection: 'row', gap: 4, marginLeft: 'auto' },
  iconButton: { alignItems: 'center', height: 48, justifyContent: 'center', width: 48 },
  search: {
    alignItems: 'center',
    borderRadius: 12,
    flexDirection: 'row',
    gap: 8,
    marginBottom: 4,
    marginHorizontal: 12,
    marginTop: 8,
    minHeight: 40,
    paddingHorizontal: 12,
  },
  searchInput: { flex: 1, paddingVertical: 8 },
});
