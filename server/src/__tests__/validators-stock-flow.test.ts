/**
 * Plan pilote — étape 3, lot stock : les corps que le client envoie réellement passent
 * (relevés dans client/src : inventory.api, LotMovementModal, ReceptionChecks, IngredientFormModal,
 * PackagingPage, ProductTransfersPage, opening-inventory-check.api, lot-thermal.api, EmplacementsTab,
 * StockClosingTab, product-lot.api), les champs non déclarés sont conservés (passthrough), et les
 * corps incohérents sont refusés. Aucun signe imposé là où le code n'en impose pas.
 */
import { describe, it, expect } from 'vitest';
import * as S from '../validators/stock-flow.validator.js';
import { emptyBody } from '../validators/common.validator.js';

const ID = '11111111-1111-4111-8111-111111111111';
const ID2 = '22222222-2222-4222-8222-222222222222';
type Parser = { safeParse: (v: unknown) => { success: boolean; data?: unknown } };
const ok = (schema: Parser, v: unknown) => expect(schema.safeParse(v).success).toBe(true);
const ko = (schema: Parser, v: unknown) => expect(schema.safeParse(v).success).toBe(false);
const out = (schema: Parser, v: unknown) => schema.safeParse(v).data as Record<string, unknown>;

describe('Schémas stock (plan pilote, étape 3)', () => {
  it('lots matière : mouvements du LotMovementModal', () => {
    ok(S.lotMovementSchema, { type: 'open', quantity: 2.5, containerCount: 1, reason: undefined });
    ok(S.lotMovementSchema, { type: 'return', quantity: 0.4, containerCount: undefined });
    ok(S.lotMovementSchema, { type: 'waste', quantity: 0.2, reasonCode: 'casse', reason: 'Casse — sac percé' });
    ok(S.lotMovementSchema, { type: 'losses', reason: 'dlc_expired', note: undefined });
    // Le contrôleur exige lui-même quantité > 0 et motif selon le type : pas refusé ici.
    ok(S.lotMovementSchema, { type: 'open' });
    ko(S.lotMovementSchema, { type: 'open', quantity: 'beaucoup' });
    ko(S.lotMovementSchema, { type: 'open', quantity: 1, containerCount: 'x' });
  });

  it('lots matière : quarantaine sans corps, déplacement, pesage, pertes', () => {
    ok(S.lotQuarantineSchema, undefined);
    ok(S.lotQuarantineSchema, { reason: 'Contrôle en cours' });
    ok(S.lotMoveLocationSchema, { toLocationId: ID, motif: undefined });
    ok(S.lotMoveLocationSchema, {}); // « Emplacement de destination requis » : message du contrôleur
    ko(S.lotMoveLocationSchema, { toLocationId: 'chambre-froide' });
    ok(S.lotQuantityActionSchema, { quantity: 3, containerCount: 2, reason: 'avance' });
    ok(S.lotQuantityActionSchema, { quantity: '1.5', reason: 'reliquat' });
    ok(S.lotSendToLossesSchema, { reason: 'damaged', note: 'sac éventré' });
    ko(S.lotSendToLossesSchema, { reason: 12 });
  });

  it('contrôle à réception : critères booléens ou sans objet, température négative', () => {
    const body = { temperatureOk: null, temperatureValue: null, visualOk: true, packagingOk: true, labelsOk: false, overallConformity: false, notes: undefined };
    ok(S.receptionQualityCheckSchema, body);
    ok(S.receptionQualityCheckSchema, { ...body, temperatureOk: true, temperatureValue: -18.5 });
    expect(out(S.receptionQualityCheckSchema, body).temperatureValue).toBeNull();
    ko(S.receptionQualityCheckSchema, { ...body, visualOk: 'oui' });
    ko(S.receptionQualityCheckSchema, { ...body, temperatureValue: 'froid' });
  });

  it('lots produits : pertes et stock orphelin, réconciliation sans corps', () => {
    ok(S.lotSendToLossesSchema, { reason: 'dlv_expired', note: undefined });
    ok(S.orphanToLossesSchema, { productId: ID, reason: 'other', note: 'reste vitrine' });
    ko(S.orphanToLossesSchema, { productId: 'abc', reason: 'other' });
    ok(emptyBody, undefined);
    ok(emptyBody, {});
  });

  it('clôture de stock : corps de StockClosingTab', () => {
    ok(S.stockClosingSchema, { periodLabel: 'Novembre 2026', closingDate: '2026-11-30' });
    ok(S.stockClosingSchema, {}); // « Libellé de période et date requis » : message du contrôleur
    ko(S.stockClosingSchema, { periodLabel: 'Novembre 2026', closingDate: 'demain' });
    ko(S.stockClosingSchema, { periodLabel: 'x'.repeat(41), closingDate: '2026-11-30' });
  });

  it('fiche ingrédient : création et modification (IngredientFormModal), valeurs transmises telles quelles', () => {
    const create = {
      name: 'Farine T55', unit: 'kg', unitCost: 7.2, supplier: undefined, categoryId: ID,
      containerTypeId: ID2, containerSize: 25, densiteKgL: null, poidsPieceKg: null, allergens: ['gluten'],
      __unknown: 'conservé',
    };
    ok(S.createIngredientSchema, create);
    const r = out(S.createIngredientSchema, create);
    expect(r.allergens).toEqual(['gluten']);
    expect(r.__unknown).toBe('conservé');
    ok(S.createIngredientSchema, { ...create, categoryId: null, containerTypeId: null, containerSize: null });
    ko(S.createIngredientSchema, { ...create, name: '  ' });
    ko(S.createIngredientSchema, { ...create, unitCost: undefined });
    ko(S.createIngredientSchema, { ...create, categoryId: 'farines' });
    ok(S.updateIngredientSchema, { ...create, threshold: 5 });
    ok(S.updateIngredientSchema, { categoryId: ID }); // PurchaseOrdersTab : reclassement seul
    expect(out(S.updateIngredientSchema, { categoryId: null }).categoryId).toBeNull(); // null = vider, pas « absent »
    ko(S.updateIngredientSchema, { containerSize: 'grand' });
    ok(S.convertToConsumableSchema, { categoryId: ID });
    ok(S.convertToConsumableSchema, { categoryId: '' });
  });

  it('emballages : fiche (PackagingPage) et ajustement signé', () => {
    const form = { name: 'Boîte 24 cm', format: '', unit: 'piece', unit_cost: 3.5, supplier: '', category_id: '', is_recyclable: false, is_compostable: false, is_food_safe: true, notes: '' };
    ok(S.createPackagingSchema, form);
    ok(S.createPackagingSchema, { name: 'Sachet', unit: 'piece', category_id: ID, unit_cost: 0.2 }); // PurchaseOrdersTab
    ok(S.updatePackagingSchema, { category_id: ID });
    ok(S.updatePackagingSchema, { ...form, is_active: false });
    ko(S.createPackagingSchema, { ...form, name: '' });
    ko(S.updatePackagingSchema, { is_food_safe: 'oui' });
    ok(S.packagingAdjustStockSchema, { quantity: 50, type: 'reception', note: '', unitCost: 3.4 });
    ok(S.packagingAdjustStockSchema, { quantity: -4, type: 'waste', note: 'abîmés', unitCost: undefined });
    ok(S.packagingAdjustStockSchema, { quantity: -2 }); // type 'adjustment' par défaut côté contrôleur
    ko(S.packagingAdjustStockSchema, { quantity: 'NaN', type: 'reception' });
    ko(S.packagingAdjustStockSchema, { quantity: 1, type: 'vol' });
  });

  it('transfert de produits finis : corps de ProductTransfersPage', () => {
    ok(S.productTransferSchema, { fromStoreId: ID, toStoreId: ID2, items: [{ productId: ID, quantity: 12 }], notes: '' });
    ok(S.productTransferSchema, { fromStoreId: '', toStoreId: '', items: [] }); // messages du contrôleur / dépôt
    ko(S.productTransferSchema, { fromStoreId: 'boutique', toStoreId: ID2, items: [] });
    ko(S.productTransferSchema, { fromStoreId: ID, toStoreId: ID2, items: [{ productId: ID, quantity: 'douze' }] });
  });

  it("contrôle d'ouverture : recomptage et validation", () => {
    const body = { previousCheckId: null, items: [{ productId: ID, expectedQty: 4, foundQty: 4 }, { productId: ID2, expectedQty: 3, foundQty: 0, missingReason: 'theft' }], notes: undefined };
    ok(S.openingCheckSchema, body);
    ok(S.openingCheckSchema, { ...body, previousCheckId: ID });
    ko(S.openingCheckSchema, { ...body, items: [{ productId: ID, expectedQty: '4', foundQty: 4 }] }); // sommes et !== côté dépôt
    ko(S.openingCheckSchema, { ...body, items: [{ productId: ID, expectedQty: 4, foundQty: 2.5 }] }); // colonne INTEGER
    ko(S.openingCheckSchema, { ...body, items: [{ productId: ID, expectedQty: 4, foundQty: 3, missingReason: 'perdu' }] });
    ok(S.openingCheckValidateSchema, { action: 'approve' });
    ok(S.openingCheckValidateSchema, { action: 'reject', rejectionReason: 'Recompter' });
  });

  it('état thermique : décongélation avec ou sans durée', () => {
    ok(S.lotThawSchema, { dureeVieHeures: 48 });
    ok(S.lotThawSchema, { dureeVieHeures: undefined });
    ok(S.lotThawSchema, undefined);
    ko(S.lotThawSchema, { dureeVieHeures: 'deux jours' });
  });

  it('stock frigo et emplacements : schémas existants, champs non déclarés conservés', () => {
    const surplus = { productId: ID, quantity: 2, storeId: ID2 };
    expect(out(S.frigoSurplusSchema, surplus).storeId).toBe(ID2);
    ok(S.frigoConsumeSchema, { productId: ID, quantity: 1, storeId: ID2 });
    ok(S.frigoLossSchema, { quantity: 1, type: 'expired' });
    ok(S.frigoAdjustSchema, { quantity: 0, notes: 'recompté' }); // quantité comptée nulle admise
    ko(S.frigoAdjustSchema, { quantity: -1 });
    ko(S.frigoLossSchema, { quantity: 1, type: 'vol' });
    const loc = { code: 'CF1', name: 'Chambre froide', type: 'positif', parentId: null, equipementId: null, tempMin: 0, tempMax: 4, capaciteUnite: null, capaciteValeur: null };
    ok(S.stockLocationCreateSchema, loc);
    ok(S.stockLocationUpdateSchema, { tempMin: null });
    ko(S.stockLocationCreateSchema, { ...loc, type: 'garage' });
    ko(S.stockLocationCreateSchema, { ...loc, tempMin: Number.NaN });
  });
});
