import { describe, expect, it } from 'vitest';
import {
  __test_focusFlagDate as focusFlagDate,
  __test_isFocusFlagActive as isFocusFlagActive,
} from './App';

describe('focusFlagDate (☀ evening rollover)', () => {
  it('stamps today for a daytime click', () => {
    expect(focusFlagDate(new Date('2026-07-20T09:30:00'))).toBe('2026-07-20');
    expect(focusFlagDate(new Date('2026-07-20T16:59:00'))).toBe('2026-07-20');
  });

  it('stamps tomorrow for a click at or after 5 PM', () => {
    expect(focusFlagDate(new Date('2026-07-20T17:00:00'))).toBe('2026-07-21');
    expect(focusFlagDate(new Date('2026-07-20T23:45:00'))).toBe('2026-07-21');
  });

  it('rolls over month and year boundaries', () => {
    expect(focusFlagDate(new Date('2026-07-31T18:00:00'))).toBe('2026-08-01');
    expect(focusFlagDate(new Date('2026-12-31T20:00:00'))).toBe('2027-01-01');
  });
});

describe('isFocusFlagActive', () => {
  it('is active on the flagged day itself', () => {
    expect(isFocusFlagActive('2026-07-20', '2026-07-20')).toBe(true);
  });

  it('is active the evening before: a tomorrow-dated flag lights up immediately', () => {
    // Flagged Monday night after 5 PM → focusDate is Tuesday; still Monday now.
    expect(isFocusFlagActive('2026-07-21', '2026-07-20')).toBe(true);
    // …and it stays active all of Tuesday.
    expect(isFocusFlagActive('2026-07-21', '2026-07-21')).toBe(true);
  });

  it('lapses after the flagged day, and is inactive when unset', () => {
    expect(isFocusFlagActive('2026-07-19', '2026-07-20')).toBe(false);
    expect(isFocusFlagActive(undefined, '2026-07-20')).toBe(false);
  });
});
