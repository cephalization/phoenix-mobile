import { Stack, useLocalSearchParams } from 'expo-router';

import { usePxiHeaderOptions } from '@/components/pxi-header-button';
import { findRootSpan, TraceDetailView } from '@/components/traces/trace-detail';
import { nativeHeaderTitle, useDuoLayout } from '@/features/duo/layout';
import { usePhoenixProjects, usePhoenixTrace } from '@/hooks/use-phoenix-data';
import { useInstanceStore } from '@/store/instances';

export default function TraceDetailScreen() {
  const { id, projectId, traceId } = useLocalSearchParams<{
    id: string;
    projectId: string;
    traceId: string;
  }>();

  const { systemBarEdge } = useDuoLayout();

  const instance = useInstanceStore((state) =>
    state.instances.find((candidate) => candidate.id === id),
  );

  // The header shares query keys with TraceDetailView, so these read the same cache entries.
  const projects = usePhoenixProjects(instance);
  const project = projects.data?.find((candidate) => candidate.id === projectId);
  const trace = usePhoenixTrace(instance, projectId, traceId);
  const root = findRootSpan(trace.data ?? []);
  const pxiHeader = usePxiHeaderOptions(instance);

  return (
    <>
      <Stack.Screen
        options={{
          headerBackTitle: project?.name ?? 'Traces',
          title: nativeHeaderTitle(systemBarEdge, root?.name ?? 'Trace'),
          ...pxiHeader,
        }}
      />
      <TraceDetailView instanceId={id} projectId={projectId} traceId={traceId} />
    </>
  );
}
