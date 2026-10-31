import { ListRow } from '@/components/ui/list-row';
import { StatusLabel, type StatusTone } from '@/components/ui/status-label';
import type { SessionData, SessionReviewClassification } from '@/features/session-review/types';
import { formatCompactNumber, formatDuration, formatRelativeTime } from '@/lib/format';

/**
 * A session in the project list: its first question (else its ID) and turn count, with its review state,
 * duration, and start time on the second line. Rows carry a review symbol only
 * once the project has a review queue.
 */
export function SessionRow({
  classification,
  onPress,
  opener,
  selected,
  session,
}: {
  classification: SessionReviewClassification;
  onPress: () => void;
  /** The session's first question; the row falls back to the session ID. */
  opener: string | null;
  selected: boolean;
  session: SessionData;
}) {
  const configured = classification.status !== 'not-configured';
  const review = reviewLabel(classification);
  const turns = session.traces.length;
  const started = formatRelativeTime(session.start_time);

  const duration = formatDuration(
    Math.max(0, new Date(session.end_time).getTime() - new Date(session.start_time).getTime()),
  );

  const required = classification.requiredConfigNames.length;

  const progress =
    configured && required > 0
      ? `${review} ${classification.completedConfigNames.length}/${required}`
      : null;

  const subtitle = [progress, duration, started].filter((part) => part !== null).join(' · ');
  const tokens = formatCompactNumber(session.token_count_total ?? 0);

  return (
    <ListRow
      accessibilityHint="Opens session details and review"
      accessibilityLabel={`Session ${session.session_id}, ${review}, ${turns} turn${turns === 1 ? '' : 's'}, ${duration}, ${tokens} tokens, started ${started}`}
      leading={configured ? <StatusLabel tone={reviewTone(classification)} /> : undefined}
      meta={`${turns} turn${turns === 1 ? '' : 's'}`}
      onPress={onPress}
      selected={selected}
      subtitle={subtitle}
      title={opener ?? session.session_id}
      variant="sidebar"
    />
  );
}

function reviewLabel(classification: SessionReviewClassification) {
  switch (classification.status) {
    case 'not-configured':
      return 'Not configured';
    case 'complete':
      return 'Reviewed';
    case 'partial':
      return 'Partial';
    case 'stale':
      return 'Needs attention';
    case 'unreviewed':
      return 'Needs review';
  }
}

function reviewTone(classification: SessionReviewClassification): StatusTone {
  switch (classification.status) {
    case 'complete':
      return 'ok';
    case 'stale':
      return 'error';
    case 'partial':
      return 'pending';
    case 'not-configured':
    case 'unreviewed':
      return 'neutral';
  }
}
