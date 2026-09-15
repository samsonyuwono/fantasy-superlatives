import { describe, it, expect } from 'vitest';
import { formatSubject } from '../src/format.js';

describe('formatSubject', () => {
  it('includes the league name so multiple leagues to one inbox are distinguishable', () => {
    expect(formatSubject(1, 'Main League')).toBe('🏈 Main League — Week 1 Superlatives');
  });

  it('reflects the week number', () => {
    expect(formatSubject(14, 'Dynasty')).toBe('🏈 Dynasty — Week 14 Superlatives');
  });
});
