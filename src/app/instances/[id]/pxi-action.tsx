import { router, Stack, useLocalSearchParams } from 'expo-router';

import { PxiActionView } from '@/components/chat/pxi-action';
import { resolvePxiAction, type PxiActionRouteParams } from '@/features/pxi/actions';

export default function PxiActionSheet() {
  const params = useLocalSearchParams<PxiActionRouteParams>();
  const action = resolvePxiAction(params);

  return (
    <>
      <Stack.Screen options={{ title: action?.title ?? 'PXI' }} />
      <PxiActionView
        onClose={() => {
          if (router.canGoBack()) router.back();
        }}
        params={params}
      />
    </>
  );
}
