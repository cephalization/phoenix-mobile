import { Redirect, useLocalSearchParams } from 'expo-router';
import { useEffect } from 'react';

import { useInstanceStore } from '@/store/instances';

/**
 * Links to an instance make it the active one and land on the projects list,
 * which is the root. Kept so `/instances/<id>` links from before the projects
 * list became the root still open the right instance.
 */
export default function InstanceRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const exists = useInstanceStore((state) => state.instances.some((item) => item.id === id));
  const activeInstanceId = useInstanceStore((state) => state.activeInstanceId);
  const setActiveInstanceId = useInstanceStore((state) => state.setActiveInstanceId);
  const pending = exists && activeInstanceId !== id;

  useEffect(() => {
    if (pending) setActiveInstanceId(id);
  }, [id, pending, setActiveInstanceId]);

  if (pending) return null;

  return <Redirect href="/" />;
}
