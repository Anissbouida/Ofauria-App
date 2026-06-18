import type { Response } from 'express';
import type { AuthRequest } from '../middleware/auth.middleware.js';
import {
  accountRepository,
  accountAuxiliaryRepository,
  journalRepository,
  fiscalPeriodRepository,
  journalEntryRepository,
  reconciliationRepository,
  financialStatementsRepository,
  tvaDeclarationRepository,
} from '../repositories/ledger.repository.js';

/* ═══ Plan comptable CGNC ═══ */
export const planComptableController = {
  /**
   * GET /api/ledger/accounts — Liste complete pour rendre l'arbre Plan comptable.
   *   Query string :
   *     ?includeInactive=true  pour inclure les comptes desactives (admin uniquement)
   */
  async list(req: AuthRequest, res: Response) {
    const includeInactive = req.query.includeInactive === 'true';
    const accounts = await accountRepository.findAll({ includeInactive });
    res.json({ success: true, data: accounts });
  },

  /**
   * GET /api/ledger/accounts/:code — Detail d'un compte CGNC par code.
   */
  async getByCode(req: AuthRequest, res: Response) {
    const account = await accountRepository.findByCode(req.params.code);
    if (!account) {
      res.status(404).json({ success: false, error: { message: 'Compte introuvable' } });
      return;
    }
    res.json({ success: true, data: account });
  },
};

/* ═══ Sous-comptes tiers ═══ */
export const accountAuxiliaryController = {
  /**
   * GET /api/ledger/auxiliaries?kind=supplier|customer
   */
  async list(req: AuthRequest, res: Response) {
    const kind = req.query.kind as 'supplier' | 'customer' | undefined;
    if (kind && kind !== 'supplier' && kind !== 'customer') {
      res.status(400).json({ success: false, error: { message: 'kind doit valoir supplier ou customer' } });
      return;
    }
    const rows = await accountAuxiliaryRepository.findAll({ kind });
    res.json({ success: true, data: rows });
  },
};

/* ═══ Journaux ═══ */
export const journalController = {
  /**
   * GET /api/ledger/journals — Liste des journaux actifs (AC, VE, BQ, CA, OD).
   */
  async list(_req: AuthRequest, res: Response) {
    const journals = await journalRepository.findAll();
    res.json({ success: true, data: journals });
  },
};

/* ═══ Periodes fiscales ═══ */
export const fiscalPeriodController = {
  /**
   * GET /api/ledger/fiscal-periods?year=2026
   */
  async list(req: AuthRequest, res: Response) {
    const year = req.query.year ? parseInt(req.query.year as string, 10) : undefined;
    if (req.query.year && (Number.isNaN(year) || !year)) {
      res.status(400).json({ success: false, error: { message: 'year invalide' } });
      return;
    }
    const periods = await fiscalPeriodRepository.findAll({ year });
    res.json({ success: true, data: periods });
  },
};

/* ═══ Reconciliation ═══ */
export const reconciliationController = {
  /**
   * GET /api/v1/ledger/reconciliation — Synthese + liste des divergences.
   */
  async check(_req: AuthRequest, res: Response) {
    const summary = await reconciliationRepository.summary();
    const divergent = await reconciliationRepository.divergent();
    res.json({ success: true, data: { summary, divergent } });
  },
};

/* ═══ Ecritures comptables (lecture seule Phase 1) ═══ */
export const journalEntryController = {
  /**
   * GET /api/ledger/entries — Liste paginee avec filtres.
   *   ?startDate=YYYY-MM-DD&endDate=YYYY-MM-DD
   *   ?journalId=<uuid>
   *   ?status=draft|posted|reversed
   *   ?search=<text>
   *   ?limit=50&offset=0
   */
  async list(req: AuthRequest, res: Response) {
    const limit = req.query.limit ? Math.min(parseInt(req.query.limit as string, 10) || 50, 200) : 50;
    const offset = req.query.offset ? Math.max(parseInt(req.query.offset as string, 10) || 0, 0) : 0;

    const status = req.query.status as string | undefined;
    if (status && !['draft', 'posted', 'reversed'].includes(status)) {
      res.status(400).json({ success: false, error: { message: 'status invalide' } });
      return;
    }

    const result = await journalEntryRepository.findAll({
      storeId: req.user!.storeId,
      startDate: req.query.startDate as string | undefined,
      endDate: req.query.endDate as string | undefined,
      journalId: req.query.journalId as string | undefined,
      status: status as 'draft' | 'posted' | 'reversed' | undefined,
      search: req.query.search as string | undefined,
      limit,
      offset,
    });

    res.json({ success: true, data: result.rows, meta: { total: result.total, limit, offset } });
  },

  /**
   * GET /api/ledger/entries/:id — Detail d'une ecriture avec ses lignes.
   */
  async getById(req: AuthRequest, res: Response) {
    const entry = await journalEntryRepository.findById(req.params.id);
    if (!entry) {
      res.status(404).json({ success: false, error: { message: 'Ecriture introuvable' } });
      return;
    }
    // Isolation multi-magasin : une ecriture d'un autre magasin ne peut etre vue
    // qu'a condition d'etre transverse (store_id = NULL)
    if (req.user!.storeId && entry.store_id && entry.store_id !== req.user!.storeId) {
      res.status(403).json({ success: false, error: { message: 'Acces refuse' } });
      return;
    }
    res.json({ success: true, data: entry });
  },
};

/* ═══ Etats comptables ═══ */
export const financialStatementsController = {
  /**
   * GET /api/v1/ledger/general-ledger?account=4411&startDate=...&endDate=...
   */
  async generalLedger(req: AuthRequest, res: Response) {
    const accountCode = req.query.account as string | undefined;
    if (!accountCode) {
      res.status(400).json({ success: false, error: { message: 'parametre account requis' } });
      return;
    }
    const data = await financialStatementsRepository.generalLedger({
      accountCode,
      startDate: req.query.startDate as string | undefined,
      endDate: req.query.endDate as string | undefined,
      storeId: req.user!.storeId,
    });
    if (!data) {
      res.status(404).json({ success: false, error: { message: 'Compte introuvable' } });
      return;
    }
    res.json({ success: true, data });
  },

  /**
   * GET /api/v1/ledger/balance?startDate=...&endDate=...
   */
  async balance(req: AuthRequest, res: Response) {
    const rows = await financialStatementsRepository.balance({
      startDate: req.query.startDate as string | undefined,
      endDate: req.query.endDate as string | undefined,
      storeId: req.user!.storeId,
    });
    res.json({ success: true, data: rows });
  },

  /**
   * GET /api/v1/ledger/income-statement?startDate=...&endDate=...  (CPC)
   */
  async incomeStatement(req: AuthRequest, res: Response) {
    const data = await financialStatementsRepository.incomeStatement({
      startDate: req.query.startDate as string | undefined,
      endDate: req.query.endDate as string | undefined,
      storeId: req.user!.storeId,
    });
    res.json({ success: true, data });
  },
};

/* ═══ Declaration TVA (CA20) ═══ */
export const tvaDeclarationController = {
  /**
   * GET /api/v1/ledger/tva-declaration?startDate=...&endDate=...
   */
  async declaration(req: AuthRequest, res: Response) {
    const startDate = req.query.startDate as string | undefined;
    const endDate = req.query.endDate as string | undefined;
    if (!startDate || !endDate) {
      res.status(400).json({ success: false, error: { message: 'startDate et endDate requis' } });
      return;
    }
    const data = await tvaDeclarationRepository.declaration({ startDate, endDate, storeId: req.user!.storeId });
    res.json({ success: true, data });
  },
};
