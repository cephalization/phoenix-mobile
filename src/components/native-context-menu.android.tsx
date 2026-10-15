import { MenuView, type MenuComponentRef } from '@expo/ui/community/menu';
import { useEffect, useRef, useState, type ReactElement } from 'react';
import { Pressable, StyleSheet, View, type GestureResponderEvent } from 'react-native';

import type { NativeContextMenuAction } from './native-context-menu';

type MenuRequest = { id: number; x: number; y: number };

/**
 * Android keeps the content in ordinary React Native layout and opens the
 * Material dropdown imperatively from a long press. Hosting the content inside
 * the menu's Compose trigger (`RNHostView` with `matchContents`) lays the
 * subtree out from an unbounded root, so text never wraps and wide blocks run
 * off screen. The dropdown anchors to a zero-size view placed at the press
 * point, which also keeps the menu near the finger on long messages.
 */
export function NativeContextMenu({
  actions,
  children,
  onAction,
}: {
  actions: NativeContextMenuAction[];
  children: ReactElement;
  onAction: (id: string) => void;
}) {
  const menuRef = useRef<MenuComponentRef>(null);
  const [request, setRequest] = useState<MenuRequest | null>(null);

  useEffect(() => {
    // Open after the anchor has moved to the requested point.
    if (request) menuRef.current?.show();
  }, [request]);

  const handleLongPress = (event: GestureResponderEvent) => {
    const { locationX, locationY } = event.nativeEvent;

    setRequest((current) => ({ id: (current?.id ?? 0) + 1, x: locationX, y: locationY }));
  };

  return (
    <View style={styles.menu}>
      <View pointerEvents="none" style={StyleSheet.absoluteFill}>
        <View style={[styles.anchor, { left: request?.x ?? 0, top: request?.y ?? 0 }]}>
          <MenuView
            actions={actions.map((action) => ({
              attributes: action.destructive ? { destructive: true } : undefined,
              id: action.id,
              title: action.title,
            }))}
            onPressAction={(event) => onAction(event.nativeEvent.event)}
            ref={menuRef}
          >
            <View style={styles.anchorTarget} />
          </MenuView>
        </View>
      </View>
      <Pressable
        accessible={false}
        android_disableSound
        delayLongPress={350}
        focusable={false}
        onLongPress={handleLongPress}
      >
        {children}
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  menu: { alignSelf: 'stretch' },
  anchor: { position: 'absolute' },
  anchorTarget: { height: 1, width: 1 },
});
