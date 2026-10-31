import { Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Platform } from 'react-native';

import { usePxiHeaderOptions } from '@/components/pxi-header-button';
import { TraceDetailView } from '@/components/traces/trace-detail';
import { traceMoreMenu } from '@/components/traces/trace-detail-actions';
import { nativeHeaderTitle, useDuoLayout } from '@/features/duo/layout';
import { usePhoenixProjects } from '@/hooks/use-phoenix-data';
import { useInstanceStore } from '@/store/instances';

export default function TraceDetailScreen() {
  const { id, projectId, traceId } = useLocalSearchParams<{
    id: string;
    projectId: string;
    traceId: string;
  }>();

  const { systemBarEdge } = useDuoLayout();
  const [selectedSpanId, setSelectedSpanId] = useState<string | null>(null);

  const instance = useInstanceStore((state) =>
    state.instances.find((candidate) => candidate.id === id),
  );

  // Shares its query key with TraceDetailView, so this reads the same cache entry.
  const projects = usePhoenixProjects(instance);
  const project = projects.data?.find((candidate) => candidate.id === projectId);
  const pxiHeader = usePxiHeaderOptions(instance);

  // The page opens with the root span's name, so the bar says only what this is.
  const title = nativeHeaderTitle(systemBarEdge, 'Trace');
  const barActions = Platform.OS === 'ios' && instance !== undefined;

  return (
    <>
      <Stack.Screen
        options={
          barActions
            ? {
                headerBackTitle: project?.name ?? 'Traces',
                title,
                // Trailing items stack from the far end: PXI last sits at the top of a vertical bar.
                unstable_headerRightItems: (props) => [
                  traceMoreMenu({ baseUrl: instance.baseUrl, spanId: selectedSpanId, traceId }),
                  ...(pxiHeader.unstable_headerRightItems?.(props) ?? []),
                ],
              }
            : { headerBackTitle: project?.name ?? 'Traces', title, ...pxiHeader }
        }
      />
      <TraceDetailView
        actionsInBar={barActions}
        instanceId={id}
        onSelectSpan={setSelectedSpanId}
        projectId={projectId}
        selectedSpanId={selectedSpanId}
        traceId={traceId}
      />
    </>
  );
}
