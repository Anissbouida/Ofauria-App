/**
 * Lot L0 de l'audit de cohérence des profils : chaque écran déclare ce dont il a besoin
 * (shared/src/constants/screen-needs.ts). Sur les 18 profils standard :
 *   - le registre ne cite que des modules et des capacités qui existent ;
 *   - chaque adresse gardée existe dans l'application ;
 *   - Boulangerie (Ofauria) ne perd aucun écran ;
 *   - un profil sans caisse, sans production ou sans capacités alimentaires ne voit pas les
 *     écrans qui en dépendent.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { hasTestDb, testPool, closeTestPool } from './helpers.js';
import { SCREEN_NEEDS, ROUTE_NEEDS, needsMet, capabilityDefault, CORE_MODULES, APP_MODULES, resolveModuleKeys } from '@ofauria/shared';

describe.skipIf(!hasTestDb)('Écrans selon le profil (18 profils)', () => {
  type Ctx = { moduleActive: (m: string) => boolean; hasFeature: (f: string) => boolean };
  const profiles = new Map<string, Ctx>();
  let featureKeys = new Set<string>();

  beforeAll(async () => {
    const catalog = (await testPool().query(`SELECT key, module_key, label, default_on FROM app_features`)).rows;
    featureKeys = new Set(catalog.map(f => f.key as string));
    const packs = (await testPool().query(`SELECT code, enabled_modules, features, off_features FROM sector_packs WHERE NOT COALESCE(is_custom, false)`)).rows;
    for (const p of packs) {
      const mods = new Set<string>([...CORE_MODULES, ...((p.enabled_modules ?? []) as string[])]);
      const moduleActive = (m: string) => resolveModuleKeys(m).some(k => mods.has(k));
      const feats = new Set(catalog.filter(f => capabilityDefault(f, p.features ?? [], f.key, p.off_features ?? []) && moduleActive(f.module_key)).map(f => f.key as string));
      profiles.set(p.code, { moduleActive, hasFeature: f => feats.has(f) });
    }
  });
  afterAll(async () => { await closeTestPool(); });

  const hidden = (code: string) => Object.entries(SCREEN_NEEDS).filter(([, n]) => !needsMet(n, profiles.get(code)!)).map(([k]) => k).sort();

  it('le registre ne cite que des modules et des capacités existants', () => {
    const modules = new Set<string>(Object.values(APP_MODULES));
    const all = [...Object.values(SCREEN_NEEDS), ...ROUTE_NEEDS.map(r => r.needs)];
    expect(all.flatMap(n => [...(n.modules ?? []), ...(n.anyModules ?? [])]).filter(m => !modules.has(m))).toEqual([]);
    expect(all.flatMap(n => n.features ?? []).filter(f => !featureKeys.has(f))).toEqual([]);
  });

  it('chaque adresse gardée existe dans l’application', () => {
    const app = readFileSync(resolve(__dirname, '../../../../client/src/App.tsx'), 'utf8');
    expect(ROUTE_NEEDS.map(r => r.prefix).filter(p => !app.includes(`path="${p}`))).toEqual([]);
  });

  it('18 profils standard, et Boulangerie (Ofauria) ne perd aucun écran', () => {
    expect(profiles.size).toBeGreaterThanOrEqual(18);
    expect(hidden('boulangerie')).toEqual([]);
  });

  it('sans caisse ni production ni capacités alimentaires, leurs écrans disparaissent', () => {
    const btp = hidden('btp');
    for (const k of ['sales:sales:sales', 'sales:sales:sessions', 'accounting:caisse', 'employees:commissions', 'stock:pesee', 'stock:bons', 'stock:registre', 'controle:production', 'reports:menu'])
      expect(btp).toContain(k);
    // Services : ni stock ni commandes.
    expect(hidden('services')).toEqual(expect.arrayContaining(['purchasing:identification', 'sales:sales:routes', 'accounting:losses']));
    // Négoce : caisse oui (tickets visibles), production non (bons de sortie masqués).
    const negoce = hidden('negoce');
    expect(negoce).not.toContain('sales:sales:sales');
    expect(negoce).toContain('stock:bons');
  });
});
