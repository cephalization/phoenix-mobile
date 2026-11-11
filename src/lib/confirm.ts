import { Alert } from 'react-native';

export function confirmAction({
  confirmLabel,
  message,
  onCancel,
  onConfirm,
  title,
}: {
  confirmLabel: string;
  message: string;
  onCancel?: () => void;
  onConfirm: () => void | Promise<void>;
  title: string;
}) {
  Alert.alert(
    title,
    message,
    [
      { text: 'Cancel', style: 'cancel', onPress: onCancel },
      { text: confirmLabel, style: 'destructive', onPress: () => void onConfirm() },
    ],
    { onDismiss: onCancel },
  );
}
