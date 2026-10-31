import { ListRow } from '@/components/ui/list-row';
import { StatusLabel } from '@/components/ui/status-label';
import type { PhoenixTraceListItem } from '@/hooks/use-phoenix-data';
import { formatCompactNumber, formatDuration, formatRelativeTime } from '@/lib/format';

/**
 * A trace in the project list: what was asked, as T3 lists a thread by its
 * prompt. The title is the root span's input when it has readable text, else
 * the span name; the second line carries the span name or the error, tokens,
 * and start time. Only an error gets a symbol, so a healthy list stays quiet.
 */
export function TraceRow({
  onPress,
  selected,
  trace,
}: {
  onPress: () => void;
  selected: boolean;
  trace: PhoenixTraceListItem;
}) {
  const isError = trace.statusCode === 'ERROR';
  const status = isError ? 'Error' : trace.statusCode === 'OK' ? 'OK' : 'Unset';
  const latency = formatDuration(trace.latencyMs);
  const started = formatRelativeTime(trace.startTime);
  const title = trace.inputExcerpt ?? trace.name;

  const tokens =
    trace.tokenCountTotal == null ? null : `${formatCompactNumber(trace.tokenCountTotal)} tok`;

  const lead = isError
    ? (trace.statusMessage ?? 'Error')
    : trace.inputExcerpt
      ? trace.name
      : trace.spanKind.toLowerCase();

  const subtitle = [lead, tokens, started].filter((part) => part !== null).join(' · ');

  return (
    <ListRow
      accessibilityHint="Opens trace details"
      accessibilityLabel={`${title}, ${trace.name}, ${status}, ${latency}, started ${started}`}
      leading={isError ? <StatusLabel size={12} tone="error" /> : undefined}
      meta={latency}
      onPress={onPress}
      selected={selected}
      subtitle={subtitle}
      subtitleTone={isError ? 'danger' : 'default'}
      title={title}
      variant="sidebar"
    />
  );
}
