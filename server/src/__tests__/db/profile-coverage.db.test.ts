/**
 * C-02 — « exportable et livré dans un profil » dans la définition de fini.
 * Toute politique du catalogue réglable au niveau société a une valeur dans au moins un profil
 * de référence autre que la boulangerie (preuve qu'elle est réellement paramétrable), ou figure
 * ci-dessous avec la raison écrite pour laquelle elle n'a pas à l'être.
 * Ajouter une politique sans faire l'un ou l'autre fait échouer ce test.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { hasTestDb, testPool, closeTestPool } from './helpers.js';

/** Politiques sans valeur de profil, et pourquoi. */
const EXCEPTIONS: Record<string, string> = {
  'production.yield_target': 'Cible chiffrée propre à chaque atelier ; la valeur par défaut (90 %) vaut pour tous les métiers.',
  'production.yield_display': 'Préférence d\'affichage, pas un réglage de métier.',
  'production.kwh_price': 'Prix de l\'énergie propre au contrat de chaque société.',
  'production.margin_multiplier': 'Politique commerciale propre à chaque société.',
  'production.mrp_horizon': 'Horizon de planification propre à chaque société ; la valeur par défaut convient à tous les métiers.',
  'production.showcase_time': 'Heure de mise en vitrine : option « vitrine », propre à la boulangerie.',
  'production.shift_cutoff': 'Heure de coupure d\'équipe propre à chaque établissement.',
  'production.oee_thresholds': 'Seuils de TRS propres à chaque atelier.',
  'production.forecast_history': 'Profondeur d\'historique de prévision, sans lien avec le métier.',
  'production.replenishment_history': 'Profondeur d\'historique des demandes boutique, sans lien avec le métier.',
};

describe.skipIf(!hasTestDb)('Définition de fini : réglages livrés dans un profil (C-02)', () => {
  let policyKeys: string[] = [];
  let covered = new Set<string>();

  beforeAll(async () => {
    const { policyDefinitions } = await import('../../services/policies.js');
    policyKeys = policyDefinitions().filter(d => d.domain === 'production' && d.scopes?.includes('company')).map(d => d.key);
    const rows = (await testPool().query(
      `SELECT profile FROM sector_packs WHERE NOT is_custom AND code <> 'boulangerie'`)).rows;
    covered = new Set(rows.flatMap(r => (r.profile?.policies ?? []).map((p: { key: string }) => p.key)));
  });
  afterAll(async () => { await closeTestPool(); });

  it('chaque politique de production est livrée dans un profil ou justifiée', () => {
    const orphans = policyKeys.filter(k => !covered.has(k) && !EXCEPTIONS[k]);
    expect(orphans, `Donner une valeur dans un profil de référence (mig 586/590) ou justifier dans EXCEPTIONS : ${orphans.join(', ')}`).toEqual([]);
  });

  it('pas d\'exception obsolète (politique disparue ou désormais livrée)', () => {
    const stale = Object.keys(EXCEPTIONS).filter(k => !policyKeys.includes(k) || covered.has(k));
    expect(stale).toEqual([]);
  });
});
