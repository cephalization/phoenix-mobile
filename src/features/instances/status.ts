import type { StatusTone } from '@/components/ui/status-label';
import { PhoenixAuthError } from '@/features/auth/oauth';
import { usePhoenixViewer } from '@/hooks/use-phoenix-data';
import type { PhoenixInstance } from '@/types/instance';

export type InstanceStatus = {
  tone: StatusTone;
  label: string;
  loginRequired: boolean;
  viewer: ReturnType<typeof usePhoenixViewer>;
};

/** Whether an instance answers, and as whom, from its viewer request. */
export function useInstanceStatus(instance: PhoenixInstance | undefined): InstanceStatus {
  const viewer = usePhoenixViewer(instance);

  const loginRequired =
    viewer.error instanceof PhoenixAuthError && viewer.error.code === 'login_required';

  if (viewer.isPending) return { tone: 'pending', label: 'Checking', loginRequired, viewer };

  if (loginRequired) return { tone: 'error', label: 'Sign-in required', loginRequired, viewer };

  if (viewer.isError) return { tone: 'error', label: 'Unreachable', loginRequired, viewer };

  return {
    tone: 'ok',
    label: viewer.data.auth_method === 'ANONYMOUS' ? 'Connected' : 'Signed in',
    loginRequired,
    viewer,
  };
}
