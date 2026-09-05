import { describe, expect, it } from 'vitest';
import { domains } from './data';

describe('shared Align and Portal direction', () => {
  it('keeps the live short Career vision in the repository seed', () => {
    const career = domains.find((domain) => domain.id === 'career');
    expect(career?.vision).toContain('To teach, lead, create factual media, and advance responsible AI—especially media trust and provenance—');
    expect(career?.vision).toContain('some work from home, and pay above the current $75K');
  });
});
