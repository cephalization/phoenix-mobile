import * as Linking from 'expo-linking';
import { useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { MotionPressable } from '@/components/motion-pressable';
import { AppFonts, useAppColors } from '@/constants/theme';
import { completeOAuthCallback } from '@/features/auth/login';
import { revokeAndDeleteCredentials } from '@/features/auth/session';
import { phoenixQueryKeys } from '@/hooks/use-phoenix-data';
import { haptics } from '@/lib/haptics';
import { createPhoenixClient } from '@/lib/phoenix';
import { useInstanceStore } from '@/store/instances';

export default function OAuthCallbackScreen() {
  const colors = useAppColors();
  const callbackUrl = Linking.useLinkingURL();
  const queryClient = useQueryClient();
  const addInstance = useInstanceStore((state) => state.addInstance);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!callbackUrl?.startsWith('phoenixmobile://oauth/callback')) return;

    const completeSignIn = async () => {
      try {
        // Android can route the deep link here without resolving the original
        // openAuthSessionAsync promise. Completion is globally deduplicated, so this
        // route is also the reliable warm-callback owner on that platform.
        const instance = await completeOAuthCallback(callbackUrl);

        try {
          const viewer = await (await createPhoenixClient(instance)).GET('/v1/user');

          if (!viewer.data || viewer.data.data.auth_method === 'ANONYMOUS') {
            throw new Error('Phoenix did not return an authenticated user after sign-in.');
          }
        } catch (verificationError) {
          await revokeAndDeleteCredentials(instance).catch(() => undefined);
          throw verificationError;
        }

        const replacedIds = useInstanceStore
          .getState()
          .instances.filter((item) => item.baseUrl === instance.baseUrl && item.id !== instance.id)
          .map((item) => item.id);

        await addInstance(instance);

        for (const id of replacedIds)
          queryClient.removeQueries({ queryKey: phoenixQueryKeys.instance(id) });
        haptics.success();
        router.replace({ pathname: '/instances/[id]', params: { id: instance.id } });
      } catch (reason) {
        haptics.error();
        setError(
          reason instanceof Error ? reason.message : 'Phoenix sign-in could not be completed.',
        );
      }
    };

    void completeSignIn();
  }, [addInstance, callbackUrl, queryClient]);

  return (
    <SafeAreaView style={[styles.screen, { backgroundColor: colors.background }]}>
      <View style={styles.content}>
        {error ? (
          <>
            <Text style={[styles.title, { color: colors.text }]}>Sign-in failed</Text>
            <Text style={[styles.copy, { color: colors.textSecondary }]}>{error}</Text>
            <MotionPressable
              onPress={() => router.replace('/')}
              style={[styles.button, { backgroundColor: colors.accent }]}
            >
              <Text style={[styles.buttonText, { color: colors.accentForeground }]}>
                Return to instances
              </Text>
            </MotionPressable>
          </>
        ) : (
          <>
            <ActivityIndicator color={colors.brand} />
            <Text style={[styles.copy, { color: colors.textSecondary }]}>
              Completing Phoenix sign-in…
            </Text>
          </>
        )}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, justifyContent: 'center' },
  content: { alignItems: 'center', gap: 16, padding: 24 },
  title: { fontFamily: AppFonts.semibold, fontSize: 24 },
  copy: { fontFamily: AppFonts.regular, fontSize: 15, lineHeight: 22, textAlign: 'center' },
  button: { borderRadius: 14, justifyContent: 'center', minHeight: 48, paddingHorizontal: 18 },
  buttonText: { fontFamily: AppFonts.semibold, fontSize: 14 },
});
