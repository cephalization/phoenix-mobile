import type { usePhoenixSession } from '@/hooks/use-phoenix-sessions';

export type SessionQueueFilter = 'all' | 'needs-review' | 'reviewed';

export type LoadedSession = NonNullable<ReturnType<typeof usePhoenixSession>['data']>;
