import { Alert, Platform } from 'react-native';

export function confirmAction({
  confirmLabel,
  message,
  onConfirm,
  title,
}: {
  confirmLabel: string;
  message: string;
  onConfirm: () => void | Promise<void>;
  title: string;
}) {
  if (Platform.OS === 'web' && typeof window !== 'undefined') {
    if (window.confirm(`${title}\n\n${message}`)) void onConfirm();
    return;
  }

  Alert.alert(title, message, [
    { text: 'Cancel', style: 'cancel' },
    { text: confirmLabel, style: 'destructive', onPress: () => void onConfirm() },
  ]);
}
