import { EmptyState } from '@/components/ui/empty-state';
import { useReachabilityStore } from '@/features/offline/reachability';

/**
 * In place of a screen whose server can't be reached and which was never
 * saved for offline use. A calm explanation rather than a network error; the
 * retry appears only when the device has a network to retry on.
 */
export function OfflineUnavailable({
  fill = true,
  instanceName,
  onRetry,
}: {
  instanceName: string;
  onRetry?: () => void;
  /** False keeps it compact inside a list. */
  fill?: boolean;
}) {
  const deviceOnline = useReachabilityStore((state) => state.deviceOnline);

  return (
    <EmptyState
      action={deviceOnline && onRetry ? { label: 'Try again', onPress: onRetry } : undefined}
      fill={fill}
      message={`${instanceName} isn’t reachable. This page wasn’t saved for offline use.`}
      symbol={{ android: 'cloud_off', ios: 'icloud.slash', web: 'cloud_off' }}
      title="Not available offline"
    />
  );
}
