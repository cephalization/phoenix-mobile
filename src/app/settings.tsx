import { useQueryClient } from '@tanstack/react-query';
import Constants from 'expo-constants';
import { Alert, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { MotionPressable } from '@/components/motion-pressable';
import { PhoenixLogo } from '@/components/phoenix-logo';
import { AppFonts, MaxContentWidth, useAppColors } from '@/constants/theme';
import { phoenixQueryKeys } from '@/hooks/use-phoenix-data';
import { haptics } from '@/lib/haptics';
import { useInstanceStore } from '@/store/instances';
import { type Appearance, useSettingsStore } from '@/store/settings';

const appearanceOptions: { label: string; value: Appearance }[] = [
  { label: 'System', value: 'system' },
  { label: 'Light', value: 'light' },
  { label: 'Dark', value: 'dark' },
];

export default function SettingsScreen() {
  const colors = useAppColors();
  const queryClient = useQueryClient();
  const appearance = useSettingsStore((state) => state.appearance);
  const setAppearance = useSettingsStore((state) => state.setAppearance);
  const instances = useInstanceStore((state) => state.instances);
  const clearInstances = useInstanceStore((state) => state.clearInstances);

  const clearConnections = () => {
    Alert.alert('Remove all connections?', 'Every saved Phoenix connection will be removed from this device.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Remove all',
        style: 'destructive',
        onPress: () => {
          queryClient.removeQueries({ queryKey: phoenixQueryKeys.all });
          clearInstances();
          haptics.success();
        },
      },
    ]);
  };

  return (
    <SafeAreaView edges={['bottom']} style={[styles.screen, { backgroundColor: colors.background }]}>
      <ScrollView contentContainerStyle={styles.scrollContent}>
        <View style={styles.content}>
          <View style={styles.section}>
            <View style={styles.sectionHeading}>
              <Text style={[styles.sectionTitle, { color: colors.text }]}>Appearance</Text>
              <Text style={[styles.sectionDescription, { color: colors.textSecondary }]}>Choose how Phoenix Mobile looks.</Text>
            </View>
            <View style={[styles.segmentedControl, { backgroundColor: colors.backgroundSelected }]}>
              {appearanceOptions.map((option) => {
                const isSelected = appearance === option.value;
                return (
                  <MotionPressable
                    accessibilityRole="button"
                    haptic="selection"
                    key={option.value}
                    onPress={() => setAppearance(option.value)}
                    scaleTo={0.97}
                    style={[
                      styles.appearanceOption,
                      isSelected && { backgroundColor: colors.accent },
                    ]}>
                    <Text
                      style={[
                        styles.appearanceLabel,
                        { color: isSelected ? colors.accentForeground : colors.textSecondary },
                      ]}>
                      {option.label}
                    </Text>
                  </MotionPressable>
                );
              })}
            </View>
          </View>

          <View style={styles.section}>
            <View style={styles.sectionHeading}>
              <Text style={[styles.sectionTitle, { color: colors.text }]}>Connections</Text>
              <Text style={[styles.sectionDescription, { color: colors.textSecondary }]}>
                {instances.length === 1 ? '1 instance saved on this device.' : `${instances.length} instances saved on this device.`}
              </Text>
            </View>
            <MotionPressable
              accessibilityRole="button"
              disabled={instances.length === 0}
              haptic="warning"
              onPress={clearConnections}
              style={[
                styles.clearButton,
                { borderColor: colors.border, opacity: instances.length === 0 ? 0.45 : 1 },
              ]}>
              <Text style={[styles.clearButtonText, { color: colors.danger }]}>Remove all connections</Text>
            </MotionPressable>
          </View>

          <View style={[styles.about, { borderColor: colors.border }]}>
            <PhoenixLogo size={40} />
            <View style={styles.aboutCopy}>
              <Text style={[styles.aboutTitle, { color: colors.text }]}>Phoenix Mobile</Text>
              <Text style={[styles.aboutVersion, { color: colors.textSecondary }]}>Version {Constants.expoConfig?.version ?? '1.0.0'}</Text>
            </View>
          </View>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  scrollContent: { flexGrow: 1 },
  content: { alignSelf: 'center', gap: 30, maxWidth: MaxContentWidth, padding: 20, width: '100%' },
  section: { gap: 14 },
  sectionHeading: { gap: 5 },
  sectionTitle: { fontFamily: AppFonts.semibold, fontSize: 18 },
  sectionDescription: { fontFamily: AppFonts.regular, fontSize: 14, lineHeight: 20 },
  segmentedControl: { borderRadius: 16, flexDirection: 'row', gap: 4, padding: 4 },
  appearanceOption: { alignItems: 'center', borderRadius: 12, flex: 1, justifyContent: 'center', minHeight: 44 },
  appearanceLabel: { fontFamily: AppFonts.medium, fontSize: 14 },
  clearButton: { alignItems: 'center', borderRadius: 14, borderWidth: 1, justifyContent: 'center', minHeight: 48 },
  clearButtonText: { fontFamily: AppFonts.medium, fontSize: 14 },
  about: { alignItems: 'center', borderTopWidth: 1, flexDirection: 'row', gap: 12, paddingTop: 20 },
  aboutCopy: { gap: 2 },
  aboutTitle: { fontFamily: AppFonts.semibold, fontSize: 15 },
  aboutVersion: { fontFamily: AppFonts.regular, fontSize: 13 },
});
