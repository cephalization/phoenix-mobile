import { describe, expect, it } from 'vitest';

import { inputExcerpt } from './excerpt';

describe('inputExcerpt', () => {
  it('keeps plain text on one line', () => {
    expect(inputExcerpt('Where is my\n  order?')).toBe('Where is my order?');
  });

  it('reads the last user message of a chat payload', () => {
    const payload = JSON.stringify({
      messages: [
        { role: 'system', content: 'You are helpful.' },
        { role: 'user', content: 'First question' },
        { role: 'assistant', content: 'Answer' },
        { role: 'user', content: [{ type: 'text', text: 'Follow-up question' }] },
      ],
    });

    expect(inputExcerpt(payload)).toBe('Follow-up question');
  });

  it('reads a text field from other JSON', () => {
    expect(inputExcerpt(JSON.stringify({ query: 'shipping policy', k: 4 }))).toBe(
      'shipping policy',
    );
  });

  it('returns null when nothing is readable', () => {
    expect(inputExcerpt(JSON.stringify({ k: 4 }))).toBeNull();
    expect(inputExcerpt(undefined)).toBeNull();
    expect(inputExcerpt('   ')).toBeNull();
  });

  it('truncates long input', () => {
    expect(inputExcerpt('x'.repeat(300))?.length).toBe(140);
  });
});
