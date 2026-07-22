import {
  Geist_400Regular,
  Geist_500Medium,
  Geist_600SemiBold,
  useFonts,
} from '@expo-google-fonts/geist';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { DarkTheme, DefaultTheme, Stack, ThemeProvider } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useState } from 'react';
import { Appearance, Platform, useColorScheme } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { featureFlags } from 'react-native-screens';

import { Colors } from '@/constants/theme';
import { useSettingsStore } from '@/store/settings';

SplashScreen.preventAutoHideAsync();
featureFlags.experiment.synchronousScreenUpdatesEnabled = true;

export default function RootLayout() {
  const colorScheme = useColorScheme();
  const appearance = useSettingsStore((state) => state.appearance);
  const resolvedScheme = appearance === 'system' ? colorScheme : appearance;
  const colors = Colors[resolvedScheme === 'dark' ? 'dark' : 'light'];
  const [fontsLoaded, fontError] = useFonts({
    Geist_400Regular,
    Geist_500Medium,
    Geist_600SemiBold,
  });
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            retry: 1,
            staleTime: 30_000,
          },
        },
      })
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
          <Stack
            screenOptions={{
              contentStyle: { backgroundColor: colors.background },
              headerShadowVisible: false,
              headerStyle: { backgroundColor: colors.background },
              headerTintColor: colors.text,
              headerTitleStyle: { fontFamily: 'Geist_600SemiBold' },
            }}>
            <Stack.Screen name="index" options={{ headerShown: false }} />
            <Stack.Screen
              name="instances/new"
              options={{
                presentation: 'formSheet',
                sheetAllowedDetents: [0.72, 0.95],
                sheetCornerRadius: 28,
                sheetGrabberVisible: true,
                title: 'Add Instance',
              }}
            />
            <Stack.Screen name="instances/[id]/index" options={{ title: 'Instance' }} />
            <Stack.Screen name="instances/[id]/projects/[projectId]" options={{ title: 'Project' }} />
            <Stack.Screen name="instances/[id]/projects/[projectId]/traces/[traceId]" options={{ title: 'Trace' }} />
            <Stack.Screen name="instances/[id]/chat" options={{ headerShown: false }} />
            <Stack.Screen
              name="settings"
              options={{
                presentation: 'formSheet',
                sheetAllowedDetents: [0.58, 0.88],
                sheetCornerRadius: 28,
                sheetGrabberVisible: true,
                title: 'Settings',
              }}
            />
          </Stack>
        </ThemeProvider>
      </QueryClientProvider>
    </GestureHandlerRootView>
  );
}
