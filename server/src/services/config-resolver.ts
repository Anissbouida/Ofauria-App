/** Central resolution algorithm. Storage and authorization remain in the calling service. */
export const CONFIG_LEVELS = ['base', 'country', 'sector', 'specialization', 'company', 'legal_entity', 'store', 'workshop', 'order_type', 'product', 'user'] as const;
export type ConfigLevel = typeof CONFIG_LEVELS[number];
export type ConfigContext = Partial<Record<ConfigLevel, string | readonly string[]>>;
export type ConfigMerge = 'override' | 'or' | 'union' | 'conflict';
export type ConfigRule = { levels?: readonly ConfigLevel[]; preference?: boolean; merge?: ConfigMerge; lockable?: boolean };
export type ConfigValue<T = unknown> = { scope_type: ConfigLevel; scope_id: string; value: T; locked?: boolean; lock_reason?: 'security' | 'regulatory' | null };
export type ConfigResolution<T> = { value: T; source: ConfigLevel | 'default'; scopeId: string; locked: boolean; trace: Array<ConfigValue<T> & { state: 'applied' | 'overridden' | 'blocked' }> };

const equal = (a: unknown, b: unknown): boolean => {
  if (Object.is(a, b)) return true;
  if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((v, i) => equal(v, b[i]));
  if (a && b && typeof a === 'object' && typeof b === 'object' && !Array.isArray(a) && !Array.isArray(b)) {
    const aa = a as Record<string, unknown>, bb = b as Record<string, unknown>;
    return Object.keys(aa).length === Object.keys(bb).length && Object.keys(aa).every(k => Object.hasOwn(bb, k) && equal(aa[k], bb[k]));
  }
  return false;
};

function isLockAllowed(row: ConfigValue, rule: ConfigRule): boolean {
  return rule.lockable === true && (row.scope_type === 'base' || row.scope_type === 'country'
    ? row.lock_reason === 'security' || row.lock_reason === 'regulatory'
    : row.scope_type === 'sector' && row.lock_reason === 'regulatory');
}
function permitted(level: ConfigLevel, rule: ConfigRule) {
  return (level !== 'user' || rule.preference === true) && (!rule.levels || rule.levels.includes(level));
}
function candidates<T>(rows: readonly ConfigValue<T>[], ctx: ConfigContext, rule: ConfigRule) {
  const out: ConfigValue<T>[] = [];
  for (const level of CONFIG_LEVELS) {
    if (!permitted(level, rule)) continue;
    const raw = ctx[level] ?? (level === 'base' || level === 'company' ? '' : undefined);
    if (raw === undefined) continue;
    const ids = typeof raw === 'string' ? [raw] : [...new Set(raw)];
    // Sector order is provided least-to-most preferred (secondary, principal).
    for (const id of ids) {
      const matches = rows.filter(r => r.scope_type === level && r.scope_id === id);
      if (matches.length > 1) throw new Error(`CONFIG_DUPLICATE: ${level}/${id}`);
      if (matches[0]) out.push(matches[0]);
    }
  }
  return out;
}

function merged<T>(a: T, b: T, mode: ConfigMerge): T {
  if (equal(a, b)) return a;
  if (mode === 'or' && typeof a === 'boolean' && typeof b === 'boolean') return (a || b) as T;
  if (mode === 'union' && Array.isArray(a) && Array.isArray(b)) return [...a, ...b].filter((x,i,all) => all.findIndex(y => equal(x,y)) === i) as T;
  if (mode === 'override') return b;
  throw Object.assign(new Error('Des spécialités proposent des valeurs incompatibles. Choisissez une valeur au niveau entreprise.'), { code: 'CONFIG_CONFLICT', statusCode: 409 });
}

/** Most specific value wins; a valid upper lock stops every narrower override. */
export function resolveConfig<T>(fallback: T, rows: readonly ConfigValue<T>[], ctx: ConfigContext = {}, rule: ConfigRule = {}): ConfigResolution<T> {
  const chain = candidates(rows, ctx, rule);
  let value = fallback, source: ConfigResolution<T>['source'] = 'default', scopeId = '', locked = false;
  const trace: ConfigResolution<T>['trace'] = [];
  let specialtyConflict = false;
  for (const row of chain) {
    if (row.locked && !isLockAllowed(row, rule)) throw new Error(`CONFIG_INVALID_LOCK: ${row.scope_type}`);
    if (locked) { trace.push({ ...row, state: 'blocked' }); continue; }
    if (row.scope_type === 'specialization' && source === 'specialization') {
      try { value = merged(value, row.value, rule.merge ?? 'conflict'); }
      catch (e) { if ((e as { code?: string }).code !== 'CONFIG_CONFLICT') throw e; specialtyConflict = true; }
    } else {
      for (const previous of trace) if (previous.state === 'applied') previous.state = 'overridden';
      value = row.value;
    }
    if (row.scope_type === 'company') specialtyConflict = false;
    source = row.scope_type; scopeId = row.scope_id; locked = row.locked === true;
    trace.push({ ...row, state: 'applied' });
  }
  if (specialtyConflict) throw Object.assign(new Error('Les spécialités nécessitent un arbitrage au niveau entreprise.'), { code: 'CONFIG_CONFLICT', statusCode: 409 });
  return { value, source, scopeId, locked, trace };
}

export const explainConfig = resolveConfig;

/** For future transactional writes: validate the candidate against the applicable upper chain. */
export function assertConfigWritable<T>(candidate: ConfigValue<T>, rows: readonly ConfigValue<T>[], ctx: ConfigContext, rule: ConfigRule) {
  if (!permitted(candidate.scope_type, rule)) throw Object.assign(new Error('Niveau non autorisé pour ce paramètre.'), { code: 'CONFIG_SCOPE', statusCode: 400 });
  if (candidate.locked && !isLockAllowed(candidate, rule)) throw Object.assign(new Error('Verrou non autorisé à ce niveau.'), { code: 'CONFIG_LOCK', statusCode: 400 });
  const upper = candidates(rows, ctx, rule).filter(r => CONFIG_LEVELS.indexOf(r.scope_type) < CONFIG_LEVELS.indexOf(candidate.scope_type));
  if (upper.some(r => r.locked && isLockAllowed(r, rule))) throw Object.assign(new Error('Paramètre verrouillé par un niveau supérieur.'), { code: 'CONFIG_LOCKED', statusCode: 409 });
}
