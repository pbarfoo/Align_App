import { describe, expect, it } from 'vitest';
import { domains } from './data';

describe('shared Align and Portal direction', () => {
  it('preserves Career and former Community direction in separate paragraphs', () => {
    const career = domains.find((domain) => domain.id === 'career');
    expect(career?.vision.split('\n\n')[0]).toBe(
      'Teach, lead, create factual media, and advance responsible AI in a flexible, autonomous career that supports family, stability, and professional respect.',
    );
    expect(career?.vision.split('\n\n')[1]).toBe(
      'To contribute beyond home through friendship, service, stewardship, and community leadership — building relationships, strengthening shared places, and using my gifts to help others flourish.',
    );
  });
});
