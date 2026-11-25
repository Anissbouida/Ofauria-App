/** Generic graph shared by the module and capability engines. Cycles are valid
 * (production and recipes are mutually required); traversal is bounded by visited nodes. */
export type DependencyRelation<K extends string = string> = { module: K; related: K; kind: 'requires' | 'conflicts' | 'recommends'; reason?: string };

export function dependencyClosure<K extends string>(roots: Iterable<K>, relations: readonly DependencyRelation<K>[]): Set<K> {
  const out = new Set<K>();
  const visit = (key: K) => {
    if (out.has(key)) return;
    out.add(key);
    for (const r of relations) if (r.kind === 'requires' && r.module === key) visit(r.related);
  };
  for (const root of roots) visit(root);
  return out;
}

export function dependencyDependents<K extends string>(key: K, relations: readonly DependencyRelation<K>[]): Set<K> {
  const rows = relations.map(r => ({ ...r, module: r.related, related: r.module }));
  const result = dependencyClosure([key], rows);
  result.delete(key);
  return result;
}

export function dependencyConflicts<K extends string>(active: ReadonlySet<K>, relations: readonly DependencyRelation<K>[]): DependencyRelation<K>[] {
  const seen = new Set<string>();
  return relations.filter(r => {
    if (r.kind !== 'conflicts' || !active.has(r.module) || !active.has(r.related)) return false;
    const key = JSON.stringify([r.module, r.related].sort());
    if (seen.has(key)) return false;
    seen.add(key); return true;
  });
}

export function dependencyMissing<K extends string>(active: ReadonlySet<K>, relations: readonly DependencyRelation<K>[]): { module: K; missing: K[] }[] {
  return [...active].map(module => ({ module, missing: [...new Set(relations.filter(r => r.kind === 'requires' && r.module === module && !active.has(r.related)).map(r => r.related))] })).filter(r => r.missing.length);
}
