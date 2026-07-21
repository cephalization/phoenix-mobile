import { isToolUIPart } from 'ai';
import * as Clipboard from 'expo-clipboard';
import { SymbolView } from 'expo-symbols';
import * as WebBrowser from 'expo-web-browser';
import { useState } from 'react';
import { ActivityIndicator, Share, StyleSheet, Text, View } from 'react-native';

import { MotionPressable } from '@/components/motion-pressable';
import { MessageMarkdown } from '@/components/chat/message-markdown';
import { NativeContextMenu, type NativeContextMenuAction } from '@/components/native-context-menu';
import { PxiGlyph } from '@/components/pxi-glyph';
import { AppFonts, Fonts, useAppColors } from '@/constants/theme';
import type { PxiMessage } from '@/features/pxi/types';
import { haptics } from '@/lib/haptics';

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
    .replace(/\b(Graphql|Pxi|Api|Url|Sql)\b/g, (word) => ({
      Graphql: 'GraphQL',
      Pxi: 'PXI',
      Api: 'API',
      Url: 'URL',
      Sql: 'SQL',
    })[word] ?? word);
}

function serialize(value: unknown): string {
  if (typeof value === 'string') return value;
  try {
    const result = JSON.stringify(value, null, 2);
    return result.length > 1_800 ? `${result.slice(0, 1_800)}\n…` : result;
  } catch {
    return 'Result is not displayable.';
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function getToolPreview(input: unknown): string {
  const fields = ['summary', 'description', 'query', 'operationName', 'skill_name', 'resource_name', 'name', 'path', 'url', 'prompt', 'text', 'command'];
  const record = asRecord(input);
  const value = typeof input === 'string'
    ? input
    : fields.map((field) => record?.[field]).find((candidate) => typeof candidate === 'string');
  if (typeof value !== 'string') return '';
  const preview = value.replace(/\s+/g, ' ').trim();
  return preview.length > 120 ? `${preview.slice(0, 119).trimEnd()}…` : preview;
}

function getToolLabel(toolName: string, complete: boolean): string {
  const labels: Record<string, [running: string, complete: string]> = {
    bash: ['Running command', 'Ran command'],
    call_subagent: ['Starting subagent', 'Started subagent'],
    graphql: ['Querying Phoenix', 'Queried Phoenix'],
    graphql_query: ['Querying Phoenix', 'Queried Phoenix'],
    load_skill: ['Loading skill', 'Loaded skill'],
    read: ['Reading file', 'Read file'],
    read_skill_resource: ['Reading skill resource', 'Read skill resource'],
    web_fetch: ['Fetching page', 'Fetched page'],
    web_search: ['Searching the web', 'Searched the web'],
  };
  const label = labels[toolName];
  return label ? label[complete ? 1 : 0] : titleCase(toolName);
}

function ToolPart({ onInteraction, part }: { onInteraction?: () => void; part: PxiMessage['parts'][number] }) {
  const colors = useAppColors();
  const [expanded, setExpanded] = useState(false);
  if (!isToolUIPart(part)) return null;

  const toolName = (part.type === 'dynamic-tool' ? part.toolName : part.type).replace(/^tool-/, '');
  const complete = part.state === 'output-available';
  const failed = part.state === 'output-error';
  const approval = part.state === 'approval-requested';
  const denied = part.state === 'output-denied';
  const preview = getToolPreview(part.input);
  const inputRecord = asRecord(part.input);
  const outputRecord = complete ? asRecord(part.output) : null;
  const command = toolName === 'bash' && typeof inputRecord?.command === 'string' ? inputRecord.command : undefined;
  const stdout = toolName === 'bash' && typeof outputRecord?.stdout === 'string' ? outputRecord.stdout : undefined;
  const stderr = toolName === 'bash' && typeof outputRecord?.stderr === 'string' && outputRecord.stderr.trim()
    ? outputRecord.stderr
    : undefined;
  const error = failed && 'errorText' in part ? part.errorText : stderr;
  const detailInput = command ?? part.input;
  const detailOutput = stdout ?? part.output;
  const hasDetails = detailInput !== undefined || (complete && detailOutput !== undefined) || error !== undefined;
  const stateLabel = failed ? 'Failed' : denied ? 'Denied' : approval ? 'Approval needed' : complete ? '' : 'Running';
  const menuActions: NativeContextMenuAction[] = [
    ...(detailInput !== undefined ? [{ id: 'copy-input', systemImage: 'doc.on.doc', title: command ? 'Copy command' : 'Copy input' }] : []),
    ...(complete && detailOutput !== undefined ? [{ id: 'copy-output', systemImage: 'doc.on.clipboard', title: stdout !== undefined ? 'Copy output' : 'Copy result' }] : []),
    ...(error !== undefined ? [{ id: 'copy-error', systemImage: 'exclamationmark.triangle', title: 'Copy error' }] : []),
  ];

  const details = expanded && hasDetails ? (
    <View style={[styles.toolDetails, { backgroundColor: colors.backgroundElement }]}>
      {detailInput !== undefined ? <ToolDetail label={command ? 'Command' : 'Input'} value={detailInput} /> : null}
      {complete && detailOutput !== undefined ? <ToolDetail label={stdout !== undefined ? 'Output' : 'Result'} value={detailOutput} separated={detailInput !== undefined} /> : null}
      {error !== undefined ? <ToolDetail danger label="Error" value={error} separated={detailInput !== undefined || detailOutput !== undefined} /> : null}
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
        style={styles.toolHeading}>
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
              <Text style={[styles.toolStatus, { color: failed ? colors.danger : colors.textSecondary }]}>{stateLabel}</Text>
            ) : null}
          </View>
          {preview ? <Text numberOfLines={1} style={[styles.toolPreview, { color: colors.textSecondary }]}>{preview}</Text> : null}
        </View>
        {hasDetails ? (
          <View style={styles.disclosure}>
            <SymbolView
              name={expanded
                ? { ios: 'chevron.down', android: 'keyboard_arrow_down', web: 'keyboard_arrow_down' }
                : { ios: 'chevron.right', android: 'chevron_right', web: 'chevron_right' }}
              size={14}
              tintColor={colors.textSecondary}
              weight="semibold"
            />
          </View>
        ) : null}
      </MotionPressable>
      {details && menuActions.length > 0 ? (
        <NativeContextMenu
          actions={menuActions}
          onAction={(id) => {
            onInteraction?.();
            const value = id === 'copy-input' ? detailInput : id === 'copy-output' ? detailOutput : error;
            if (value !== undefined) void Clipboard.setStringAsync(serialize(value)).then(haptics.success);
          }}>
          {details}
        </NativeContextMenu>
      ) : details}
    </View>
  );
}

function ToolDetail({ danger = false, label, separated = false, value }: { danger?: boolean; label: string; separated?: boolean; value: unknown }) {
  const colors = useAppColors();
  return (
    <View style={[styles.toolDetailSection, separated && { borderTopColor: colors.border, borderTopWidth: 1 }]}>
      <Text style={[styles.toolDetailLabel, { color: danger ? colors.danger : colors.textSecondary }]}>{label}</Text>
      <Text selectable style={[styles.toolDetailText, { color: danger ? colors.danger : colors.textSecondary }]}>{serialize(value)}</Text>
    </View>
  );
}

export function ChatMessage({ instanceBaseUrl, message, onInteraction }: { instanceBaseUrl: string; message: PxiMessage; onInteraction?: () => void }) {
  const colors = useAppColors();
  const isUser = message.role === 'user';
  const textParts = message.parts.filter((part) => part.type === 'text');
  const traceId = message.metadata?.trace?.traceId;

  if (isUser) {
    const text = textParts.map((part) => part.text).join('');
    return (
      <NativeContextMenu actions={TEXT_MENU_ACTIONS} onAction={(id) => handleTextMenuAction(id, text, onInteraction)}>
        <View style={styles.userRow}>
          <View style={[styles.userBubble, { backgroundColor: colors.accent }]}>
            <Text selectable style={[styles.userText, { color: colors.accentForeground }]}>{text}</Text>
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
      {message.parts.map((part, index) => (
        <AssistantPart key={'toolCallId' in part ? part.toolCallId : 'sourceId' in part ? part.sourceId : `${part.type}-${index}`} onInteraction={onInteraction} part={part} />
      ))}
      {traceId && (
        <MotionPressable
          accessibilityRole="link"
          onPress={() => {
            onInteraction?.();
            void WebBrowser.openBrowserAsync(`${instanceBaseUrl.replace(/\/+$/, '')}/redirects/traces/${encodeURIComponent(traceId)}`);
          }}
          style={styles.traceLink}>
          <Text style={[styles.traceText, { color: colors.brand }]}>View trace</Text>
        </MotionPressable>
      )}
    </View>
  );
}

function AssistantPart({ onInteraction, part }: { onInteraction?: () => void; part: PxiMessage['parts'][number] }) {
  const colors = useAppColors();

  if (part.type === 'text') {
    return (
      <NativeContextMenu actions={TEXT_MENU_ACTIONS} onAction={(id) => handleTextMenuAction(id, part.text, onInteraction)}>
        <View>
          <MessageMarkdown onInteraction={onInteraction} streaming={part.state === 'streaming'} text={part.text} />
        </View>
      </NativeContextMenu>
    );
  }
  if (isToolUIPart(part)) return <ToolPart onInteraction={onInteraction} part={part} />;
  if (part.type === 'reasoning') {
    return part.state === 'streaming' ? <Text style={[styles.thinking, { color: colors.textSecondary }]}>Thinking…</Text> : null;
  }
  if (part.type === 'source-url') {
    return (
      <MotionPressable
        accessibilityRole="link"
        onPress={() => {
          onInteraction?.();
          void WebBrowser.openBrowserAsync(part.url);
        }}
        style={[styles.source, { backgroundColor: colors.backgroundSelected }]}>
        <Text numberOfLines={1} style={[styles.sourceText, { color: colors.text }]}>{part.title ?? part.url}</Text>
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
        style={[styles.attachment, { backgroundColor: colors.backgroundElement, borderColor: colors.border }]}>
        <Text numberOfLines={1} style={[styles.attachmentTitle, { color: colors.text }]}>{part.filename ?? 'PXI file'}</Text>
        <Text style={[styles.attachmentType, { color: colors.textSecondary }]}>{part.mediaType}</Text>
      </MotionPressable>
    );
  }
  if (part.type === 'source-document') {
    return (
      <View style={[styles.attachment, { backgroundColor: colors.backgroundElement, borderColor: colors.border }]}>
        <Text numberOfLines={1} style={[styles.attachmentTitle, { color: colors.text }]}>{part.title}</Text>
        <Text style={[styles.attachmentType, { color: colors.textSecondary }]}>{part.filename ?? part.mediaType}</Text>
      </View>
    );
  }
  if (part.type.startsWith('data-')) {
    return (
      <View style={[styles.attachment, { backgroundColor: colors.backgroundElement, borderColor: colors.border }]}>
        <Text style={[styles.attachmentTitle, { color: colors.text }]}>PXI update</Text>
        <Text style={[styles.attachmentType, { color: colors.textSecondary }]}>{titleCase(part.type.replace(/^data-/, ''))}</Text>
      </View>
    );
  }
  return null;
}

const styles = StyleSheet.create({
  userRow: { alignItems: 'flex-end', paddingLeft: 42 },
  userBubble: { borderRadius: 19, borderBottomRightRadius: 6, maxWidth: '88%', paddingHorizontal: 15, paddingVertical: 11 },
  userText: { fontFamily: AppFonts.regular, fontSize: 16, lineHeight: 23 },
  assistantRow: { gap: 11, paddingRight: 8 },
  assistantLabel: { alignItems: 'center', flexDirection: 'row', gap: 7 },
  assistantName: { fontFamily: AppFonts.semibold, fontSize: 12, letterSpacing: 0.5 },
  thinking: { fontFamily: AppFonts.regular, fontSize: 12, fontStyle: 'italic' },
  tool: { marginVertical: -2 },
  toolHeading: { alignItems: 'flex-start', flexDirection: 'row', gap: 9, minHeight: 48, paddingVertical: 7 },
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
  toolDetailLabel: { fontFamily: AppFonts.semibold, fontSize: 10, letterSpacing: 0.7, textTransform: 'uppercase' },
  toolDetailText: { fontFamily: Fonts.mono, fontSize: 12, lineHeight: 18 },
  source: { borderRadius: 12, maxWidth: '100%', paddingHorizontal: 10, paddingVertical: 7 },
  sourceText: { fontFamily: AppFonts.medium, fontSize: 12, maxWidth: 260 },
  attachment: { borderRadius: 14, borderWidth: 1, gap: 3, padding: 12 },
  attachmentTitle: { fontFamily: AppFonts.medium, fontSize: 13 },
  attachmentType: { fontFamily: AppFonts.regular, fontSize: 11 },
  traceLink: { alignSelf: 'flex-start', minHeight: 40, justifyContent: 'center' },
  traceText: { fontFamily: AppFonts.medium, fontSize: 13 },
});
