import { isToolUIPart } from 'ai';
import * as Clipboard from 'expo-clipboard';
import { SymbolView, type SymbolViewProps } from 'expo-symbols';
import * as WebBrowser from 'expo-web-browser';
import { useState } from 'react';
import { ActivityIndicator, Share, StyleSheet, Text, View } from 'react-native';

import { MessageMarkdown } from '@/components/chat/message-markdown';
import { isJsonBlockValue, JsonBlock } from '@/components/json-block';
import { MotionPressable } from '@/components/motion-pressable';
import { NativeContextMenu, type NativeContextMenuAction } from '@/components/native-context-menu';
import { AppFonts, Type, useAppColors } from '@/constants/theme';
import type { PxiMessage } from '@/features/pxi/types';
import { haptics } from '@/lib/haptics';
import { isJsonObject, isJsonString, isJsonValue, type JsonValue } from '@/lib/json';

const TEXT_MENU_ACTIONS: NativeContextMenuAction[] = [
  { id: 'copy', systemImage: 'doc.on.doc', title: 'Copy' },
  { id: 'share', systemImage: 'square.and.arrow.up', title: 'Share' },
];

function handleTextMenuAction(id: string, text: string, onInteraction?: () => void) {
  onInteraction?.();

  if (id === 'copy') {
    void Clipboard.setStringAsync(text).then(haptics.success);
  } else if (id === 'share') {
    void Share.share({ message: text });
  }
}

function titleCase(value: string): string {
  return value
    .replace(/^tool-/, '')
    .replace(/[_-]+/g, ' ')
    .replace(/\b\w/g, (letter) => letter.toUpperCase())
    .replace(
      /\b(Graphql|Pxi|Api|Url|Sql)\b/g,
      (word) =>
        ({
          Graphql: 'GraphQL',
          Pxi: 'PXI',
          Api: 'API',
          Url: 'URL',
          Sql: 'SQL',
        })[word] ?? word,
    );
}

function serialize(value: JsonValue): string {
  if (isJsonString(value)) return value;

  try {
    const result = JSON.stringify(value, null, 2);

    return result.length > 1_800 ? `${result.slice(0, 1_800)}\n…` : result;
  } catch {
    return 'Result is not displayable.';
  }
}

function getToolPreview(input: JsonValue | undefined): string {
  const fields = [
    'summary',
    'description',
    'query',
    'operationName',
    'skill_name',
    'resource_name',
    'name',
    'path',
    'url',
    'prompt',
    'text',
    'command',
  ];

  const record = isJsonObject(input) ? input : null;

  const value = isJsonString(input)
    ? input
    : fields.map((field) => record?.[field]).find(isJsonString);

  if (value === undefined) return '';
  const preview = value.replace(/\s+/g, ' ').trim();

  return preview.length > 120 ? `${preview.slice(0, 119).trimEnd()}…` : preview;
}

const TOOL_LABELS = new Map<string, [running: string, complete: string]>([
  ['bash', ['Running command', 'Ran command']],
  ['call_subagent', ['Starting subagent', 'Started subagent']],
  ['execute', ['Running Phoenix query', 'Ran Phoenix query']],
  ['executeSql', ['Running analytics query', 'Ran analytics query']],
  ['get_schemas', ['Reading tool schemas', 'Read tool schemas']],
  ['get_tags', ['Browsing Phoenix tools', 'Browsed Phoenix tools']],
  ['graphql', ['Querying Phoenix', 'Queried Phoenix']],
  ['graphql_query', ['Querying Phoenix', 'Queried Phoenix']],
  ['issue_read', ['Reading GitHub issue', 'Read GitHub issue']],
  ['list_issues', ['Listing GitHub issues', 'Listed GitHub issues']],
  ['list_tools', ['Listing Phoenix tools', 'Listed Phoenix tools']],
  ['load_skill', ['Loading skill', 'Loaded skill']],
  ['load_skill_reference', ['Reading skill reference', 'Read skill reference']],
  ['read', ['Reading file', 'Read file']],
  ['read_skill_resource', ['Reading skill resource', 'Read skill resource']],
  ['search', ['Searching Phoenix tools', 'Searched Phoenix tools']],
  ['search_issues', ['Searching GitHub issues', 'Searched GitHub issues']],
  ['web_fetch', ['Fetching page', 'Fetched page']],
  ['web_search', ['Searching the web', 'Searched the web']],
]);

function getToolLabel(toolName: string, complete: boolean): string {
  const label = TOOL_LABELS.get(toolName);

  return label ? label[complete ? 1 : 0] : titleCase(toolName);
}

type SymbolName = SymbolViewProps['name'];

const Symbols = {
  check: { ios: 'checkmark', android: 'check', web: 'check' },
  failed: { ios: 'exclamationmark.triangle.fill', android: 'warning', web: 'warning' },
  denied: { ios: 'minus.circle', android: 'block', web: 'block' },
  approval: { ios: 'questionmark.circle', android: 'help', web: 'help' },
  expand: { ios: 'chevron.down', android: 'keyboard_arrow_down', web: 'keyboard_arrow_down' },
  collapsed: { ios: 'chevron.right', android: 'chevron_right', web: 'chevron_right' },
  copy: { ios: 'doc.on.doc', android: 'content_copy', web: 'content_copy' },
  trace: { ios: 'arrow.up.right', android: 'north_east', web: 'north_east' },
  link: { ios: 'link', android: 'link', web: 'link' },
  file: { ios: 'doc', android: 'description', web: 'description' },
  update: { ios: 'arrow.triangle.2.circlepath', android: 'sync', web: 'sync' },
} satisfies Record<string, SymbolName>;

/**
 * A tool call as one quiet line: status, what PXI did, and the call's gist in
 * monospace. Tapping it unfolds the input and result.
 */
function ToolPart({
  onInteraction,
  part,
}: {
  onInteraction?: () => void;
  part: PxiMessage['parts'][number];
}) {
  const colors = useAppColors();
  const [expanded, setExpanded] = useState(false);

  if (!isToolUIPart(part)) return null;

  const toolName = (part.type === 'dynamic-tool' ? part.toolName : part.type).replace(/^tool-/, '');
  const complete = part.state === 'output-available';
  const failed = part.state === 'output-error';
  const approval = part.state === 'approval-requested';
  const denied = part.state === 'output-denied';
  // Tool payloads arrive from the UI message stream as parsed JSON; anything else is not shown.
  const input = isJsonValue(part.input) ? part.input : undefined;
  const output = complete && isJsonValue(part.output) ? part.output : undefined;
  const preview = getToolPreview(input);
  const inputRecord = isJsonObject(input) ? input : null;
  const outputRecord = isJsonObject(output) ? output : null;

  const command =
    toolName === 'bash' && inputRecord !== null && isJsonString(inputRecord.command)
      ? inputRecord.command
      : undefined;

  const stdout =
    toolName === 'bash' && outputRecord !== null && isJsonString(outputRecord.stdout)
      ? outputRecord.stdout
      : undefined;

  const stderr =
    toolName === 'bash' &&
    outputRecord !== null &&
    isJsonString(outputRecord.stderr) &&
    outputRecord.stderr.trim()
      ? outputRecord.stderr
      : undefined;

  const error = failed && 'errorText' in part ? part.errorText : stderr;
  const detailInput = command ?? input;
  const detailOutput = stdout ?? output;

  const hasDetails =
    detailInput !== undefined || (complete && detailOutput !== undefined) || error !== undefined;

  const label = getToolLabel(toolName, complete);

  const stateLabel = failed
    ? 'Failed'
    : denied
      ? 'Denied'
      : approval
        ? 'Needs approval'
        : complete
          ? ''
          : 'Running';

  return (
    <View>
      <MotionPressable
        accessibilityHint={hasDetails ? 'Shows the tool’s input and result' : undefined}
        accessibilityLabel={[label, preview, stateLabel].filter(Boolean).join(', ')}
        accessibilityRole="button"
        accessibilityState={{ disabled: !hasDetails, expanded }}
        disabled={!hasDetails}
        hitSlop={{ bottom: 6, top: 6 }}
        onPress={() => {
          onInteraction?.();
          setExpanded((value) => !value);
        }}
        scaleTo={0.99}
        style={styles.toolRow}
      >
        <View style={styles.toolSymbol}>
          {complete ? (
            <SymbolView
              name={Symbols.check}
              size={11}
              tintColor={colors.textTertiary}
              weight="bold"
            />
          ) : failed ? (
            <SymbolView name={Symbols.failed} size={12} tintColor={colors.danger} />
          ) : denied ? (
            <SymbolView name={Symbols.denied} size={12} tintColor={colors.textTertiary} />
          ) : approval ? (
            <SymbolView name={Symbols.approval} size={12} tintColor={colors.text} />
          ) : (
            <ActivityIndicator
              color={colors.textTertiary}
              size="small"
              style={styles.toolSpinner}
            />
          )}
        </View>
        <Text
          numberOfLines={1}
          style={[Type.subhead, styles.toolLabel, { color: colors.textSecondary }]}
        >
          {label}
        </Text>
        <Text
          numberOfLines={1}
          style={[Type.mono, styles.toolPreview, { color: colors.textTertiary }]}
        >
          {preview}
        </Text>
        {stateLabel ? (
          <Text style={[Type.label, { color: failed ? colors.danger : colors.textTertiary }]}>
            {stateLabel}
          </Text>
        ) : null}
        {hasDetails ? (
          <SymbolView
            name={expanded ? Symbols.expand : Symbols.collapsed}
            size={10}
            tintColor={colors.textTertiary}
            weight="semibold"
          />
        ) : null}
      </MotionPressable>
      {expanded && hasDetails ? (
        <View style={styles.toolDetails}>
          {detailInput !== undefined ? (
            <ToolDetail
              label={command ? 'Command' : 'Input'}
              onInteraction={onInteraction}
              value={detailInput}
            />
          ) : null}
          {complete && detailOutput !== undefined ? (
            <ToolDetail
              label={stdout !== undefined ? 'Output' : 'Result'}
              onInteraction={onInteraction}
              value={detailOutput}
            />
          ) : null}
          {error !== undefined ? (
            <ToolDetail danger label="Error" onInteraction={onInteraction} value={error} />
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

function ToolDetail({
  danger = false,
  label,
  onInteraction,
  value,
}: {
  danger?: boolean;
  label: string;
  onInteraction?: () => void;
  value: JsonValue;
}) {
  const colors = useAppColors();

  return (
    <View style={styles.toolDetail}>
      <View style={styles.toolDetailHeading}>
        <Text style={[Type.label, { color: danger ? colors.danger : colors.textSecondary }]}>
          {label}
        </Text>
        <MotionPressable
          accessibilityLabel={`Copy ${label.toLowerCase()}`}
          accessibilityRole="button"
          haptic="selection"
          hitSlop={10}
          onPress={() => {
            onInteraction?.();
            void Clipboard.setStringAsync(serialize(value)).then(haptics.success);
          }}
          style={styles.inlineAction}
        >
          <Text style={[Type.label, { color: colors.textSecondary }]}>Copy</Text>
        </MotionPressable>
      </View>
      {isJsonBlockValue(value) ? (
        <JsonBlock onInteraction={onInteraction} value={value} />
      ) : (
        <View
          style={[
            styles.toolText,
            { backgroundColor: colors.backgroundElement, borderColor: colors.border },
          ]}
        >
          <Text
            selectable
            style={[
              Type.mono,
              styles.toolTextLine,
              { color: danger ? colors.danger : colors.textSecondary },
            ]}
          >
            {serialize(value)}
          </Text>
        </View>
      )}
    </View>
  );
}

export function ChatMessage({
  instanceBaseUrl,
  message,
  onInteraction,
  pending = false,
}: {
  instanceBaseUrl: string;
  message: PxiMessage;
  onInteraction?: () => void;
  /** The turn is still being produced, so missing content is expected. */
  pending?: boolean;
}) {
  const colors = useAppColors();
  const isUser = message.role === 'user';
  const textParts = message.parts.filter((part) => part.type === 'text');
  const traceId = message.metadata?.phoenix?.turnTraceContext?.traceId;
  const hasVisibleContent = message.parts.some(hasVisibleOutput);

  if (isUser) {
    const text = textParts.map((part) => part.text).join('');

    return (
      <NativeContextMenu
        actions={TEXT_MENU_ACTIONS}
        onAction={(id) => handleTextMenuAction(id, text, onInteraction)}
      >
        <View style={styles.userRow}>
          <View style={[styles.userBubble, { backgroundColor: colors.bubble }]}>
            <Text selectable style={[styles.userText, { color: colors.text }]}>
              {text}
            </Text>
          </View>
        </View>
      </NativeContextMenu>
    );
  }

  const replyText = textParts
    .map((part) => part.text.trim())
    .filter(Boolean)
    .join('\n\n');

  const showFooter = !pending && (replyText.length > 0 || traceId !== undefined);

  return (
    <View style={styles.assistant}>
      {hasVisibleContent ? null : (
        <Text style={[Type.subhead, { color: colors.textSecondary }]}>
          {pending ? 'Thinking…' : 'No response was recorded for this turn.'}
        </Text>
      )}
      {message.parts.map((part, index) => (
        <AssistantPart
          key={
            'toolCallId' in part
              ? part.toolCallId
              : 'sourceId' in part
                ? part.sourceId
                : `${part.type}-${index}`
          }
          onInteraction={onInteraction}
          part={part}
        />
      ))}
      {showFooter ? (
        <View style={styles.footer}>
          {replyText.length > 0 ? (
            <FooterAction
              accessibilityLabel="Copy response"
              label="Copy"
              onPress={() => {
                onInteraction?.();
                void Clipboard.setStringAsync(replyText).then(haptics.success);
              }}
              symbol={Symbols.copy}
            />
          ) : null}
          {traceId !== undefined ? (
            <FooterAction
              accessibilityLabel="View this turn’s trace in Phoenix"
              label="Trace"
              onPress={() => {
                onInteraction?.();
                void WebBrowser.openBrowserAsync(
                  `${instanceBaseUrl.replace(/\/+$/, '')}/redirects/traces/${encodeURIComponent(traceId)}`,
                );
              }}
              role="link"
              symbol={Symbols.trace}
            />
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

function FooterAction({
  accessibilityLabel,
  label,
  onPress,
  role = 'button',
  symbol,
}: {
  accessibilityLabel: string;
  label: string;
  onPress: () => void;
  role?: 'button' | 'link';
  symbol: SymbolName;
}) {
  const colors = useAppColors();

  return (
    <MotionPressable
      accessibilityLabel={accessibilityLabel}
      accessibilityRole={role}
      haptic="selection"
      hitSlop={10}
      onPress={onPress}
      style={styles.footerAction}
    >
      <SymbolView name={symbol} size={12} tintColor={colors.textTertiary} weight="medium" />
      <Text style={[Type.label, { color: colors.textTertiary }]}>{label}</Text>
    </MotionPressable>
  );
}

// Interrupted turns persist assistant messages whose parts carry no output;
// a bare label would otherwise look like a rendering failure.
function hasVisibleOutput(part: PxiMessage['parts'][number]): boolean {
  if (part.type === 'text' || part.type === 'reasoning') return part.text.trim().length > 0;

  return part.type !== 'step-start';
}

/** Sources, files, and data updates: one line with a symbol, a title, and a mono detail. */
function AttachmentRow({
  detail,
  onPress,
  symbol,
  title,
}: {
  detail?: string;
  onPress?: () => void;
  symbol: SymbolName;
  title: string;
}) {
  const colors = useAppColors();

  const content = (
    <>
      <View style={styles.toolSymbol}>
        <SymbolView name={symbol} size={12} tintColor={colors.textTertiary} />
      </View>
      <Text numberOfLines={1} style={[Type.subhead, styles.toolLabel, { color: colors.text }]}>
        {title}
      </Text>
      {detail ? (
        <Text
          numberOfLines={1}
          style={[Type.mono, styles.toolPreview, { color: colors.textTertiary }]}
        >
          {detail}
        </Text>
      ) : null}
    </>
  );

  if (!onPress) return <View style={styles.toolRow}>{content}</View>;

  return (
    <MotionPressable
      accessibilityLabel={title}
      accessibilityRole="link"
      hitSlop={{ bottom: 6, top: 6 }}
      onPress={onPress}
      scaleTo={0.99}
      style={styles.toolRow}
    >
      {content}
    </MotionPressable>
  );
}

function AssistantPart({
  onInteraction,
  part,
}: {
  onInteraction?: () => void;
  part: PxiMessage['parts'][number];
}) {
  const colors = useAppColors();

  if (part.type === 'text') {
    return (
      <NativeContextMenu
        actions={TEXT_MENU_ACTIONS}
        onAction={(id) => handleTextMenuAction(id, part.text, onInteraction)}
      >
        <View>
          <MessageMarkdown
            onInteraction={onInteraction}
            streaming={part.state === 'streaming'}
            text={part.text}
          />
        </View>
      </NativeContextMenu>
    );
  }

  if (isToolUIPart(part)) return <ToolPart onInteraction={onInteraction} part={part} />;

  if (part.type === 'reasoning') {
    return part.state === 'streaming' ? (
      <Text style={[Type.subhead, { color: colors.textSecondary }]}>Thinking…</Text>
    ) : null;
  }

  if (part.type === 'source-url') {
    return (
      <AttachmentRow
        detail={hostOf(part.url)}
        onPress={() => {
          onInteraction?.();
          void WebBrowser.openBrowserAsync(part.url);
        }}
        symbol={Symbols.link}
        title={part.title ?? part.url}
      />
    );
  }

  if (part.type === 'file') {
    return (
      <AttachmentRow
        detail={part.mediaType}
        onPress={() => {
          onInteraction?.();
          void WebBrowser.openBrowserAsync(part.url);
        }}
        symbol={Symbols.file}
        title={part.filename ?? 'PXI file'}
      />
    );
  }

  if (part.type === 'source-document') {
    return (
      <AttachmentRow
        detail={part.filename ?? part.mediaType}
        symbol={Symbols.file}
        title={part.title}
      />
    );
  }

  if (part.type.startsWith('data-')) {
    return (
      <AttachmentRow
        detail={titleCase(part.type.replace(/^data-/, ''))}
        symbol={Symbols.update}
        title="PXI update"
      />
    );
  }

  return null;
}

function hostOf(url: string): string | undefined {
  try {
    return new URL(url).host;
  } catch {
    return undefined;
  }
}

const styles = StyleSheet.create({
  userRow: { alignItems: 'flex-end', paddingLeft: 48 },
  userBubble: { borderRadius: 20, paddingHorizontal: 15, paddingVertical: 10 },
  userText: { fontFamily: AppFonts.regular, fontSize: 16, lineHeight: 22 },
  assistant: { gap: 6 },
  toolRow: { alignItems: 'center', flexDirection: 'row', gap: 8, minHeight: 34 },
  toolSymbol: { alignItems: 'center', justifyContent: 'center', width: 16 },
  toolSpinner: { transform: [{ scale: 0.7 }] },
  toolLabel: { flexShrink: 0, maxWidth: '62%' },
  toolPreview: { flex: 1, minWidth: 0 },
  toolDetails: { gap: 10, paddingBottom: 8, paddingLeft: 24, paddingTop: 2 },
  toolDetail: { gap: 6 },
  toolDetailHeading: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    minHeight: 24,
  },
  inlineAction: { justifyContent: 'center', minHeight: 24, paddingLeft: 12 },
  toolText: { borderRadius: 10, borderWidth: StyleSheet.hairlineWidth, padding: 10 },
  toolTextLine: { lineHeight: 18 },
  footer: { flexDirection: 'row', gap: 18, marginTop: -2 },
  footerAction: { alignItems: 'center', flexDirection: 'row', gap: 5, minHeight: 28 },
});
