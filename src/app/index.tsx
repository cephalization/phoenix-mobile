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
import { InstanceTitleButton, useInstanceSwitcherItem } from '@/components/instance-switcher';
import { PhoenixLogo } from '@/components/phoenix-logo';
import { PxiHeaderButton, usePxiHeaderOptions } from '@/components/pxi-header-button';
import { EmptyState } from '@/components/ui/empty-state';
import { ListRow, RowInset } from '@/components/ui/list-row';
import { SectionHeader } from '@/components/ui/section-header';
import { Type, useAppColors } from '@/constants/theme';
import { runOAuthLogin } from '@/features/auth/login';
import { useContentColumnStyle } from '@/features/duo/layout';
import { useInstanceStatus } from '@/features/instances/status';
import {
  phoenixQueryKeys,
  type PhoenixProject,
  usePhoenixProjects,
} from '@/hooks/use-phoenix-data';
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
  const switcher = useInstanceSwitcherItem(instance);
  const pxiHeader = usePxiHeaderOptions(instance);
  const recentIds = useSettingsStore((state) => state.recentProjects[instance.id] ?? NoRecents);
  const noteProjectOpened = useSettingsStore((state) => state.noteProjectOpened);
  const [query, setQuery] = useState('');
  const [signingIn, setSigningIn] = useState(false);
  const nativeBar = Platform.OS === 'ios';

  const refresh = async () => {
    haptics.selection();
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

  const sections = projectSections(projects.data ?? [], recentIds, query);

  const emptyState = projects.isPending ? (
    <EmptyState loading title="Loading projects" />
  ) : status.loginRequired && instance.auth.type === 'oauth2' ? (
    <EmptyState
      action={{ label: signingIn ? 'Signing in…' : 'Sign in', onPress: () => void signIn() }}
      message={`${instance.name} needs you to sign in again.`}
      symbol={{ android: 'lock', ios: 'lock', web: 'lock' }}
      title="Sign-in required"
    />
  ) : projects.isError ? (
    <EmptyState
      action={{ label: 'Try again', onPress: () => void refresh() }}
      message={projects.error.message}
      symbol={{ android: 'wifi_off', ios: 'wifi.exclamationmark', web: 'wifi_off' }}
      title={`Can’t reach ${instance.name}`}
    />
  ) : query.length > 0 ? (
    <EmptyState fill={false} title="No matching projects" />
  ) : (
    <EmptyState
      message="Projects appear here once they send traces."
      symbol={{ android: 'folder', ios: 'folder', web: 'folder' }}
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
                    name={{ android: 'settings', ios: 'gearshape', web: 'settings' }}
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
          {(projects.data?.length ?? 0) > 6 ? (
            <View style={[styles.search, { backgroundColor: colors.backgroundSelected }]}>
              <SymbolView
                name={{ android: 'search', ios: 'magnifyingglass', web: 'search' }}
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
      renderItem={({ item }) => (
        <ListRow
          accessibilityHint="Opens the project's traces"
          onPress={() => open(item)}
          subtitle={item.description ?? undefined}
          title={item.name}
        />
      )}
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

/**
 * Recently opened projects first, then every project by name. A search
 * collapses both into one filtered list.
 */
function projectSections(
  projects: PhoenixProject[],
  recentIds: readonly string[],
  query: string,
): ProjectSection[] {
  if (projects.length === 0) return [];
  const byName = [...projects].sort((a, b) => a.name.localeCompare(b.name));
  const needle = query.trim().toLowerCase();

  if (needle.length > 0) {
    const matches = byName.filter((project) => project.name.toLowerCase().includes(needle));

    return matches.length === 0 ? [] : [{ title: null, data: matches }];
  }

  const recent = recentIds.flatMap((id) => projects.filter((project) => project.id === id));

  if (recent.length === 0 || projects.length <= 6) return [{ title: null, data: byName }];

  return [
    { title: 'Recent', data: recent },
    { title: 'All projects', data: byName },
  ];
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
