import { describe, expect, it } from 'vitest';
import { domains } from './data';

describe('LifeOS domain model', () => {
  it('exposes four distinct domains with family/home separated from community/service', () => {
    expect(domains.map((domain) => domain.id)).toEqual([
      'career',
      'self',
      'family',
      'community',
    ]);

    expect(domains.find((domain) => domain.id === 'family')?.name).toBe('Family / Home');
    expect(domains.find((domain) => domain.id === 'community')?.name).toBe('Community / Service');
  });
});
