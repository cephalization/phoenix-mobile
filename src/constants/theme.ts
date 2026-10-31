/**
 * Below are the colors that are used in the app. The colors are defined in the light and dark mode.
 * There are many other ways to style your app. For example, [Nativewind](https://www.nativewind.dev/), [Tamagui](https://tamagui.dev/), [unistyles](https://reactnativeunistyles.vercel.app), etc.
 */

import '@/global.css';

import { createContext, use } from 'react';
import { Platform, type TextStyle, useColorScheme } from 'react-native';

import { useSettingsStore } from '@/store/settings';

export const Colors = {
  light: {
    text: '#000000',
    background: '#FDFDFD',
    backgroundElement: '#FFFFFF',
    backgroundSelected: '#F8F8F8',
    textSecondary: '#686868',
    border: '#E6E6E6',
    // Hairline between flat rows; lighter than `border`, which outlines controls.
    separator: '#ECECEC',
    textTertiary: '#8C8C8C',
    // The sidebar column sits on a faint tint so the detail column reads as the page.
    sidebar: '#F5F5F5',
    // A selected sidebar row is a raised fill, never a colour.
    rowSelected: '#E8E8E8',
    // A user's chat message; visible on both the page and the sidebar tint.
    bubble: '#EFEFEF',
    accent: '#000000',
    accentForeground: '#FFFFFF',
    accentSoft: '#E0F2FF',
    brand: '#00ADEE',
    brandSecondary: '#18BAB6',
    // Darkened brand variants that meet contrast requirements for text on light canvases.
    brandText: '#007CAD',
    brandSecondaryText: '#0E7C79',
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
    separator: '#232323',
    textTertiary: '#7C7C7C',
    sidebar: '#161616',
    rowSelected: '#282828',
    bubble: '#242424',
    accent: '#FFFFFF',
    accentForeground: '#000000',
    accentSoft: '#123C3A',
    brand: '#00ADEE',
    brandSecondary: '#18BAB6',
    brandText: '#00ADEE',
    brandSecondaryText: '#18BAB6',
    success: '#0FB5AE',
    danger: '#F9634C',
    ripple: 'rgba(255, 255, 255, 0.10)',
  },
} as const;

export type ThemeColor = keyof typeof Colors.light & keyof typeof Colors.dark;

/**
 * The surface a screen is drawn on. Inside an expanded split's sidebar column
 * `background` resolves to the sidebar tint, so every screen there takes the
 * column's surface without knowing which column it is in.
 */
export type Surface = 'page' | 'sidebar';

export const SurfaceContext = createContext<Surface>('page');

const SidebarColors = {
  light: { ...Colors.light, background: Colors.light.sidebar },
  dark: { ...Colors.dark, background: Colors.dark.sidebar },
};

export function useAppColors() {
  const systemScheme = useColorScheme();
  const appearance = useSettingsStore((state) => state.appearance);
  const surface = use(SurfaceContext);
  const scheme = appearance === 'system' ? systemScheme : appearance;
  const palette = surface === 'sidebar' ? SidebarColors : Colors;

  return palette[scheme === 'dark' ? 'dark' : 'light'];
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
    /** Geist Mono, loaded through expo-font alongside Geist; matches Phoenix's code font. */
    mono: 'GeistMono_400Regular',
    monoMedium: 'GeistMono_500Medium',
  },
  default: {
    sans: 'normal',
    serif: 'serif',
    rounded: 'normal',
    mono: 'GeistMono_400Regular',
    monoMedium: 'GeistMono_500Medium',
  },
  web: {
    sans: 'var(--font-display)',
    serif: 'var(--font-serif)',
    rounded: 'var(--font-rounded)',
    mono: 'GeistMono_400Regular',
    monoMedium: 'GeistMono_500Medium',
  },
});

const monoFamily = Fonts.mono;
const monoMediumFamily = Fonts.monoMedium;

/**
 * The type scale. Columns use inline titles; `largeTitle` is for a page that
 * stands alone. Every number a user compares (latency, tokens, counts, times,
 * IDs) uses the monospaced styles so columns of values line up.
 */
export const Type = {
  largeTitle: { fontFamily: AppFonts.semibold, fontSize: 30, letterSpacing: -0.9, lineHeight: 36 },
  title: { fontFamily: AppFonts.semibold, fontSize: 22, letterSpacing: -0.4, lineHeight: 28 },
  headline: { fontFamily: AppFonts.medium, fontSize: 16, letterSpacing: -0.1, lineHeight: 21 },
  body: { fontFamily: AppFonts.regular, fontSize: 15, lineHeight: 21 },
  subhead: { fontFamily: AppFonts.regular, fontSize: 13, lineHeight: 18 },
  label: { fontFamily: AppFonts.medium, fontSize: 12, lineHeight: 16 },
  mono: { fontFamily: monoFamily, fontSize: 12, fontVariant: ['tabular-nums'], lineHeight: 16 },
  monoValue: {
    fontFamily: monoMediumFamily,
    fontSize: 15,
    fontVariant: ['tabular-nums'],
    lineHeight: 20,
  },
} satisfies Record<string, TextStyle>;

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
