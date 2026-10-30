import { describe, expect, it } from 'vitest';
import { domains } from './data';

describe('shared Align and Portal direction', () => {
  it('keeps the original Career vision without the Community paragraph', () => {
    const career = domains.find((domain) => domain.id === 'career');
    expect(career?.vision).toBe(
      'Teach, lead, create factual media, and advance responsible AI in a flexible, autonomous career that supports family, stability, and professional respect.',
    );
  });
});
