import { describe, expect, it } from 'vitest';
import { domains, sortDomains } from './data';

describe('LifeOS domain model', () => {
  it('exposes four distinct domains with family/home separated from community/service', () => {
    expect(domains.map((domain) => domain.id)).toEqual([
      'self',
      'family',
      'career',
      'community',
    ]);

    expect(domains.find((domain) => domain.id === 'family')?.name).toBe('Family / Home');
    expect(domains.find((domain) => domain.id === 'community')?.name).toBe('Community');
  });

  it('restores the app order after domains load in arbitrary database order', () => {
    const shuffled = [domains[3], domains[0], domains[2], domains[1]];
    expect(sortDomains(shuffled).map((domain) => domain.id)).toEqual([
      'self',
      'family',
      'career',
      'community',
    ]);
  });
});
