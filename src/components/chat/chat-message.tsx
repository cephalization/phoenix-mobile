import { isToolUIPart } from 'ai';
import * as Clipboard from 'expo-clipboard';
import { SymbolView } from 'expo-symbols';
import * as WebBrowser from 'expo-web-browser';
import { useState } from 'react';
import { ActivityIndicator, Share, StyleSheet, Text, View } from 'react-native';

import { MotionPressable } from '@/components/motion-pressable';
import { MessageMarkdown } from '@/components/chat/message-markdown';
import { isJsonBlockValue, JsonBlock } from '@/components/json-block';
import { NativeContextMenu, type NativeContextMenuAction } from '@/components/native-context-menu';
import { PxiGlyph } from '@/components/pxi-glyph';
import { AppFonts, Fonts, useAppColors } from '@/constants/theme';
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

  const stateLabel = failed
    ? 'Failed'
    : denied
      ? 'Denied'
      : approval
        ? 'Approval needed'
        : complete
          ? ''
          : 'Running';

  const details =
    expanded && hasDetails ? (
      <View style={[styles.toolDetails, { backgroundColor: colors.backgroundElement }]}>
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
            separated={detailInput !== undefined}
          />
        ) : null}
        {error !== undefined ? (
          <ToolDetail
            danger
            label="Error"
            onInteraction={onInteraction}
            value={error}
            separated={detailInput !== undefined || detailOutput !== undefined}
          />
        ) : null}
      </View>
    ) : null;

  return (
    <View style={styles.tool}>
      <MotionPressable
        accessibilityHint={hasDetails ? 'Shows tool input and result' : undefined}
        accessibilityRole="button"
        accessibilityState={{ disabled: !hasDetails, expanded }}
        disabled={!hasDetails}
        onPress={() => {
          onInteraction?.();
          setExpanded((value) => !value);
        }}
        scaleTo={0.995}
        style={styles.toolHeading}
      >
        <View style={styles.toolStateSlot}>
          {complete ? (
            <Text style={[styles.toolStateGlyph, { color: colors.success }]}>✓</Text>
          ) : failed ? (
            <Text style={[styles.toolStateGlyph, { color: colors.danger }]}>×</Text>
          ) : denied ? (
            <Text style={[styles.toolStateGlyph, { color: colors.textSecondary }]}>−</Text>
          ) : approval ? (
            <Text style={[styles.toolStateGlyph, { color: colors.brand }]}>?</Text>
          ) : (
            <ActivityIndicator color={colors.brand} size="small" style={styles.toolSpinner} />
          )}
        </View>
        <View style={styles.toolCopy}>
          <View style={styles.toolTitleRow}>
            <Text numberOfLines={1} style={[styles.toolName, { color: colors.text }]}>
              {getToolLabel(toolName, complete)}
            </Text>
            {stateLabel ? (
              <Text
                style={[
                  styles.toolStatus,
                  { color: failed ? colors.danger : colors.textSecondary },
                ]}
              >
                {stateLabel}
              </Text>
            ) : null}
          </View>
          {preview ? (
            <Text numberOfLines={1} style={[styles.toolPreview, { color: colors.textSecondary }]}>
              {preview}
            </Text>
          ) : null}
        </View>
        {hasDetails ? (
          <View style={styles.disclosure}>
            <SymbolView
              name={
                expanded
                  ? {
                      ios: 'chevron.down',
                      android: 'keyboard_arrow_down',
                      web: 'keyboard_arrow_down',
                    }
                  : { ios: 'chevron.right', android: 'chevron_right', web: 'chevron_right' }
              }
              size={14}
              tintColor={colors.textSecondary}
              weight="semibold"
            />
          </View>
        ) : null}
      </MotionPressable>
      {details}
    </View>
  );
}

function ToolDetail({
  danger = false,
  label,
  onInteraction,
  separated = false,
  value,
}: {
  danger?: boolean;
  label: string;
  onInteraction?: () => void;
  separated?: boolean;
  value: JsonValue;
}) {
  const colors = useAppColors();

  return (
    <View
      style={[
        styles.toolDetailSection,
        separated && { borderTopColor: colors.border, borderTopWidth: 1 },
      ]}
    >
      <View style={styles.toolDetailHeading}>
        <Text
          style={[styles.toolDetailLabel, { color: danger ? colors.danger : colors.textSecondary }]}
        >
          {label}
        </Text>
        <MotionPressable
          accessibilityLabel={`Copy ${label.toLowerCase()}`}
          accessibilityRole="button"
          haptic="selection"
          onPress={() => {
            onInteraction?.();
            void Clipboard.setStringAsync(serialize(value)).then(haptics.success);
          }}
          style={styles.toolDetailCopyButton}
        >
          <Text style={[styles.toolDetailCopyLabel, { color: colors.textSecondary }]}>Copy</Text>
        </MotionPressable>
      </View>
      {isJsonBlockValue(value) ? (
        <JsonBlock onInteraction={onInteraction} value={value} />
      ) : (
        <Text
          selectable
          style={[styles.toolDetailText, { color: danger ? colors.danger : colors.textSecondary }]}
        >
          {serialize(value)}
        </Text>
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
  const traceId = message.metadata?.trace?.traceId;
  const hasVisibleContent = message.parts.some(hasVisibleOutput);

  if (isUser) {
    const text = textParts.map((part) => part.text).join('');

    return (
      <NativeContextMenu
        actions={TEXT_MENU_ACTIONS}
        onAction={(id) => handleTextMenuAction(id, text, onInteraction)}
      >
        <View style={styles.userRow}>
          <View style={[styles.userBubble, { backgroundColor: colors.accent }]}>
            <Text selectable style={[styles.userText, { color: colors.accentForeground }]}>
              {text}
            </Text>
          </View>
        </View>
      </NativeContextMenu>
    );
  }

  return (
    <View style={styles.assistantRow}>
      <View style={styles.assistantLabel}>
        <PxiGlyph color={colors.brand} size={15} />
        <Text style={[styles.assistantName, { color: colors.textSecondary }]}>PXI</Text>
      </View>
      {hasVisibleContent ? null : (
        <Text style={[styles.thinking, { color: colors.textSecondary }]}>
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
      {traceId && (
        <MotionPressable
          accessibilityRole="link"
          onPress={() => {
            onInteraction?.();
            void WebBrowser.openBrowserAsync(
              `${instanceBaseUrl.replace(/\/+$/, '')}/redirects/traces/${encodeURIComponent(traceId)}`,
            );
          }}
          style={styles.traceLink}
        >
          <Text style={[styles.traceText, { color: colors.brand }]}>View trace</Text>
        </MotionPressable>
      )}
    </View>
  );
}

// Interrupted turns persist assistant messages whose parts carry no output;
// a bare label would otherwise look like a rendering failure.
function hasVisibleOutput(part: PxiMessage['parts'][number]): boolean {
  if (part.type === 'text' || part.type === 'reasoning') return part.text.trim().length > 0;

  return part.type !== 'step-start';
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
      <Text style={[styles.thinking, { color: colors.textSecondary }]}>Thinking…</Text>
    ) : null;
  }

  if (part.type === 'source-url') {
    return (
      <MotionPressable
        accessibilityRole="link"
        onPress={() => {
          onInteraction?.();
          void WebBrowser.openBrowserAsync(part.url);
        }}
        style={[styles.source, { backgroundColor: colors.backgroundSelected }]}
      >
        <Text numberOfLines={1} style={[styles.sourceText, { color: colors.text }]}>
          {part.title ?? part.url}
        </Text>
      </MotionPressable>
    );
  }

  if (part.type === 'file') {
    return (
      <MotionPressable
        accessibilityRole="link"
        onPress={() => {
          onInteraction?.();
          void WebBrowser.openBrowserAsync(part.url);
        }}
        style={[
          styles.attachment,
          { backgroundColor: colors.backgroundElement, borderColor: colors.border },
        ]}
      >
        <Text numberOfLines={1} style={[styles.attachmentTitle, { color: colors.text }]}>
          {part.filename ?? 'PXI file'}
        </Text>
        <Text style={[styles.attachmentType, { color: colors.textSecondary }]}>
          {part.mediaType}
        </Text>
      </MotionPressable>
    );
  }

  if (part.type === 'source-document') {
    return (
      <View
        style={[
          styles.attachment,
          { backgroundColor: colors.backgroundElement, borderColor: colors.border },
        ]}
      >
        <Text numberOfLines={1} style={[styles.attachmentTitle, { color: colors.text }]}>
          {part.title}
        </Text>
        <Text style={[styles.attachmentType, { color: colors.textSecondary }]}>
          {part.filename ?? part.mediaType}
        </Text>
      </View>
    );
  }

  if (part.type.startsWith('data-')) {
    return (
      <View
        style={[
          styles.attachment,
          { backgroundColor: colors.backgroundElement, borderColor: colors.border },
        ]}
      >
        <Text style={[styles.attachmentTitle, { color: colors.text }]}>PXI update</Text>
        <Text style={[styles.attachmentType, { color: colors.textSecondary }]}>
          {titleCase(part.type.replace(/^data-/, ''))}
        </Text>
      </View>
    );
  }

  return null;
}

const styles = StyleSheet.create({
  userRow: { alignItems: 'flex-end', paddingLeft: 42 },
  userBubble: {
    borderRadius: 19,
    borderBottomRightRadius: 6,
    maxWidth: '88%',
    paddingHorizontal: 15,
    paddingVertical: 11,
  },
  userText: { fontFamily: AppFonts.regular, fontSize: 16, lineHeight: 23 },
  assistantRow: { gap: 11, paddingRight: 8 },
  assistantLabel: { alignItems: 'center', flexDirection: 'row', gap: 7 },
  assistantName: { fontFamily: AppFonts.semibold, fontSize: 12, letterSpacing: 0.5 },
  thinking: { fontFamily: AppFonts.regular, fontSize: 12, fontStyle: 'italic' },
  tool: { marginVertical: -2 },
  toolHeading: {
    alignItems: 'flex-start',
    flexDirection: 'row',
    gap: 9,
    minHeight: 48,
    paddingVertical: 7,
  },
  toolStateSlot: { alignItems: 'center', height: 28, justifyContent: 'center', width: 18 },
  toolStateGlyph: { fontFamily: AppFonts.semibold, fontSize: 16, lineHeight: 22 },
  toolSpinner: { transform: [{ translateX: -1.5 }] },
  toolCopy: { flex: 1, gap: 2, minWidth: 0 },
  toolTitleRow: { alignItems: 'center', flexDirection: 'row', gap: 8, minHeight: 22 },
  toolName: { flexShrink: 1, fontFamily: AppFonts.medium, fontSize: 14 },
  toolStatus: { fontFamily: AppFonts.regular, fontSize: 11 },
  toolPreview: { fontFamily: AppFonts.regular, fontSize: 13, lineHeight: 18 },
  disclosure: { alignItems: 'center', height: 28, justifyContent: 'center', width: 24 },
  toolDetails: { borderRadius: 11, marginBottom: 8, marginLeft: 27, overflow: 'hidden' },
  toolDetailSection: { gap: 5, paddingHorizontal: 12, paddingVertical: 10 },
  toolDetailHeading: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    minHeight: 48,
  },
  toolDetailLabel: {
    fontFamily: AppFonts.semibold,
    fontSize: 10,
    letterSpacing: 0.7,
    textTransform: 'uppercase',
  },
  toolDetailCopyButton: {
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 48,
    minWidth: 48,
  },
  toolDetailCopyLabel: { fontFamily: AppFonts.medium, fontSize: 11 },
  toolDetailText: { fontFamily: Fonts.mono, fontSize: 12, lineHeight: 18 },
  source: { borderRadius: 12, maxWidth: '100%', paddingHorizontal: 10, paddingVertical: 7 },
  sourceText: { fontFamily: AppFonts.medium, fontSize: 12, maxWidth: 260 },
  attachment: { borderRadius: 14, borderWidth: 1, gap: 3, padding: 12 },
  attachmentTitle: { fontFamily: AppFonts.medium, fontSize: 13 },
  attachmentType: { fontFamily: AppFonts.regular, fontSize: 11 },
  traceLink: { alignSelf: 'flex-start', minHeight: 40, justifyContent: 'center' },
  traceText: { fontFamily: AppFonts.medium, fontSize: 13 },
});
