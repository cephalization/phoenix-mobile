import { router, useLocalSearchParams } from 'expo-router';
import { StyleSheet, Text } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { PxiChat } from '@/components/chat/pxi-chat';
import { MotionPressable } from '@/components/motion-pressable';
import { AppFonts, Spacing, useAppColors } from '@/constants/theme';
import { useInstanceStore } from '@/store/instances';

export default function PxiChatScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const colors = useAppColors();

  const instance = useInstanceStore((state) =>
    state.instances.find((candidate) => candidate.id === id),
  );

  if (!instance) {
    return (
      <SafeAreaView style={[styles.center, { backgroundColor: colors.background }]}>
        <Text style={[styles.stateTitle, { color: colors.text }]}>Instance not found</Text>
        <MotionPressable onPress={() => router.replace('/')}>
          <Text style={[styles.link, { color: colors.brand }]}>Return home</Text>
        </MotionPressable>
      </SafeAreaView>
    );
  }

  const closeChat = () => {
    if (router.canGoBack()) router.back();
    else router.replace({ pathname: '/instances/[id]', params: { id: instance.id } });
  };

  return <PxiChat instance={instance} onClose={closeChat} presentation="screen" />;
}

const styles = StyleSheet.create({
  center: { alignItems: 'center', flex: 1, gap: Spacing.two, justifyContent: 'center' },
  stateTitle: { fontFamily: AppFonts.semibold, fontSize: 20, textAlign: 'center' },
  link: { fontFamily: AppFonts.medium, fontSize: 14 },
});
