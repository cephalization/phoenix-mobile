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
import { Appearance, Platform, useColorScheme } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { featureFlags } from 'react-native-screens';

import { DuoPreviewFrame } from '@/components/duo/preview-frame';
import { PxiPaneShell } from '@/components/duo/pxi-shell';
import { DuoSheetPlacement } from '@/components/duo/sheet-placement';
import { Colors } from '@/constants/theme';
import { useDuoLayout } from '@/features/duo/layout';
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
  const colors = Colors[resolvedScheme === 'dark' ? 'dark' : 'light'];
  const stackContentInset = usePxiPaneStore((state) => state.stackContentInset);
  const { isRegularWidth } = useDuoLayout();

  // Compact width presents form sheets as bottom sheets with detents. A
  // regular-width window (the open iPhone Duo) gets a full-height sheet that
  // `DuoSheetPlacement` docks beside the vertical system bar.
  const formSheet = (detents: number[]) =>
    isRegularWidth
      ? { presentation: 'formSheet' as const, sheetCornerRadius: 28 }
      : {
          presentation: 'formSheet' as const,
          sheetAllowedDetents: detents,
          sheetCornerRadius: 28,
          sheetGrabberVisible: true,
        };

  // The native stack keeps the whole window while PXI floats over its trailing
  // or bottom region, so content screens pad their layout away from the pane.
  const contentScreen = {
    contentStyle: {
      backgroundColor: colors.background,
      paddingBottom: stackContentInset.bottom,
      paddingRight: stackContentInset.right,
    },
  };

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
          <DuoPreviewFrame>
            <DuoSheetPlacement />
            <PxiPaneShell>
              <Stack
                screenOptions={{
                  contentStyle: { backgroundColor: colors.background },
                  headerShadowVisible: false,
                  headerStyle: { backgroundColor: colors.background },
                  headerTintColor: colors.text,
                  headerTitleStyle: { fontFamily: 'Geist_600SemiBold' },
                }}
              >
                <Stack.Screen name="index" options={{ headerShown: false }} />
                <Stack.Screen name="oauth/callback" options={{ headerShown: false }} />
                <Stack.Screen name="duo-preview" options={{ headerShown: false }} />
                <Stack.Screen
                  name="instances/new"
                  options={{
                    ...formSheet([0.72, 0.95]),
                    title: 'Add Instance',
                  }}
                />
                <Stack.Screen
                  name="instances/[id]/index"
                  options={{ ...contentScreen, title: 'Instance' }}
                />
                <Stack.Screen
                  name="instances/[id]/projects/[projectId]"
                  options={{ ...contentScreen, title: 'Project' }}
                />
                <Stack.Screen
                  name="instances/[id]/projects/[projectId]/traces/[traceId]"
                  options={{ ...contentScreen, title: 'Trace' }}
                />
                <Stack.Screen
                  name="instances/[id]/projects/[projectId]/sessions/index"
                  options={{ ...contentScreen, title: 'Sessions' }}
                />
                <Stack.Screen
                  name="instances/[id]/projects/[projectId]/sessions/[sessionId]"
                  options={{ ...contentScreen, title: 'Session' }}
                />
                <Stack.Screen
                  name="instances/[id]/projects/[projectId]/sessions/add-to-dataset"
                  options={{
                    ...formSheet([0.72, 0.95]),
                    title: 'Add to dataset',
                  }}
                />
                <Stack.Screen
                  name="instances/[id]/projects/[projectId]/sessions/new-annotation-config"
                  options={{
                    ...formSheet([0.72, 0.95]),
                    title: 'New annotation config',
                  }}
                />
                <Stack.Screen
                  name="instances/[id]/projects/[projectId]/sessions/settings"
                  options={{
                    ...formSheet([0.72, 0.95]),
                    title: 'Review queue',
                  }}
                />
                <Stack.Screen name="instances/[id]/chat" options={{ headerShown: false }} />
                <Stack.Screen
                  name="instances/[id]/pxi-action"
                  options={{
                    ...formSheet([0.72, 0.95]),
                    title: 'PXI',
                  }}
                />
                <Stack.Screen
                  name="settings"
                  options={{
                    ...formSheet([0.58, 0.88]),
                    title: 'Settings',
                  }}
                />
              </Stack>
            </PxiPaneShell>
          </DuoPreviewFrame>
        </ThemeProvider>
      </QueryClientProvider>
    </GestureHandlerRootView>
  );
}
