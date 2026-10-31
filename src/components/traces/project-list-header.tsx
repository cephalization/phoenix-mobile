import { router } from 'expo-router';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { RowInset } from '@/components/ui/list-row';
import { SegmentedControl } from '@/components/ui/segmented-control';
import { AppFonts, Type, useAppColors } from '@/constants/theme';
import { useDuoLayout } from '@/features/duo/layout';
import { haptics } from '@/lib/haptics';

export type ProjectView = 'traces' | 'sessions';

const Views = [
  { label: 'Traces', value: 'traces' },
  { label: 'Sessions', value: 'sessions' },
] as const satisfies readonly { label: string; value: ProjectView }[];

/**
 * Traces and Sessions are one place: the control replaces the route rather
 * than pushing, so Back still leaves the project. Beside a vertical system bar
 * the navigation bar has no title, so the project's name leads the list.
 */
export function ProjectViewPicker({
  instanceId,
  projectId,
  title,
  value,
}: {
  instanceId: string;
  projectId: string;
  title: string | undefined;
  value: ProjectView;
}) {
  const colors = useAppColors();
  const { systemBarEdge } = useDuoLayout();

  return (
    <View style={styles.picker}>
      {systemBarEdge !== 'top' && title ? (
        <Text
          accessibilityRole="header"
          numberOfLines={2}
          style={[Type.title, { color: colors.text }]}
        >
          {title}
        </Text>
      ) : null}
      <SegmentedControl
        onChange={(next) =>
          router.replace({
            pathname:
              next === 'traces'
                ? '/instances/[id]/projects/[projectId]'
                : '/instances/[id]/projects/[projectId]/sessions',
            params: { id: instanceId, projectId },
          })
        }
        options={Views}
        value={value}
      />
    </View>
  );
}

export type InlineChoiceOption<T extends string> = { label: string; value: T };

/**
 * One labelled line of text choices. Android and web have no native bar
 * menus, so the options the iOS menu holds stay reachable in the list.
 */
export function InlineChoice<T extends string>({
  label,
  onChange,
  options,
  value,
}: {
  label: string;
  options: readonly InlineChoiceOption<T>[];
  value: T;
  onChange: (value: T) => void;
}) {
  const colors = useAppColors();

  return (
    <ScrollView
      contentContainerStyle={styles.choice}
      horizontal
      showsHorizontalScrollIndicator={false}
    >
      <Text style={[Type.label, styles.choiceLabel, { color: colors.textTertiary }]}>{label}</Text>
      {options.map((option) => {
        const selected = option.value === value;

        return (
          <Pressable
            accessibilityLabel={`${label}, ${option.label}`}
            accessibilityRole="button"
            accessibilityState={{ selected }}
            key={option.value}
            onPress={() => {
              if (selected) return;
              haptics.selection();
              onChange(option.value);
            }}
            style={styles.option}
          >
            <Text
              style={[
                Type.subhead,
                selected && styles.optionSelected,
                { color: selected ? colors.text : colors.textSecondary },
              ]}
            >
              {option.label}
            </Text>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  picker: { gap: 12, paddingBottom: 4, paddingHorizontal: RowInset, paddingTop: 8 },
  choice: { alignItems: 'center', paddingHorizontal: RowInset - 10 },
  choiceLabel: { minWidth: 64, paddingHorizontal: 10 },
  option: { alignItems: 'center', justifyContent: 'center', minHeight: 48, paddingHorizontal: 10 },
  optionSelected: { fontFamily: AppFonts.semibold },
});
