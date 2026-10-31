import { isValidElement, use } from 'react';
import { StyleSheet } from 'react-native';
import {
  Split,
  type StackHeaderConfigProps,
  type StackHeaderInlineItemIOS,
  type StackHeaderMenuElementIOS,
  type StackHeaderMenuIOS,
} from 'react-native-screens';

import { SurfaceContext, useAppColors } from '@/constants/theme';
import { isJsonString } from '@/lib/json';

import type {
  NativeStackHeaderItem,
  NativeStackHeaderItemButton,
  NativeStackHeaderItemMenu,
  NativeStackNavigationOptions,
} from 'expo-router/native-stack';

type IOSHeader = NonNullable<StackHeaderConfigProps['ios']>;

type HeaderItem = NonNullable<IOSHeader['trailingItems']>[number];

type HeaderIcon = StackHeaderInlineItemIOS['icon'];

type ItemIcon = NativeStackHeaderItemButton['icon'];

type MenuItems = NativeStackHeaderItemMenu['menu']['items'];

/** UIKit's overflow order: low-priority items collapse into the system menu first. */
export type BarItemVisibilityPriority = 'low' | 'standard' | 'high';

/**
 * A header button that iPhone Duo can place in its vertical bar. Give every
 * item an icon and a label: the bar shows the icon, the overflow menu shows
 * both, and an item without an icon stays in a horizontal bar.
 */
export type BarButton = NativeStackHeaderItemButton & {
  visibilityPriority?: BarItemVisibilityPriority;
  /**
   * An image in the iOS asset catalog to use instead of `icon` in split
   * columns. Asset-catalog images resolve synchronously; an image source loads
   * on every header rebuild and shows the label until it arrives.
   */
  xcasset?: string;
};

export function barButton(item: BarButton): NativeStackHeaderItemButton {
  return item;
}

/** A header menu with the same overflow priority as `BarButton`. */
export type BarMenu = NativeStackHeaderItemMenu & {
  visibilityPriority?: BarItemVisibilityPriority;
};

export function barMenu(item: BarMenu): NativeStackHeaderItemMenu {
  return item;
}

function convertIcon(icon: ItemIcon): HeaderIcon {
  if (!icon) return undefined;

  if (icon.type === 'image') {
    return icon.tinted === false
      ? { type: 'imageSource', imageSource: icon.source }
      : { type: 'templateSource', templateSource: icon.source };
  }

  return icon;
}

function convertMenu(items: MenuItems, id: string, title?: string): StackHeaderMenuIOS {
  const children = items.map((item, index): StackHeaderMenuElementIOS => {
    const childId = `${id}:${index}`;

    if (item.type === 'submenu') {
      return {
        ...convertMenu(item.items, childId, item.label),
        displayInline: item.inline,
      };
    }

    return {
      id: childId,
      type: 'menuItem',
      itemType: 'action',
      title: item.label,
      icon: convertIcon(item.icon),
      onPress: item.disabled ? undefined : item.onPress,
      disabled: item.disabled,
      destructive: item.destructive,
      subtitle: item.description,
      state: item.state,
    };
  });

  return { id, type: 'menu', title, children };
}

function iconOf(item: NativeStackHeaderItemButton): HeaderIcon {
  if ('xcasset' in item && isJsonString(item.xcasset))
    return { type: 'xcasset', name: item.xcasset };

  return convertIcon(item.icon);
}

function visibilityPriorityOf(item: NativeStackHeaderItemButton | NativeStackHeaderItemMenu) {
  if (!('visibilityPriority' in item)) return undefined;
  const value = item.visibilityPriority;

  return value === 'low' || value === 'standard' || value === 'high' ? value : undefined;
}

function convertItems(items: NativeStackHeaderItem[], prefix: string): HeaderItem[] {
  return items.map((item, index): HeaderItem => {
    const id =
      item.type === 'button' || item.type === 'menu'
        ? (item.identifier ?? `${prefix}:${index}`)
        : `${prefix}:${index}`;

    switch (item.type) {
      case 'spacing':
        return { type: 'spacer', id, sizing: 'fixed', width: item.spacing };
      case 'custom':
        return {
          type: 'item',
          id,
          render: () => item.element,
          hidesSharedBackground: item.hidesSharedBackground,
        };
      case 'menu':
        return {
          type: 'item',
          id,
          identifier: item.identifier,
          title: item.label || item.accessibilityLabel,
          icon: convertIcon(item.icon),
          menu: item.disabled
            ? undefined
            : convertMenu(item.menu.items, `${id}:menu`, item.menu.title),
          visibilityPriority: visibilityPriorityOf(item),
          variant: item.variant,
          tintColor: item.tintColor,
          hidesSharedBackground: item.hidesSharedBackground,
        };
      case 'button':
        return {
          type: 'item',
          id,
          identifier: item.identifier,
          title: item.label || item.accessibilityLabel,
          icon: iconOf(item),
          onPress: item.disabled ? undefined : item.onPress,
          disabled: item.disabled,
          visibilityPriority: visibilityPriorityOf(item),
          variant: item.selected ? 'prominent' : item.variant,
          tintColor: item.tintColor,
          hidesSharedBackground: item.hidesSharedBackground,
        };
    }
  });
}

/**
 * The native navigation bar of one screen in a split column. React Native
 * Screens v5 configures each column screen's bar from a header config child
 * rather than from stack options, so this maps the options a screen sets with
 * `Stack.Screen` onto it. Adapted from T3 Code's `V5StackHeader` (MIT).
 */
export function ColumnHeader({
  canGoBack,
  options,
}: {
  canGoBack: boolean;
  options: NativeStackNavigationOptions;
}) {
  const colors = useAppColors();
  const surface = use(SurfaceContext);
  const itemProps = { tintColor: options.headerTintColor, canGoBack };
  const leading = convertItems(options.unstable_headerLeftItems?.(itemProps) ?? [], 'leading');
  const trailing = convertItems(options.unstable_headerRightItems?.(itemProps) ?? [], 'trailing');
  const left = options.headerLeft?.(itemProps);
  const right = options.headerRight?.(itemProps);

  if (!options.unstable_headerLeftItems && isValidElement(left)) {
    leading.push({ type: 'item', id: 'custom-left', render: () => left });
  }

  if (!options.unstable_headerRightItems && isValidElement(right)) {
    trailing.push({ type: 'item', id: 'custom-right', render: () => right });
  }

  // Phoenix screens title their bars with `title`; `headerTitle` and
  // `headerTransparent` are not mapped.
  const title = options.title;
  const titleStyle = StyleSheet.flatten(options.headerTitleStyle);
  const headerStyle = StyleSheet.flatten(options.headerStyle);

  const appearance = {
    // The sidebar's bar takes the column's tint so the column reads as one surface.
    backgroundColor: surface === 'sidebar' ? colors.background : headerStyle?.backgroundColor,
    shadowColor: options.headerShadowVisible === false ? 'transparent' : undefined,
    titleFontFamily: titleStyle?.fontFamily,
    titleFontSize: titleStyle?.fontSize,
    titleFontWeight: titleStyle?.fontWeight,
    titleFontColor: titleStyle?.color,
  };

  return (
    <Split.HeaderConfig
      backButtonHidden={options.headerBackVisible === false}
      hidden={options.headerShown === false}
      ios={{
        backButtonDisplayMode: options.headerBackButtonDisplayMode ?? 'minimal',
        backButtonTitle: options.headerBackTitle,
        largeTitleEnabled: options.headerLargeTitleEnabled,
        leadingItems: leading,
        scrollEdgeAppearance: appearance,
        standardAppearance: appearance,
        tintColor: options.headerTintColor,
        trailingItems: trailing,
      }}
      title={title}
    />
  );
}
