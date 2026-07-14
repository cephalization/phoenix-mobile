import { useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { ActivityIndicator, Alert, FlatList, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Animated, { FadeIn, FadeOut, ReduceMotion, ZoomIn, ZoomOut } from 'react-native-reanimated';

import { InstanceCard } from '@/components/instance-card';
import { MotionPressable } from '@/components/motion-pressable';
import { PhoenixLogo } from '@/components/phoenix-logo';
import { phoenixQueryKeys } from '@/hooks/use-phoenix-data';
import { haptics } from '@/lib/haptics';
import { AppFonts, MaxContentWidth, Spacing, useAppColors } from '@/constants/theme';
import { useInstanceStore } from '@/store/instances';
import type { PhoenixInstance } from '@/types/instance';

export default function InstancesScreen() {
  const colors = useAppColors();
  const queryClient = useQueryClient();
  const instances = useInstanceStore((state) => state.instances);
  const hasHydrated = useInstanceStore((state) => state.hasHydrated);
  const removeInstance = useInstanceStore((state) => state.removeInstance);

  const requestRemove = (instance: PhoenixInstance) => {
    Alert.alert('Remove connection?', `${instance.name} will be removed from this device.`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Remove',
        style: 'destructive',
        onPress: () => {
          queryClient.removeQueries({ queryKey: phoenixQueryKeys.instance(instance.id) });
          removeInstance(instance.id);
          haptics.success();
        },
      },
    ]);
  };

  return (
    <SafeAreaView style={[styles.safeArea, { backgroundColor: colors.background }]}>
      <View style={styles.page}>
        <View style={styles.header}>
          <View style={styles.titleRow}>
            <Text style={[styles.title, { color: colors.text }]}>Instances</Text>
            {instances.length > 0 && (
              <Animated.View
                entering={ZoomIn.duration(180).reduceMotion(ReduceMotion.System)}
                exiting={ZoomOut.duration(140).reduceMotion(ReduceMotion.System)}
                style={[styles.countBadge, { backgroundColor: colors.backgroundSelected }]}>
                <Text style={[styles.countText, { color: colors.textSecondary }]}>{instances.length}</Text>
              </Animated.View>
            )}
          </View>
          <PhoenixLogo size={36} />
        </View>

        <View style={styles.listArea}>
          <FlatList
            data={hasHydrated ? instances : []}
            keyExtractor={(instance) => instance.id}
            contentContainerStyle={[styles.list, instances.length > 0 && styles.populatedList]}
            ItemSeparatorComponent={() => <View style={[styles.separator, { backgroundColor: colors.border }]} />}
            renderItem={({ index, item }) => (
              <InstanceCard index={index} instance={item} onRemove={requestRemove} />
            )}
            style={
              instances.length > 0
                ? [styles.connectionList, { backgroundColor: colors.backgroundElement, borderColor: colors.border }]
                : styles.emptyList
            }
            ListEmptyComponent={
              !hasHydrated ? (
                <ActivityIndicator color={colors.brand} style={styles.loader} />
              ) : (
                <Animated.View
                  entering={FadeIn.duration(220).reduceMotion(ReduceMotion.System)}
                  exiting={FadeOut.duration(140).reduceMotion(ReduceMotion.System)}
                  style={[styles.emptyState, { backgroundColor: colors.backgroundElement, borderColor: colors.border }]}>
                  <View style={[styles.emptyLogo, { backgroundColor: colors.accentSoft }]}>
                    <PhoenixLogo size={54} />
                  </View>
                  <View style={styles.emptyCopyGroup}>
                    <Text style={[styles.emptyTitle, { color: colors.text }]}>No instances</Text>
                    <Text style={[styles.emptyCopy, { color: colors.textSecondary }]}>
                      Tap + to add a Phoenix connection.
                    </Text>
                  </View>
                </Animated.View>
              )
            }
          />
        </View>

        <View style={styles.bottomActions}>
          <MotionPressable
            accessibilityLabel="Settings"
            accessibilityRole="button"
            onPress={() => router.push('/settings')}
            style={[styles.actionButton, { backgroundColor: colors.backgroundElement, borderColor: colors.border }]}>
            <SymbolView
              name={{ ios: 'gearshape.fill', android: 'settings', web: 'settings' }}
              size={25}
              tintColor={colors.text}
            />
          </MotionPressable>
          <MotionPressable
            accessibilityLabel="Add instance"
            accessibilityRole="button"
            onPress={() => router.push('/instances/new')}
            style={[styles.actionButton, { backgroundColor: colors.accent, borderColor: colors.accent }]}>
            <SymbolView
              name={{ ios: 'plus', android: 'add', web: 'add' }}
              size={28}
              tintColor={colors.accentForeground}
              weight="medium"
            />
          </MotionPressable>
        </View>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1 },
  page: { alignSelf: 'center', flex: 1, maxWidth: MaxContentWidth, paddingHorizontal: 20, paddingTop: 28, width: '100%' },
  header: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between', paddingBottom: 24 },
  titleRow: { alignItems: 'center', flexDirection: 'row', gap: 10 },
  title: { fontFamily: AppFonts.semibold, fontSize: 40, letterSpacing: -1.5, lineHeight: 46 },
  countBadge: { alignItems: 'center', borderRadius: 14, justifyContent: 'center', minHeight: 28, minWidth: 28 },
  countText: { fontFamily: AppFonts.medium, fontSize: 12 },
  listArea: { flex: 1 },
  list: { flexGrow: 1, gap: 10, paddingBottom: 16 },
  populatedList: { gap: 0, paddingBottom: 0 },
  connectionList: { borderRadius: 18, borderWidth: 1, flexGrow: 0, overflow: 'hidden' },
  emptyList: { flex: 1 },
  separator: { height: 1, marginLeft: 70 },
  loader: { paddingVertical: Spacing.six },
  emptyState: { alignItems: 'center', borderRadius: 22, borderWidth: 1, gap: 18, overflow: 'hidden', padding: 28 },
  emptyLogo: { alignItems: 'center', borderRadius: 22, height: 78, justifyContent: 'center', width: 78 },
  emptyCopyGroup: { gap: 7 },
  emptyTitle: { fontFamily: AppFonts.semibold, fontSize: 18, letterSpacing: -0.2, textAlign: 'center' },
  emptyCopy: { fontFamily: AppFonts.regular, fontSize: 15, lineHeight: 22, textAlign: 'center' },
  bottomActions: { flexDirection: 'row', justifyContent: 'space-between', paddingBottom: 10, paddingTop: 14 },
  actionButton: { alignItems: 'center', borderRadius: 30, borderWidth: 1, height: 58, justifyContent: 'center', width: 58 },
});
