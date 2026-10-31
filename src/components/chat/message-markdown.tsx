import {
  MarkdownStream,
  type MarkdownStyleMap,
  type RenderRules,
} from '@ronradtke/react-native-markdown-display';
import * as WebBrowser from 'expo-web-browser';
import { ScrollView, StyleSheet, View } from 'react-native';

import { CodeBlock } from '@/components/chat/code-block';
import { JsonBlock } from '@/components/json-block';
import { AppFonts, Colors, Fonts, Type, useAppColors } from '@/constants/theme';
import { isJsonString } from '@/lib/json';

export function MessageMarkdown({
  onInteraction,
  streaming,
  text,
}: {
  onInteraction?: () => void;
  streaming: boolean;
  text: string;
}) {
  const colors = useAppColors();
  const dark = colors.text === Colors.dark.text;

  // Blocks take the full column explicitly, and heading text may shrink inside
  // its row, so long headings and inline code wrap instead of running off screen.
  const markdownStyles: MarkdownStyleMap = {
    body: {
      color: colors.text,
      fontFamily: AppFonts.regular,
      fontSize: 16,
      lineHeight: 25,
      width: '100%',
    },
    textgroup: { flexShrink: 1 },
    paragraph: { marginBottom: 12, marginTop: 0 },
    heading1: { ...Type.title, color: colors.text, marginBottom: 8, marginTop: 10 },
    heading2: {
      color: colors.text,
      fontFamily: AppFonts.semibold,
      fontSize: 19,
      letterSpacing: -0.3,
      lineHeight: 25,
      marginBottom: 8,
      marginTop: 10,
    },
    heading3: {
      color: colors.text,
      fontFamily: AppFonts.semibold,
      fontSize: 17,
      lineHeight: 23,
      marginBottom: 6,
      marginTop: 8,
    },
    heading4: { ...Type.headline, color: colors.text, marginBottom: 6, marginTop: 8 },
    heading5: { ...Type.headline, color: colors.text, marginBottom: 4, marginTop: 6 },
    heading6: { ...Type.label, color: colors.textSecondary, marginBottom: 4, marginTop: 6 },
    strong: { fontFamily: AppFonts.semibold },
    em: { fontStyle: 'italic' },
    // Links stay monochrome; the underline is what marks them.
    link: {
      color: colors.text,
      textDecorationColor: colors.textTertiary,
      textDecorationLine: 'underline',
    },
    blocklink: { borderColor: colors.separator },
    bullet_list: { marginBottom: 10, marginTop: 2, width: '100%' },
    ordered_list: { marginBottom: 10, marginTop: 2, width: '100%' },
    bullet_list_icon: { color: colors.textTertiary, marginLeft: 2, marginRight: 10 },
    ordered_list_icon: {
      color: colors.textTertiary,
      fontFamily: Fonts.mono,
      fontVariant: ['tabular-nums'],
      marginLeft: 2,
      marginRight: 10,
    },
    list_item: { marginBottom: 4, width: '100%' },
    blockquote: {
      backgroundColor: 'transparent',
      borderColor: colors.border,
      borderLeftWidth: 2,
      marginBottom: 12,
      marginLeft: 0,
      paddingLeft: 12,
      paddingVertical: 2,
      width: '100%',
    },
    code_inline: {
      backgroundColor: colors.backgroundSelected,
      borderColor: colors.border,
      borderRadius: 5,
      borderWidth: StyleSheet.hairlineWidth,
      color: colors.text,
      fontFamily: Fonts.mono,
      fontSize: 14,
      paddingHorizontal: 4,
      paddingVertical: 1,
    },
    code_block: {
      backgroundColor: colors.backgroundElement,
      borderColor: colors.border,
      borderRadius: 12,
      borderWidth: StyleSheet.hairlineWidth,
      color: colors.text,
      fontFamily: Fonts.mono,
      fontSize: 13,
      lineHeight: 20,
      padding: 12,
    },
    fence: {
      borderColor: colors.border,
      borderRadius: 12,
      borderWidth: StyleSheet.hairlineWidth,
      marginBottom: 12,
      width: '100%',
    },
    fence_header: {
      borderBottomColor: colors.separator,
      paddingHorizontal: 12,
      paddingVertical: 7,
    },
    fence_language_label: { color: colors.textTertiary, fontFamily: Fonts.mono, fontSize: 11 },
    fence_code: { backgroundColor: colors.backgroundElement, padding: 12 },
    fence_token: { fontFamily: Fonts.mono, fontSize: 13, lineHeight: 20 },
    table: { borderColor: colors.border, borderRadius: 10, borderWidth: StyleSheet.hairlineWidth },
    tr: { borderBottomColor: colors.separator, borderBottomWidth: StyleSheet.hairlineWidth },
    // Columns share the width and wrap; the minimum keeps many-column tables
    // legible by letting the table scroll sideways instead of crushing cells.
    th: { minWidth: 112, padding: 8 },
    td: { minWidth: 112, padding: 8 },
    hr: { backgroundColor: colors.separator, height: StyleSheet.hairlineWidth, marginVertical: 16 },
  };

  const rules = createRules(onInteraction);

  return (
    <MarkdownStream
      colorScheme={dark ? 'dark' : 'light'}
      cursorColor={colors.brand}
      onLinkPress={(url) => {
        onInteraction?.();

        return openMarkdownLink(url);
      }}
      rules={rules}
      streaming={streaming}
      style={markdownStyles}
    >
      {text}
    </MarkdownStream>
  );
}

function createRules(onInteraction: (() => void) | undefined): RenderRules {
  return {
    table: (node, children, _parents, styles) => (
      <ScrollView
        contentContainerStyle={tableStyles.content}
        horizontal
        key={node.key}
        nestedScrollEnabled
        onScrollBeginDrag={onInteraction}
        showsHorizontalScrollIndicator
        style={tableStyles.scroller}
      >
        <View style={[tableStyles.table, styles.table]}>{children}</View>
      </ScrollView>
    ),
    code_block: (node) => {
      if (looksLikeJson(node.content))
        return <JsonBlock key={node.key} onInteraction={onInteraction} value={node.content} />;

      return (
        <CodeBlock
          code={trimTrailingNewline(node.content)}
          key={node.key}
          language=""
          onInteraction={onInteraction}
        />
      );
    },
    fence: (node) => {
      const language = isJsonString(node.sourceInfo)
        ? (node.sourceInfo.trim().split(/\s+/)[0]?.toLowerCase() ?? '')
        : '';

      if (language === 'json' || language === 'jsonc') {
        return <JsonBlock key={node.key} onInteraction={onInteraction} value={node.content} />;
      }

      return (
        <CodeBlock
          code={trimTrailingNewline(node.content)}
          key={node.key}
          language={language}
          onInteraction={onInteraction}
        />
      );
    },
  };
}

const tableStyles = StyleSheet.create({
  scroller: { marginBottom: 12, width: '100%' },
  // Narrow tables stretch to the text column; wider ones overflow into the scroll.
  content: { minWidth: '100%' },
  table: { flexGrow: 1 },
});

function trimTrailingNewline(value: string) {
  return value.endsWith('\n') ? value.slice(0, -1) : value;
}

function looksLikeJson(value: string) {
  const trimmed = value.trim();

  if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) return false;

  try {
    JSON.parse(trimmed);

    return true;
  } catch {
    return false;
  }
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
