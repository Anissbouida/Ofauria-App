import { describe, it, expect } from 'vitest';
import { CONFIG_LEVELS, resolveConfig, assertConfigWritable, type ConfigContext, type ConfigValue } from '../services/config-resolver.js';

describe('Configuration centralisée — priorité, conflits, verrous', () => {
  const context: ConfigContext = { country: 'MA', sector: ['secondary', 'primary'], specialization: ['sp1', 'sp2'], legal_entity: 'entity', store: 'store', workshop: 'workshop', order_type: 'order', product: 'product', user: 'user' };
  const rows: ConfigValue<number>[] = CONFIG_LEVELS.filter(x => x !== 'specialization').map((scope_type, i) => ({ scope_type, scope_id: scope_type === 'base' || scope_type === 'company' ? '' : scope_type === 'sector' ? 'primary' : String(context[scope_type]), value: i + 1 }));
  it('respecte toute la hiérarchie, et exclut les préférences utilisateur non autorisées', () => {
    expect(resolveConfig(0, rows, context).source).toBe('product');
    expect(resolveConfig(0, rows, context, { preference: true }).source).toBe('user');
    for (const [i, row] of rows.entries()) {
      expect(resolveConfig(0, rows.slice(0, i + 1), context, { preference: true }).source).toBe(row.scope_type);
    }
  });
  it('préserve la priorité historique des politiques et ignore les périmètres absents', () => {
    const legacy = rows.filter(r => ['company','store','workshop','order_type','product'].includes(r.scope_type));
    expect(resolveConfig(90, legacy, { store: 'other' }).source).toBe('company');
    expect(resolveConfig(90, legacy, { workshop: 'workshop', product: 'missing' }).source).toBe('workshop');
    expect(resolveConfig(90, [], {}).value).toBe(90);
  });
  it('le pays verrouillé gagne et les écritures plus précises sont refusées', () => {
    const locked = rows.map(r => r.scope_type === 'country' ? { ...r, locked: true, lock_reason: 'regulatory' as const } : r);
    const rule = { lockable: true, preference: true };
    const result = resolveConfig(0, locked, context, rule);
    expect(result).toMatchObject({ source: 'country', locked: true });
    expect(result.trace.find(r => r.scope_type === 'store')?.state).toBe('blocked');
    for (const r of rows.slice(2)) expect(() => assertConfigWritable(r, locked, context, rule)).toThrow(/verrouillé/);
    expect(() => assertConfigWritable({ scope_type: 'sector', scope_id: 'primary', value: 2, locked: true, lock_reason: 'security' }, [], context, rule)).toThrow(/Verrou non autorisé/);
    expect(() => assertConfigWritable({ scope_type: 'user', scope_id: 'user', value: 2 }, [], context, {})).toThrow(/Niveau non autorisé/);
  });
  it('fusionne les spécialités selon les règles et impose un arbitrage entreprise en cas de conflit', () => {
    const pairs = <T>(a: T, b: T): ConfigValue<T>[] => [{ scope_type: 'specialization', scope_id: 'sp1', value: a }, { scope_type: 'specialization', scope_id: 'sp2', value: b }];
    expect(resolveConfig(false, pairs(false, true), context, { merge: 'or' }).value).toBe(true);
    expect(resolveConfig<string[]>([], pairs(['a'], ['a','b']), context, { merge: 'union' }).value).toEqual(['a','b']);
    expect(() => resolveConfig(0, pairs(1, 2), context)).toThrow(/arbitrage/);
    expect(resolveConfig(0, [...pairs(1, 2), { scope_type: 'company', scope_id: '', value: 3 }], context).value).toBe(3);
    expect(() => resolveConfig(0, [...pairs(1, 2), { scope_type: 'store', scope_id: 'store', value: 3 }], context)).toThrow(/arbitrage/);
  });
  it('le secteur principal est prioritaire sur un secteur secondaire', () => {
    expect(resolveConfig('socle', [{ scope_type: 'sector', scope_id: 'primary', value: 'principal' }, { scope_type: 'sector', scope_id: 'secondary', value: 'secondaire' }], context).value).toBe('principal');
  });
});
