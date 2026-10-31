import {
  Geist_400Regular,
  Geist_500Medium,
  Geist_600SemiBold,
  useFonts,
} from '@expo-google-fonts/geist';
import { GeistMono_400Regular, GeistMono_500Medium } from '@expo-google-fonts/geist-mono';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { DarkTheme, DefaultTheme, Stack, ThemeProvider } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useState } from 'react';
import type { NativeStackNavigationOptions } from 'expo-router/native-stack';
import { Appearance, Platform, useColorScheme } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { featureFlags } from 'react-native-screens';

import { PxiPaneShell } from '@/components/duo/pxi-shell';
import { DuoSheetPlacement } from '@/components/duo/sheet-placement';
import { SplitStack } from '@/components/duo/split-stack';
import { Colors } from '@/constants/theme';
import { useDuoLayout } from '@/features/duo/layout';
import { NativeMetricsProvider } from '@/features/duo/native-metrics';
import { enableColumnRouting } from '@/features/duo/split-routes';
import { PhoenixAuthError } from '@/features/auth/oauth';
import { usePxiPaneStore } from '@/features/pxi/pane-store';
import { useSettingsStore } from '@/store/settings';

SplashScreen.preventAutoHideAsync();

featureFlags.experiment.synchronousScreenUpdatesEnabled = true;

// A deep link straight to a sheet or the OAuth callback keeps the instance list
// underneath it, so dismissing the sheet or pressing Back lands somewhere.
export const unstable_settings = { anchor: 'index' };

export default function RootLayout() {
  const colorScheme = useColorScheme();
  const appearance = useSettingsStore((state) => state.appearance);
  const resolvedScheme = appearance === 'system' ? colorScheme : appearance;

  const [fontsLoaded, fontError] = useFonts({
    Geist_400Regular,
    Geist_500Medium,
    Geist_600SemiBold,
    GeistMono_400Regular,
    GeistMono_500Medium,
  });

  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            retry: (failureCount, error) =>
              !(error instanceof PhoenixAuthError) && failureCount < 1,
            staleTime: 30_000,
          },
        },
      }),
  );

  useEffect(() => {
    if (fontsLoaded || fontError) SplashScreen.hideAsync();
  }, [fontError, fontsLoaded]);

  // Native surfaces outside React (Alert, native sheets, Material menus) read the
  // platform scheme, so the in-app appearance override must be pushed down to it.
  useEffect(() => {
    if (Platform.OS === 'web') return;
    Appearance.setColorScheme(appearance === 'system' ? 'unspecified' : appearance);
  }, [appearance]);

  if (!fontsLoaded && !fontError) return null;

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <QueryClientProvider client={queryClient}>
        <ThemeProvider value={resolvedScheme === 'dark' ? DarkTheme : DefaultTheme}>
          <StatusBar style={resolvedScheme === 'dark' ? 'light' : 'dark'} />
          <NativeMetricsProvider>
            {({ columns, ready }) =>
              ready ? <AppNavigator columns={columns} dark={resolvedScheme === 'dark'} /> : null
            }
          </NativeMetricsProvider>
        </ThemeProvider>
      </QueryClientProvider>
    </GestureHandlerRootView>
  );
}

/**
 * iPhone Duo and iPad lay the app out in native split columns that UIKit
 * collapses and expands as the window changes; other devices keep one native
 * stack, with PXI as a JavaScript pane on wide windows. The choice is made
 * once, from the first native metrics, so screens never remount.
 */
function AppNavigator({ columns, dark }: { columns: boolean; dark: boolean }) {
  const colors = Colors[dark ? 'dark' : 'light'];
  const stackContentInset = usePxiPaneStore((state) => state.stackContentInset);
  const { isRegularWidth } = useDuoLayout();

  enableColumnRouting(columns);

  // Compact width presents form sheets as bottom sheets with detents. The
  // largest detent is the full height: iPhone Duo moves its status bar out of
  // the sheet only at the maximum native detent, so a shorter one leaves the
  // clock over the sheet's content on the closed display. A regular-width
  // window (the open iPhone Duo) gets a full-height sheet that
  // `DuoSheetPlacement` docks beside the vertical system bar.
  const formSheet = (initialDetent: number): NativeStackNavigationOptions =>
    isRegularWidth
      ? { presentation: 'formSheet', sheetCornerRadius: 28 }
      : {
          presentation: 'formSheet',
          sheetAllowedDetents: [initialDetent, 1],
          sheetCornerRadius: 28,
          sheetGrabberVisible: true,
        };

  // Beside a JavaScript PXI pane the native stack keeps the whole window, so
  // content screens pad their layout away from the pane.
  const contentScreen: NativeStackNavigationOptions = {
    contentStyle: {
      backgroundColor: colors.background,
      paddingBottom: stackContentInset.bottom,
      paddingRight: stackContentInset.right,
    },
  };

  const screenOptions: NativeStackNavigationOptions = {
    contentStyle: { backgroundColor: colors.background },
    headerShadowVisible: false,
    headerStyle: { backgroundColor: colors.background },
    headerTintColor: colors.text,
    headerTitleStyle: { fontFamily: 'Geist_600SemiBold' },
  };

  const screens: { name: string; options: NativeStackNavigationOptions }[] = [
    { name: 'index', options: { headerShown: false } },
    { name: 'oauth/callback', options: { headerShown: false } },
    { name: 'instances/new', options: { ...formSheet(0.72), title: 'Add Instance' } },
    { name: 'instances/index', options: { ...formSheet(0.58), title: 'Connections' } },
    { name: 'instances/[id]/index', options: { headerShown: false } },
    {
      name: 'instances/[id]/projects/[projectId]',
      options: { ...contentScreen, title: 'Project' },
    },
    {
      name: 'instances/[id]/projects/[projectId]/traces/[traceId]',
      options: { ...contentScreen, title: 'Trace' },
    },
    {
      name: 'instances/[id]/projects/[projectId]/sessions/index',
      options: { ...contentScreen, title: 'Sessions' },
    },
    {
      name: 'instances/[id]/projects/[projectId]/sessions/[sessionId]',
      options: { ...contentScreen, title: 'Session' },
    },
    {
      name: 'instances/[id]/projects/[projectId]/sessions/add-to-dataset',
      options: { ...formSheet(0.72), title: 'Add to dataset' },
    },
    {
      name: 'instances/[id]/projects/[projectId]/sessions/new-annotation-config',
      options: { ...formSheet(0.72), title: 'New annotation config' },
    },
    {
      name: 'instances/[id]/projects/[projectId]/sessions/settings',
      options: { ...formSheet(0.72), title: 'Review queue' },
    },
    { name: 'instances/[id]/chat', options: { headerShown: false } },
    { name: 'instances/[id]/pxi-action', options: { ...formSheet(0.72), title: 'PXI' } },
    { name: 'settings', options: { ...formSheet(0.58), title: 'Settings' } },
  ];

  if (columns) {
    return (
      <>
        <DuoSheetPlacement />
        <SplitStack screenOptions={screenOptions}>
          {screens.map((screen) => (
            <SplitStack.Screen key={screen.name} name={screen.name} options={screen.options} />
          ))}
        </SplitStack>
      </>
    );
  }

  return (
    <>
      <DuoSheetPlacement />
      <PxiPaneShell>
        <Stack screenOptions={screenOptions}>
          {screens.map((screen) => (
            <Stack.Screen key={screen.name} name={screen.name} options={screen.options} />
          ))}
        </Stack>
      </PxiPaneShell>
    </>
  );
}
