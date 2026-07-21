/**
 * Below are the colors that are used in the app. The colors are defined in the light and dark mode.
 * There are many other ways to style your app. For example, [Nativewind](https://www.nativewind.dev/), [Tamagui](https://tamagui.dev/), [unistyles](https://reactnativeunistyles.vercel.app), etc.
 */

import '@/global.css';

import { Platform, useColorScheme } from 'react-native';

import { useSettingsStore } from '@/store/settings';

export const Colors = {
  light: {
    text: '#000000',
    background: '#FDFDFD',
    backgroundElement: '#FFFFFF',
    backgroundSelected: '#F8F8F8',
    textSecondary: '#686868',
    border: '#E6E6E6',
    accent: '#000000',
    accentForeground: '#FFFFFF',
    accentSoft: '#E0F2FF',
    brand: '#00ADEE',
    brandSecondary: '#18BAB6',
    success: '#008F5D',
    danger: '#EA3829',
    ripple: 'rgba(0, 0, 0, 0.07)',
  },
  dark: {
    text: '#FFFFFF',
    background: '#0E0E0E',
    backgroundElement: '#1D1D1D',
    backgroundSelected: '#303030',
    textSecondary: '#B0B0B0',
    border: '#303030',
    accent: '#FFFFFF',
    accentForeground: '#000000',
    accentSoft: '#123C3A',
    brand: '#00ADEE',
    brandSecondary: '#18BAB6',
    success: '#0FB5AE',
    danger: '#F9634C',
    ripple: 'rgba(255, 255, 255, 0.10)',
  },
} as const;

export type ThemeColor = keyof typeof Colors.light & keyof typeof Colors.dark;

export function useAppColors() {
  const systemScheme = useColorScheme();
  const appearance = useSettingsStore((state) => state.appearance);
  const scheme = appearance === 'system' ? systemScheme : appearance;
  return Colors[scheme === 'dark' ? 'dark' : 'light'];
}

export const AppFonts = {
  regular: 'Geist_400Regular',
  medium: 'Geist_500Medium',
  semibold: 'Geist_600SemiBold',
} as const;

export const Fonts = Platform.select({
  ios: {
    /** iOS `UIFontDescriptorSystemDesignDefault` */
    sans: 'system-ui',
    /** iOS `UIFontDescriptorSystemDesignSerif` */
    serif: 'ui-serif',
    /** iOS `UIFontDescriptorSystemDesignRounded` */
    rounded: 'ui-rounded',
    /** iOS `UIFontDescriptorSystemDesignMonospaced` */
    mono: 'ui-monospace',
  },
  default: {
    sans: 'normal',
    serif: 'serif',
    rounded: 'normal',
    mono: 'monospace',
  },
  web: {
    sans: 'var(--font-display)',
    serif: 'var(--font-serif)',
    rounded: 'var(--font-rounded)',
    mono: 'var(--font-mono)',
  },
});

export const Spacing = {
  half: 2,
  one: 4,
  two: 8,
  three: 16,
  four: 24,
  five: 32,
  six: 64,
} as const;

export const BottomTabInset = Platform.select({ ios: 50, android: 80 }) ?? 0;
export const MaxContentWidth = 800;
