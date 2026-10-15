import { useQueryClient } from '@tanstack/react-query';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
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
import { runOAuthLogin } from '@/features/auth/login';
import { PhoenixAuthError } from '@/features/auth/oauth';
import {
  phoenixQueryKeys,
  type PhoenixProject,
  usePhoenixProjects,
  usePhoenixViewer,
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
  const viewer = usePhoenixViewer(instance);
  const projects = usePhoenixProjects(instance);
  const [isSigningIn, setIsSigningIn] = useState(false);
  const [signInError, setSignInError] = useState<string | null>(null);
  const isRefreshing = version.isRefetching || viewer.isRefetching || projects.isRefetching;

  useEffect(() => {
    if (instance) setActiveInstanceId(instance.id);
  }, [instance, setActiveInstanceId]);

  const refresh = async () => {
    if (!instance || isRefreshing) return;
    haptics.selection();
    const results = await Promise.all([version.refetch(), viewer.refetch(), projects.refetch()]);

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

  const signIn = async () => {
    if (!instance || instance.auth.type !== 'oauth2' || isSigningIn) return;
    setIsSigningIn(true);
    setSignInError(null);

    try {
      await runOAuthLogin(instance);
      await queryClient.invalidateQueries({ queryKey: phoenixQueryKeys.instance(instance.id) });
      haptics.success();
    } catch (error) {
      haptics.error();
      setSignInError(error instanceof Error ? error.message : 'Phoenix sign-in failed.');
    } finally {
      setIsSigningIn(false);
    }
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

  const loginRequired =
    viewer.error instanceof PhoenixAuthError && viewer.error.code === 'login_required';

  const authStatus = viewer.isPending
    ? { label: 'Checking authentication', color: colors.textSecondary }
    : loginRequired
      ? { label: 'Sign-in required', color: colors.danger }
      : viewer.isError
        ? { label: 'Network check failed', color: colors.danger }
        : viewer.data.auth_method === 'ANONYMOUS'
          ? { label: 'Connected anonymously', color: colors.success }
          : { label: 'Authenticated', color: colors.success };

  const pxiHeaderButton = <PxiHeaderButton instance={instance} />;

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
      style={[styles.screen, { backgroundColor: colors.background }]}
    >
      <Stack.Screen
        options={{
          headerBackTitle: 'Instances',
          headerRight: () => pxiHeaderButton,
          scrollEdgeEffects: { bottom: 'soft' },
          title: instance.name,
          unstable_headerRightItems: () => [{ element: pxiHeaderButton, type: 'custom' }],
        }}
      />
      <View style={[styles.content, { paddingBottom: 20 + insets.bottom }]}>
        <View style={styles.hero}>
          <View style={styles.authStatusLine}>
            <View style={[styles.statusRow, { backgroundColor: colors.backgroundSelected }]}>
              <View style={[styles.statusDot, { backgroundColor: authStatus.color }]} />
              <Text style={[styles.status, { color: colors.textSecondary }]}>
                {authStatus.label}
              </Text>
            </View>
            {loginRequired && instance.auth.type === 'oauth2' && (
              <MotionPressable
                accessibilityRole="button"
                disabled={isSigningIn}
                onPress={signIn}
                style={[styles.signInButton, { backgroundColor: colors.accent }]}
              >
                <Text style={[styles.signInText, { color: colors.accentForeground }]}>
                  {isSigningIn ? 'Signing in…' : 'Sign in again'}
                </Text>
              </MotionPressable>
            )}
          </View>
          {signInError && (
            <Text style={[styles.authError, { color: colors.danger }]}>{signInError}</Text>
          )}
          <View style={styles.instanceTitleRow}>
            <PhoenixLogo loading={version.isPending || projects.isPending} size={36} />
            <Text style={[styles.title, { color: colors.text }]}>{instance.name}</Text>
          </View>
          <Text selectable style={[styles.host, { color: colors.textSecondary }]}>
            {instance.baseUrl}
          </Text>
          {viewer.data && viewer.data.auth_method !== 'ANONYMOUS' && (
            <Text style={[styles.identity, { color: colors.textSecondary }]}>
              Signed in as {viewer.data.username || viewer.data.email} · {viewer.data.role}
            </Text>
          )}
        </View>

        <View
          style={[
            styles.metrics,
            { backgroundColor: colors.backgroundElement, borderColor: colors.border },
          ]}
        >
          <View style={styles.metric}>
            <Text numberOfLines={1} style={[styles.metricLabel, { color: colors.textSecondary }]}>
              Server version
            </Text>
            <Text style={[styles.metricValue, { color: colors.text }]}>{version.data ?? '—'}</Text>
          </View>
          <View style={[styles.metricDivider, { backgroundColor: colors.border }]} />
          <View style={styles.metric}>
            <Text numberOfLines={1} style={[styles.metricLabel, { color: colors.textSecondary }]}>
              Projects
            </Text>
            <Text style={[styles.metricValue, { color: colors.text }]}>
              {projects.data?.length ?? '—'}
            </Text>
          </View>
        </View>

        <View style={styles.section}>
          <View style={styles.sectionHeading}>
            <Text style={[styles.sectionTitle, { color: colors.text }]}>Projects</Text>
            <MotionPressable
              accessibilityRole="button"
              disabled={isRefreshing}
              onPress={refresh}
              style={[styles.refreshButton, { backgroundColor: colors.backgroundSelected }]}
            >
              <Text style={[styles.link, { color: colors.accent }]}>
                {isRefreshing ? 'Refreshing' : 'Refresh'}
              </Text>
            </MotionPressable>
          </View>

          {projects.isPending ? (
            <ActivityIndicator color={colors.accent} style={styles.loader} />
          ) : projects.isError ? (
            <Animated.View
              entering={FadeIn.duration(180).reduceMotion(ReduceMotion.System)}
              exiting={FadeOut.duration(120).reduceMotion(ReduceMotion.System)}
              style={[
                styles.message,
                { backgroundColor: colors.backgroundSelected, borderColor: colors.border },
              ]}
            >
              <Text style={[styles.messageTitle, { color: colors.text }]}>
                Couldn’t load projects
              </Text>
              <Text style={[styles.messageCopy, { color: colors.textSecondary }]}>
                {projects.error.message}
              </Text>
            </Animated.View>
          ) : projects.data.length === 0 ? (
            <Animated.View
              entering={FadeIn.duration(180).reduceMotion(ReduceMotion.System)}
              exiting={FadeOut.duration(120).reduceMotion(ReduceMotion.System)}
              style={[
                styles.message,
                { backgroundColor: colors.backgroundSelected, borderColor: colors.border },
              ]}
            >
              <Text style={[styles.messageTitle, { color: colors.text }]}>No projects yet</Text>
              <Text style={[styles.messageCopy, { color: colors.textSecondary }]}>
                Traced projects will appear here.
              </Text>
            </Animated.View>
          ) : (
            <View style={[styles.projectList, { borderColor: colors.border }]}>
              {projects.data.map((project, index) => (
                <ProjectRow
                  index={index}
                  instanceId={instance.id}
                  key={project.id}
                  project={project}
                  showDivider={index < projects.data.length - 1}
                />
              ))}
            </View>
          )}
        </View>

        <MotionPressable
          accessibilityRole="button"
          haptic="warning"
          onPress={remove}
          style={styles.removeButton}
        >
          <Text style={[styles.removeText, { color: colors.danger }]}>Remove connection</Text>
        </MotionPressable>
      </View>
    </ScrollView>
  );
}

function ProjectRow({
  index,
  instanceId,
  project,
  showDivider,
}: {
  index: number;
  instanceId: string;
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
        withTiming(1, { duration: 260, easing: Easing.out(Easing.cubic) }),
      ),
    );
  }, [entrance, index]);

  const entranceStyle = useAnimatedStyle(() => ({
    opacity: entrance.get(),
    transform: [{ translateY: (1 - entrance.get()) * 10 }],
  }));

  return (
    <Animated.View
      style={[
        styles.projectRow,
        showDivider && { borderBottomColor: colors.border, borderBottomWidth: 1 },
        entranceStyle,
      ]}
    >
      <MotionPressable
        accessibilityHint="Opens recent traces for this project"
        accessibilityRole="button"
        onPress={() =>
          router.push({
            pathname: '/instances/[id]/projects/[projectId]',
            params: { id: instanceId, projectId: project.id },
          })
        }
        scaleTo={0.99}
        style={styles.project}
      >
        <View style={[styles.projectMark, { backgroundColor: colors.accentSoft }]}>
          <Text style={[styles.projectInitial, { color: colors.accent }]}>
            {project.name.charAt(0).toUpperCase()}
          </Text>
        </View>
        <View style={styles.projectContent}>
          <Text numberOfLines={1} style={[styles.projectName, { color: colors.text }]}>
            {project.name}
          </Text>
          {project.description && (
            <Text
              numberOfLines={2}
              style={[styles.projectDescription, { color: colors.textSecondary }]}
            >
              {project.description}
            </Text>
          )}
        </View>
        <View style={styles.projectArrow}>
          <SymbolView
            name={{ ios: 'chevron.right', android: 'chevron_right', web: 'chevron_right' }}
            size={15}
            tintColor={colors.textSecondary}
            weight="semibold"
          />
        </View>
      </MotionPressable>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  center: { alignItems: 'center', flex: 1, gap: Spacing.three, justifyContent: 'center' },
  scrollContent: { flexGrow: 1 },
  content: { alignSelf: 'center', gap: 30, maxWidth: MaxContentWidth, padding: 20, width: '100%' },
  hero: { gap: 10 },
  authStatusLine: { alignItems: 'center', flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  statusRow: {
    alignItems: 'center',
    alignSelf: 'flex-start',
    borderRadius: 14,
    flexDirection: 'row',
    gap: 7,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  statusDot: { borderRadius: 4, height: 8, width: 8 },
  status: { fontFamily: AppFonts.medium, fontSize: 12 },
  signInButton: {
    borderRadius: 12,
    justifyContent: 'center',
    minHeight: 48,
    paddingHorizontal: 14,
  },
  signInText: { fontFamily: AppFonts.semibold, fontSize: 13 },
  authError: { fontFamily: AppFonts.regular, fontSize: 13, lineHeight: 19 },
  instanceTitleRow: { alignItems: 'center', flexDirection: 'row', gap: 11, paddingTop: 7 },
  title: {
    flex: 1,
    fontFamily: AppFonts.semibold,
    fontSize: 32,
    letterSpacing: -1.1,
    lineHeight: 38,
  },
  host: { fontFamily: AppFonts.regular, fontSize: 14 },
  identity: { fontFamily: AppFonts.medium, fontSize: 13, lineHeight: 19 },
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
  projectRow: { overflow: 'hidden' },
  project: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: Spacing.three,
    minHeight: 74,
    padding: 14,
  },
  projectMark: {
    alignItems: 'center',
    borderRadius: 11,
    height: 42,
    justifyContent: 'center',
    width: 42,
  },
  projectInitial: { fontFamily: AppFonts.semibold, fontSize: 15 },
  projectContent: { flex: 1, gap: Spacing.one },
  projectName: { fontFamily: AppFonts.medium, fontSize: 15 },
  projectDescription: { fontFamily: AppFonts.regular, fontSize: 13, lineHeight: 19 },
  projectArrow: { alignItems: 'center', height: 32, justifyContent: 'center', width: 20 },
  removeButton: { alignItems: 'center', minHeight: 48, padding: Spacing.three },
  removeText: { fontFamily: AppFonts.medium, fontSize: 14 },
  emptyTitle: { fontFamily: AppFonts.semibold, fontSize: 20 },
});
