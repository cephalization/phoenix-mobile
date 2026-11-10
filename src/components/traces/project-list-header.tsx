import { useLocalSearchParams, useNavigation } from 'expo-router';
import type { NavigationProp, ParamListBase } from 'expo-router/react-navigation';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { RowInset } from '@/components/ui/list-row';
import { SegmentedControl } from '@/components/ui/segmented-control';
import { AppFonts, Type, useAppColors } from '@/constants/theme';
import { useDuoLayout } from '@/features/duo/layout';
import { useMetricsSupported } from '@/hooks/use-phoenix-metrics';
import { haptics } from '@/lib/haptics';
import { useInstanceStore } from '@/store/instances';

export type ProjectView = 'overview' | 'traces' | 'sessions';

const Views = [
  { label: 'Overview', value: 'overview' },
  { label: 'Traces', value: 'traces' },
  { label: 'Sessions', value: 'sessions' },
] as const satisfies readonly { label: string; value: ProjectView }[];

const ListViews = Views.filter((view) => view.value !== 'overview');

/**
 * Overview, Traces, and Sessions are one place: the control changes the
 * project route's `view` parameter in place, so nothing is pushed and Back
 * leaves the project. A server without project metrics has no Overview.
 * Choosing a view drops a time window or filter another view handed over.
 * Beside a vertical system bar the navigation bar has no title, so the
 * project's name leads the list.
 */
export function ProjectViewPicker({
  title,
  value,
}: {
  title: string | undefined;
  value: ProjectView;
}) {
  const colors = useAppColors();
  const navigation = useNavigation<NavigationProp<ParamListBase>>();
  const { systemBarEdge } = useDuoLayout();
  const { id } = useLocalSearchParams<{ id: string }>();
  const instance = useInstanceStore((state) => state.instances.find((entry) => entry.id === id));
  const overview = useMetricsSupported(instance) !== false;

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
        // This screen's own navigation, so the change targets the project
        // route even while a selected trace or session is focused beside it.
        onChange={(next) =>
          navigation.setParams({
            filter: undefined,
            from: undefined,
            show: undefined,
            to: undefined,
            view: next,
          })
        }
        options={overview ? Views : ListViews}
        value={value}
      />
    </View>
  );
}

export type InlineChoiceOption<T extends string> = { label: string; value: T };

/**
 * One labelled line of text choices. Android has no native bar
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
