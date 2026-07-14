import type { ReactElement } from 'react';

export type NativeContextMenuAction = {
  destructive?: boolean;
  id: string;
  systemImage?: string;
  title: string;
};

export function NativeContextMenu({ children }: {
  actions: NativeContextMenuAction[];
  children: ReactElement;
  onAction: (id: string) => void;
}) {
  return children;
}
