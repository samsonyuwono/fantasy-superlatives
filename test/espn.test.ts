import { describe, it, expect } from 'vitest';
import { teamName } from '../src/espn.js';

describe('teamName', () => {
  it('collapses internal runs of whitespace to a single space', () => {
    expect(teamName({ name: 'Tea  Baggers' })).toBe('Tea Baggers');
  });

  it('trims leading/trailing whitespace', () => {
    expect(teamName({ name: '  Supreme Leader  ' })).toBe('Supreme Leader');
  });

  it('falls back to the abbreviation when the name is empty', () => {
    expect(teamName({ name: '   ', abbreviation: 'TB' })).toBe('TB');
  });

  it('falls back to Team <id> when nothing else is available', () => {
    expect(teamName({ id: 7 })).toBe('Team 7');
  });
});
