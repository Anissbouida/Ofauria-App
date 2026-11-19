/**
 * G0-07 — lot Paramètres, utilisateurs, clients : les corps que le client envoie réellement
 * passent (settings.api, users.api, UsersPage, CustomersPage en FormData, UnpaidCustomerPicker),
 * les champs non déclarés sont conservés, les types faux sont refusés, et aucune valeur n'est
 * convertie quand le contrôleur s'en charge.
 */
import { describe, it, expect } from 'vitest';
import * as St from '../validators/settings.validator.js';
import * as U from '../validators/users.validator.js';
import * as C from '../validators/customers.validator.js';
import { numish, body } from '../validators/route-body.validator.js';

const ID = '00000000-0000-0000-0000-000000000001'; // magasin par défaut : identifiant admis
type Schema = { safeParse: (v: unknown) => { success: boolean; data?: unknown } };
const ok = (s: Schema, v: unknown) => expect(s.safeParse(v).success).toBe(true);
const ko = (s: Schema, v: unknown) => expect(s.safeParse(v).success).toBe(false);
const out = (s: Schema, v: unknown) => s.safeParse(v).data as Record<string, unknown>;

describe('Briques G0-07', () => {
  it('numish laisse la valeur telle quelle, refuse un texte non numérique', () => {
    const s = body({ n: numish });
    expect(out(s, { n: '12.5' }).n).toBe('12.5');
    expect(out(s, { n: '' }).n).toBe('');
    expect(out(s, { n: null }).n).toBe(null);
    ko(s, { n: 'abc' });
  });
  it('un corps absent vaut {} et les champs inconnus sont conservés', () => {
    const s = body({ a: numish });
    expect(out(s, undefined)).toEqual({});
    expect(out(s, { zz: 1 })).toEqual({ zz: 1 });
  });
});

describe('Paramètres (settings.routes)', () => {
  it('fiche société : texte légal et capital, champs du ticket conservés', () => {
    const r = out(St.updateCompanySettingsSchema, { legalIce: '001234567000089', legalCapital: '100000', receiptNumCopies: 2, themeAccent: '#AA0000' });
    expect(r.legalCapital).toBe('100000');
    expect(r.receiptNumCopies).toBe(2);
    ko(St.updateCompanySettingsSchema, { legalName: 12 });
    ko(St.updateCompanySettingsSchema, { legalCapital: 'beaucoup' });
  });
  it('numérotation, paramètre, secteur', () => {
    ok(St.documentSequenceSchema, { pattern: 'FA-{YYYY}-{N}', padding: 5, resetPeriod: 'year' });
    ok(St.documentSequenceSchema, { pattern: 'X', padding: '4', resetPeriod: 'never' });
    ok(St.parameterValueSchema, { value: { any: 'shape' } });
    ok(St.setSectorSchema, { code: 'bakery', keepAdjustments: false });
    ko(St.setSectorSchema, {});
  });
  it('modules : valeurs true / false / null seulement ; diffusion', () => {
    ok(St.moduleAdjustmentsSchema, { modules: { crm: true, sav: null }, features: { promo: false } });
    ko(St.moduleAdjustmentsSchema, { modules: { crm: 'oui' } });
    ok(St.moduleRolloutSchema, { pilot: { roles: ['manager'], users: [ID] }, disabledStores: [] });
    ok(St.moduleRolloutSchema, { pilot: null });
    ko(St.moduleRolloutSchema, { disabledStores: 'tous' });
  });
  it('compte bancaire, TVA, règles, webhooks, import', () => {
    ok(St.bankAccountSchema, { label: 'BMCE', bankName: 'BMCE', rib: '011780000012345678901234', isDefault: true, storeId: ID });
    ok(St.addTaxRateSchema, { code: 'TVA20', label: 'Normal', rate: 20, kind: 'standard', validFrom: '2026-01-01' });
    ko(St.addTaxRateSchema, { code: 'TVA20', label: 'Normal', rate: 'vingt', kind: 'standard', validFrom: '2026-01-01' });
    ok(St.updateApprovalRuleSchema, { escalateAfterHours: '', steps: [{ role: 'admin' }] });
    ok(St.createWebhookSchema, { label: 'ERP', url: 'https://x.test/hook', events: ['invoice.created'] });
    ko(St.createWebhookSchema, { label: 'ERP' });
    ok(St.webhookActiveSchema, { active: false });
    ok(St.dataImportSchema, { mapping: '{"Nom":"name"}', mode: 'upsert' });
  });
});

describe('Utilisateurs et rôles (users.routes)', () => {
  it('compte : corps de UsersPage accepté, mot de passe requis à la création, PIN null = retiré', () => {
    const body = { firstName: 'A', lastName: 'B', email: 'a@b.ma', roles: ['cashier'], primaryRole: 'cashier', storeId: null, employeeId: null, password: 'abcd', pinCode: '123456' };
    ok(U.createUserSchema, body);
    ko(U.createUserSchema, { ...body, password: undefined });
    ok(U.updateUserSchema, { isActive: false });
    ok(U.updateUserSchema, { pinCode: null });
    ko(U.updateUserSchema, { roles: 'cashier' });
  });
  it('modes, séparation des tâches, plafonds, délégations', () => {
    ok(U.enforcementModeSchema, { mode: 'enforce' });
    ko(U.enforcementModeSchema, { mode: 'strict' });
    ok(U.createSodRuleSchema, { label: 'Achat / paiement', aModule: 'purchasing', aRight: 'create', bModule: 'payments', bRight: 'create' });
    ok(U.approvalLimitSchema, { roleCode: 'manager', documentType: 'purchase_order', maxAmount: 5000 });
    ok(U.delegationSchema, { fromUserId: ID, toUserId: '11111111-1111-4111-8111-111111111111', roleCode: 'manager', endsAt: '2026-12-31' });
    ko(U.delegationSchema, { fromUserId: 'moi', toUserId: ID, roleCode: 'manager', endsAt: '2026-12-31' });
    ok(U.permissionsSchema, { permissions: { sales: ['view'] } });
  });
});

describe('Clients (customers.routes)', () => {
  it('fiche en FormData : tout en texte, identifiants liés vides, rien n est converti', () => {
    const fd = { customerType: 'professionnel', firstName: 'Ali', companyName: 'SARL X', creditLimit: '10000', remisePct: '', delaiPaiementJours: '30', tvaExonere: false, salespersonId: '', parentCustomerId: '', payerCustomerId: '', ice: '001234567000089' };
    const r = out(C.customerSchema, fd);
    expect(r.creditLimit).toBe('10000');
    expect(r.salespersonId).toBe('');
    ok(C.customerSchema, { firstName: 'Ali', lastName: null, phone: null, customerType: 'particulier' });
    ko(C.customerSchema, { creditLimit: 'illimité' });
  });
  it('adresses, exonération, portail, consentement, actions', () => {
    ok(C.customerAddressSchema, { addressLine: '12 rue X', kind: 'delivery', isDefaultDelivery: true });
    ok(C.customerTaxExemptionSchema, { certificateNumber: 'ATT-1', validFrom: '2026-01-01', validTo: '' });
    ok(C.portalTokenSchema, { expiresInDays: 90 });
    ok(C.portalTokenSchema, {});
    ok(C.customerConsentSchema, { marketingConsent: true });
    ok(C.customerActionSchema, undefined);
  });
});
