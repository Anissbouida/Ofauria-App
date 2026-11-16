/**
 * G0-07 (plan d'action 2026-11) — garde : toute NOUVELLE mutation (POST, PUT,
 * PATCH) doit passer par un schéma de validation.
 *
 * Les mutations sans schéma à la date de cette tâche sont inscrites dans
 * fixtures/unvalidated-mutations.json. La liste ne peut que RÉTRÉCIR :
 *  - une mutation sans schéma absente de la liste fait échouer le test ;
 *  - une entrée de la liste qui a reçu son schéma (ou n'existe plus) aussi, pour
 *    que la liste reste exacte.
 * Régénérer après avoir ajouté des schémas :
 *   npx tsx scripts/audit-validation-routes.ts --write   (depuis server/)
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { scanRoutes } from '../utils/route-scan.js';

const ROUTES = fileURLToPath(new URL('../routes/', import.meta.url));
const allowlist: string[] = JSON.parse(readFileSync(fileURLToPath(new URL('./fixtures/unvalidated-mutations.json', import.meta.url)), 'utf8'));

describe('Garde : mutations sans schéma de validation (G0-07)', () => {
  const routes = scanRoutes(ROUTES).filter(r => r.method !== 'DELETE');
  const missing = routes.filter(r => !r.validated).map(r => r.key);

  it('l\'analyse voit bien les routes', () => {
    expect(routes.length).toBeGreaterThan(300);
  });

  it('aucune nouvelle mutation sans schéma', () => {
    const allowed = new Set(allowlist);
    const added = missing.filter(k => !allowed.has(k));
    expect(added, `Mutation(s) ajoutée(s) sans validate(...) :\n${added.join('\n')}`).toEqual([]);
  });

  it('la liste blanche est à jour (elle ne contient que des mutations encore sans schéma)', () => {
    const still = new Set(missing);
    const stale = allowlist.filter(k => !still.has(k));
    expect(stale, `Entrée(s) à retirer de fixtures/unvalidated-mutations.json :\n${stale.join('\n')}`).toEqual([]);
  });

  it('les factures, le stock de matières et la caisse sont validés', () => {
    const must = [
      'POST accounting:invoicesRouter /', 'PUT accounting:invoicesRouter /:id', 'POST accounting:invoicesRouter /merge',
      'POST inventory /restock', 'POST inventory /adjust', 'PUT inventory /threshold',
      'POST cash-register /open', 'POST cash-register /close', 'POST cash-register /:id/submit',
    ];
    const validated = new Set(routes.filter(r => r.validated).map(r => r.key));
    expect(must.filter(k => !validated.has(k))).toEqual([]);
  });
});
