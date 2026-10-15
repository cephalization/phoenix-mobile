import { MenuView, type MenuAction } from '@expo/ui/community/menu';
import type { ReactElement } from 'react';
import { StyleSheet } from 'react-native';

import type { NativeContextMenuAction } from './native-context-menu';

// iOS: the SwiftUI context menu hosts the content itself so the system preview
// shows the message. Android has its own implementation (see the .android file).
export function NativeContextMenu({
  actions,
  children,
  onAction,
}: {
  actions: NativeContextMenuAction[];
  children: ReactElement;
  onAction: (id: string) => void;
}) {
  return (
    <MenuView
      actions={actions.map((action) => ({
        attributes: action.destructive ? { destructive: true } : undefined,
        id: action.id,
        // SAFETY: systemImage values are SF Symbol names authored in this app's static action
        // tables; MenuView treats a string image as an SF Symbol on iOS and ignores it on Android.
        image: action.systemImage as MenuAction['image'],
        title: action.title,
      }))}
      onPressAction={(event) => onAction(event.nativeEvent.event)}
      shouldOpenOnLongPress
      style={styles.menu}
    >
      {children}
    </MenuView>
  );
}

const styles = StyleSheet.create({ menu: { alignSelf: 'stretch' } });
