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
import { StyleSheet, View, useColorScheme } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { featureFlags } from 'react-native-screens';

import { Colors } from '@/constants/theme';
import { PxiFab } from '@/components/pxi-fab';
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

  if (!fontsLoaded && !fontError) return null;

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <QueryClientProvider client={queryClient}>
        <ThemeProvider value={resolvedScheme === 'dark' ? DarkTheme : DefaultTheme}>
          <StatusBar style="auto" />
          <View style={styles.root}>
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
            <PxiFab />
          </View>
        </ThemeProvider>
      </QueryClientProvider>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({ root: { flex: 1 } });
