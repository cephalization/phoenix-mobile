import type { PhoenixInstance } from '@/types/instance';

import { PhoenixAuthError } from './oauth';

export async function runOAuthLogin(_instance: PhoenixInstance): Promise<PhoenixInstance> {
  throw new PhoenixAuthError(
    'OAuth connections are available in the iOS and Android apps.',
    'unavailable',
  );
}

export function hasInMemoryOAuthLoginOwner(): boolean {
  return false;
}

export async function completeOAuthCallback(_callbackUrl: string): Promise<PhoenixInstance> {
  throw new PhoenixAuthError(
    'OAuth callbacks are only supported in the iOS and Android apps.',
    'unavailable',
  );
}
