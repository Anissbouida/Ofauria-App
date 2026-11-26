/**
 * Garde « une route métier se ferme avec son module » (feuille de route Kalum par profil,
 * étape 1.2). Toute famille de routes montée dans routes/index.ts doit avoir une règle
 * d'activation (module ou capacité) ou figurer, justifiée, dans EXEMPT_PREFIXES.
 * Une nouvelle route oubliée resterait ouverte pour une société qui n'a pas le module.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { CAPABILITY_SCREENS } from '@ofauria/shared';
import { activationRuleFor, featureRuleFor, EXEMPT_PREFIXES } from '../middleware/module-activation.middleware.js';

const ROUTES = readFileSync(resolve(__dirname, '../routes/index.ts'), 'utf8');
const MOUNTED = [...new Set([...ROUTES.matchAll(/router\.use\(\s*'(\/[^']+)'/g)].map(m => m[1]))];
const MIGRATION = readFileSync(resolve(__dirname, '../../migrations/710_capacites_tous_modules.sql'), 'utf8');

describe('Garde : toute route montée est couverte par l’activation', () => {
  it('a trouvé les routes montées', () => {
    expect(MOUNTED.length).toBeGreaterThan(90);
  });

  it('chaque famille de routes a une règle ou une exemption justifiée', () => {
    const uncovered = MOUNTED.filter(p =>
      !EXEMPT_PREFIXES.some(e => p === e || p.startsWith(e + '/'))
      && !activationRuleFor(p) && !featureRuleFor(p));
    expect(uncovered).toEqual([]);
  });

  it('une exemption ne masque pas une règle existante', () => {
    expect(EXEMPT_PREFIXES.filter(e => activationRuleFor(e))).toEqual([]);
  });
});

describe('Registre des capacités hors Production', () => {
  it('chaque capacité du registre est inscrite par la migration 710', () => {
    const missing = CAPABILITY_SCREENS.filter(c => !MIGRATION.includes(`('${c.key}', '${c.module}',`)).map(c => c.key);
    expect(missing).toEqual([]);
  });

  it('chaque route d’une capacité est montée et fermée par la capacité', () => {
    for (const c of CAPABILITY_SCREENS) {
      for (const prefix of c.api) {
        expect(MOUNTED.some(m => m === prefix || prefix.startsWith(m + '/')), prefix).toBe(true);
        expect(featureRuleFor(prefix)?.feature, prefix).toBe(c.key);
      }
    }
  });

  it('la caisse garde son calcul de total quand les promotions sont éteintes', () => {
    expect(featureRuleFor('/promotions/evaluate')).toBeUndefined();
    expect(featureRuleFor('/promotions')?.feature).toBe('promotions_fidelite');
  });
});
