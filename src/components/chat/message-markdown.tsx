import { MarkdownStream, type MarkdownStyleMap } from '@ronradtke/react-native-markdown-display';
import * as WebBrowser from 'expo-web-browser';
import { Platform } from 'react-native';

import { AppFonts, Colors, useAppColors } from '@/constants/theme';

const monoFont = Platform.select({
  ios: 'SFMono-Regular',
  android: 'monospace',
  web: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
});

export function MessageMarkdown({ onInteraction, streaming, text }: { onInteraction?: () => void; streaming: boolean; text: string }) {
  const colors = useAppColors();
  const dark = colors.background === Colors.dark.background;
  const markdownStyles: MarkdownStyleMap = {
    body: {
      color: colors.text,
      fontFamily: AppFonts.regular,
      fontSize: 16,
      lineHeight: 26,
    },
    paragraph: { marginBottom: 12, marginTop: 0 },
    heading1: { color: colors.text, fontFamily: AppFonts.semibold, fontSize: 24, lineHeight: 31, marginBottom: 10, marginTop: 8 },
    heading2: { color: colors.text, fontFamily: AppFonts.semibold, fontSize: 21, lineHeight: 28, marginBottom: 9, marginTop: 8 },
    heading3: { color: colors.text, fontFamily: AppFonts.semibold, fontSize: 18, lineHeight: 25, marginBottom: 8, marginTop: 6 },
    heading4: { color: colors.text, fontFamily: AppFonts.semibold, fontSize: 16, lineHeight: 24, marginBottom: 7, marginTop: 6 },
    heading5: { color: colors.text, fontFamily: AppFonts.semibold, fontSize: 15, lineHeight: 22 },
    heading6: { color: colors.textSecondary, fontFamily: AppFonts.semibold, fontSize: 14, lineHeight: 21 },
    strong: { fontFamily: AppFonts.semibold },
    em: { fontStyle: 'italic' },
    link: { color: colors.brand, textDecorationLine: 'underline' },
    blocklink: { borderColor: colors.border },
    bullet_list: { marginBottom: 10, marginTop: 2 },
    ordered_list: { marginBottom: 10, marginTop: 2 },
    bullet_list_icon: { color: colors.textSecondary, marginLeft: 3, marginRight: 10 },
    ordered_list_icon: { color: colors.textSecondary, marginLeft: 3, marginRight: 10 },
    list_item: { marginBottom: 4 },
    blockquote: {
      backgroundColor: colors.backgroundSelected,
      borderColor: colors.brandSecondary,
      borderLeftWidth: 3,
      borderRadius: 8,
      marginBottom: 12,
      marginLeft: 0,
      paddingHorizontal: 12,
      paddingVertical: 8,
    },
    code_inline: {
      backgroundColor: colors.backgroundSelected,
      borderColor: colors.border,
      borderRadius: 5,
      borderWidth: 1,
      color: colors.text,
      fontFamily: monoFont,
      fontSize: 14,
      paddingHorizontal: 5,
      paddingVertical: 2,
    },
    code_block: {
      backgroundColor: colors.backgroundElement,
      borderColor: colors.border,
      borderRadius: 10,
      borderWidth: 1,
      color: colors.text,
      fontFamily: monoFont,
      fontSize: 13,
      lineHeight: 20,
      padding: 12,
    },
    fence: { borderColor: colors.border, borderRadius: 10, borderWidth: 1, marginBottom: 12 },
    fence_header: { backgroundColor: colors.backgroundSelected, borderBottomColor: colors.border, paddingHorizontal: 12, paddingVertical: 7 },
    fence_language_label: { color: colors.textSecondary, fontFamily: monoFont, fontSize: 11 },
    fence_code: { backgroundColor: colors.backgroundElement, padding: 12 },
    fence_token: { fontFamily: monoFont, fontSize: 13, lineHeight: 20 },
    table: { borderColor: colors.border, borderRadius: 8, borderWidth: 1, marginBottom: 12 },
    tr: { borderBottomColor: colors.border, borderBottomWidth: 1 },
    th: { backgroundColor: colors.backgroundSelected, padding: 8 },
    td: { padding: 8 },
    hr: { backgroundColor: colors.border, height: 1, marginVertical: 14 },
  };

  return (
    <MarkdownStream
      colorScheme={dark ? 'dark' : 'light'}
      cursorColor={colors.brand}
      onLinkPress={(url) => {
        onInteraction?.();
        return openMarkdownLink(url);
      }}
      streaming={streaming}
      style={markdownStyles}>
      {text}
    </MarkdownStream>
  );
}

function openMarkdownLink(url: string): boolean {
  try {
    const protocol = new URL(url).protocol;
    if (protocol === 'http:' || protocol === 'https:') void WebBrowser.openBrowserAsync(url);
  } catch {
    // Suppress malformed and non-web links emitted by model output.
  }
  return true;
}
