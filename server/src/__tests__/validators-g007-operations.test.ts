/**
 * G0-07 — lot catalogue, ventes, qualité, comptabilité et outils : corps réellement envoyés
 * par les écrans (products.api, quality.api, routings.api, delivery-routes.api, pricing.api,
 * fixed-assets.api, categories…) admis, champs inconnus conservés, types faux refusés.
 */
import { describe, it, expect } from 'vitest';
import * as P from '../validators/product.validator.js';
import * as SI from '../validators/supplier-item.validator.js';
import * as DR from '../validators/delivery-route.validator.js';
import * as Q from '../validators/quality.validator.js';
import * as R from '../validators/routing.validator.js';
import * as PR from '../validators/pricing.validator.js';
import * as RF from '../validators/referentiel.validator.js';
import * as AP from '../validators/approval.validator.js';
import * as CC from '../validators/cost-center.validator.js';
import * as HA from '../validators/haccp.validator.js';
import * as DU from '../validators/dunning.validator.js';
import * as ST from '../validators/sales-terms.validator.js';
import * as CAT from '../validators/category.validator.js';
import * as FA from '../validators/fixed-asset.validator.js';
import * as AS from '../validators/accounting-setup.validator.js';
import * as CS from '../validators/catalog-settings.validator.js';
import * as PP from '../validators/product-pipeline.validator.js';
import * as PRN from '../validators/printer.validator.js';
import * as REP from '../validators/reports.validator.js';
import { approveLeaveSchema, employeeDocumentSchema } from '../validators/employees.validator.js';

const ID = '00000000-0000-0000-0000-000000000001';
type Schema = { safeParse: (v: unknown) => { success: boolean; data?: unknown } };
const ok = (s: Schema, v: unknown) => expect(s.safeParse(v).success).toBe(true);
const ko = (s: Schema, v: unknown) => expect(s.safeParse(v).success).toBe(false);
const out = (s: Schema, v: unknown) => s.safeParse(v).data as Record<string, unknown>;

describe('Catalogue et achats', () => {
  it('produit : stock, paliers, prix par canal, actions sans corps', () => {
    ok(P.adjustProductStockSchema, { quantity: '5', note: 'Inventaire', lotNumber: 'L1', expiresAt: '2026-12-01', unitCost: '' });
    ko(P.adjustProductStockSchema, { quantity: { n: 1 } });
    ok(P.pricingTiersSchema, { tiers: [{ min_grammes: 0, max_grammes: null, prix_per_kg: 120, display_order: 0 }] });
    ok(P.channelPricingSchema, { items: [{ channel_id: ID, price_override: 12, price_per_kg_override: null }] });
    ko(P.channelPricingSchema, { items: 'tout' });
    ok(P.productNoBodySchema, undefined);
  });
  it('catalogue fournisseur', () => {
    ok(SI.createSupplierItemSchema, { supplierId: ID, kind: 'ingredient', purchasableId: ID, qtyPerContainer: '25', moq: null, isBlocked: false });
    ko(SI.createSupplierItemSchema, { supplierId: 'abc', kind: 'ingredient', purchasableId: ID });
    ok(SI.supplierItemPriceSchema, { price: 12.5, priceUnit: 'container', validFrom: '2026-11-01' });
    ok(SI.updateSupplierItemSchema, { notes: null, containerTypeId: 3 });
  });
  it('catégories (identifiant entier) : nom texte requis à la création', () => {
    ok(CAT.createCategorySchema, { name: 'Viennoiseries', displayOrder: 2 });
    ko(CAT.createCategorySchema, { description: 'sans nom' });
    ok(CAT.updateCategorySchema, { family: null, displayOrder: 0 });
  });
  it('listes de prix', () => {
    ok(PR.priceListSchema, { name: 'Pros', channelId: '', priority: '10', isActive: true });
    ok(PR.priceListItemSchema, { productId: ID, unitPrice: 9.9, minQuantity: 1 });
    ok(PR.bulkPriceUpdateSchema, { mode: 'increase_pct', value: -5, categoryId: 3 });
    ko(PR.bulkPriceUpdateSchema, { mode: 'set', value: 'dix' });
  });
  it('référentiels : champs communs typés, champs propres à la table conservés', () => {
    const r = out(RF.refEntrySchema, { label: 'Sac 25 kg', metadata: { kg: 25 }, display_order: 3 });
    expect(r.display_order).toBe(3);
    ko(RF.refEntrySchema, { label: 12 });
    ok(RF.refReorderSchema, { orderedIds: [ID, 4] });
  });
  it('paramétrage : sachets, majoration, canaux, points de vente', () => {
    ok(CS.sachetConfigSchema, { defaultArticlesPerSachet: 6, categories: [{ id: 2, articlesPerSachet: null, needsSachet: true }] });
    ok(CS.sachetSuggestSchema, { items: [{ productId: ID, quantity: 3 }] });
    ok(CS.productionMarkupSchema, { globalPercent: '12', categories: [{ categoryId: 3, percent: '' }] });
    ok(CS.createSalesChannelSchema, { code: 'GLOVO', label: 'Glovo', displayOrder: 2 });
    ok(CS.storeSchema, { name: 'Centre', code: 'CTR', patente: 12345, openingHours: { mon: { open: '07:00', close: '20:00' } } });
    ko(CS.storeSchema, { openingHours: 'tous les jours' });
  });
  it('développement de produits', () => {
    ok(PP.createPipelineSchema, { name: 'Tarte figue', categoryId: 4, targetDate: '2026-12-15' });
    ok(PP.pipelineStageDataSchema, { stage: 'tests', recipe: { anything: true } });
    ok(PP.pipelineDecisionSchema, { decision: 'approved', comments: '' });
    ok(PP.pipelineActionSchema, undefined);
  });
});

describe('Ventes et logistique', () => {
  it('tournées de livraison', () => {
    ok(DR.createDeliveryRouteSchema, { label: 'Tournée nord', routeDate: '2026-11-19', driverName: null });
    ok(DR.deliveryRouteStopsSchema, { deliveryNoteIds: [ID] });
    ko(DR.deliveryRouteStopsSchema, { deliveryNoteIds: ['BL-1'] });
    ok(DR.deliveryStopDeliveredSchema, { delivered: true });
  });
  it('ristournes, contrats-cadres, abonnements, objectifs', () => {
    ok(ST.createRebateSchema, { customerId: ID, year: 2026, ratePercent: '2.5', minTurnover: null });
    ok(ST.createSalesContractSchema, { customerId: ID, basis: 'quantity', committedQuantity: '100', startDate: '2026-01-01', productId: ID });
    ko(ST.createSalesContractSchema, { customerId: ID, basis: 'value', committedValue: 'beaucoup' });
    ok(ST.createSubscriptionSchema, { customerId: ID, label: 'Pain quotidien', amount: 300, frequency: 'monthly', startDate: '2026-01-01' });
    ok(ST.generateSubscriptionsSchema, {});
    ok(ST.salesTargetSchema, { salespersonId: ID, periodStart: '2026-11-01', periodEnd: '2026-11-30', targetAmount: 50000 });
    ok(DU.dunningLevelSchema, { label: 'Relance 1', daysAfterDue: '15', sendEmail: true });
    ko(DU.dunningLevelSchema, { sendEmail: 'oui' });
  });
  it('approbations : motif facultatif', () => {
    ok(AP.approvalDecisionSchema, undefined);
    ok(AP.approvalDecisionSchema, { reason: 'Hors budget' });
    ko(AP.approvalDecisionSchema, { reason: 42 });
  });
});

describe('Qualité, production, personnel', () => {
  it('qualité', () => {
    ok(Q.qualityTemplateSchema, { name: 'Réception', appliesTo: 'reception', items: [{ label: 'T°', kind: 'measure', min: 0, max: 4 }] });
    ok(Q.qualityInspectionSchema, { title: 'Lot 12', results: [{ label: 'T°', kind: 'measure', ok: true, value: 3 }], productLotId: null });
    ko(Q.qualityInspectionSchema, { title: 'X', results: 'ok' });
    ok(Q.nonConformitySchema, { title: 'Étiquette', severity: 'low', responsibleId: '', dueDate: null });
  });
  it('postes de charge et HACCP', () => {
    ok(R.workCenterSchema, { name: 'Four 1', hourlyCost: 40, capacityMinutesPerDay: null });
    ok(R.activeFlagSchema, { active: false });
    ok(R.downtimeSchema, { fromTime: '2026-11-18T08:00', reason: 'Panne', createIntervention: true });
    ok(HA.haccpEquipmentSchema, { nom: 'Chambre froide', type: 'frigo', haccp_monitored: true, temp_min: 0, temp_max: 4 });
    ko(HA.haccpEquipmentSchema, { temp_min: '0' });
    ok(HA.haccpReceptionCheckSchema, { overallConformity: true, temperatureValue: 3.5, notes: null });
  });
  it('personnel : congé, pièce jointe (multipart)', () => {
    ok(approveLeaveSchema, undefined);
    ok(approveLeaveSchema, { allowNegative: true });
    ok(employeeDocumentSchema, { docType: 'contract', title: 'CDI', expiresOn: '', contractId: '' });
  });
});

describe('Comptabilité et outils', () => {
  it('centres de coût, immobilisations, catégories comptables, CCA', () => {
    ok(CC.createCostCenterSchema, { code: 'LAB', name: 'Laboratoire' });
    ok(CC.assignCostCenterSchema, { invoiceId: ID, costCenterId: '' });
    ko(CC.assignCostCenterSchema, { invoiceId: 'FA-1' });
    ok(FA.createFixedAssetSchema, { label: 'Four', assetAccountId: ID, depreciationAccountId: ID, expenseAccountId: ID, acquisitionDate: '2026-01-01', acquisitionCost: '45000', durationYears: 5 });
    ok(FA.runDepreciationSchema, { year: 2026, month: 11 });
    ok(AS.createAccountingCategorySchema, { name: 'Énergie', parent_id: ID, requires_po: false });
    ko(AS.createAccountingCategorySchema, { description: 'sans nom' });
    ok(AS.createPrepaidChargeSchema, { label: 'Assurance', chargeAccountCode: '6134', totalAmount: 12000, startDate: '2026-01-01', endDate: '2026-12-31' });
  });
  it('imprimantes et rapports', () => {
    ok(PRN.attachSystemPrinterSchema, { name: 'Caisse', uri: 'usb://EPSON/TM' });
    ok(PRN.printerSchema, { name: 'Caisse', type: 'receipt', interface: 'cups', connectionString: 'Caisse', paperWidth: 80, isDefault: true });
    ko(PRN.printerSchema, { paperWidth: 'large' });
    ok(REP.reportRunSchema, { sourceKey: 'sales', dimensions: ['day'], measures: ['amount'], filters: { store: ID }, limit: 100, sort: { key: 'amount', dir: 'desc' } });
    ok(REP.reportDefinitionSchema, { name: 'CA', sourceKey: 'sales', config: { measures: ['amount'] } });
    ok(REP.reportDashboardSchema, { name: 'Direction', tiles: [{ reportId: ID }] });
    ko(REP.reportDashboardSchema, { name: 'Direction', tiles: 'toutes' });
  });
});
