import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import {
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import Animated, { FadeIn, FadeOut, ReduceMotion, useReducedMotion } from 'react-native-reanimated';
import { z } from 'zod';

import { MotionPressable } from '@/components/motion-pressable';
import { PhoenixLogo } from '@/components/phoenix-logo';
import { AppFonts, MaxContentWidth, useAppColors } from '@/constants/theme';
import { haptics } from '@/lib/haptics';
import { createInstanceId, createPhoenixClient, normalizePhoenixUrl } from '@/lib/phoenix';
import { useInstanceStore } from '@/store/instances';
import type { PhoenixInstance } from '@/types/instance';

const connectionSchema = z.object({
  name: z.string().trim().max(60, 'Use 60 characters or fewer.'),
  host: z.string().trim().min(1, 'Enter a Phoenix host and port.'),
});

type ConnectionForm = z.infer<typeof connectionSchema>;

export default function NewInstanceScreen() {
  const colors = useAppColors();
  const reduceMotion = useReducedMotion();
  const [connectionStatus, setConnectionStatus] = useState<'idle' | 'verifying' | 'success'>('idle');
  const addInstance = useInstanceStore((state) => state.addInstance);
  const {
    control,
    handleSubmit,
    formState: { errors },
    setError,
  } = useForm<ConnectionForm>({
    resolver: zodResolver(connectionSchema),
    defaultValues: { host: '', name: '' },
  });

  const connect = useMutation({
    onMutate: () => setConnectionStatus('verifying'),
    mutationFn: async (values: ConnectionForm) => {
      let baseUrl: string;
      try {
        baseUrl = normalizePhoenixUrl(values.host);
      } catch {
        throw new Error('Enter a valid host, such as 192.168.1.10:6006.');
      }

      const url = new URL(baseUrl);
      const instance: PhoenixInstance = {
        id: createInstanceId(),
        name: values.name || url.host,
        baseUrl,
        auth: { type: 'none' },
        createdAt: new Date().toISOString(),
      };

      await createPhoenixClient(instance).getServerVersion();
      return instance;
    },
    onSuccess: async (instance) => {
      setConnectionStatus('success');
      haptics.success();
      addInstance(instance);
      if (!reduceMotion) await new Promise((resolve) => setTimeout(resolve, 480));
      router.replace({ pathname: '/instances/[id]', params: { id: instance.id } });
    },
    onError: (error) => {
      setConnectionStatus('idle');
      haptics.error();
      setError('root', { message: getConnectionError(error) });
    },
  });

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      style={[styles.screen, { backgroundColor: colors.background }]}>
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled">
        <View style={styles.content}>
          <View style={styles.heading}>
            <View style={styles.connectionType}>
              <PhoenixLogo size={25} />
              <Text style={[styles.connectionTypeText, { color: colors.brand }]}>Unauthenticated connection</Text>
            </View>
            <Text style={[styles.title, { color: colors.text }]}>Connect your Phoenix</Text>
            <Text style={[styles.subtitle, { color: colors.textSecondary }]}>
              Enter the address of a running instance. We’ll verify it before anything is saved.
            </Text>
          </View>

          <View style={styles.form}>
            <Controller
              control={control}
              name="host"
              render={({ field: { onBlur, onChange, value } }) => (
                <View style={styles.field}>
                  <Text style={[styles.label, { color: colors.text }]}>Host and port</Text>
                  <TextInput
                    accessibilityLabel="Phoenix host and port"
                    autoCapitalize="none"
                    autoCorrect={false}
                    keyboardType="url"
                    onBlur={onBlur}
                    onChangeText={onChange}
                    placeholder="192.168.1.10:6006"
                    placeholderTextColor={colors.textSecondary}
                    style={[
                      styles.input,
                      {
                        backgroundColor: colors.backgroundSelected,
                        borderColor: errors.host ? colors.danger : colors.border,
                        color: colors.text,
                      },
                    ]}
                    value={value}
                  />
                  {errors.host && <Text style={[styles.error, { color: colors.danger }]}>{errors.host.message}</Text>}
                </View>
              )}
            />

            <Controller
              control={control}
              name="name"
              render={({ field: { onBlur, onChange, value } }) => (
                <View style={styles.field}>
                  <Text style={[styles.label, { color: colors.text }]}>Display name</Text>
                  <TextInput
                    accessibilityLabel="Display name"
                    autoCapitalize="words"
                    onBlur={onBlur}
                    onChangeText={onChange}
                    placeholder="Local Phoenix (optional)"
                    placeholderTextColor={colors.textSecondary}
                    style={[
                      styles.input,
                      {
                        backgroundColor: colors.backgroundSelected,
                        borderColor: errors.name ? colors.danger : colors.border,
                        color: colors.text,
                      },
                    ]}
                    value={value}
                  />
                  {errors.name && <Text style={[styles.error, { color: colors.danger }]}>{errors.name.message}</Text>}
                </View>
              )}
            />

            <View style={[styles.notice, { backgroundColor: colors.backgroundSelected, borderColor: colors.border }]}>
              <View style={styles.noticeHeader}>
                <Text style={[styles.noticeTitle, { color: colors.text }]}>Authentication</Text>
                <View style={[styles.soonBadge, { backgroundColor: colors.accentSoft }]}>
                  <Text style={[styles.soonBadgeText, { color: colors.brand }]}>COMING SOON</Text>
                </View>
              </View>
              <Text style={[styles.noticeCopy, { color: colors.textSecondary }]}>
                OAuth 2 connections are next. For now, connect to an instance with authentication disabled.
              </Text>
            </View>

            {errors.root && <Text style={[styles.rootError, { color: colors.danger }]}>{errors.root.message}</Text>}

            <MotionPressable
              accessibilityLabel={connectionStatus === 'idle' ? 'Verify and connect' : 'Verifying Phoenix server'}
              accessibilityRole="button"
              disabled={connect.isPending}
              onPress={handleSubmit((values) => connect.mutate(values))}
              style={[styles.submit, { backgroundColor: colors.accent, opacity: connect.isPending ? 0.9 : 1 }]}>
              <Animated.View
                key={connectionStatus}
                entering={FadeIn.duration(160).reduceMotion(ReduceMotion.System)}
                exiting={FadeOut.duration(100).reduceMotion(ReduceMotion.System)}
                style={styles.submitContent}>
                {connectionStatus === 'verifying' && <PhoenixLogo loading size={25} />}
                {connectionStatus === 'success' && (
                  <View style={[styles.successIcon, { backgroundColor: colors.success }]}>
                    <Text style={styles.successIconText}>✓</Text>
                  </View>
                )}
                <Text style={[styles.submitText, { color: colors.accentForeground }]}>
                  {connectionStatus === 'verifying'
                    ? 'Verifying Phoenix…'
                    : connectionStatus === 'success'
                      ? 'Connected'
                      : 'Verify and connect'}
                </Text>
              </Animated.View>
            </MotionPressable>
          </View>

          <View style={styles.deviceNoteRow}>
            <View style={[styles.deviceNoteDot, { backgroundColor: colors.brand }]} />
            <Text style={[styles.deviceNote, { color: colors.textSecondary }]}>
              On a physical device, use your computer’s LAN address instead of localhost.
            </Text>
          </View>
        </View>
      </ScrollView>
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
  content: {
    alignSelf: 'center',
    gap: 28,
    maxWidth: MaxContentWidth,
    padding: 20,
    width: '100%',
  },
  heading: { gap: 10, paddingBottom: 4 },
  connectionType: { alignItems: 'center', flexDirection: 'row', gap: 8 },
  connectionTypeText: { fontFamily: AppFonts.medium, fontSize: 13 },
  title: { fontFamily: AppFonts.semibold, fontSize: 34, letterSpacing: -1.3, lineHeight: 39 },
  subtitle: { fontFamily: AppFonts.regular, fontSize: 16, lineHeight: 24, maxWidth: 420 },
  form: { gap: 22 },
  field: { gap: 9 },
  label: { fontFamily: AppFonts.medium, fontSize: 14 },
  input: { borderRadius: 15, borderWidth: 1, fontFamily: AppFonts.regular, fontSize: 16, minHeight: 56, paddingHorizontal: 16 },
  error: { fontFamily: AppFonts.regular, fontSize: 14 },
  notice: { borderRadius: 16, borderWidth: 1, gap: 9, padding: 16 },
  noticeHeader: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between' },
  noticeTitle: { fontFamily: AppFonts.semibold, fontSize: 14 },
  soonBadge: { borderRadius: 5, paddingHorizontal: 7, paddingVertical: 4 },
  soonBadgeText: { fontFamily: AppFonts.medium, fontSize: 9, letterSpacing: 0.9 },
  noticeCopy: { fontFamily: AppFonts.regular, fontSize: 14, lineHeight: 21 },
  rootError: { fontFamily: AppFonts.regular, fontSize: 14, lineHeight: 21 },
  submit: { alignItems: 'center', borderRadius: 15, justifyContent: 'center', minHeight: 54 },
  submitContent: { alignItems: 'center', flexDirection: 'row', gap: 9, justifyContent: 'center' },
  submitText: { fontFamily: AppFonts.semibold, fontSize: 15 },
  successIcon: { alignItems: 'center', borderRadius: 10, height: 20, justifyContent: 'center', width: 20 },
  successIconText: { color: '#FFFFFF', fontFamily: AppFonts.semibold, fontSize: 12 },
  deviceNoteRow: { alignItems: 'flex-start', flexDirection: 'row', gap: 10, justifyContent: 'center', paddingHorizontal: 12 },
  deviceNoteDot: { borderRadius: 3, height: 6, marginTop: 7, width: 6 },
  deviceNote: { flex: 1, fontFamily: AppFonts.regular, fontSize: 13, lineHeight: 20, maxWidth: 340 },
});
