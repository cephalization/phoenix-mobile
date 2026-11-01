import type { StatusTone } from '@/components/ui/status-label';
import { PhoenixAuthError } from '@/features/auth/oauth';
import { useInstanceReachability } from '@/features/offline/reachability';
import { usePhoenixViewer } from '@/hooks/use-phoenix-data';
import type { PhoenixInstance } from '@/types/instance';

export type InstanceStatus = {
  tone: StatusTone;
  label: string;
  loginRequired: boolean;
  /** The server didn't answer its last request, or the device has no network. */
  offline: boolean;
  viewer: ReturnType<typeof usePhoenixViewer>;
};

/** Whether an instance answers, and as whom, from its viewer request. */
export function useInstanceStatus(instance: PhoenixInstance | undefined): InstanceStatus {
  const viewer = usePhoenixViewer(instance);
  const reachability = useInstanceReachability(instance?.id);

  const loginRequired =
    viewer.error instanceof PhoenixAuthError && viewer.error.code === 'login_required';

  // A saved viewer would otherwise read as connected while the server is away.
  const offline = reachability.state === 'offline';

  if (offline) return { tone: 'neutral', label: 'Offline', loginRequired, offline, viewer };

  if (viewer.isPending) {
    return { tone: 'pending', label: 'Checking', loginRequired, offline, viewer };
  }

  if (loginRequired) {
    return { tone: 'error', label: 'Sign-in required', loginRequired, offline, viewer };
  }

  if (viewer.isError)
    return { tone: 'error', label: 'Unreachable', loginRequired, offline, viewer };

  return {
    tone: 'ok',
    label: viewer.data.auth_method === 'ANONYMOUS' ? 'Connected' : 'Signed in',
    loginRequired,
    offline,
    viewer,
  };
}
