import { describe, it, expect } from 'vitest';
import { hasRight, hasVerb, effectiveScope, scopeStoreFilter, unionRights, moduleKeys, hasCapability, evaluateSod } from '../services/access-rules.js';
import type { EffectiveRights, RightRow, SodRule } from '../services/access-rules.js';

const row = (module: string, p: Partial<RightRow> = {}): RightRow => ({
  module, can_view: true, can_create: false, can_edit: false, can_delete: false, config: {}, ...p,
});

const rights = (rows: RightRow[], over: Partial<EffectiveRights> = {}): EffectiveRights => ({
  roleCode: 'manager', baseRole: 'manager', roles: ['manager'], baseRoles: ['manager'],
  isAdmin: false, source: 'role', rows, ...over,
});

describe('moduleKeys (alias fusion Stock)', () => {
  it('résout un module et ses alias historiques dans les deux sens', () => {
    expect(moduleKeys('stock')).toEqual(expect.arrayContaining(['stock', 'economat', 'inventory', 'pesage', 'warehouse']));
    expect(moduleKeys('economat')).toEqual(expect.arrayContaining(['stock', 'economat']));
  });
});

describe('hasRight', () => {
  it('admin : tout, sans ligne', () => {
    expect(hasRight(rights([], { isAdmin: true }), ['accounting'], 'delete')).toBe(true);
  });
  it('accordé si une ligne du module porte l’action', () => {
    expect(hasRight(rights([row('purchasing', { can_create: true })]), ['purchasing'], 'create')).toBe(true);
    expect(hasRight(rights([row('purchasing', { can_create: true })]), ['purchasing'], 'delete')).toBe(false);
  });
  it('un alias vaut pour le module canonique', () => {
    expect(hasRight(rights([row('economat', { can_edit: true })]), ['stock'], 'edit')).toBe(true);
  });
});

describe('hasVerb (verbes métier)', () => {
  it('accordé si config.verbs contient le verbe', () => {
    const r = rights([row('purchasing', { config: { verbs: ['approve'] } })]);
    expect(hasVerb(r, ['purchasing'], 'approve')).toBe(true);
    expect(hasVerb(r, ['purchasing'], 'post')).toBe(false);
  });
  it('admin : tous les verbes', () => {
    expect(hasVerb(rights([], { isAdmin: true }), ['accounting'], 'post')).toBe(true);
  });
});

describe('effectiveScope (portée des données)', () => {
  it('défaut : établissement quand non précisé', () => {
    expect(effectiveScope(rights([row('sales')]), 'sales')).toBe('store');
  });
  it('admin : tous', () => {
    expect(effectiveScope(rights([], { isAdmin: true }), 'sales')).toBe('all');
  });
  it('la plus permissive gagne entre lignes (all > store > own)', () => {
    const r = rights([row('sales', { config: { scope: 'own' } }), row('sales', { config: { scope: 'all' } })]);
    expect(effectiveScope(r, 'sales')).toBe('all');
  });
});

describe('unionRights (rôles multiples)', () => {
  it('OR des droits CRUD par module', () => {
    const u = unionRights([
      row('production', { can_create: true }),
      row('production', { can_edit: true }),
    ]);
    expect(u).toHaveLength(1);
    expect(u[0]).toMatchObject({ module: 'production', can_view: true, can_create: true, can_edit: true });
  });
  it('union des verbes et portée la plus permissive', () => {
    const u = unionRights([
      row('purchasing', { config: { verbs: ['approve'], scope: 'store' } }),
      row('purchasing', { config: { verbs: ['post'], scope: 'all' } }),
    ]);
    expect((u[0].config.verbs as string[]).sort()).toEqual(['approve', 'post']);
    expect(u[0].config.scope).toBe('all');
  });
  it('union des tableaux de config (ex. catégories des chefs)', () => {
    const u = unionRights([
      row('production', { config: { category_slugs: ['viennoiseries'] } }),
      row('production', { config: { category_slugs: ['macaron'] } }),
    ]);
    expect((u[0].config.category_slugs as string[]).sort()).toEqual(['macaron', 'viennoiseries']);
  });
});

describe('scopeStoreFilter (portée → filtre de requête)', () => {
  it('all : aucun filtre', () => expect(scopeStoreFilter('all', 's1', 'u1')).toEqual({}));
  it('store : établissement de l\'utilisateur', () => expect(scopeStoreFilter('store', 's1', 'u1')).toEqual({ storeId: 's1' }));
  it('own : enregistrements créés par l\'utilisateur', () => expect(scopeStoreFilter('own', 's1', 'u1')).toEqual({ createdBy: 'u1' }));
});

describe('hasCapability (gouvernance)', () => {
  it('résout une action CRUD ou un verbe métier', () => {
    const r = rights([row('purchasing', { can_create: true, config: { verbs: ['approve'] } })]);
    expect(hasCapability(r, ['purchasing'], 'create')).toBe(true);
    expect(hasCapability(r, ['purchasing'], 'approve')).toBe(true);
    expect(hasCapability(r, ['purchasing'], 'delete')).toBe(false);
    expect(hasCapability(r, ['purchasing'], 'post')).toBe(false);
  });
});

describe('evaluateSod (séparation des tâches)', () => {
  const rule: SodRule = { code: 'achat_cr_appr', label: 'Créer et approuver', severity: 'critical', a_module: 'purchasing', a_right: 'create', b_module: 'purchasing', b_right: 'approve' };
  it('conflit si les deux capacités sont détenues', () => {
    const r = rights([row('purchasing', { can_create: true, config: { verbs: ['approve'] } })]);
    expect(evaluateSod(r, [rule]).map(v => v.code)).toEqual(['achat_cr_appr']);
  });
  it('pas de conflit avec une seule capacité', () => {
    expect(evaluateSod(rights([row('purchasing', { can_create: true })]), [rule])).toEqual([]);
  });
  it('administrateur exempté', () => {
    expect(evaluateSod(rights([], { isAdmin: true }), [rule])).toEqual([]);
  });
});
