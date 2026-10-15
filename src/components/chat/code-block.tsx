import { Highlight } from 'prism-react-renderer';
import type { ComponentProps, ReactNode } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';

import { codeColors, createPrismTheme } from '@/constants/code-theme';
import { Colors, Fonts, useAppColors } from '@/constants/theme';

const MAX_CODE_LENGTH = 40_000;

/**
 * Fenced code with Phoenix's Pierre syntax colors and Geist Mono. Mirrors the
 * `JsonBlock` chrome so mixed replies read as one surface.
 */
export function CodeBlock({
  code,
  language,
  onInteraction,
}: {
  code: string;
  language: string;
  onInteraction?: () => void;
}) {
  const colors = useAppColors();
  const dark = colors.background === Colors.dark.background;
  const theme = createPrismTheme(codeColors(dark), colors.text);
  const truncated = code.length > MAX_CODE_LENGTH;
  const source = truncated ? `${code.slice(0, MAX_CODE_LENGTH)}\n…` : code;
  const label = language.length > 0 ? language.toUpperCase() : 'CODE';

  return (
    <View
      accessibilityLabel={`${label} code`}
      style={[
        styles.block,
        { backgroundColor: colors.backgroundElement, borderColor: colors.border },
      ]}
    >
      <View
        style={[
          styles.header,
          { backgroundColor: colors.backgroundSelected, borderBottomColor: colors.border },
        ]}
      >
        <Text style={[styles.language, { color: colors.textSecondary }]}>{label}</Text>
        {truncated ? (
          <Text style={[styles.truncated, { color: colors.textSecondary }]}>Truncated</Text>
        ) : null}
      </View>
      <ScrollView
        contentContainerStyle={styles.content}
        horizontal
        nestedScrollEnabled
        onScrollBeginDrag={onInteraction}
        showsHorizontalScrollIndicator
      >
        <Highlight code={source} language={language || 'text'} theme={theme}>
          {({ tokens, getTokenProps }) => (
            <View>{renderLines(tokens, getTokenProps, colors.text)}</View>
          )}
        </Highlight>
      </ScrollView>
    </View>
  );
}

type RenderProps = Parameters<NonNullable<ComponentProps<typeof Highlight>['children']>>[0];

// Lines and tokens are keyed by their character offset in the source, which is
// stable for a given code string and unique within it.
function renderLines(
  tokens: RenderProps['tokens'],
  getTokenProps: RenderProps['getTokenProps'],
  foreground: string,
): ReactNode[] {
  const lines: ReactNode[] = [];
  let lineOffset = 0;

  for (const line of tokens) {
    const spans: ReactNode[] = [];
    let column = 0;

    for (const token of line) {
      // Blank lines arrive as a single empty "\n" token and lines may start with a
      // zero-length token; neither should render or advance the key offset.
      if (token.empty === true || token.content.length === 0) continue;

      // Prism tags decorators and some interpolations as `punctuation` last, which
      // would override their semantic color; keep punctuation only when it is the
      // whole story.
      const semanticTypes = token.types.filter((type) => type !== 'punctuation');

      const { style, children } = getTokenProps({
        token: semanticTypes.length > 0 ? { ...token, types: semanticTypes } : token,
      });

      spans.push(
        <Text
          key={column}
          style={[
            style?.color != null ? { color: String(style.color) } : null,
            style?.fontStyle === 'italic' ? styles.italic : null,
            style?.fontWeight === 'bold' ? styles.bold : null,
            style?.textDecorationLine === 'underline' ? styles.underline : null,
            style?.textDecorationLine === 'line-through' ? styles.strike : null,
          ]}
        >
          {children}
        </Text>,
      );
      column += token.content.length;
    }

    lines.push(
      <Text key={lineOffset} style={[styles.line, { color: foreground }]}>
        {spans.length === 0 ? ' ' : spans}
      </Text>,
    );
    lineOffset += column + 1;
  }

  return lines;
}

const styles = StyleSheet.create({
  block: { borderRadius: 11, borderWidth: 1, marginBottom: 12, overflow: 'hidden' },
  header: {
    alignItems: 'center',
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    justifyContent: 'space-between',
    minHeight: 32,
    paddingHorizontal: 11,
  },
  language: { fontFamily: Fonts.mono, fontSize: 10, letterSpacing: 0.7 },
  truncated: { fontFamily: Fonts.mono, fontSize: 10 },
  content: { minWidth: '100%', padding: 12 },
  line: { fontFamily: Fonts.mono, fontSize: 13, lineHeight: 20 },
  italic: { fontStyle: 'italic' },
  bold: { fontFamily: Fonts.monoMedium },
  underline: { textDecorationLine: 'underline' },
  strike: { textDecorationLine: 'line-through' },
});
