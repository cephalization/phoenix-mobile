import { Alert } from 'react-native';

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
  Alert.alert(title, message, [
    { text: 'Cancel', style: 'cancel' },
    { text: confirmLabel, style: 'destructive', onPress: () => void onConfirm() },
  ]);
}
