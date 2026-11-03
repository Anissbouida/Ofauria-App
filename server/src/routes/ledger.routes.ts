import { Router, type Response } from 'express';
import { z } from 'zod';
import type { AuthRequest } from '../middleware/auth.middleware.js';
import { journalTemplateRepository as tplRepo } from '../repositories/journal-template.repository.js';
import { ledgerIntegrityRepository as integrityRepo } from '../repositories/ledger-integrity.repository.js';
import { fiscalYearRepository } from '../repositories/ledger.repository.js';
import { buildFec } from '../services/fec.service.js';
import { manualEntryRepository } from '../repositories/manual-entry.repository.js';
import { lettrageRepository } from '../repositories/lettrage.repository.js';
import { agedBalanceRepository } from '../repositories/aged-balance.repository.js';
import { chartOfAccountsRepository } from '../repositories/chart-of-accounts.repository.js';
import { corporateTaxRepository } from '../repositories/corporate-tax.repository.js';
import { fxRevaluationRepository } from '../repositories/fx-revaluation.repository.js';
import {
  EDITION_KINDS, type EditionKind, editionContext, renderPdf, renderXlsx,
  buildJournal, buildGrandLivre, buildBalance, buildBilan, buildCpc, buildBalanceAgee, buildImmobilisations, buildCessions, buildAnalytique, buildIs, buildEcartsConversion, buildLiasse,
} from '../services/ledger-editions.service.js';
import { liasseRepository } from '../repositories/liasse.repository.js';
import { buildVatDeductionEdi, buildIr9421Edi, buildLiasseIsEdi, zipOne } from '../services/dgi-edi.service.js';
import {
  planComptableController,
  accountAuxiliaryController,
  journalController,
  fiscalPeriodController,
  journalEntryController,
  reconciliationController,
  financialStatementsController,
  tvaDeclarationController,
  balanceSheetController,
  backfillController,
  purchaseLedgerController,
} from '../controllers/ledger.controller.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { validateUuidParams } from '../middleware/validate.middleware.js';
import { ROLES } from '@ofauria/shared';
import { authenticate } from '../middleware/auth.middleware.js';
import { authorize } from '../middleware/role.middleware.js';
import { requireVerb } from '../middleware/module.middleware.js';
import { ROLE_GROUPS } from '@ofauria/shared';

// Acces : admin + gerant (ROLE_GROUPS.ADMIN_MANAGER). La gerante dispose des
// memes droits que l'admin sur la comptabilite. Les autres routes du noyau
// suivent la meme regle (fixed-asset.routes, bank-reconciliation.routes).

export const ledgerRouter = Router();

// Plan comptable
ledgerRouter.get('/accounts',         authenticate, authorize(...ROLE_GROUPS.ADMIN_MANAGER), planComptableController.list);
ledgerRouter.get('/accounts/:code',   authenticate, authorize(...ROLE_GROUPS.ADMIN_MANAGER), planComptableController.getByCode);
// Plan comptable modifiable (mig 429) : droit « validate » pour toute écriture du plan.
const accountBody = z.object({
  code: z.string().trim().min(4).max(10),
  label: z.string().trim().min(2).max(200),
  accountType: z.enum(['asset', 'liability', 'equity', 'revenue', 'expense', 'result']).nullish(),
  normalSide: z.enum(['D', 'C']).nullish(),
  isCollective: z.boolean().optional(),
  auxiliaryKind: z.enum(['supplier', 'customer']).nullish(),
  tvaRate: z.coerce.number().nullish(),
  tvaDirection: z.enum(['collected', 'deductible']).nullish(),
});
const accountActor = (req: AuthRequest) => ({ userId: req.user!.userId });
const accountBad = (res: Response, m?: string) => res.status(400).json({ success: false, error: { message: m ?? 'Saisie invalide' } });
ledgerRouter.get('/accounts/:id/usage', authenticate, authorize(...ROLE_GROUPS.ADMIN_MANAGER), validateUuidParams('id'), asyncHandler(async (req: AuthRequest, res: Response) => {
  res.json({ success: true, data: await chartOfAccountsRepository.usage(req.params.id) });
}));
ledgerRouter.post('/accounts', authenticate, authorize(...ROLE_GROUPS.ADMIN_MANAGER), requireVerb('accounting', 'validate'), asyncHandler(async (req: AuthRequest, res: Response) => {
  const r = accountBody.safeParse(req.body);
  if (!r.success) { accountBad(res, r.error.issues[0]?.message); return; }
  res.status(201).json({ success: true, data: await chartOfAccountsRepository.create(r.data, accountActor(req)) });
}));
ledgerRouter.put('/accounts/:id', authenticate, authorize(...ROLE_GROUPS.ADMIN_MANAGER), requireVerb('accounting', 'validate'), validateUuidParams('id'), asyncHandler(async (req: AuthRequest, res: Response) => {
  const r = accountBody.safeParse(req.body);
  if (!r.success) { accountBad(res, r.error.issues[0]?.message); return; }
  res.json({ success: true, data: await chartOfAccountsRepository.update(req.params.id, r.data, accountActor(req)) });
}));
ledgerRouter.post('/accounts/:id/active', authenticate, authorize(...ROLE_GROUPS.ADMIN_MANAGER), requireVerb('accounting', 'validate'), validateUuidParams('id'), asyncHandler(async (req: AuthRequest, res: Response) => {
  res.json({ success: true, data: await chartOfAccountsRepository.setActive(req.params.id, Boolean((req.body as { active?: boolean }).active), accountActor(req)) });
}));
ledgerRouter.delete('/accounts/:id', authenticate, authorize(...ROLE_GROUPS.ADMIN_MANAGER), requireVerb('accounting', 'validate'), validateUuidParams('id'), asyncHandler(async (req: AuthRequest, res: Response) => {
  res.json({ success: true, data: await chartOfAccountsRepository.remove(req.params.id, accountActor(req)) });
}));

// Sous-comptes tiers (auxiliaires)
ledgerRouter.get('/auxiliaries',      authenticate, authorize(...ROLE_GROUPS.ADMIN_MANAGER), accountAuxiliaryController.list);

// Journaux
ledgerRouter.get('/journals',         authenticate, authorize(...ROLE_GROUPS.ADMIN_MANAGER), journalController.list);

// Periodes fiscales
ledgerRouter.get('/fiscal-periods',   authenticate, authorize(...ROLE_GROUPS.ADMIN_MANAGER), fiscalPeriodController.list);
ledgerRouter.patch('/fiscal-periods/:id/status', authenticate, authorize(...ROLE_GROUPS.ADMIN_MANAGER), requireVerb('accounting', 'close'), fiscalPeriodController.updateStatus);
// Mig 311 (D8) : checklist de clôture, historique, file de comptabilisation, GR/IR, relevé TVA, paramétrage.
ledgerRouter.get('/fiscal-periods/:id/checklist', authenticate, authorize(...ROLE_GROUPS.ADMIN_MANAGER), validateUuidParams('id'), asyncHandler(fiscalPeriodController.checklist));
ledgerRouter.get('/fiscal-periods/:id/events', authenticate, authorize(...ROLE_GROUPS.ADMIN_MANAGER), validateUuidParams('id'), asyncHandler(fiscalPeriodController.events));
// Exercices (mig 416) : contrôles et clôture définitive avec à-nouveaux (admin).
ledgerRouter.get('/fiscal-years', authenticate, authorize(...ROLE_GROUPS.ADMIN_MANAGER), asyncHandler(async (_req: AuthRequest, res: Response) => {
  res.json({ success: true, data: await fiscalYearRepository.findAll() });
}));
const yearParam = (req: AuthRequest, res: Response): number | null => {
  const y = Number(req.params.year);
  if (!Number.isInteger(y) || y < 2000 || y > 2100) { res.status(400).json({ success: false, error: { message: 'Exercice invalide' } }); return null; }
  return y;
};
ledgerRouter.get('/fiscal-years/:year/checklist', authenticate, authorize(...ROLE_GROUPS.ADMIN_MANAGER), asyncHandler(async (req: AuthRequest, res: Response) => {
  const y = yearParam(req, res); if (y === null) return;
  res.json({ success: true, data: await fiscalYearRepository.checklist(y) });
}));
ledgerRouter.post('/fiscal-years/:year/close', authenticate, authorize(ROLES.ADMIN), requireVerb('accounting', 'close'), asyncHandler(async (req: AuthRequest, res: Response) => {
  const y = yearParam(req, res); if (y === null) return;
  res.json({ success: true, data: await fiscalYearRepository.close(y, req.user!.userId) });
}));
// FEC (avis CNC n° 24, art. 210 CGI) : fichier + attestation d'intégrité d'une même génération.
ledgerRouter.get('/fec', authenticate, authorize(...ROLE_GROUPS.ADMIN_MANAGER), requireVerb('accounting', 'export'), asyncHandler(async (req: AuthRequest, res: Response) => {
  const r = z.object({
    year: z.coerce.number().int().min(2000).max(2100).optional(),
    startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  }).refine(q => q.year || (q.startDate && q.endDate), { message: 'year, ou startDate et endDate, requis' }).safeParse(req.query);
  if (!r.success) { tplBad(res, r.error.issues[0]?.message); return; }
  res.json({ success: true, data: await buildFec({ year: r.data.year, start: r.data.startDate, end: r.data.endDate }, actorOf(req)) });
}));
// Éditions comptables PDF / Excel (lot Important 8) : droit « print » pour le PDF,
// « export » pour l'Excel.
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const editionQuery = z.object({
  format: z.enum(['pdf', 'xlsx']).default('pdf'),
  startDate: z.string().regex(DAY).optional(),
  endDate: z.string().regex(DAY).optional(),
  journal: z.string().trim().max(10).optional(),
  account: z.string().trim().max(10).optional(),
  class: z.coerce.number().int().min(1).max(8).optional(),
  side: z.enum(['suppliers', 'customers']).default('suppliers'),
  axis: z.string().uuid().optional(),
  table: z.enum(['actif', 'passif', 'cpc', 'esg', 'passage']).default('actif'),
  model: z.enum(['normal', 'simplifie']).default('normal'),
});
const editionVerb = (req: AuthRequest, res: Response, next: () => void) =>
  requireVerb('accounting', req.query.format === 'xlsx' ? 'export' : 'print')(req, res, next);
ledgerRouter.get('/editions/:kind', authenticate, authorize(...ROLE_GROUPS.ADMIN_MANAGER), editionVerb, asyncHandler(async (req: AuthRequest, res: Response) => {
  const kind = req.params.kind as EditionKind;
  if (!EDITION_KINDS.includes(kind)) { tplBad(res, 'État inconnu'); return; }
  const r = editionQuery.safeParse(req.query);
  if (!r.success) { tplBad(res, r.error.issues[0]?.message); return; }
  const q = r.data;
  const today = new Date().toLocaleDateString('sv-SE', { timeZone: 'Africa/Casablanca' });
  const end = q.endDate ?? today;
  const start = q.startDate ?? `${end.slice(0, 4)}-01-01`;
  if (start > end) { tplBad(res, 'Période invalide'); return; }
  const storeId = req.user!.storeId ?? null;
  const edition = kind === 'journal' ? await buildJournal({ startDate: start, endDate: end, journalCode: q.journal, storeId })
    : kind === 'grand-livre' ? await buildGrandLivre({ startDate: start, endDate: end, accountClass: q.class, account: q.account, storeId })
    : kind === 'balance' ? await buildBalance({ startDate: start, endDate: end, storeId })
    : kind === 'bilan' ? await buildBilan({ endDate: end, storeId })
    : kind === 'cpc' ? await buildCpc({ startDate: start, endDate: end, storeId })
    : kind === 'immobilisations' ? await buildImmobilisations({ year: Number(end.slice(0, 4)), storeId })
    : kind === 'cessions' ? await buildCessions({ year: Number(end.slice(0, 4)), storeId })
    : kind === 'is' ? await buildIs({ year: Number(end.slice(0, 4)) })
    : kind === 'ecarts-conversion' ? await buildEcartsConversion({ year: Number(end.slice(0, 4)) })
    : kind === 'liasse' ? await buildLiasse({ year: Number(end.slice(0, 4)), model: q.model, table: q.table })
    : kind === 'analytique' ? (q.axis ? await buildAnalytique({ axisId: q.axis, startDate: start, endDate: end, storeId }) : null)
    : await buildBalanceAgee({ side: q.side, asOf: end });
  if (!edition) { tplBad(res, 'Axe analytique requis'); return; }
  const ctx = await editionContext(req.user!.userId);
  const buf = q.format === 'xlsx' ? await renderXlsx(edition, ctx) : await renderPdf(edition, ctx);
  res.setHeader('Content-Type', q.format === 'xlsx'
    ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' : 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="${edition.key}.${q.format}"`);
  res.send(buf);
}));

// Impôt sur les sociétés (mig 430) : calcul libre, versements et comptabilisation avec le droit « post ».
const taxYear = (req: AuthRequest, res: Response): number | null => {
  const y = Number(req.params.year);
  if (!Number.isInteger(y) || y < 2000 || y > 2100) { res.status(400).json({ success: false, error: { message: 'Exercice invalide' } }); return null; }
  return y;
};
const taxActor = (req: AuthRequest) => ({ userId: req.user!.userId });
const TAX_AM = [authenticate, authorize(...ROLE_GROUPS.ADMIN_MANAGER)];
ledgerRouter.get('/corporate-tax/:year', ...TAX_AM, asyncHandler(async (req: AuthRequest, res: Response) => {
  const y = taxYear(req, res); if (y === null) return;
  res.json({ success: true, data: await corporateTaxRepository.summary(y) });
}));
ledgerRouter.put('/corporate-tax/:year/params', ...TAX_AM, requireVerb('accounting', 'post'), asyncHandler(async (req: AuthRequest, res: Response) => {
  const y = taxYear(req, res); if (y === null) return;
  const r = z.object({
    regime: z.enum(['standard', 'credit']).optional(),
    rate_standard: z.coerce.number().min(0).max(60).optional(), rate_high: z.coerce.number().min(0).max(60).optional(),
    high_threshold: z.coerce.number().min(0).optional(), rate_credit: z.coerce.number().min(0).max(60).optional(),
    cm_rate: z.coerce.number().min(0).max(5).optional(), cm_minimum: z.coerce.number().min(0).optional(),
    cm_exempt: z.boolean().optional(), cm_base_override: z.coerce.number().min(0).nullable().optional(),
  }).safeParse(req.body);
  if (!r.success) { tplBad(res, r.error.issues[0]?.message); return; }
  res.json({ success: true, data: await corporateTaxRepository.setParams(y, r.data, taxActor(req)) });
}));
ledgerRouter.post('/corporate-tax/:year/adjustments', ...TAX_AM, requireVerb('accounting', 'post'), asyncHandler(async (req: AuthRequest, res: Response) => {
  const y = taxYear(req, res); if (y === null) return;
  const r = z.object({ kind: z.enum(['reintegration', 'deduction']), label: z.string().trim().min(2).max(200), amount: z.coerce.number().positive() }).safeParse(req.body);
  if (!r.success) { tplBad(res, r.error.issues[0]?.message); return; }
  res.status(201).json({ success: true, data: await corporateTaxRepository.addAdjustment(y, r.data, taxActor(req)) });
}));
ledgerRouter.delete('/corporate-tax/adjustments/:id', ...TAX_AM, requireVerb('accounting', 'post'), validateUuidParams('id'), asyncHandler(async (req: AuthRequest, res: Response) => {
  res.json({ success: true, data: await corporateTaxRepository.removeAdjustment(req.params.id, taxActor(req)) });
}));
ledgerRouter.post('/corporate-tax/:year/payments', ...TAX_AM, requireVerb('accounting', 'post'), asyncHandler(async (req: AuthRequest, res: Response) => {
  const y = taxYear(req, res); if (y === null) return;
  const r = z.object({
    kind: z.enum(['acompte', 'solde']), quarter: z.coerce.number().int().min(1).max(4).nullish(), amount: z.coerce.number().positive(),
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), treasury: z.enum(['bank', 'cash']), reference: z.string().trim().max(60).nullish(),
  }).safeParse(req.body);
  if (!r.success) { tplBad(res, r.error.issues[0]?.message); return; }
  res.status(201).json({ success: true, data: await corporateTaxRepository.pay(y, r.data, taxActor(req)) });
}));
ledgerRouter.post('/corporate-tax/payments/:id/cancel', ...TAX_AM, requireVerb('accounting', 'post'), validateUuidParams('id'), asyncHandler(async (req: AuthRequest, res: Response) => {
  const r = z.object({ reason: z.string().trim().min(3).max(500) }).safeParse(req.body);
  if (!r.success) { tplBad(res, 'Motif obligatoire (3 caractères au moins)'); return; }
  res.json({ success: true, data: await corporateTaxRepository.cancelPayment(req.params.id, r.data.reason, taxActor(req)) });
}));
ledgerRouter.post('/corporate-tax/:year/book', ...TAX_AM, requireVerb('accounting', 'post'), asyncHandler(async (req: AuthRequest, res: Response) => {
  const y = taxYear(req, res); if (y === null) return;
  res.json({ success: true, data: await corporateTaxRepository.book(y, taxActor(req)) });
}));
ledgerRouter.post('/corporate-tax/:year/unbook', ...TAX_AM, requireVerb('accounting', 'post'), asyncHandler(async (req: AuthRequest, res: Response) => {
  const y = taxYear(req, res); if (y === null) return;
  const r = z.object({ reason: z.string().trim().min(3).max(500) }).safeParse(req.body);
  if (!r.success) { tplBad(res, 'Motif obligatoire (3 caractères au moins)'); return; }
  res.json({ success: true, data: await corporateTaxRepository.unbook(y, r.data.reason, taxActor(req)) });
}));

// Réévaluation des devises (mig 431) : calcul libre, comptabilisation et annulation avec le droit « post ».
// Taux de clôture saisis : ?rates=EUR:10.95,USD:9.8 (lecture) ou { rates: { EUR: 10.95 } } (comptabilisation).
const fxRates = z.record(z.string().regex(/^[A-Z]{3}$/), z.coerce.number().positive().max(100_000)).default({});
const parseRatesQuery = (v: unknown) => Object.fromEntries(String(v ?? '').split(',').map(x => x.split(':'))
  .filter(([k, r]) => /^[A-Z]{3}$/.test(k ?? '') && Number(r) > 0).map(([k, r]) => [k, Number(r)]));
// Liasse fiscale (lot Bonus 14) : bilan, CPC, ESG et passage au résultat fiscal, en lecture.
ledgerRouter.get('/liasse/:year', ...TAX_AM, asyncHandler(async (req: AuthRequest, res: Response) => {
  const y = taxYear(req, res); if (y === null) return;
  const model = req.query.model === 'simplifie' ? 'simplifie' : 'normal';
  res.json({ success: true, data: await liasseRepository.build(y, model) });
}));
// Télédéclarations EDI (portail SIMPL de la DGI) : aperçu JSON, XML ou ZIP à téléverser.
const ediFormat = (req: AuthRequest) => (req.query.format === 'xml' ? 'xml' : req.query.format === 'zip' ? 'zip' : 'json');
const sendEdi = (req: AuthRequest, res: Response, out: { filename: string; xml: Buffer; issues: unknown[] } & Record<string, unknown>) => {
  const f = ediFormat(req);
  if (f === 'json') { const { xml: _xml, ...rest } = out; res.json({ success: true, data: rest }); return; }
  const body = f === 'zip' ? zipOne(`${out.filename}.xml`, out.xml) : out.xml;
  res.setHeader('Content-Type', f === 'zip' ? 'application/zip' : 'application/xml; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${out.filename}.${f}"`);
  res.send(body);
};
ledgerRouter.get('/edi/tva-deductions/:year', ...TAX_AM, requireVerb('accounting', 'export'), asyncHandler(async (req: AuthRequest, res: Response) => {
  const y = taxYear(req, res); if (y === null) return;
  const regime = req.query.regime === '2' ? 2 : 1;
  const period = Number(req.query.period);
  if (!Number.isInteger(period) || period < 1 || period > (regime === 1 ? 12 : 4)) { tplBad(res, 'Période invalide'); return; }
  sendEdi(req, res, await buildVatDeductionEdi({ year: y, period, regime }));
}));
ledgerRouter.get('/edi/9421/:year', ...TAX_AM, requireVerb('accounting', 'export'), asyncHandler(async (req: AuthRequest, res: Response) => {
  const y = taxYear(req, res); if (y === null) return;
  sendEdi(req, res, await buildIr9421Edi(y));
}));
ledgerRouter.get('/edi/liasse/:year', ...TAX_AM, requireVerb('accounting', 'export'), asyncHandler(async (req: AuthRequest, res: Response) => {
  const y = taxYear(req, res); if (y === null) return;
  sendEdi(req, res, await buildLiasseIsEdi(y, req.query.model === 'simplifie' ? 'simplifie' : 'normal'));
}));
ledgerRouter.get('/fx-revaluation/:year', ...TAX_AM, asyncHandler(async (req: AuthRequest, res: Response) => {
  const y = taxYear(req, res); if (y === null) return;
  res.json({ success: true, data: await fxRevaluationRepository.summary(y, parseRatesQuery(req.query.rates)) });
}));
ledgerRouter.post('/fx-revaluation/:year/book', ...TAX_AM, requireVerb('accounting', 'post'), asyncHandler(async (req: AuthRequest, res: Response) => {
  const y = taxYear(req, res); if (y === null) return;
  const r = z.object({ rates: fxRates }).safeParse(req.body ?? {});
  if (!r.success) { tplBad(res, 'Taux de clôture invalide'); return; }
  res.json({ success: true, data: await fxRevaluationRepository.book(y, r.data.rates, taxActor(req)) });
}));
ledgerRouter.post('/fx-revaluation/:year/cancel', ...TAX_AM, requireVerb('accounting', 'post'), asyncHandler(async (req: AuthRequest, res: Response) => {
  const y = taxYear(req, res); if (y === null) return;
  const r = z.object({ reason: z.string().trim().min(3).max(500) }).safeParse(req.body);
  if (!r.success) { tplBad(res, 'Motif obligatoire (3 caractères au moins)'); return; }
  res.json({ success: true, data: await fxRevaluationRepository.cancel(y, r.data.reason, taxActor(req)) });
}));

// Balance âgée comptable : lignes non lettrées des comptes de tiers, par échéance.
ledgerRouter.get('/aged-balance', authenticate, authorize(...ROLE_GROUPS.ADMIN_MANAGER), asyncHandler(async (req: AuthRequest, res: Response) => {
  const r = z.object({
    side: z.enum(['suppliers', 'customers']).default('suppliers'),
    asOf: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  }).safeParse(req.query);
  if (!r.success) { tplBad(res, r.error.issues[0]?.message); return; }
  const asOf = r.data.asOf ?? new Date().toLocaleDateString('sv-SE', { timeZone: 'Africa/Casablanca' });
  res.json({ success: true, data: await agedBalanceRepository.compute({ side: r.data.side, asOf }) });
}));
ledgerRouter.get('/outbox',authenticate, authorize(...ROLE_GROUPS.ADMIN_MANAGER), asyncHandler(purchaseLedgerController.outbox));
ledgerRouter.post('/outbox/replay', authenticate, authorize(ROLES.ADMIN), asyncHandler(purchaseLedgerController.replay));
ledgerRouter.post('/outbox/:id/replay', authenticate, authorize(ROLES.ADMIN), validateUuidParams('id'), asyncHandler(purchaseLedgerController.replay));
ledgerRouter.get('/grir/open-items', authenticate, authorize(...ROLE_GROUPS.ADMIN_MANAGER), asyncHandler(purchaseLedgerController.grirOpenItems));
ledgerRouter.get('/vat-deduction-statement', authenticate, authorize(...ROLE_GROUPS.ADMIN_MANAGER), asyncHandler(purchaseLedgerController.vatStatement));
ledgerRouter.get('/posting-profiles', authenticate, authorize(...ROLE_GROUPS.ADMIN_MANAGER), asyncHandler(purchaseLedgerController.postingProfiles));

// Ecritures comptables
ledgerRouter.get('/entries',          authenticate, authorize(...ROLE_GROUPS.ADMIN_MANAGER), journalEntryController.list);
ledgerRouter.get('/entries/:id',      authenticate, authorize(...ROLE_GROUPS.ADMIN_MANAGER), journalEntryController.getById);

// Modèles d'écritures (mig 391) : structure réutilisable + instanciation en OD.
const AM = [authenticate, authorize(...ROLE_GROUPS.ADMIN_MANAGER)];

// Saisie libre (mig 418) : brouillon modifiable, comptabilisation (droit « post »),
// extourne motivée des écritures manuelles.
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const manualBody = z.object({
  journalCode: z.string().trim().min(1).max(10),
  date: z.string().regex(DATE_RE),
  description: z.string().trim().min(1).max(2000),
  pieceRef: z.string().trim().max(60).nullish(),
  pieceDate: z.string().regex(DATE_RE).nullish(),
  lines: z.array(z.object({
    accountId: z.string().uuid(),
    auxiliaryId: z.string().uuid().nullish(),
    debit: z.coerce.number().min(0),
    credit: z.coerce.number().min(0),
    label: z.string().trim().max(200).nullish(),
  })).min(2).max(500),
});
const manualActor = (req: AuthRequest) => ({ userId: req.user!.userId, storeId: req.user!.storeId ?? null });
const parseManual = (req: AuthRequest, res: Response) => {
  const r = manualBody.safeParse(req.body);
  if (!r.success) { res.status(400).json({ success: false, error: { message: r.error.issues[0]?.message ?? 'Saisie invalide' } }); return null; }
  return r.data;
};
ledgerRouter.post('/entries', ...AM, asyncHandler(async (req: AuthRequest, res: Response) => {
  const input = parseManual(req, res); if (!input) return;
  res.status(201).json({ success: true, data: await manualEntryRepository.createDraft(input, manualActor(req)) });
}));
ledgerRouter.post('/entries/post', ...AM, requireVerb('accounting', 'post'), asyncHandler(async (req: AuthRequest, res: Response) => {
  const input = parseManual(req, res); if (!input) return;
  res.status(201).json({ success: true, data: await manualEntryRepository.createAndPost(input, manualActor(req)) });
}));
ledgerRouter.put('/entries/:id', ...AM, validateUuidParams('id'), asyncHandler(async (req: AuthRequest, res: Response) => {
  const input = parseManual(req, res); if (!input) return;
  res.json({ success: true, data: await manualEntryRepository.updateDraft(req.params.id, input, manualActor(req)) });
}));
ledgerRouter.delete('/entries/:id', ...AM, validateUuidParams('id'), asyncHandler(async (req: AuthRequest, res: Response) => {
  res.json({ success: true, data: await manualEntryRepository.deleteDraft(req.params.id, manualActor(req)) });
}));
ledgerRouter.post('/entries/:id/post', ...AM, requireVerb('accounting', 'post'), validateUuidParams('id'), asyncHandler(async (req: AuthRequest, res: Response) => {
  res.json({ success: true, data: await manualEntryRepository.post(req.params.id, manualActor(req)) });
}));
ledgerRouter.post('/entries/:id/reverse', ...AM, requireVerb('accounting', 'post'), validateUuidParams('id'), asyncHandler(async (req: AuthRequest, res: Response) => {
  const r = z.object({ date: z.string().regex(DATE_RE).nullish(), reason: z.string().trim().min(3).max(500) }).safeParse(req.body);
  if (!r.success) { res.status(400).json({ success: false, error: { message: 'Motif de l\'extourne obligatoire (3 caractères au moins)' } }); return; }
  res.json({ success: true, data: await manualEntryRepository.reverse(req.params.id, r.data, manualActor(req)) });
}));

// Lettrage manuel (mig 420) : consultation libre, lettrer/délettrer avec le droit « validate ».
ledgerRouter.get('/lettrage/accounts', ...AM, asyncHandler(async (_req: AuthRequest, res: Response) => {
  res.json({ success: true, data: await lettrageRepository.accounts() });
}));
ledgerRouter.get('/lettrage/accounts/:id/tiers', ...AM, validateUuidParams('id'), asyncHandler(async (req: AuthRequest, res: Response) => {
  res.json({ success: true, data: await lettrageRepository.tiers(req.params.id) });
}));
ledgerRouter.get('/lettrage/lines', ...AM, asyncHandler(async (req: AuthRequest, res: Response) => {
  const r = z.object({
    accountId: z.string().uuid(),
    auxiliaryId: z.string().uuid().optional(),
    status: z.enum(['open', 'lettered', 'all']).default('open'),
    from: z.string().regex(DATE_RE).optional(),
    to: z.string().regex(DATE_RE).optional(),
  }).safeParse(req.query);
  if (!r.success) { tplBad(res, r.error.issues[0]?.message); return; }
  res.json({ success: true, data: await lettrageRepository.lines(r.data) });
}));
const autoScope = z.object({ accountId: z.string().uuid().optional(), auxiliaryId: z.string().uuid().optional() });
ledgerRouter.get('/lettrage/auto', ...AM, asyncHandler(async (req: AuthRequest, res: Response) => {
  const r = autoScope.safeParse(req.query);
  if (!r.success) { tplBad(res, r.error.issues[0]?.message); return; }
  res.json({ success: true, data: await lettrageRepository.autoLetter({ ...r.data, dryRun: true }, { userId: req.user!.userId }) });
}));
ledgerRouter.post('/lettrage/auto', ...AM, requireVerb('accounting', 'validate'), asyncHandler(async (req: AuthRequest, res: Response) => {
  const r = autoScope.safeParse(req.body ?? {});
  if (!r.success) { tplBad(res, r.error.issues[0]?.message); return; }
  res.json({ success: true, data: await lettrageRepository.autoLetter(r.data, { userId: req.user!.userId }) });
}));
ledgerRouter.post('/lettrage', ...AM, requireVerb('accounting', 'validate'), asyncHandler(async (req: AuthRequest, res: Response) => {
  const r = z.object({ lineIds: z.array(z.string().uuid()).min(2).max(1000) }).safeParse(req.body);
  if (!r.success) { tplBad(res, 'Sélectionnez au moins deux lignes à lettrer'); return; }
  res.status(201).json({ success: true, data: await lettrageRepository.letter(r.data.lineIds, { userId: req.user!.userId }) });
}));
ledgerRouter.delete('/lettrage/:id', ...AM, requireVerb('accounting', 'validate'), validateUuidParams('id'), asyncHandler(async (req: AuthRequest, res: Response) => {
  res.json({ success: true, data: await lettrageRepository.unletter(req.params.id, { userId: req.user!.userId }) });
}));

const tplLine = z.object({
  accountId: z.string().uuid(),
  side: z.enum(['debit', 'credit']),
  amount: z.coerce.number().min(0),
  label: z.string().trim().max(200).nullish(),
});
const tplBody = z.object({
  name: z.string().trim().min(1).max(160),
  journalCode: z.string().trim().max(10).optional(),
  description: z.string().trim().max(2000).nullish(),
  lines: z.array(tplLine).min(2),
});
const tplBad = (res: Response, m = 'Paramètres invalides') => res.status(400).json({ success: false, error: { message: m } });

ledgerRouter.get('/entry-templates', ...AM, asyncHandler(async (req: AuthRequest, res: Response) => {
  const storeId = req.user!.role === 'admin' ? undefined : req.user!.storeId;
  res.json({ success: true, data: await tplRepo.list(storeId ?? null) });
}));
ledgerRouter.get('/entry-templates/:id', ...AM, validateUuidParams('id'), asyncHandler(async (req: AuthRequest, res: Response) => {
  const t = await tplRepo.getById(req.params.id);
  if (!t) { res.status(404).json({ success: false, error: { message: 'Modèle introuvable' } }); return; }
  res.json({ success: true, data: t });
}));
ledgerRouter.post('/entry-templates', ...AM, asyncHandler(async (req: AuthRequest, res: Response) => {
  const r = tplBody.safeParse(req.body);
  if (!r.success) { tplBad(res, r.error.issues[0]?.message); return; }
  const out = await tplRepo.create(r.data, { userId: req.user!.userId, storeId: req.user!.storeId ?? null });
  if ('error' in out) { tplBad(res, out.error); return; }
  res.status(201).json({ success: true, data: out });
}));
ledgerRouter.put('/entry-templates/:id', ...AM, validateUuidParams('id'), asyncHandler(async (req: AuthRequest, res: Response) => {
  const r = tplBody.safeParse(req.body);
  if (!r.success) { tplBad(res, r.error.issues[0]?.message); return; }
  const out = await tplRepo.update(req.params.id, r.data);
  if ('error' in out) { res.status(out.error === 'Modèle introuvable' ? 404 : 400).json({ success: false, error: { message: out.error } }); return; }
  res.json({ success: true, data: out });
}));
ledgerRouter.post('/entry-templates/:id/active', ...AM, validateUuidParams('id'), asyncHandler(async (req: AuthRequest, res: Response) => {
  const out = await tplRepo.setActive(req.params.id, Boolean((req.body as { active?: boolean }).active));
  if (!out) { res.status(404).json({ success: false, error: { message: 'Modèle introuvable' } }); return; }
  res.json({ success: true, data: out });
}));
ledgerRouter.delete('/entry-templates/:id', ...AM, validateUuidParams('id'), asyncHandler(async (req: AuthRequest, res: Response) => {
  await tplRepo.remove(req.params.id);
  res.json({ success: true, data: null });
}));
ledgerRouter.post('/entry-templates/:id/instantiate', ...AM, validateUuidParams('id'), asyncHandler(async (req: AuthRequest, res: Response) => {
  const r = z.object({
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    label: z.string().trim().max(200).nullish(),
    amounts: z.record(z.string().uuid(), z.coerce.number().min(0)).optional(),
  }).safeParse(req.body);
  if (!r.success) { tplBad(res, r.error.issues[0]?.message); return; }
  const out = await tplRepo.instantiate(req.params.id, { ...r.data, storeId: req.user!.storeId ?? null, userId: req.user!.userId });
  if ('error' in out) { res.status(400).json({ success: false, error: { message: out.error } }); return; }
  res.status(201).json({ success: true, data: out });
}));

// Inaltérabilité (mig 413) : état de la chaîne et des gardes, scellement,
// vérification, journal d'audit des actions comptables.
const actorOf = (req: AuthRequest) => ({ userId: req.user!.userId, ip: req.ip ?? null });
ledgerRouter.get('/integrity', ...AM, asyncHandler(async (_req: AuthRequest, res: Response) => {
  res.json({ success: true, data: await integrityRepo.status() });
}));
ledgerRouter.post('/integrity/seal', ...AM, asyncHandler(async (req: AuthRequest, res: Response) => {
  res.json({ success: true, data: await integrityRepo.seal(actorOf(req)) });
}));
ledgerRouter.post('/integrity/verify', ...AM, asyncHandler(async (req: AuthRequest, res: Response) => {
  res.json({ success: true, data: await integrityRepo.verify(actorOf(req)) });
}));
ledgerRouter.get('/audit-log', ...AM, asyncHandler(async (req: AuthRequest, res: Response) => {
  const r = z.object({
    event: z.enum(['post', 'reverse', 'draft_delete', 'letter', 'unletter', 'reletter', 'seal', 'verify', 'outbox_replay', 'year_close', 'fec_export']).optional(),
    entryId: z.string().uuid().optional(),
    before: z.coerce.number().int().positive().optional(),
    limit: z.coerce.number().int().min(1).max(200).optional(),
  }).safeParse(req.query);
  if (!r.success) { tplBad(res, r.error.issues[0]?.message); return; }
  res.json({ success: true, data: await integrityRepo.auditLog(r.data) });
}));

// Reconciliation legacy <-> ledger
ledgerRouter.get('/reconciliation',   authenticate, authorize(...ROLE_GROUPS.ADMIN_MANAGER), reconciliationController.check);

// Etats comptables (grand livre, balance, CPC)
ledgerRouter.get('/general-ledger',      authenticate, authorize(...ROLE_GROUPS.ADMIN_MANAGER), financialStatementsController.generalLedger);
ledgerRouter.get('/general-ledger-full', authenticate, authorize(...ROLE_GROUPS.ADMIN_MANAGER), financialStatementsController.generalLedgerFull);
ledgerRouter.get('/balance',          authenticate, authorize(...ROLE_GROUPS.ADMIN_MANAGER), financialStatementsController.balance);
ledgerRouter.get('/income-statement', authenticate, authorize(...ROLE_GROUPS.ADMIN_MANAGER), financialStatementsController.incomeStatement);
ledgerRouter.get('/cash-flow',        authenticate, authorize(...ROLE_GROUPS.ADMIN_MANAGER), financialStatementsController.cashFlow);

// Declaration TVA (CA20 Maroc)
ledgerRouter.get('/tva-declaration',  authenticate, authorize(...ROLE_GROUPS.ADMIN_MANAGER), tvaDeclarationController.declaration);

// Bilan (actif / passif)
ledgerRouter.get('/balance-sheet',    authenticate, authorize(...ROLE_GROUPS.ADMIN_MANAGER), balanceSheetController.balanceSheet);

// Backfill des ecritures (admin) — generation depuis l'historique existant
ledgerRouter.post('/backfill',        authenticate, authorize(...ROLE_GROUPS.ADMIN_MANAGER), backfillController.run);
