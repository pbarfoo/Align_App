import { describe, expect, it } from 'vitest';
import { domains, initialGoals, sortDomains } from './data';

describe('LifeOS domain model', () => {
  it('exposes exactly the three canonical domain names', () => {
    expect(new Set(domains.map((domain) => domain.name))).toEqual(
      new Set(['Family & Friends', 'Career', 'Self']),
    );
    expect(domains.find((domain) => domain.id === 'family')?.name).toBe('Family & Friends');
    expect(domains).toHaveLength(3);
  });

  it('restores the app order after domains load in arbitrary database order', () => {
    const shuffled = [domains[2], domains[0], domains[1]];
    expect(sortDomains(shuffled).map((domain) => domain.id)).toEqual([
      'family',
      'career',
      'self',
    ]);
  });

  it('merges Community values into Career without duplicate or project-specific labels', () => {
    const values = domains.find((domain) => domain.id === 'career')!.values;
    expect(values).toEqual([
      'Leadership', 'Autonomy', 'Flexibility', 'Professional Respect', 'Competence', 'Service',
      'Presence', 'Integrity', 'Love/Positivity', 'Community',
    ]);
    expect(new Set(values).size).toBe(values.length);
  });

  it('keeps every seeded sub-goal in the same domain as its parent', () => {
    const byId = new Map(initialGoals.map((goal) => [goal.id, goal]));
    for (const goal of initialGoals) {
      if (!goal.parentGoalId) continue;
      expect(byId.get(goal.parentGoalId)?.domainId).toBe(goal.domainId);
    }
  });
});
