import type { SFSymbol } from 'expo-symbols';
import type { ReactElement } from 'react';

export type NativeContextMenuAction = {
  destructive?: boolean;
  id: string;
  systemImage?: SFSymbol;
  title: string;
};

export function NativeContextMenu({
  children,
}: {
  actions: NativeContextMenuAction[];
  children: ReactElement;
  onAction: (id: string) => void;
}) {
  return children;
}
