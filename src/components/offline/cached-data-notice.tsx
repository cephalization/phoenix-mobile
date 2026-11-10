import { router } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { RowInset } from '@/components/ui/list-row';
import { Type, useAppColors } from '@/constants/theme';
import { usePendingChangeCount } from '@/features/offline/outbox';
import { useInstanceReachability } from '@/features/offline/reachability';
import { haptics } from '@/lib/haptics';
import type { PhoenixInstance } from '@/types/instance';

import { cachedNoticeText, pendingChangesText } from './offline-state';

const ClockTickMs = 60_000;

/**
 * One quiet line at the top of a screen while its instance can't be reached:
 * the screen is showing saved data, and how old it is. Queued changes for the
 * instance add a count that opens the pending changes sheet. Hidden while the
 * instance answers, and when there is neither data nor a queued change (the
 * screen's own empty state says so then).
 */
export function CachedDataNotice({
  dataUpdatedAt,
  instance,
}: {
  instance: PhoenixInstance;
  /** The screen's primary query `dataUpdatedAt`; 0 or undefined when it holds no data. */
  dataUpdatedAt: number | undefined;
}) {
  const colors = useAppColors();
  const reachability = useInstanceReachability(instance.id);
  const pendingCount = usePendingChangeCount(instance.id);
  const now = useMinuteClock();
  const pending = pendingChangesText(pendingCount);

  if (reachability.state !== 'offline' || (!dataUpdatedAt && pending === null)) return null;

  const status = cachedNoticeText(dataUpdatedAt, now);

  const content = (
    <>
      <SymbolView
        name={{ android: 'cloud_off', ios: 'icloud.slash' }}
        size={14}
        tintColor={colors.textSecondary}
        weight="medium"
      />
      <Text numberOfLines={2} style={[Type.label, styles.text, { color: colors.textSecondary }]}>
        {status}
        {pending === null ? null : (
          <Text style={{ color: colors.text }}>
            {' · '}
            {pending}
          </Text>
        )}
      </Text>
    </>
  );

  const surface = {
    backgroundColor: colors.backgroundSelected,
    borderBottomColor: colors.separator,
  };

  // The visible text is terse for a narrow sidebar; VoiceOver gets the full sentence.
  const label =
    pending === null
      ? status
      : `${status}. ${pendingCount === 1 ? '1 change' : `${pendingCount} changes`} waiting to upload`;

  if (pending === null) {
    return (
      <View
        accessibilityLabel={label}
        accessibilityLiveRegion="polite"
        accessible
        style={[styles.notice, surface]}
      >
        {content}
      </View>
    );
  }

  return (
    <Pressable
      accessibilityHint="Opens the changes waiting to be sent"
      accessibilityLabel={label}
      accessibilityLiveRegion="polite"
      accessibilityRole="button"
      // The line stays slim; the touch target reaches 48 points.
      hitSlop={{ bottom: 4, top: 4 }}
      onPress={() => {
        haptics.selection();
        router.push({ pathname: '/instances/[id]/pending', params: { id: instance.id } });
      }}
      style={({ pressed }) => [
        styles.notice,
        surface,
        pressed ? { backgroundColor: colors.rowSelected } : null,
      ]}
    >
      {content}
    </Pressable>
  );
}

/** The current time, advanced each minute so the age stays honest. */
function useMinuteClock() {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const interval = setInterval(() => setNow(Date.now()), ClockTickMs);

    return () => clearInterval(interval);
  }, []);

  return now;
}

const styles = StyleSheet.create({
  notice: {
    alignItems: 'center',
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    gap: 8,
    minHeight: 40,
    paddingHorizontal: RowInset,
    paddingVertical: 8,
  },
  text: { flexShrink: 1 },
});
