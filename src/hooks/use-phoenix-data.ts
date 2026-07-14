import type { Types } from '@arizeai/phoenix-client';
import { useQuery } from '@tanstack/react-query';

import { createPhoenixClient } from '@/lib/phoenix';
import type { PhoenixInstance } from '@/types/instance';

export type PhoenixProject = Types['V1']['components']['schemas']['Project'];

export const phoenixQueryKeys = {
  all: ['phoenix'] as const,
  instance: (instanceId: string) => [...phoenixQueryKeys.all, 'instance', instanceId] as const,
  projects: (instanceId: string) => [...phoenixQueryKeys.instance(instanceId), 'projects'] as const,
  version: (instanceId: string) => [...phoenixQueryKeys.instance(instanceId), 'version'] as const,
};

export function usePhoenixVersion(instance: PhoenixInstance | undefined) {
  return useQuery({
    queryKey: phoenixQueryKeys.version(instance?.id ?? 'missing'),
    queryFn: async () => {
      if (!instance) throw new Error('Phoenix instance not found.');
      const version = await createPhoenixClient(instance).getServerVersion();
      return version.join('.');
    },
    enabled: Boolean(instance),
  });
}

export function usePhoenixProjects(instance: PhoenixInstance | undefined) {
  return useQuery({
    queryKey: phoenixQueryKeys.projects(instance?.id ?? 'missing'),
    queryFn: async (): Promise<PhoenixProject[]> => {
      if (!instance) throw new Error('Phoenix instance not found.');
      const response = await createPhoenixClient(instance).GET('/v1/projects', {
        params: {
          query: {
            include_dataset_evaluator_projects: false,
            include_experiment_projects: false,
            limit: 100,
          },
        },
      });

      if (!response.data) throw new Error('Phoenix returned an empty projects response.');
      return response.data.data;
    },
    enabled: Boolean(instance),
  });
}
