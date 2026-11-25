import { describe, it, expect } from 'vitest';
import { templateRights, templateFits, templateSod, templateActionKeys, roleTemplateIssues, type RoleTemplate } from '../services/wizard/role-templates.js';
import type { SodRule } from '../services/access-rules.js';

const tpl = (over: Partial<RoleTemplate> = {}): RoleTemplate => ({
  code: 'controleur_qualite', label: 'Contrôleur qualité', description: null, base_role: 'manager',
  sector_code: null, specialization_code: null, requires_modules: ['controle'], home_route: null, exists: false,
  permissions: [
    { module: 'controle', rights: 'vce', scope: 'all' },
    { module: 'production', rights: 'v', scope: 'all' },
    { module: 'dashboard', rights: 'v', scope: 'all' },
  ],
  ...over,
});
const rule = (over: Partial<SodRule> = {}): SodRule => ({ code: 'r', label: 'Saisie et validation', severity: 'critical', a_module: 'purchasing', a_right: 'create', b_module: 'purchasing', b_right: 'approve', ...over });

describe('Modèles de rôles (lot 11)', () => {
  it('limite les droits aux modules retenus, garde les modules socle', () => {
    const rows = templateRights(tpl(), ['controle']);
    expect(rows.map(r => r.module)).toEqual(['controle', 'dashboard']);
    expect(rows[0]).toMatchObject({ can_view: true, can_create: true, can_edit: true, can_delete: false, config: { scope: 'all' } });
  });

  it('ne propose un modèle que pour ses secteurs (ascendants compris), spécialités et modules', () => {
    const ctx = { lineage: new Set(['boulangerie', 'generique']), specialties: ['patisserie'], modules: ['production'] };
    expect(templateFits(tpl({ requires_modules: ['production'] }), ctx)).toBe(true);
    expect(templateFits(tpl({ requires_modules: ['controle'] }), ctx)).toBe(false);
    expect(templateFits(tpl({ sector_code: 'negoce', requires_modules: [] }), ctx)).toBe(false);
    expect(templateFits(tpl({ sector_code: 'boulangerie', specialization_code: 'chocolaterie', requires_modules: [] }), ctx)).toBe(false);
  });

  it('détecte la séparation des tâches, verbes métier compris', () => {
    const buyer = templateRights(tpl({ permissions: [{ module: 'purchasing', rights: 'vc', scope: 'all', verbs: ['approve'] }] }), ['purchasing']);
    expect(templateSod(buyer, [rule()])).toHaveLength(1);
    const direction = templateRights(tpl({ permissions: [{ module: 'purchasing', rights: 'v', scope: 'all', verbs: ['approve'] }] }), ['purchasing']);
    expect(templateSod(direction, [rule()])).toHaveLength(0);
  });

  it('bloque un conflit critique, avertit sinon, ignore une proposition inconnue', () => {
    const t = tpl({ code: 'acheteur', label: 'Acheteur', requires_modules: [], permissions: [{ module: 'purchasing', rights: 'vc', scope: 'all', verbs: ['approve'] }] });
    const answers = { modules: { data: { selected: ['purchasing'] } }, roles: { data: { selected: ['acheteur', 'Direction générale'] } } };
    const critical = roleTemplateIssues(answers, [t], [rule()], new Set());
    expect(critical.map(i => i.severity).sort()).toEqual(['blocking', 'warning']);
    const soft = roleTemplateIssues(answers, [t], [rule({ severity: 'warning' })], new Set());
    expect(soft.every(i => i.severity === 'warning')).toBe(true);
    // Un rôle déjà existant n'est jamais recréé : pas de contrôle.
    expect(roleTemplateIssues({ ...answers, roles: { data: { selected: ['acheteur'] } } }, [{ ...t, exists: true }], [rule()], new Set())).toEqual([]);
  });

  it('bloque un modèle devenu hors périmètre', () => {
    const issues = roleTemplateIssues({ modules: { data: { selected: [] } }, roles: { data: { selected: ['controleur_qualite'] } } }, [tpl()], [], new Set());
    expect(issues).toEqual([expect.objectContaining({ severity: 'blocking' })]);
  });

  it('reprend les droits par action du rôle de base pour les seuls modules accordés', () => {
    const rows = templateRights(tpl(), ['controle', 'production']);
    const keys = templateActionKeys(['controle.complaints.create', 'controle.complaints.indicators.view', 'production.confirm', 'accounting.accounts', 'inconnue.x'], rows);
    // controle : accès complet ; production : consultation seule ; comptabilité : non accordée.
    expect(keys).toEqual(['controle.complaints.create', 'controle.complaints.indicators.view']);
  });
});
