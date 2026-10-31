import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { SymbolView } from 'expo-symbols';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native';
import Animated, { FadeIn, FadeOut, ReduceMotion, useReducedMotion } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { z } from 'zod';

import { MotionPressable } from '@/components/motion-pressable';
import { AppFonts, Fonts, Type, useAppColors } from '@/constants/theme';
import { runOAuthLogin } from '@/features/auth/login';
import {
  assertPhoenix19,
  discoverOAuth,
  probePhoenixAuth,
  registerOAuthClient,
} from '@/features/auth/oauth';
import { revokeAndDeleteCredentials } from '@/features/auth/session';
import { phoenixQueryKeys } from '@/hooks/use-phoenix-data';
import { haptics } from '@/lib/haptics';
import { isJsonString } from '@/lib/json';
import {
  createInstanceId,
  createPhoenixClient,
  normalizePhoenixUrl,
  PhoenixUrlError,
} from '@/lib/phoenix';
import { useInstanceStore } from '@/store/instances';
import type { PhoenixInstance } from '@/types/instance';
import { useContentColumnStyle } from '@/features/duo/layout';

const connectionSchema = z.object({
  allowInsecureOAuth: z.boolean(),
  name: z.string().trim().max(60, 'Use 60 characters or fewer.'),
  host: z.string().trim().min(1, 'Enter a Phoenix host and port.'),
});

type ConnectionForm = z.infer<typeof connectionSchema>;

/**
 * Optional prefill carried by a link such as
 * `phoenixmobile://instances/new?host=192.168.1.20:6006` (or the Expo Go form,
 * `exp://<computer>:8081/--/instances/new?host=...`), so a collaborator can be
 * handed a connection instead of typing it. Nothing is saved until verified.
 */
type ConnectionLinkParams = { host?: string; name?: string };

export default function NewInstanceScreen() {
  const colors = useAppColors();
  const insets = useSafeAreaInsets();
  // Pads clear of iPhone Duo's vertical bar, which runs down a sheet's trailing edge.
  const column = useContentColumnStyle(20);
  const queryClient = useQueryClient();
  const reduceMotion = useReducedMotion();
  const linkParams = useLocalSearchParams<ConnectionLinkParams>();

  const [connectionStatus, setConnectionStatus] = useState<
    'idle' | 'verifying' | 'authorizing' | 'success'
  >('idle');

  const addInstance = useInstanceStore((state) => state.addInstance);
  const instances = useInstanceStore((state) => state.instances);
  const pendingOAuthRegistrations = useInstanceStore((state) => state.pendingOAuthRegistrations);

  const savePendingOAuthRegistration = useInstanceStore(
    (state) => state.savePendingOAuthRegistration,
  );

  const {
    control,
    handleSubmit,
    formState: { errors },
    setError,
  } = useForm<ConnectionForm>({
    resolver: zodResolver(connectionSchema),
    defaultValues: {
      allowInsecureOAuth: false,
      host: isJsonString(linkParams.host) ? linkParams.host : '',
      name: isJsonString(linkParams.name) ? linkParams.name : '',
    },
  });

  const connect = useMutation({
    onMutate: () => setConnectionStatus('verifying'),
    mutationFn: async (values: ConnectionForm) => {
      let baseUrl: string;

      try {
        baseUrl = normalizePhoenixUrl(values.host);
      } catch (error) {
        if (error instanceof PhoenixUrlError) throw error;
        throw new Error('Enter a valid host, such as 192.168.1.10:6006.', { cause: error });
      }

      const url = new URL(baseUrl);

      const instance: PhoenixInstance = {
        id: createInstanceId(),
        name: values.name || url.host,
        baseUrl,
        auth: { type: 'none' },
        createdAt: new Date().toISOString(),
      };

      const version = (await (await createPhoenixClient(instance)).getServerVersion()).join('.');
      const authMode = await probePhoenixAuth(baseUrl);

      if (authMode === 'anonymous') return instance;

      assertPhoenix19(version);

      if (Platform.OS === 'web') {
        throw new Error(
          'This Phoenix server requires OAuth. Add it from the Phoenix Mobile iOS or Android app; web does not store tokens.',
        );
      }

      setConnectionStatus('authorizing');
      const metadata = await discoverOAuth(baseUrl, values.allowInsecureOAuth);

      const existingAuth = instances.find(
        (item) => item.baseUrl === baseUrl && item.auth.type === 'oauth2',
      )?.auth;

      const pendingRegistration = pendingOAuthRegistrations[baseUrl];

      const reusableClientId =
        existingAuth?.type === 'oauth2' &&
        existingAuth.issuer === metadata.issuer &&
        existingAuth.registrationEndpoint === metadata.registrationEndpoint
          ? existingAuth.clientId
          : pendingRegistration &&
              pendingRegistration.baseUrl === baseUrl &&
              isJsonString(pendingRegistration.clientId) &&
              pendingRegistration.clientId.length > 0 &&
              pendingRegistration.issuer === metadata.issuer &&
              pendingRegistration.registrationEndpoint === metadata.registrationEndpoint
            ? pendingRegistration.clientId
            : null;

      const clientId = reusableClientId ?? (await registerOAuthClient(metadata));

      if (!reusableClientId) {
        if (!metadata.registrationEndpoint) {
          throw new Error(
            'This Phoenix server does not allow dynamic client registration for Phoenix Mobile.',
          );
        }

        savePendingOAuthRegistration({
          baseUrl,
          clientId,
          issuer: metadata.issuer,
          registrationEndpoint: metadata.registrationEndpoint,
          createdAt: Date.now(),
        });
      }

      const authenticated: PhoenixInstance = {
        ...instance,
        auth: {
          ...metadata,
          clientId,
          credentialKey: `phoenix.oauth.${instance.id}`,
        },
      };

      const connected = await runOAuthLogin(authenticated);

      try {
        const viewer = await (await createPhoenixClient(connected)).GET('/v1/user');

        if (!viewer.data || viewer.data.data.auth_method === 'ANONYMOUS') {
          throw new Error('Phoenix did not return an authenticated user after sign-in.');
        }
      } catch (error) {
        await revokeAndDeleteCredentials(connected).catch(() => undefined);
        throw error;
      }

      return connected;
    },
    onSuccess: async (instance) => {
      setConnectionStatus('success');
      haptics.success();

      const replacedIds = instances
        .filter((item) => item.baseUrl === instance.baseUrl && item.id !== instance.id)
        .map((item) => item.id);

      await addInstance(instance);

      for (const id of replacedIds)
        queryClient.removeQueries({ queryKey: phoenixQueryKeys.instance(id) });

      if (!reduceMotion) await new Promise((resolve) => setTimeout(resolve, 480));
      useInstanceStore.getState().setActiveInstanceId(instance.id);
      router.dismissTo('/');
    },
    onError: (error) => {
      setConnectionStatus('idle');
      haptics.error();
      setError('root', { message: getConnectionError(error) });
    },
  });

  const busy = connectionStatus === 'verifying' || connectionStatus === 'authorizing';

  const content = (
    <ScrollView
      automaticallyAdjustKeyboardInsets
      contentContainerStyle={styles.scrollContent}
      contentInsetAdjustmentBehavior="automatic"
      keyboardShouldPersistTaps="handled"
      style={[styles.screen, { backgroundColor: colors.background }]}
    >
      <View style={[styles.content, column, { paddingBottom: 24 + insets.bottom }]}>
        <Controller
          control={control}
          name="host"
          render={({ field: { onBlur, onChange, value } }) => (
            <View style={styles.field}>
              <Text style={[Type.label, { color: colors.textSecondary }]}>Host and port</Text>
              <TextInput
                accessibilityLabel="Phoenix host and port"
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType="url"
                onBlur={onBlur}
                onChangeText={onChange}
                placeholder="192.168.1.10:6006"
                placeholderTextColor={colors.textTertiary}
                style={[
                  styles.input,
                  styles.hostInput,
                  {
                    backgroundColor: colors.backgroundElement,
                    borderColor: errors.host ? colors.danger : colors.border,
                    color: colors.text,
                  },
                ]}
                value={value}
              />
              {errors.host && (
                <Text style={[Type.subhead, { color: colors.danger }]}>{errors.host.message}</Text>
              )}
            </View>
          )}
        />

        <Controller
          control={control}
          name="name"
          render={({ field: { onBlur, onChange, value } }) => (
            <View style={styles.field}>
              <Text style={[Type.label, { color: colors.textSecondary }]}>Name</Text>
              <TextInput
                accessibilityLabel="Display name"
                autoCapitalize="words"
                onBlur={onBlur}
                onChangeText={onChange}
                placeholder="Optional, such as Local Phoenix"
                placeholderTextColor={colors.textTertiary}
                style={[
                  styles.input,
                  {
                    backgroundColor: colors.backgroundElement,
                    borderColor: errors.name ? colors.danger : colors.border,
                    color: colors.text,
                  },
                ]}
                value={value}
              />
              {errors.name && (
                <Text style={[Type.subhead, { color: colors.danger }]}>{errors.name.message}</Text>
              )}
            </View>
          )}
        />

        <Text style={[Type.subhead, { color: colors.textSecondary }]}>
          Phoenix Mobile checks the server before saving it. On a phone, use your computer’s LAN
          address instead of localhost.
        </Text>

        <View style={[styles.optionGroup, { borderColor: colors.separator }]}>
          <Controller
            control={control}
            name="allowInsecureOAuth"
            render={({ field: { onChange, value } }) => (
              <View style={styles.switchRow}>
                <View style={styles.switchCopy}>
                  <Text style={[Type.headline, { color: colors.text }]}>
                    Allow sign-in over HTTP
                  </Text>
                  <Text style={[Type.subhead, { color: colors.textSecondary }]}>
                    Development only. Passwords and tokens can be intercepted on the network.
                  </Text>
                </View>
                <Switch
                  accessibilityLabel="Allow OAuth credentials over insecure HTTP"
                  onValueChange={(next) => {
                    haptics.selection();
                    onChange(next);
                  }}
                  trackColor={{ false: colors.backgroundSelected, true: colors.danger }}
                  value={value}
                />
              </View>
            )}
          />
          <Text style={[Type.subhead, styles.footnote, { color: colors.textTertiary }]}>
            Servers without authentication connect directly. Phoenix 19 or newer servers that
            require sign-in open the system browser, over HTTPS unless HTTP is allowed above.
          </Text>
        </View>

        {errors.root && (
          <Text accessibilityRole="alert" style={[Type.subhead, { color: colors.danger }]}>
            {errors.root.message}
          </Text>
        )}

        <MotionPressable
          accessibilityLabel={
            connectionStatus === 'idle' ? 'Verify and connect' : 'Verifying Phoenix server'
          }
          accessibilityRole="button"
          accessibilityState={{ busy: connect.isPending }}
          disabled={connect.isPending}
          onPress={() => void handleSubmit((values) => connect.mutate(values))()}
          style={[styles.submit, { backgroundColor: colors.accent }]}
        >
          <Animated.View
            key={connectionStatus}
            entering={FadeIn.duration(160).reduceMotion(ReduceMotion.System)}
            exiting={FadeOut.duration(100).reduceMotion(ReduceMotion.System)}
            style={styles.submitContent}
          >
            {busy && <ActivityIndicator color={colors.accentForeground} size="small" />}
            {connectionStatus === 'success' && (
              <SymbolView
                name={{ ios: 'checkmark', android: 'check', web: 'check' }}
                size={15}
                tintColor={colors.accentForeground}
                weight="bold"
              />
            )}
            <Text style={[styles.submitText, { color: colors.accentForeground }]}>
              {connectionStatus === 'verifying'
                ? 'Verifying…'
                : connectionStatus === 'authorizing'
                  ? 'Waiting for sign-in…'
                  : connectionStatus === 'success'
                    ? 'Connected'
                    : 'Connect'}
            </Text>
          </Animated.View>
        </MotionPressable>
      </View>
    </ScrollView>
  );

  // iOS form-sheet sizing requires the ScrollView as the screen root, and the
  // keyboard-inset props above are iOS-only; Android needs explicit avoidance,
  // matching the height behavior device-verified for the chat screen.
  if (Platform.OS !== 'android') return content;

  return (
    <KeyboardAvoidingView behavior="height" style={styles.screen}>
      {content}
    </KeyboardAvoidingView>
  );
}

function getConnectionError(error: Error): string {
  if (/version could not be determined/i.test(error.message)) {
    return 'Could not reach a supported Phoenix server at that address.';
  }

  return error.message || 'Could not connect to Phoenix.';
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  scrollContent: { flexGrow: 1 },
  content: { alignSelf: 'center', gap: 18, paddingTop: 16, width: '100%' },
  field: { gap: 6 },
  input: {
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    fontFamily: AppFonts.regular,
    fontSize: 16,
    minHeight: 48,
    paddingHorizontal: 14,
  },
  hostInput: { fontFamily: Fonts.mono, fontSize: 15 },
  optionGroup: { borderTopWidth: StyleSheet.hairlineWidth, gap: 8, paddingTop: 14 },
  switchRow: { alignItems: 'center', flexDirection: 'row', gap: 14, minHeight: 48 },
  switchCopy: { flex: 1, gap: 2 },
  footnote: { paddingRight: 8 },
  submit: {
    alignItems: 'center',
    borderRadius: 24,
    justifyContent: 'center',
    marginTop: 4,
    minHeight: 50,
  },
  submitContent: { alignItems: 'center', flexDirection: 'row', gap: 8, justifyContent: 'center' },
  submitText: { fontFamily: AppFonts.semibold, fontSize: 15 },
});
