import { NotSavedOfflineGlyph } from '@/components/offline/not-saved-offline-glyph';
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
  unsaved = false,
}: {
  classification: SessionReviewClassification;
  onPress: () => void;
  /** The session's first question; the row falls back to the session ID. */
  opener: string | null;
  selected: boolean;
  session: SessionData;
  /** Offline, and its details were never saved: it would open to nothing. */
  unsaved?: boolean;
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
      accessibilityHint={unsaved ? 'Not saved for offline use' : 'Opens session details and review'}
      accessibilityLabel={`Session ${session.session_id}, ${review}, ${turns} turn${turns === 1 ? '' : 's'}, ${duration}, ${tokens} tokens, started ${started}`}
      dimmed={unsaved}
      leading={configured ? <StatusLabel tone={reviewTone(classification)} /> : undefined}
      meta={`${turns} turn${turns === 1 ? '' : 's'}`}
      onPress={onPress}
      selected={selected}
      subtitle={subtitle}
      title={opener ?? session.session_id}
      trailing={unsaved ? <NotSavedOfflineGlyph /> : null}
      variant="sidebar"
    />
  );
}

type ReviewStatus = SessionReviewClassification['status'];

const ReviewLabels: Record<ReviewStatus, string> = {
  'not-configured': 'Not configured',
  complete: 'Reviewed',
  partial: 'Partial',
  stale: 'Needs attention',
  unreviewed: 'Needs review',
};

const ReviewTones: Record<ReviewStatus, StatusTone> = {
  complete: 'ok',
  stale: 'error',
  partial: 'pending',
  'not-configured': 'neutral',
  unreviewed: 'neutral',
};

function reviewLabel(classification: SessionReviewClassification) {
  return ReviewLabels[classification.status];
}

function reviewTone(classification: SessionReviewClassification): StatusTone {
  return ReviewTones[classification.status];
}
