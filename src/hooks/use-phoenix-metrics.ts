import { keepPreviousData, useQuery } from '@tanstack/react-query';

import { fetchProjectOverview, fetchProjectsHealth, MetricsMinimum } from '@/features/metrics/api';
import type { MetricsWindow } from '@/features/metrics/window';
import { phoenixQueryKeys, usePhoenixVersionAtLeast } from '@/hooks/use-phoenix-data';
import type { PhoenixInstance } from '@/types/instance';

export const metricsQueryKeys = {
  overview: (instanceId: string, projectId: string, window: MetricsWindow) =>
    [
      ...phoenixQueryKeys.instance(instanceId),
      'project',
      projectId,
      'overview',
      window.cacheKey,
    ] as const,
  health: (instanceId: string, window: MetricsWindow) =>
    [...phoenixQueryKeys.instance(instanceId), 'projects-health', window.cacheKey] as const,
};

/** Whether the server has the metrics the overview reads; undefined until its version is known. */
export function useMetricsSupported(instance: PhoenixInstance | undefined) {
  return usePhoenixVersionAtLeast(instance, MetricsMinimum);
}

export function useProjectOverview(
  instance: PhoenixInstance | undefined,
  projectId: string,
  window: MetricsWindow,
  enabled = true,
) {
  const supported = useMetricsSupported(instance);

  return useQuery({
    queryKey: metricsQueryKeys.overview(instance?.id ?? 'missing', projectId, window),
    queryFn: async ({ signal }) => {
      if (!instance) throw new Error('Phoenix instance not found.');

      return fetchProjectOverview(instance, projectId, window, signal);
    },
    enabled: Boolean(instance) && supported === true && enabled,
    // A new range keeps the old charts on screen until the new ones arrive.
    placeholderData: keepPreviousData,
  });
}

/** Health for the listed projects, refreshed with the list. */
export function useProjectsHealth(
  instance: PhoenixInstance | undefined,
  projectIds: readonly string[],
  window: MetricsWindow,
) {
  const supported = useMetricsSupported(instance);

  return useQuery({
    queryKey: [...metricsQueryKeys.health(instance?.id ?? 'missing', window), projectIds.join(',')],
    queryFn: async ({ signal }) => {
      if (!instance) throw new Error('Phoenix instance not found.');

      // An array, not a Map: the offline cache stores query data as JSON.
      return fetchProjectsHealth(instance, projectIds, window, signal);
    },
    enabled: Boolean(instance) && supported === true && projectIds.length > 0,
    placeholderData: keepPreviousData,
  });
}
