import { useQueryClient } from '@tanstack/react-query';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useEffect } from 'react';
import { ActivityIndicator, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated, {
  Easing,
  FadeIn,
  FadeOut,
  ReduceMotion,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withDelay,
  withTiming,
} from 'react-native-reanimated';

import { MotionPressable } from '@/components/motion-pressable';
import { PhoenixLogo } from '@/components/phoenix-logo';
import { PxiHeaderButton } from '@/components/pxi-header-button';
import { AppFonts, MaxContentWidth, Spacing, useAppColors } from '@/constants/theme';
import {
  phoenixQueryKeys,
  type PhoenixProject,
  usePhoenixProjects,
  usePhoenixVersion,
} from '@/hooks/use-phoenix-data';
import { haptics } from '@/lib/haptics';
import { confirmAction } from '@/lib/confirm';
import { useInstanceStore } from '@/store/instances';

export default function InstanceScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const colors = useAppColors();
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();
  const instance = useInstanceStore((state) => state.instances.find((item) => item.id === id));
  const removeInstance = useInstanceStore((state) => state.removeInstance);
  const setActiveInstanceId = useInstanceStore((state) => state.setActiveInstanceId);
  const version = usePhoenixVersion(instance);
  const projects = usePhoenixProjects(instance);
  const isRefreshing = version.isRefetching || projects.isRefetching;

  useEffect(() => {
    if (instance) setActiveInstanceId(instance.id);
  }, [instance, setActiveInstanceId]);

  const refresh = async () => {
    if (!instance || isRefreshing) return;
    haptics.selection();
    const results = await Promise.all([version.refetch(), projects.refetch()]);
    if (results.some((result) => result.isError)) haptics.error();
    else haptics.light();
  };

  const remove = () => {
    if (!instance) return;
    confirmAction({
      title: 'Remove connection?',
      message: `${instance.name} and its local PXI history will be removed from this device.`,
      confirmLabel: 'Remove',
      onConfirm: async () => {
        try {
          await removeInstance(instance.id);
          queryClient.removeQueries({ queryKey: phoenixQueryKeys.instance(instance.id) });
          haptics.success();
          router.dismissTo('/');
        } catch {
          haptics.error();
        }
      },
    });
  };

  if (!instance) {
    return (
      <SafeAreaView style={[styles.center, { backgroundColor: colors.background }]}>
        <Text style={[styles.emptyTitle, { color: colors.text }]}>Instance not found</Text>
        <MotionPressable onPress={() => router.dismissTo('/')}>
          <Text style={[styles.link, { color: colors.accent }]}>Return to instances</Text>
        </MotionPressable>
      </SafeAreaView>
    );
  }

  return (
    <ScrollView
      contentContainerStyle={styles.scrollContent}
      contentInsetAdjustmentBehavior="automatic"
      refreshControl={
        <RefreshControl
          colors={[colors.brand]}
          onRefresh={refresh}
          progressBackgroundColor={colors.backgroundElement}
          refreshing={isRefreshing}
          tintColor={colors.brand}
        />
      }
      style={[styles.screen, { backgroundColor: colors.background }]}>
      <Stack.Screen
        options={{
          headerBackTitle: 'Instances',
          headerRight: () => <PxiHeaderButton instance={instance} />,
          scrollEdgeEffects: { bottom: 'soft' },
          title: instance.name,
          unstable_headerRightItems: () => [
            {
              element: <PxiHeaderButton instance={instance} />,
              type: 'custom',
            },
          ],
        }}
      />
      <View style={[styles.content, { paddingBottom: 20 + insets.bottom }]}>
          <View style={styles.hero}>
            <View style={[styles.statusRow, { backgroundColor: colors.backgroundSelected }]}>
              <View style={[styles.statusDot, { backgroundColor: projects.isError ? colors.danger : colors.success }]} />
              <Text style={[styles.status, { color: colors.textSecondary }]}>
                {projects.isError ? 'Connection issue' : 'Connected without authentication'}
              </Text>
            </View>
            <View style={styles.instanceTitleRow}>
              <PhoenixLogo loading={version.isPending || projects.isPending} size={36} />
              <Text style={[styles.title, { color: colors.text }]}>{instance.name}</Text>
            </View>
            <Text selectable style={[styles.host, { color: colors.textSecondary }]}>
              {instance.baseUrl}
            </Text>
          </View>

          <View style={[styles.metrics, { backgroundColor: colors.backgroundElement, borderColor: colors.border }]}>
            <View style={styles.metric}>
              <Text numberOfLines={1} style={[styles.metricLabel, { color: colors.textSecondary }]}>Server version</Text>
              <Text style={[styles.metricValue, { color: colors.text }]}>{version.data ?? '—'}</Text>
            </View>
            <View style={[styles.metricDivider, { backgroundColor: colors.border }]} />
            <View style={styles.metric}>
              <Text numberOfLines={1} style={[styles.metricLabel, { color: colors.textSecondary }]}>Projects</Text>
              <Text style={[styles.metricValue, { color: colors.text }]}>{projects.data?.length ?? '—'}</Text>
            </View>
          </View>

          <View style={styles.section}>
            <View style={styles.sectionHeading}>
              <Text style={[styles.sectionTitle, { color: colors.text }]}>Projects</Text>
              <MotionPressable
                accessibilityRole="button"
                disabled={isRefreshing}
                onPress={refresh}
                style={[styles.refreshButton, { backgroundColor: colors.backgroundSelected }]}>
                <Text style={[styles.link, { color: colors.accent }]}>{isRefreshing ? 'Refreshing' : 'Refresh'}</Text>
              </MotionPressable>
            </View>

            {projects.isPending ? (
              <ActivityIndicator color={colors.accent} style={styles.loader} />
            ) : projects.isError ? (
              <Animated.View
                entering={FadeIn.duration(180).reduceMotion(ReduceMotion.System)}
                exiting={FadeOut.duration(120).reduceMotion(ReduceMotion.System)}
                style={[styles.message, { backgroundColor: colors.backgroundSelected, borderColor: colors.border }]}>
                <Text style={[styles.messageTitle, { color: colors.text }]}>Couldn’t load projects</Text>
                <Text style={[styles.messageCopy, { color: colors.textSecondary }]}>{projects.error.message}</Text>
              </Animated.View>
            ) : projects.data.length === 0 ? (
              <Animated.View
                entering={FadeIn.duration(180).reduceMotion(ReduceMotion.System)}
                exiting={FadeOut.duration(120).reduceMotion(ReduceMotion.System)}
                style={[styles.message, { backgroundColor: colors.backgroundSelected, borderColor: colors.border }]}>
                <Text style={[styles.messageTitle, { color: colors.text }]}>No projects yet</Text>
                <Text style={[styles.messageCopy, { color: colors.textSecondary }]}>Traced projects will appear here.</Text>
              </Animated.View>
            ) : (
              <View style={[styles.projectList, { borderColor: colors.border }]}>
                {projects.data.map((project, index) => (
                  <ProjectRow
                    index={index}
                    key={project.id}
                    project={project}
                    showDivider={index < projects.data.length - 1}
                  />
                ))}
              </View>
            )}
          </View>

          <MotionPressable accessibilityRole="button" haptic="warning" onPress={remove} style={styles.removeButton}>
            <Text style={[styles.removeText, { color: colors.danger }]}>Remove connection</Text>
          </MotionPressable>
      </View>
    </ScrollView>
  );
}

function ProjectRow({
  index,
  project,
  showDivider,
}: {
  index: number;
  project: PhoenixProject;
  showDivider: boolean;
}) {
  const colors = useAppColors();
  const reduceMotion = useReducedMotion();
  const entrance = useSharedValue(reduceMotion ? 1 : 0);

  useEffect(() => {
    entrance.set(
      withDelay(
        Math.min(index, 6) * 45,
        withTiming(1, { duration: 260, easing: Easing.out(Easing.cubic) })
      )
    );
  }, [entrance, index]);

  const entranceStyle = useAnimatedStyle(() => ({
    opacity: entrance.get(),
    transform: [{ translateY: (1 - entrance.get()) * 10 }],
  }));

  return (
    <Animated.View
      style={[
        styles.project,
        showDivider && { borderBottomColor: colors.border, borderBottomWidth: 1 },
        entranceStyle,
      ]}>
      <View style={[styles.projectMark, { backgroundColor: colors.accentSoft }]}>
        <Text style={[styles.projectInitial, { color: colors.accent }]}>{project.name.charAt(0).toUpperCase()}</Text>
      </View>
      <View style={styles.projectContent}>
        <Text style={[styles.projectName, { color: colors.text }]}>{project.name}</Text>
        {project.description && (
          <Text numberOfLines={2} style={[styles.projectDescription, { color: colors.textSecondary }]}>
            {project.description}
          </Text>
        )}
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  center: { alignItems: 'center', flex: 1, gap: Spacing.three, justifyContent: 'center' },
  scrollContent: { flexGrow: 1 },
  content: { alignSelf: 'center', gap: 30, maxWidth: MaxContentWidth, padding: 20, width: '100%' },
  hero: { gap: 10 },
  statusRow: { alignItems: 'center', alignSelf: 'flex-start', borderRadius: 14, flexDirection: 'row', gap: 7, paddingHorizontal: 10, paddingVertical: 6 },
  statusDot: { borderRadius: 4, height: 8, width: 8 },
  status: { fontFamily: AppFonts.medium, fontSize: 12 },
  instanceTitleRow: { alignItems: 'center', flexDirection: 'row', gap: 11, paddingTop: 7 },
  title: { flex: 1, fontFamily: AppFonts.semibold, fontSize: 32, letterSpacing: -1.1, lineHeight: 38 },
  host: { fontFamily: AppFonts.regular, fontSize: 14 },
  metrics: { borderRadius: 18, borderWidth: 1, flexDirection: 'row', paddingVertical: 18 },
  metric: { flex: 1, gap: 7, paddingHorizontal: 18 },
  metricDivider: { width: 1 },
  metricLabel: { fontFamily: AppFonts.regular, fontSize: 13 },
  metricValue: { fontFamily: AppFonts.semibold, fontSize: 25, letterSpacing: -0.6 },
  section: { gap: Spacing.three },
  sectionHeading: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between' },
  sectionTitle: { fontFamily: AppFonts.semibold, fontSize: 20, letterSpacing: -0.3 },
  refreshButton: { borderRadius: 12, paddingHorizontal: 11, paddingVertical: 7 },
  link: { fontFamily: AppFonts.medium, fontSize: 13 },
  loader: { paddingVertical: Spacing.five },
  message: { borderRadius: 17, borderWidth: 1, gap: Spacing.two, padding: 18 },
  messageTitle: { fontFamily: AppFonts.semibold, fontSize: 16 },
  messageCopy: { fontFamily: AppFonts.regular, fontSize: 14, lineHeight: 21 },
  projectList: { borderRadius: 18, borderWidth: 1, overflow: 'hidden' },
  project: { alignItems: 'center', flexDirection: 'row', gap: Spacing.three, minHeight: 74, padding: 14 },
  projectMark: { alignItems: 'center', borderRadius: 11, height: 42, justifyContent: 'center', width: 42 },
  projectInitial: { fontFamily: AppFonts.semibold, fontSize: 15 },
  projectContent: { flex: 1, gap: Spacing.one },
  projectName: { fontFamily: AppFonts.medium, fontSize: 15 },
  projectDescription: { fontFamily: AppFonts.regular, fontSize: 13, lineHeight: 19 },
  removeButton: { alignItems: 'center', minHeight: 48, padding: Spacing.three },
  removeText: { fontFamily: AppFonts.medium, fontSize: 14 },
  emptyTitle: { fontFamily: AppFonts.semibold, fontSize: 20 },
});
