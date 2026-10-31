import * as Clipboard from 'expo-clipboard';
import * as WebBrowser from 'expo-web-browser';

import type { NativeStackHeaderItemMenu } from 'expo-router/native-stack';

import { barMenu } from '@/components/duo/column-header';

import { haptics } from '@/lib/haptics';

import { phoenixTraceUrl } from './trace-detail-model';

export type TraceActionTarget = {
  baseUrl: string;
  traceId: string;
  /** The selected span, when one is open in the span tree. */
  spanId: string | null;
};

export function copyId(value: string) {
  void Clipboard.setStringAsync(value).then(haptics.success, haptics.error);
}

export function openTraceInPhoenix(baseUrl: string, traceId: string) {
  void WebBrowser.openBrowserAsync(phoenixTraceUrl(baseUrl, traceId));
}

/**
 * The trace's `More` bar item on iOS: copy the trace or selected span ID and
 * open the trace in Phoenix's web UI. Android and web show the same actions
 * as rows at the end of the page.
 */
export function traceMoreMenu({
  baseUrl,
  spanId,
  traceId,
}: TraceActionTarget): NativeStackHeaderItemMenu {
  const copyItems: NativeStackHeaderItemMenu['menu']['items'] = [
    {
      type: 'action',
      label: 'Copy trace ID',
      icon: { type: 'sfSymbol', name: 'doc.on.doc' },
      onPress: () => copyId(traceId),
    },
  ];

  if (spanId !== null) {
    copyItems.push({
      type: 'action',
      label: 'Copy span ID',
      icon: { type: 'sfSymbol', name: 'number' },
      onPress: () => copyId(spanId),
    });
  }

  return barMenu({
    type: 'menu',
    identifier: 'trace-more',
    visibilityPriority: 'low',
    label: 'More',
    accessibilityLabel: 'More trace actions',
    icon: { type: 'sfSymbol', name: 'ellipsis.circle' },
    menu: {
      items: [
        {
          type: 'submenu',
          inline: true,
          label: 'Copy',
          items: copyItems,
        },
        {
          type: 'action',
          label: 'Open in Phoenix',
          icon: { type: 'sfSymbol', name: 'safari' },
          onPress: () => openTraceInPhoenix(baseUrl, traceId),
        },
      ],
    },
  });
}
