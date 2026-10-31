import { useQueryClient } from '@tanstack/react-query';
import { router, Stack } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { useState } from 'react';
import { RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { barButton } from '@/components/duo/column-header';
import { ListRow, RowInset, RowSeparator } from '@/components/ui/list-row';
import { SectionHeader } from '@/components/ui/section-header';
import { StatStrip } from '@/components/ui/stat-strip';
import { StatusLabel } from '@/components/ui/status-label';
import { Type, useAppColors } from '@/constants/theme';
import { runOAuthLogin } from '@/features/auth/login';
import { useContentColumnStyle } from '@/features/duo/layout';
import { useInstanceStatus } from '@/features/instances/status';
import { phoenixQueryKeys, usePhoenixProjects, usePhoenixVersion } from '@/hooks/use-phoenix-data';
import { confirmAction } from '@/lib/confirm';
import { haptics } from '@/lib/haptics';
import { useActiveInstance, useInstanceStore } from '@/store/instances';
import type { PhoenixInstance } from '@/types/instance';

/**
 * Connections: every stored instance, which one the app shows, and the active
 * instance's server details. Replaces the instance dashboard page, so the
 * sidebar can start at the projects list.
 */
export default function ConnectionsSheet() {
  const colors = useAppColors();
  const insets = useSafeAreaInsets();
  const column = useContentColumnStyle(0);
  const queryClient = useQueryClient();
  const instances = useInstanceStore((state) => state.instances);
  const active = useActiveInstance();

  const refresh = async () => {
    haptics.selection();
    await queryClient.invalidateQueries({ queryKey: ['phoenix'] });
  };

  return (
    <ScrollView
      contentContainerStyle={[styles.content, column, { paddingBottom: 24 + insets.bottom }]}
      contentInsetAdjustmentBehavior="automatic"
      refreshControl={
        <RefreshControl onRefresh={refresh} refreshing={false} tintColor={colors.textSecondary} />
      }
      style={[styles.screen, { backgroundColor: colors.background }]}
    >
      <Stack.Screen
        options={{
          unstable_headerRightItems: () => [
            barButton({
              type: 'button',
              label: 'Done',
              icon: { type: 'sfSymbol', name: 'checkmark' },
              onPress: () => router.back(),
              variant: 'done',
              visibilityPriority: 'high',
            }),
          ],
        }}
      />
      <SectionHeader label="Instances" />
      {instances.map((instance, index) => (
        <View key={instance.id}>
          {index > 0 ? <RowSeparator inset={RowInset + 30} /> : null}
          <InstanceRow active={instance.id === active?.id} instance={instance} />
        </View>
      ))}
      <RowSeparator inset={RowInset + 30} />
      <ListRow
        leading={
          <SymbolView
            name={{ android: 'add', ios: 'plus', web: 'add' }}
            size={16}
            tintColor={colors.text}
            weight="semibold"
          />
        }
        onPress={() => router.push('/instances/new')}
        title="Add instance"
        variant="flat"
      />

      {active ? <ActiveInstanceDetails instance={active} /> : null}
    </ScrollView>
  );
}

function InstanceRow({ active, instance }: { active: boolean; instance: PhoenixInstance }) {
  const colors = useAppColors();
  const status = useInstanceStatus(instance);
  const setActiveInstanceId = useInstanceStore((state) => state.setActiveInstanceId);

  return (
    <ListRow
      accessibilityHint={active ? undefined : 'Shows this instance’s projects'}
      accessibilityLabel={`${instance.name}, ${status.label}${active ? ', current' : ''}`}
      leading={<StatusLabel tone={status.tone} />}
      onPress={() => {
        setActiveInstanceId(instance.id);
        router.back();
      }}
      subtitle={status.tone === 'error' ? status.label : instance.baseUrl}
      subtitleMono={status.tone !== 'error'}
      subtitleTone={status.tone === 'error' ? 'danger' : 'default'}
      title={instance.name}
      trailing={
        active ? (
          <SymbolView
            name={{ android: 'check', ios: 'checkmark', web: 'check' }}
            size={16}
            tintColor={colors.text}
            weight="semibold"
          />
        ) : null
      }
      variant="flat"
    />
  );
}

function ActiveInstanceDetails({ instance }: { instance: PhoenixInstance }) {
  const colors = useAppColors();
  const queryClient = useQueryClient();
  const status = useInstanceStatus(instance);
  const version = usePhoenixVersion(instance);
  const projects = usePhoenixProjects(instance);
  const removeInstance = useInstanceStore((state) => state.removeInstance);
  const [signingIn, setSigningIn] = useState(false);
  const [signInError, setSignInError] = useState<string | null>(null);
  const viewer = status.viewer.data;

  const signIn = async () => {
    if (instance.auth.type !== 'oauth2' || signingIn) return;
    setSigningIn(true);
    setSignInError(null);

    try {
      await runOAuthLogin(instance);
      await queryClient.invalidateQueries({ queryKey: phoenixQueryKeys.instance(instance.id) });
      haptics.success();
    } catch (error) {
      haptics.error();
      setSignInError(error instanceof Error ? error.message : 'Phoenix sign-in failed.');
    } finally {
      setSigningIn(false);
    }
  };

  const remove = () => {
    confirmAction({
      title: 'Remove connection?',
      message: `${instance.name} and its local PXI history will be removed from this device.`,
      confirmLabel: 'Remove',
      onConfirm: async () => {
        try {
          await removeInstance(instance.id);
          queryClient.removeQueries({ queryKey: phoenixQueryKeys.instance(instance.id) });
          haptics.success();
        } catch {
          haptics.error();
        }
      },
    });
  };

  return (
    <View>
      <SectionHeader label={instance.name} />
      <StatStrip
        stats={[
          {
            label: 'Status',
            value: status.label,
            tone: status.tone === 'error' ? 'danger' : 'default',
          },
          { label: 'Version', value: version.data ?? '—' },
          { label: 'Projects', value: projects.data ? String(projects.data.length) : '—' },
        ]}
      />
      <Text selectable style={[Type.mono, styles.detail, { color: colors.textSecondary }]}>
        {instance.baseUrl}
      </Text>
      {viewer && viewer.auth_method !== 'ANONYMOUS' ? (
        <Text style={[Type.subhead, styles.detail, { color: colors.textSecondary }]}>
          Signed in as {viewer.username || viewer.email} · {viewer.role}
        </Text>
      ) : null}
      {signInError ? (
        <Text style={[Type.subhead, styles.detail, { color: colors.danger }]}>{signInError}</Text>
      ) : null}
      <View style={styles.actions}>
        {status.loginRequired && instance.auth.type === 'oauth2' ? (
          <>
            <RowSeparator inset={0} />
            <ListRow
              onPress={() => void signIn()}
              title={signingIn ? 'Signing in…' : 'Sign in again'}
              variant="flat"
            />
          </>
        ) : null}
        <RowSeparator inset={0} />
        <ListRow
          accessibilityHint="Removes this instance and its local PXI history"
          onPress={remove}
          title="Remove connection"
          titleTone="danger"
          variant="flat"
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  content: { alignSelf: 'center', width: '100%' },
  detail: { paddingHorizontal: RowInset, paddingTop: 4 },
  actions: { marginTop: 18 },
});
