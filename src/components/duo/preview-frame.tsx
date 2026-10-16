import { Host, Slider } from '@expo/ui';
import { router } from 'expo-router';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Platform, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { SafeAreaInsetsContext } from 'react-native-safe-area-context';

import { MotionPressable } from '@/components/motion-pressable';
import { AppFonts, Fonts, useAppColors } from '@/constants/theme';
import { divisionFor, DuoViewportContext, usePreviewViewport } from '@/features/duo/layout';
import {
  type DuoDisplay,
  type DuoOrientation,
  type DuoPose,
  useDuoPreviewStore,
} from '@/features/duo/preview-store';

/**
 * Frames the whole app at iPhone Duo point sizes so the layout can be
 * exercised on an iPad or iPhone simulator before the Duo simulator (Xcode
 * 27.1) is available. The frame scales to fit, draws the fold when the pose
 * is book or tabletop, and publishes the framed size through
 * `DuoViewportContext` so `useDuoLayout` sees Duo size classes.
 */
export function DuoPreviewFrame({ children }: { children: ReactNode }) {
  const viewport = usePreviewViewport();
  const colors = useAppColors();
  const window = useWindowDimensions();
  const [controlsOpen, setControlsOpen] = useState(true);
  const launchRoute = useDuoPreviewStore((state) => state.launchRoute);
  const setLaunchRoute = useDuoPreviewStore((state) => state.setLaunchRoute);

  // A seeded launch route opens once, then clears, so scripted demos can land
  // on a screen without any taps.
  useEffect(() => {
    if (!launchRoute) return;

    const timer = setTimeout(() => {
      setLaunchRoute(null);
      router.replace(launchRoute);
    }, 400);

    return () => clearTimeout(timer);
  }, [launchRoute, setLaunchRoute]);

  // Duo bars live on the trailing edge except on the inner display in portrait.
  // The trailing-bar insets are the ones the Duo simulator reports for both
  // displays; the portrait ones approximate a horizontal status bar.
  const innerPortrait =
    viewport !== null && viewport.display === 'inner' && viewport.width < viewport.height;

  const insets = useMemo(
    () =>
      innerPortrait
        ? { top: 54, right: 0, bottom: 34, left: 0 }
        : { top: 0, right: 84, bottom: 34, left: 0 },
    [innerPortrait],
  );

  if (!viewport) return children;

  const controlsHeight = controlsOpen ? 132 : 44;
  const availableWidth = window.width - 32;
  const availableHeight = window.height - controlsHeight - 48;
  const scale = Math.min(1, availableWidth / viewport.width, availableHeight / viewport.height);
  const division = divisionFor(viewport);
  const folded = division?.isActive === true;

  return (
    <View style={[styles.stage, { backgroundColor: colors.backgroundSelected }]}>
      <View style={styles.stageBody}>
        <View
          style={[
            styles.bezel,
            {
              borderColor: colors.border,
              height: viewport.height * scale + 24,
              width: viewport.width * scale + 24,
            },
          ]}
        >
          <View
            style={[
              styles.screen,
              {
                backgroundColor: colors.background,
                height: viewport.height,
                transform: [{ scale }],
                width: viewport.width,
              },
            ]}
          >
            <DuoViewportContext.Provider value={viewport}>
              <SafeAreaInsetsContext.Provider value={insets}>
                {children}
              </SafeAreaInsetsContext.Provider>
            </DuoViewportContext.Provider>
            {folded && division ? (
              <View
                pointerEvents="none"
                style={[
                  styles.fold,
                  {
                    backgroundColor: colors.ripple,
                    height: division.frame.height,
                    left: division.frame.x,
                    top: division.frame.y,
                    width: division.frame.width,
                  },
                ]}
              >
                <View
                  style={[
                    styles.hingeLine,
                    division.axis === 'vertical'
                      ? styles.hingeLineVertical
                      : styles.hingeLineHorizontal,
                    { backgroundColor: colors.border },
                  ]}
                />
              </View>
            ) : null}
          </View>
        </View>
      </View>
      <PreviewControls open={controlsOpen} onToggle={() => setControlsOpen((value) => !value)} />
    </View>
  );
}

const DISPLAYS: { label: string; value: DuoDisplay }[] = [
  { label: 'Outer', value: 'outer' },
  { label: 'Inner', value: 'inner' },
];

const ORIENTATIONS: { label: string; value: DuoOrientation }[] = [
  { label: 'Tall', value: 'portrait' },
  { label: 'Wide', value: 'landscape' },
];

const POSES: { label: string; value: DuoPose }[] = [
  { label: 'Flat', value: 'flat' },
  { label: 'Book', value: 'book' },
  { label: 'Tabletop', value: 'tabletop' },
];

function PreviewControls({ onToggle, open }: { onToggle: () => void; open: boolean }) {
  const colors = useAppColors();
  const display = useDuoPreviewStore((state) => state.display);
  const orientation = useDuoPreviewStore((state) => state.orientation);
  const pose = useDuoPreviewStore((state) => state.pose);
  const hingeAngle = useDuoPreviewStore((state) => state.hingeAngle);
  const setDisplay = useDuoPreviewStore((state) => state.setDisplay);
  const setOrientation = useDuoPreviewStore((state) => state.setOrientation);
  const setPose = useDuoPreviewStore((state) => state.setPose);
  const setHingeAngle = useDuoPreviewStore((state) => state.setHingeAngle);
  const setEnabled = useDuoPreviewStore((state) => state.setEnabled);

  return (
    <View
      style={[
        styles.controls,
        { backgroundColor: colors.backgroundElement, borderColor: colors.border },
      ]}
    >
      <View style={styles.controlsHeader}>
        <Text style={[styles.controlsTitle, { color: colors.text }]}>iPhone Duo preview</Text>
        <Text style={[styles.controlsMeta, { color: colors.textSecondary }]}>
          {display === 'inner' ? 'Inner 7.6″' : 'Outer 5.4″'} · {pose} · {hingeAngle}°
        </Text>
        <MotionPressable
          accessibilityRole="button"
          onPress={onToggle}
          style={styles.controlsToggle}
        >
          <Text style={[styles.controlsToggleText, { color: colors.brandText }]}>
            {open ? 'Hide' : 'Show'}
          </Text>
        </MotionPressable>
        <MotionPressable
          accessibilityRole="button"
          onPress={() => setEnabled(false)}
          style={styles.controlsToggle}
        >
          <Text style={[styles.controlsToggleText, { color: colors.danger }]}>Exit</Text>
        </MotionPressable>
      </View>
      {open ? (
        <View style={styles.controlsBody}>
          <Segmented onChange={setDisplay} options={DISPLAYS} value={display} />
          <Segmented onChange={setOrientation} options={ORIENTATIONS} value={orientation} />
          {display === 'inner' ? (
            <Segmented onChange={setPose} options={POSES} value={pose} />
          ) : null}
          {display === 'inner' && Platform.OS !== 'web' ? (
            <View style={styles.sliderRow}>
              <Text style={[styles.sliderLabel, { color: colors.textSecondary }]}>Hinge</Text>
              <Host matchContents style={styles.slider}>
                <Slider
                  max={180}
                  min={0}
                  onValueChange={(value) => setHingeAngle(value)}
                  value={hingeAngle}
                />
              </Host>
            </View>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

function Segmented<Value extends string>({
  onChange,
  options,
  value,
}: {
  onChange: (value: Value) => void;
  options: { label: string; value: Value }[];
  value: Value;
}) {
  const colors = useAppColors();

  return (
    <View style={[styles.segmented, { backgroundColor: colors.backgroundSelected }]}>
      {options.map((option) => {
        const selected = option.value === value;

        return (
          <MotionPressable
            accessibilityRole="button"
            accessibilityState={{ selected }}
            haptic="selection"
            key={option.value}
            onPress={() => onChange(option.value)}
            scaleTo={0.97}
            style={[styles.segment, selected && { backgroundColor: colors.accent }]}
          >
            <Text
              style={[
                styles.segmentLabel,
                { color: selected ? colors.accentForeground : colors.textSecondary },
              ]}
            >
              {option.label}
            </Text>
          </MotionPressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  stage: { flex: 1 },
  stageBody: { alignItems: 'center', flex: 1, justifyContent: 'center' },
  bezel: {
    alignItems: 'center',
    backgroundColor: '#0E0E0E',
    borderRadius: 44,
    borderWidth: 1,
    justifyContent: 'center',
    overflow: 'hidden',
  },
  screen: { borderRadius: 34, overflow: 'hidden' },
  fold: { alignItems: 'center', justifyContent: 'center', position: 'absolute' },
  hingeLine: { opacity: 0.9 },
  hingeLineVertical: { height: '100%', width: 2 },
  hingeLineHorizontal: { height: 2, width: '100%' },
  controls: {
    borderTopWidth: 1,
    gap: 10,
    paddingBottom: 14,
    paddingHorizontal: 16,
    paddingTop: 8,
  },
  controlsHeader: { alignItems: 'center', flexDirection: 'row', gap: 12, minHeight: 36 },
  controlsTitle: { fontFamily: AppFonts.semibold, fontSize: 13 },
  controlsMeta: { flex: 1, fontFamily: Fonts.mono, fontSize: 11 },
  controlsToggle: { justifyContent: 'center', minHeight: 36, paddingHorizontal: 6 },
  controlsToggleText: { fontFamily: AppFonts.medium, fontSize: 13 },
  controlsBody: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  segmented: { borderRadius: 12, flexDirection: 'row', gap: 2, padding: 3 },
  segment: { borderRadius: 9, justifyContent: 'center', minHeight: 32, paddingHorizontal: 12 },
  segmentLabel: { fontFamily: AppFonts.medium, fontSize: 12 },
  sliderRow: { alignItems: 'center', flexDirection: 'row', gap: 8, minWidth: 200 },
  sliderLabel: { fontFamily: AppFonts.medium, fontSize: 12 },
  slider: { flex: 1, minHeight: 32 },
});
