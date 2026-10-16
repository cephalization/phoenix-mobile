import { Stack, useLocalSearchParams } from 'expo-router';

import { usePxiHeaderOptions } from '@/components/pxi-header-button';
import { SessionDetailView, type SessionQueueFilter } from '@/components/sessions/session-detail';
import { nativeHeaderTitle, useDuoLayout } from '@/features/duo/layout';
import { useInstanceStore } from '@/store/instances';

export default function SessionDetailScreen() {
  const { id, projectId, queueFilter, sessionId } = useLocalSearchParams<{
    id: string;
    projectId: string;
    queueFilter?: SessionQueueFilter;
    sessionId: string;
  }>();

  const { systemBarEdge } = useDuoLayout();
  const instance = useInstanceStore((state) => state.instances.find((item) => item.id === id));
  const pxiHeader = usePxiHeaderOptions(instance);

  return (
    <>
      <Stack.Screen
        options={{
          headerBackTitle: 'Sessions',
          title: nativeHeaderTitle(systemBarEdge, 'Session'),
          ...pxiHeader,
        }}
      />
      <SessionDetailView
        instanceId={id}
        projectId={projectId}
        queueFilter={queueFilter}
        sessionId={sessionId}
      />
    </>
  );
}
