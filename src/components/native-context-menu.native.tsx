import { MenuView, type MenuAction } from '@expo/ui/community/menu';
import type { ReactElement } from 'react';
import { StyleSheet } from 'react-native';

import type { NativeContextMenuAction } from './native-context-menu';

export function NativeContextMenu({ actions, children, onAction }: {
  actions: NativeContextMenuAction[];
  children: ReactElement;
  onAction: (id: string) => void;
}) {
  return (
    <MenuView
      actions={actions.map((action) => ({
        attributes: action.destructive ? { destructive: true } : undefined,
        id: action.id,
        image: action.systemImage as MenuAction['image'],
        title: action.title,
      }))}
      onPressAction={(event) => onAction(event.nativeEvent.event)}
      shouldOpenOnLongPress
      style={styles.menu}>
      {children}
    </MenuView>
  );
}

const styles = StyleSheet.create({ menu: { alignSelf: 'stretch' } });
