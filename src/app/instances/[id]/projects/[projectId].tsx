import { useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { ProjectSessions } from '@/components/sessions/project-sessions';
import type { SessionQueueFilter } from '@/components/sessions/session-detail';
import { ProjectTraces } from '@/components/traces/project-traces';
import type { ProjectView } from '@/components/traces/project-list-header';

/**
 * A project: its traces or its sessions. The two lists are one page, so the
 * segmented control changes the `view` parameter in place instead of pushing
 * or replacing a route. A list stays mounted once shown and the other is only
 * hidden, so switching back neither reloads nor reflows it.
 */
export default function ProjectScreen() {
  const { filter, id, projectId, view } = useLocalSearchParams<{
    filter?: SessionQueueFilter;
    id: string;
    projectId: string;
    view?: ProjectView;
  }>();

  const shown: ProjectView = view === 'sessions' ? 'sessions' : 'traces';
  const [visited, setVisited] = useState<ReadonlySet<ProjectView>>(() => new Set([shown]));

  if (!visited.has(shown)) setVisited(new Set([...visited, shown]));

  return (
    <View style={styles.screen}>
      {visited.has('traces') ? (
        <View style={[styles.screen, shown !== 'traces' && styles.hidden]}>
          <ProjectTraces active={shown === 'traces'} id={id} projectId={projectId} />
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
