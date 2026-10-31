import { router, Stack, useLocalSearchParams } from 'expo-router';
import { Platform } from 'react-native';

import { usePxiHeaderOptions } from '@/components/pxi-header-button';
import { SessionDetailView, type SessionQueueFilter } from '@/components/sessions/session-detail';
import { nativeHeaderTitle, useDuoLayout } from '@/features/duo/layout';
import { useSessionQueueOrder, useSplitDetail } from '@/features/duo/split-detail';
import { selectDetail } from '@/features/duo/split-routes';
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
  const splitDetail = useSplitDetail();
  const title = nativeHeaderTitle(systemBarEdge, 'Session');

  // Beside the queue in native columns, a review moves on to the next session
  // the sidebar lists, chosen now while the reviewed row is still listed.
  const reviewNext = () => {
    const order = useSessionQueueOrder.getState();
    const index = order.projectId === projectId ? order.sessionIds.indexOf(sessionId) : -1;
    const next = index >= 0 ? order.sessionIds[index + 1] : undefined;

    if (next === undefined) {
      router.back();

      return;
    }

    selectDetail({
      pathname: '/instances/[id]/projects/[projectId]/sessions/[sessionId]',
      params: { id, projectId, sessionId: next, queueFilter: queueFilter ?? 'needs-review' },
    });
  };

  return (
    <>
      {/* On iOS the session view puts PXI and its own actions in the native bar. */}
      <Stack.Screen
        options={
          Platform.OS === 'ios'
            ? { headerBackTitle: 'Sessions', title }
            : { headerBackTitle: 'Sessions', title, ...pxiHeader }
        }
      />
      <SessionDetailView
        barItems={
          Platform.OS === 'ios'
            ? (props) => pxiHeader.unstable_headerRightItems?.(props) ?? []
            : undefined
        }
        instanceId={id}
        onReviewed={splitDetail.active ? reviewNext : undefined}
        projectId={projectId}
        queueFilter={queueFilter}
        sessionId={sessionId}
      />
    </>
  );
}
