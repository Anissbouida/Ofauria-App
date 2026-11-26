/**
 * Lot 2 du suivi multisectoriel (étape 1.5 de la feuille de route) — lecture unique de la
 * configuration : un paramètre se lit par getParameter() / companyCountryCode()
 * (services/module-parameters.service.ts, résolveur unique), une politique par resolvePolicy().
 * Plus aucun SELECT direct sur module_parameters dispersé dans les règles métier.
 *
 * Restent autorisés, et justifiés ici, les outils qui manipulent la configuration elle-même
 * (versions, santé, export, centre des réglages) : ils lisent toutes les clés, pas une règle.
 */
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'fs';
import { join, relative, resolve } from 'path';

const SRC = resolve(__dirname, '..');
const DIRECT = /\b(FROM|JOIN)\s+module_parameters\b/;
const ALLOWED = new Set([
  'services/module-parameters.service.ts', // le lecteur unique
  'repositories/config-layers.repository.ts', // couches de configuration (versions, comparaison)
  'repositories/governance.repository.ts', // gouvernance : instantané de toutes les clés
  'services/config-health.ts', // santé de la configuration : parcourt toutes les clés
  'services/settings-center.ts', // centre des réglages : liste et édite les clés
  'services/data-export.ts', // export intégral des données de la société
  'services/access-changes.ts', // changements d'accès : avant/après d'une clé de sécurité
  'services/production-setup.ts', // marqueur interne du simulateur (pas un réglage métier)
]);

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === '__tests__' || name === 'scripts' || name === 'node_modules') continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.ts$/.test(name)) out.push(p);
  }
  return out;
}

describe('Garde : lecture unique de la configuration (lot 2)', () => {
  it('aucune lecture directe de module_parameters hors du lecteur unique', () => {
    const hits: string[] = [];
    for (const f of walk(SRC)) {
      const rel = relative(SRC, f).split('\\').join('/');
      if (ALLOWED.has(rel)) continue;
      readFileSync(f, 'utf8').split('\n').forEach((line, i) => {
        const t = line.trim();
        if (t.startsWith('//') || t.startsWith('*') || t.startsWith('--')) return;
        if (DIRECT.test(line)) hits.push(`${rel}:${i + 1}  ${t.slice(0, 120)}`);
      });
    }
    expect(hits, `Lire par getParameter() (services/module-parameters.service.ts) :\n${hits.join('\n')}`).toEqual([]);
  });

  it('chaque exception existe encore (la liste ne garde pas de fichier disparu)', () => {
    const files = new Set(walk(SRC).map(f => relative(SRC, f).split('\\').join('/')));
    expect([...ALLOWED].filter(f => !files.has(f))).toEqual([]);
  });
});
