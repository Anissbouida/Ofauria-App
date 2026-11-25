import { describe, it, expect } from 'vitest';
import { dependencyClosure, dependencyDependents, dependencyMissing, dependencyConflicts, requiredModules, dependentModules, withRequirements, type DependencyRelation } from '@ofauria/shared';

describe('Moteur partagé des dépendances', () => {
  const relations: DependencyRelation[] = [{ module: 'a', related: 'b', kind: 'requires' }, { module: 'b', related: 'a', kind: 'requires' }, { module: 'b', related: 'c', kind: 'requires' }, { module: 'a', related: 'x', kind: 'conflicts' }, { module: 'x', related: 'a', kind: 'conflicts' }];
  it('fermeture transitive, relations inverses et cycles', () => {
    expect([...dependencyClosure(['a'], relations)]).toEqual(['a','b','c']);
    expect(new Set(dependencyDependents('c', relations))).toEqual(new Set(['a','b']));
    expect(dependencyMissing(new Set(['a']),relations)).toEqual([{ module: 'a', missing: ['b'] }]);
  });
  it('détecte un conflit une seule fois même s’il est symétrique', () => {
    expect(dependencyConflicts(new Set(['a','x']),relations)).toHaveLength(1);
    expect(dependencyConflicts(new Set(['a']),relations)).toHaveLength(0);
  });
  it('préserve le cycle historique recettes/production et les capacités', () => {
    expect(new Set(requiredModules('production'))).toEqual(new Set(['recipes','stock']));
    expect(new Set(dependentModules('stock'))).toEqual(new Set(['production','recipes','unsold','replenishment']));
    expect(withRequirements(['a'],[{ key:'a',module_key:'production',label:'A',requires:['b'] },{ key:'b',module_key:'production',label:'B',requires:['a'] }])).toEqual(new Set(['a','b']));
  });
});
