import { describe, expect, it } from 'vitest';
import { domains, initialGoals, sortDomains } from './data';

describe('LifeOS domain model', () => {
  it('exposes exactly the four canonical domain names', () => {
    expect(new Set(domains.map((domain) => domain.name))).toEqual(
      new Set(['Self', 'Career', 'Community', 'Family']),
    );
    expect(domains.find((domain) => domain.id === 'family')?.name).toBe('Family');
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

  it('keeps every seeded sub-goal in the same domain as its parent', () => {
    const byId = new Map(initialGoals.map((goal) => [goal.id, goal]));
    for (const goal of initialGoals) {
      if (!goal.parentGoalId) continue;
      expect(byId.get(goal.parentGoalId)?.domainId).toBe(goal.domainId);
    }
  });
});
