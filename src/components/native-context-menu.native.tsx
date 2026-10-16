import { Button, type ButtonProps, ContextMenu, Host, RNHostView } from '@expo/ui/swift-ui';
import { type ReactElement, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import type { NativeContextMenuAction } from './native-context-menu';

// iOS: the SwiftUI context menu hosts the content itself so the system preview
// shows the message. Android has its own implementation (see the .android file).
//
// The hosted React Native subtree is laid out from an unbounded root, so text
// measured at its max-content width ran off the right edge instead of
// wrapping. The content is pinned to the width this row receives from its own
// column; matching the host's height only (`matchContents={{ vertical: true }}`)
// instead dropped long Markdown parts entirely.
export function NativeContextMenu({
  actions,
  children,
  onAction,
}: {
  actions: NativeContextMenuAction[];
  children: ReactElement;
  onAction: (id: string) => void;
}) {
  const [width, setWidth] = useState<number | null>(null);

  return (
    <View onLayout={(event) => setWidth(event.nativeEvent.layout.width)} style={styles.row}>
      {width === null ? null : (
        <Host ignoreSafeArea="all" matchContents style={styles.row}>
          <ContextMenu>
            <ContextMenu.Trigger>
              <RNHostView matchContents>
                <View style={{ width }}>{children}</View>
              </RNHostView>
            </ContextMenu.Trigger>
            <ContextMenu.Items>
              {actions.map((action) => (
                <Button
                  key={action.id}
                  label={action.title}
                  onPress={() => onAction(action.id)}
                  role={action.destructive ? 'destructive' : undefined}
                  // SAFETY: systemImage values are SF Symbol names authored in this app's static
                  // action tables, so they satisfy the SF Symbol string union.
                  systemImage={action.systemImage as ButtonProps['systemImage']}
                />
              ))}
            </ContextMenu.Items>
          </ContextMenu>
        </Host>
      )}
    </View>
  );
}

const styles = StyleSheet.create({ row: { alignSelf: 'stretch' } });
