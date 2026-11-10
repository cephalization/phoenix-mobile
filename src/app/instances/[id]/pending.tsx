import { useQueryClient } from '@tanstack/react-query';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { Alert, type AlertButton, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { barButton } from '@/components/duo/column-header';
import { ListRow, RowInset, RowSeparator } from '@/components/ui/list-row';
import { EmptyState } from '@/components/ui/empty-state';
import { SectionHeader } from '@/components/ui/section-header';
import { StatusLabel } from '@/components/ui/status-label';
import { Type, useAppColors } from '@/constants/theme';
import { useContentColumnStyle } from '@/features/duo/layout';
import {
  discard,
  type OutboxOperation,
  retry,
  retryAll,
  useOutboxStore,
  usePendingChanges,
} from '@/features/offline/outbox';
import { describeOperation, describeStatus } from '@/features/offline/outbox-describe';
import { useInstanceReachability } from '@/features/offline/reachability';
import { revertQueuedChange } from '@/hooks/use-phoenix-sessions';
import { confirmAction } from '@/lib/confirm';
import { formatRelativeTime } from '@/lib/format';
import { haptics } from '@/lib/haptics';
import { useInstanceStore } from '@/store/instances';

/**
 * Changes made while this instance was out of reach, oldest first, as they
 * will upload. Each row retries or discards one change.
 */
export default function PendingChangesScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const colors = useAppColors();
  const queryClient = useQueryClient();
  const insets = useSafeAreaInsets();
  // Pads clear of iPhone Duo's vertical bar, which runs down a sheet's trailing edge.
  const column = useContentColumnStyle(0);
  const instance = useInstanceStore((state) => state.instances.find((item) => item.id === id));
  const operations = usePendingChanges(id);
  const reachability = useInstanceReachability(id);
  const droppedCount = useOutboxStore((state) => state.droppedCount);
  const dismissDropped = useOutboxStore((state) => state.dismissDropped);
  const instanceName = instance?.name ?? 'this server';
  const offline = reachability.state === 'offline';
  const failedCount = operations.filter((operation) => operation.status === 'failed').length;

  const uploadNow = async () => {
    haptics.selection();

    if ((await retryAll(id)) === 'drained') haptics.success();
  };

  const confirmDiscard = (operation: OutboxOperation) =>
    confirmAction({
      title: 'Discard this change?',
      message: `“${describeOperation(operation)}” will never reach ${instanceName}.`,
      confirmLabel: 'Discard',
      onConfirm: () => {
        discard(operation.id);
        void revertQueuedChange(queryClient, operation);
        haptics.success();
      },
    });

  const openRow = (operation: OutboxOperation) => {
    const buttons: AlertButton[] = [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Discard', style: 'destructive', onPress: () => confirmDiscard(operation) },
    ];

    if (operation.status !== 'sending' && !offline) {
      buttons.push({
        text: operation.status === 'failed' ? 'Retry' : 'Upload now',
        onPress: () => void retry(operation.id),
      });
    }

    Alert.alert(describeOperation(operation), describeStatus(operation), buttons);
  };

  const summary = offline
    ? `${instanceName} is offline. These upload in order when it’s back.`
    : failedCount > 0
      ? `${instanceName} rejected ${failedCount === 1 ? 'one change' : `${failedCount} changes`}. Retry after fixing the cause, or discard.`
      : `Uploading to ${instanceName} in the order they were made.`;

  return (
    <ScrollView
      contentContainerStyle={[
        styles.content,
        column,
        operations.length === 0 && styles.fill,
        { paddingBottom: 24 + insets.bottom },
      ]}
      contentInsetAdjustmentBehavior="automatic"
      style={[styles.screen, { backgroundColor: colors.background }]}
    >
      <Stack.Screen
        options={{
          unstable_headerRightItems: () => [
            barButton({
              type: 'button',
              label: 'Upload now',
              icon: { type: 'sfSymbol', name: 'arrow.up.circle' },
              disabled: offline || operations.length === 0,
              onPress: () => void uploadNow(),
              visibilityPriority: 'standard',
            }),
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

      {droppedCount > 0 ? (
        <ListRow
          accessibilityHint="Dismisses this notice"
          onPress={dismissDropped}
          subtitle="They were saved by an older version or were damaged. Tap to dismiss."
          title={`${droppedCount === 1 ? 'One change' : `${droppedCount} changes`} couldn’t be restored`}
          titleTone="danger"
          variant="flat"
        />
      ) : null}

      {operations.length === 0 ? (
        <EmptyState
          message={`Changes you make while ${instanceName} is out of reach wait here, then upload on their own.`}
          symbol={{ android: 'cloud_done', ios: 'checkmark.icloud' }}
          title="Nothing waiting"
        />
      ) : (
        <>
          <Text style={[Type.subhead, styles.summary, { color: colors.textSecondary }]}>
            {summary}
          </Text>
          <SectionHeader count={operations.length} label="Waiting to upload" />
          {operations.map((operation, index) => (
            <View key={operation.id}>
              {index > 0 ? <RowSeparator /> : null}
              <ListRow
                accessibilityHint="Retry or discard this change"
                accessibilityLabel={`${describeOperation(operation)}, ${describeStatus(operation)}`}
                leading={<StatusLabel tone={operation.status === 'failed' ? 'error' : 'pending'} />}
                meta={formatRelativeTime(operation.createdAt)}
                onPress={() => openRow(operation)}
                subtitle={describeStatus(operation)}
                subtitleTone={operation.status === 'failed' ? 'danger' : 'default'}
                title={describeOperation(operation)}
                titleLines={2}
                variant="flat"
              />
            </View>
          ))}
        </>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  content: { alignSelf: 'center', width: '100%' },
  fill: { flexGrow: 1 },
  summary: { paddingBottom: 8, paddingHorizontal: RowInset, paddingTop: 12 },
});
