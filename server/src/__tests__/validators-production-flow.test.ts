/**
 * Plan pilote — étape 2, lot production : les corps que le client envoie réellement passent
 * (relevés dans client/src : bon-sortie.api, production.api, production-etapes.api,
 * production-cout.api, contenants.api, ContenantsPage, ProductionProfileTab, WorkshopsCard,
 * POSPage — réception des transferts de production), les champs non déclarés sont conservés
 * (passthrough), et les corps incohérents sont refusés.
 */
import { describe, it, expect } from 'vitest';
import * as S from '../validators/production-flow.validator.js';
import { emptyBody } from '../validators/common.validator.js';

const ID = '11111111-1111-4111-8111-111111111111';
type Schema = { safeParse: (v: unknown) => { success: boolean; data?: unknown } };
const ok = (schema: Schema, v: unknown) => expect(schema.safeParse(v).success).toBe(true);
const ko = (schema: Schema, v: unknown) => expect(schema.safeParse(v).success).toBe(false);

describe('Schémas production (plan pilote, étape 2)', () => {
  it('bons de sortie : génération, régénération, pesée, remise, refus', () => {
    ok(S.generateBonBody, { planId: ID, storeId: ID });
    ok(S.generateBonBody, { planId: ID, storeId: ID, derogationDlc: { motif: 'Lot unique disponible' } });
    ko(S.generateBonBody, { planId: 'abc', storeId: ID });
    ko(S.generateBonBody, { planId: ID, storeId: ID, derogationDlc: { motif: 'ok' } });
    ok(S.regenerateBonBody, {});
    ok(S.regenerateBonBody, undefined);

    // Pesée : 0 accepté (ligne non servie), mesure négative refusée.
    ok(S.updateLigneBody, { actualQuantity: 1.25, source: 'scale', tareQuantity: 0.1, containerCount: 2 });
    ok(S.updateLigneBody, { actualQuantity: 0, reason: 'Rupture constatée' });
    ko(S.updateLigneBody, { actualQuantity: -1 });
    ko(S.updateLigneBody, { actualQuantity: 1, source: 'balance' });
    ok(S.weighLignesBody, { lines: [{ ligneId: ID, actualQuantity: 2.4 }, { ligneId: ID, actualQuantity: 0.5, lotId: ID }] });
    ko(S.weighLignesBody, { lines: [] });

    ok(S.markReadyBody, {});
    ok(S.markReadyBody, { withMissing: true });
    ok(S.chefRejectBody, { reason: 'Quantité de farine incorrecte' });
    ko(S.chefRejectBody, { reason: '   ' });
    ok(S.cancelBonBody, undefined);
    ok(S.transferLineBody, {});
    ok(S.transferLineBody, { overrideLotId: ID, overrideQty: 5, containerCount: 1, containerTypeId: ID });
    ko(S.transferLineBody, { overrideQty: 0 });
  });

  it('bons de sortie : un champ non déclaré est conservé', () => {
    const r = S.updateLigneBody.safeParse({ actualQuantity: 1, scaleId: 'B2' });
    expect(r.success).toBe(true);
    expect((r.data as { scaleId: string }).scaleId).toBe('B2');
  });

  it('formats de production et profil produit', () => {
    const format = {
      nom: 'Cadre 60x40', type_production: 2, unite_lancement: 'plaque', quantite_theorique: 48, pertes_fixes: 0,
      seuil_rendement_defaut: undefined, categories_pertes: ['casse', 'cuisson'],
      longueur_cm: 60, largeur_cm: 40, profondeur_cm: null, diametre_cm: null, type_decoupe: null, nb_pieces_decoupe: null,
    };
    ok(S.createContenantBody, format);
    ok(S.updateContenantBody, { nom: 'Cadre 60x40 bis' });
    ko(S.createContenantBody, { ...format, quantite_theorique: 0 });
    ko(S.createContenantBody, { ...format, type_production: 9 });
    ok(S.bulkContenantIdsBody, { ids: [ID] });
    ko(S.bulkContenantIdsBody, { ids: [] });
    ok(S.upsertProfileBody, {
      contenant_id: ID, surcharge_quantite_theorique: null, surcharge_pertes_fixes: 2, surcharge_seuil_rendement: null,
      etapes_surcharges: [], notes: null,
    });
    ko(S.upsertProfileBody, { contenant_id: ID, surcharge_seuil_rendement: 150 });
  });

  it('coûts : équipements, temps de travail, usage', () => {
    ok(S.createEquipementBody, { nom: 'Four à sole', type: 'four', cout_horaire: 12, puissance_kw: 18 });
    ko(S.createEquipementBody, { nom: 'Four', type: 'four', cout_horaire: -1 });
    ok(S.updateEquipementBody, { cout_kwh: 1.6 });
    ok(S.recordTempsTravailBody, { employee_id: ID, debut: '2026-11-18T05:00:00.000Z', duree_minutes: 90, plan_item_id: ID });
    ko(S.recordTempsTravailBody, { employee_id: ID, debut: 'hier' });
    ok(S.recordEquipementUsageBody, { equipement_id: ID, debut: '2026-11-18T05:00:00.000Z', fin: '2026-11-18T06:00:00.000Z' });
  });

  it('étapes : statut, répétition, relevé, rétro-planning, rendement, affectation', () => {
    ok(S.updateEtapeStatusBody, { status: 'completed', checklist_resultats: [{ label: 'Pousse', ok: true }], duree_reelle_min: 35 });
    ok(S.updateEtapeStatusBody, { status: 'completed', good_qty: 40, scrap_qty: 0 });
    ko(S.updateEtapeStatusBody, { status: 'done' });
    ok(S.completeRepetitionBody, { notes: undefined });
    ok(S.addReadingBody, { parametre: 'temperature_coeur', consigne: 92, tolerance: 2, mesure: 93.5, est_ccp: true });
    ko(S.addReadingBody, { parametre: 'temperature_coeur' });
    ok(S.retroPlanningBody, { heure_vitrine: undefined });
    ok(S.retroPlanningBody, { heure_vitrine: '07:30' });
    ko(S.retroPlanningBody, { heure_vitrine: '7h30' });

    ok(S.recordRendementBody, { quantite_brute: 50, quantite_nette_reelle: 47, vers_magasin: 45, vers_frigo: 2, pertes_detail: [{ categorie: 'casse', quantite: 3 }] });
    ok(S.recordRendementBody, { quantite_brute: 0, quantite_nette_reelle: 0, vers_magasin: 0 });
    ko(S.recordRendementBody, { quantite_brute: 50, quantite_nette_reelle: -1, vers_magasin: 0 });

    ok(S.assignEtapeSchema, { workCenterId: ID });
    ok(S.assignEtapeSchema, { workCenterId: null, assignedEmployeeId: '' });
    ko(S.assignEtapeSchema, { assignedEmployeeId: 'Karim' });
    // null = retirer : il ne doit pas devenir « absent ».
    expect((S.assignEtapeSchema.safeParse({ workCenterId: null }).data as { workCenterId: unknown }).workCenterId).toBeNull();
  });

  it('production : paramètres, ateliers, calcul des besoins, réception de transfert', () => {
    ok(S.productionSettingsSchema, { chargesFixesPct: 15, overproductionPct: '5', markupPercent: 30, stepsEnabled: true, costEnabled: false });
    ok(S.productionSettingsSchema, { chargesFixesPct: '' });
    ko(S.productionSettingsSchema, { markupPercent: 'trente' });

    ok(S.saveWorkshopSchema, {
      label: 'Viennoiserie', workCenterId: null, isDefault: false, isActive: true, sortOrder: 20,
      categoryIds: [3, 7], memberRoles: ['chef_viennoiserie'], memberUsers: [ID],
    });
    ok(S.saveWorkshopSchema, { label: '' });
    ko(S.saveWorkshopSchema, { label: 'Atelier', categoryIds: ['viennoiserie'] });

    ok(S.mrpGenerateSchema, { date: '2026-11-19' });
    ok(S.mrpGenerateSchema, { date: '2026-11-19', store: ID });
    ok(S.mrpGenerateSchema, {});
    ko(S.mrpGenerateSchema, { date: 20261119 });

    // POSPage : qtyReceived = nombre saisi, ou quantité transférée lue en base (texte numeric).
    ok(S.receiveProductionTransferSchema, { items: [{ itemId: ID, qtyReceived: 12, notes: undefined }] });
    ok(S.receiveProductionTransferSchema, { items: [{ itemId: ID, qtyReceived: '12.000' }, { itemId: ID, qtyReceived: 0, notes: 'Cassé' }] });
    ok(S.receiveProductionTransferSchema, {});
    ko(S.receiveProductionTransferSchema, { items: [{ itemId: 'x', qtyReceived: 1 }] });
    ko(S.receiveProductionTransferSchema, { items: [{ itemId: ID, qtyReceived: 'douze' }] });
    const r = S.receiveProductionTransferSchema.safeParse({ items: [{ itemId: ID, qtyReceived: '12.5' }] });
    expect((r.data as { items: { qtyReceived: number }[] }).items[0].qtyReceived).toBe(12.5);
  });

  it('actions sans corps (confirmer, démarrer, pause, calcul…)', () => {
    ok(emptyBody, undefined);
    ok(emptyBody, {});
  });
});
