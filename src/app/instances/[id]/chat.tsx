import { router, useLocalSearchParams } from 'expo-router';
import { StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { PxiChat } from '@/components/chat/pxi-chat';
import { EmptyState } from '@/components/ui/empty-state';
import { useAppColors } from '@/constants/theme';
import { useInstanceStore } from '@/store/instances';

export default function PxiChatScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const colors = useAppColors();

  const instance = useInstanceStore((state) =>
    state.instances.find((candidate) => candidate.id === id),
  );

  if (!instance) {
    return (
      <SafeAreaView style={[styles.screen, { backgroundColor: colors.background }]}>
        <EmptyState
          action={{ label: 'Return home', onPress: () => router.replace('/') }}
          message="This Phoenix connection is no longer on this device."
          symbol={{ ios: 'questionmark.circle', android: 'help', web: 'help' }}
          title="Instance not found"
        />
      </SafeAreaView>
    );
  }

  const closeChat = () => {
    if (router.canGoBack()) router.back();
    else router.replace('/');
  };

  return <PxiChat instance={instance} onClose={closeChat} presentation="screen" />;
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
});
