import { useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { ProjectOverview } from '@/components/overview/project-overview';
import { ProjectSessions } from '@/components/sessions/project-sessions';
import type { SessionQueueFilter } from '@/components/sessions/session-detail';
import { ProjectTraces, type TraceWindow } from '@/components/traces/project-traces';
import type { ProjectView } from '@/components/traces/project-list-header';
import { useMetricsSupported } from '@/hooks/use-phoenix-metrics';
import { useInstanceStore } from '@/store/instances';

/**
 * A project: its overview, traces, or sessions. The views are one page, so
 * the segmented control changes the `view` parameter in place instead of
 * pushing or replacing a route. A view stays mounted once shown and the
 * others are only hidden, so switching back neither reloads nor reflows it.
 * `filter` is the sessions queue filter; `query` is a trace filter expression
 * for the traces list; `from`, `to`, and `show` are the time window (and
 * errors-only feed) the overview hands the traces list for one chart bin.
 * The overview leads unless the link asks for traces or the server has no
 * project metrics.
 */
export default function ProjectScreen() {
  const { filter, from, id, projectId, query, show, to, view } = useLocalSearchParams<{
    filter?: SessionQueueFilter;
    from?: string;
    id: string;
    projectId: string;
    query?: string;
    show?: 'errors';
    to?: string;
    view?: ProjectView;
  }>();

  const instance = useInstanceStore((state) => state.instances.find((entry) => entry.id === id));
  const metrics = useMetricsSupported(instance);

  const shown: ProjectView =
    view === 'sessions' || view === 'traces'
      ? view
      : view === undefined && (query || from)
        ? 'traces'
        : metrics === false
          ? 'traces'
          : 'overview';

  const traceWindow: TraceWindow | undefined =
    from && to ? { from, to, errorsOnly: show === 'errors' } : undefined;

  const [visited, setVisited] = useState<ReadonlySet<ProjectView>>(() => new Set([shown]));

  if (!visited.has(shown)) setVisited(new Set([...visited, shown]));

  return (
    <View style={styles.screen}>
      {visited.has('overview') ? (
        <View style={[styles.screen, shown !== 'overview' && styles.hidden]}>
          <ProjectOverview active={shown === 'overview'} id={id} projectId={projectId} />
        </View>
      ) : null}
      {visited.has('traces') ? (
        <View style={[styles.screen, shown !== 'traces' && styles.hidden]}>
          <ProjectTraces
            active={shown === 'traces'}
            id={id}
            projectId={projectId}
            query={query}
            window={traceWindow}
          />
        </View>
      ) : null}
      {visited.has('sessions') ? (
        <View style={[styles.screen, shown !== 'sessions' && styles.hidden]}>
          <ProjectSessions
            active={shown === 'sessions'}
            filter={filter}
            id={id}
            projectId={projectId}
          />
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  hidden: { display: 'none' },
});
