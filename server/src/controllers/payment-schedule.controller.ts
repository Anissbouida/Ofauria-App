import type { Response } from 'express';
import type { AuthRequest } from '../middleware/auth.middleware.js';
import { paymentScheduleRepository } from '../repositories/payment-schedule.repository.js';

/**
 * API de l'echeancier : dettes echelonnees (materiel a credit) + charges fixes
 * recurrentes (loyer, electricite...). Cf. payment-schedule.repository.ts pour
 * le modele, et migration 258 pour le schema.
 *
 * Le REGLEMENT d'une echeance n'est pas ici : il passe par POST /payments avec
 * `scheduledPaymentId` (et `invoiceId` si l'echeance vient d'une facture), pour
 * rester le meme flux de tresorerie que tout le reste.
 */

function fail(res: Response, err: unknown, fallback: string) {
  const e = err as Error & { statusCode?: number };
  res.status(e?.statusCode ?? 400).json({
    success: false,
    error: { message: e?.message || fallback },
  });
}

const num = (v: unknown): number => {
  const n = typeof v === 'number' ? v : parseFloat(String(v));
  return Number.isFinite(n) ? n : 0;
};

export const paymentScheduleController = {
  /**
   * GET /api/v1/payment-schedules
   *   ?status=open|all  ?from=YYYY-MM-DD  ?to=YYYY-MM-DD  ?sourceKind=...
   *
   * Declenche au passage la generation des echeances recurrentes a venir
   * (idempotent) : c'est ce qui fait apparaitre le loyer du mois prochain
   * sans aucune saisie.
   */
  async list(req: AuthRequest, res: Response) {
    const q = req.query as Record<string, string | undefined>;
    const rows = await paymentScheduleRepository.findSchedule({
      storeId: req.user!.storeId,
      from: q.from,
      to: q.to,
      status: q.status === 'all' ? 'all' : 'open',
      sourceKind: (q.sourceKind as 'invoice' | 'debt' | 'recurring' | undefined),
    });
    res.json({ success: true, data: rows });
  },

  /** GET /api/v1/payment-schedules/by-source/:kind/:id */
  async bySource(req: AuthRequest, res: Response) {
    const kind = req.params.kind as 'invoice' | 'debt' | 'recurring';
    if (!['invoice', 'debt', 'recurring'].includes(kind)) {
      res.status(400).json({ success: false, error: { message: 'Source invalide' } });
      return;
    }
    const rows = await paymentScheduleRepository.findBySource(kind, req.params.id);
    res.json({ success: true, data: rows });
  },

  /**
   * PATCH /api/v1/payment-schedules/:id
   * Sert surtout a renseigner le montant d'une echeance variable (electricite)
   * ou a decaler une date.
   */
  async update(req: AuthRequest, res: Response) {
    const b = req.body as Record<string, unknown>;
    try {
      const row = await paymentScheduleRepository.updateScheduled(req.params.id, {
        amountDue: b.amountDue === undefined ? undefined
          : b.amountDue === null || b.amountDue === '' ? null : num(b.amountDue),
        dueDate: b.dueDate === undefined ? undefined : String(b.dueDate),
        notes: b.notes === undefined ? undefined : (b.notes as string | null),
        expectedPaymentMode: b.expectedPaymentMode === undefined ? undefined
          : (b.expectedPaymentMode as string | null),
        status: b.status === undefined ? undefined : (b.status as 'pending' | 'cancelled'),
      });
      if (!row) { res.status(404).json({ success: false, error: { message: 'Echeance introuvable' } }); return; }
      res.json({ success: true, data: row });
    } catch (err) {
      fail(res, err, 'Erreur lors de la mise a jour de l\'echeance');
    }
  },

  /**
   * POST /api/v1/invoices/:id/schedule — echelonne une facture existante.
   * body: { installments, firstDueDate, intervalMonths?, amount?, expectedPaymentMode?, notes? }
   */
  async createInvoiceSchedule(req: AuthRequest, res: Response) {
    const b = req.body as Record<string, unknown>;
    const installments = Math.floor(num(b.installments));
    if (!installments || installments < 1 || installments > 120) {
      res.status(400).json({ success: false, error: { message: 'Nombre d\'échéances invalide (1 à 120)' } });
      return;
    }
    if (!b.firstDueDate) {
      res.status(400).json({ success: false, error: { message: 'Date de la première échéance requise' } });
      return;
    }
    try {
      const rows = await paymentScheduleRepository.createInvoiceSchedule(req.params.id, {
        installments,
        firstDueDate: String(b.firstDueDate),
        intervalMonths: b.intervalMonths !== undefined ? Math.floor(num(b.intervalMonths)) : 1,
        amount: b.amount !== undefined && b.amount !== null && b.amount !== '' ? num(b.amount) : undefined,
        expectedPaymentMode: (b.expectedPaymentMode as string | null) || null,
        notes: (b.notes as string | null) || null,
        createdBy: req.user!.userId,
      });
      res.status(201).json({ success: true, data: rows });
    } catch (err) {
      fail(res, err, 'Erreur lors de la creation de l\'echeancier');
    }
  },

  /* ─────────────────────────── Dettes autonomes ─────────────────────────── */

  /** GET /api/v1/debts?includeSettled=true */
  async listDebts(req: AuthRequest, res: Response) {
    const rows = await paymentScheduleRepository.findDebts({
      storeId: req.user!.storeId,
      includeSettled: String(req.query.includeSettled) === 'true',
    });
    res.json({ success: true, data: rows });
  },

  /**
   * POST /api/v1/debts — dette echelonnee sans facture.
   * body: { label, totalAmount, installments, firstDueDate, intervalMonths?,
   *         supplierId?, categoryId?, fixedAssetId?, startDate?,
   *         expectedPaymentMode?, notes? }
   */
  async createDebt(req: AuthRequest, res: Response) {
    const b = req.body as Record<string, unknown>;
    const total = num(b.totalAmount);
    const installments = Math.floor(num(b.installments)) || 1;
    if (!b.label || String(b.label).trim() === '') {
      res.status(400).json({ success: false, error: { message: 'Libellé requis' } });
      return;
    }
    if (total <= 0) {
      res.status(400).json({ success: false, error: { message: 'Montant total invalide' } });
      return;
    }
    if (installments < 1 || installments > 120) {
      res.status(400).json({ success: false, error: { message: 'Nombre d\'échéances invalide (1 à 120)' } });
      return;
    }
    if (!b.firstDueDate) {
      res.status(400).json({ success: false, error: { message: 'Date de la première échéance requise' } });
      return;
    }
    try {
      const debt = await paymentScheduleRepository.createDebt({
        label: String(b.label).trim(),
        totalAmount: total,
        installments,
        firstDueDate: String(b.firstDueDate),
        intervalMonths: b.intervalMonths !== undefined ? Math.floor(num(b.intervalMonths)) : 1,
        supplierId: (b.supplierId as string | null) || null,
        categoryId: (b.categoryId as string | null) || null,
        fixedAssetId: (b.fixedAssetId as string | null) || null,
        startDate: (b.startDate as string | undefined) || undefined,
        expectedPaymentMode: (b.expectedPaymentMode as string | null) || null,
        notes: (b.notes as string | null) || null,
        storeId: req.user!.storeId || null,
        createdBy: req.user!.userId,
      });
      res.status(201).json({ success: true, data: debt });
    } catch (err) {
      fail(res, err, 'Erreur lors de la creation de la dette');
    }
  },

  /** PATCH /api/v1/debts/:id — annulation / reactivation. */
  async updateDebt(req: AuthRequest, res: Response) {
    const status = (req.body as { status?: string }).status;
    if (status !== 'active' && status !== 'cancelled') {
      res.status(400).json({ success: false, error: { message: 'Statut invalide' } });
      return;
    }
    const row = await paymentScheduleRepository.updateDebtStatus(req.params.id, status);
    if (!row) { res.status(404).json({ success: false, error: { message: 'Dette introuvable' } }); return; }
    res.json({ success: true, data: row });
  },

  /** DELETE /api/v1/debts/:id */
  async removeDebt(req: AuthRequest, res: Response) {
    try {
      const out = await paymentScheduleRepository.deleteDebt(req.params.id);
      res.json({ success: true, data: out });
    } catch (err) {
      fail(res, err, 'Erreur lors de la suppression');
    }
  },

  /* ────────────────────────── Charges recurrentes ────────────────────────── */

  /** GET /api/v1/recurring-charges?includeInactive=true */
  async listRecurring(req: AuthRequest, res: Response) {
    const rows = await paymentScheduleRepository.findRecurringCharges({
      storeId: req.user!.storeId,
      includeInactive: String(req.query.includeInactive) === 'true',
    });
    res.json({ success: true, data: rows });
  },

  /**
   * POST /api/v1/recurring-charges
   * body: { label, categoryId, amount?, intervalMonths?, dueDay?, startDate?,
   *         endDate?, supplierId?, expectedPaymentMode?, notes? }
   * amount omis/null = montant variable (electricite, eau).
   */
  async createRecurring(req: AuthRequest, res: Response) {
    const b = req.body as Record<string, unknown>;
    if (!b.label || String(b.label).trim() === '') {
      res.status(400).json({ success: false, error: { message: 'Libellé requis' } });
      return;
    }
    if (!b.categoryId) {
      res.status(400).json({ success: false, error: { message: 'Catégorie requise' } });
      return;
    }
    const dueDay = b.dueDay !== undefined ? Math.floor(num(b.dueDay)) : 1;
    if (dueDay < 1 || dueDay > 31) {
      res.status(400).json({ success: false, error: { message: 'Jour d\'échéance invalide (1 à 31)' } });
      return;
    }
    const interval = b.intervalMonths !== undefined ? Math.floor(num(b.intervalMonths)) : 1;
    if (interval < 1 || interval > 12) {
      res.status(400).json({ success: false, error: { message: 'Périodicité invalide (1 à 12 mois)' } });
      return;
    }
    try {
      const row = await paymentScheduleRepository.createRecurringCharge({
        label: String(b.label).trim(),
        categoryId: String(b.categoryId),
        supplierId: (b.supplierId as string | null) || null,
        amount: b.amount === undefined || b.amount === null || b.amount === '' ? null : num(b.amount),
        intervalMonths: interval,
        dueDay,
        startDate: (b.startDate as string | undefined) || undefined,
        endDate: (b.endDate as string | null) || null,
        expectedPaymentMode: (b.expectedPaymentMode as string | null) || null,
        notes: (b.notes as string | null) || null,
        storeId: req.user!.storeId || null,
        createdBy: req.user!.userId,
      });
      res.status(201).json({ success: true, data: row });
    } catch (err) {
      fail(res, err, 'Erreur lors de la creation de la charge fixe');
    }
  },

  /** PATCH /api/v1/recurring-charges/:id */
  async updateRecurring(req: AuthRequest, res: Response) {
    const b = req.body as Record<string, unknown>;
    try {
      const row = await paymentScheduleRepository.updateRecurringCharge(req.params.id, {
        label: b.label === undefined ? undefined : String(b.label).trim(),
        categoryId: b.categoryId === undefined ? undefined : String(b.categoryId),
        supplierId: b.supplierId === undefined ? undefined : (b.supplierId as string | null) || null,
        amount: b.amount === undefined ? undefined
          : b.amount === null || b.amount === '' ? null : num(b.amount),
        intervalMonths: b.intervalMonths === undefined ? undefined : Math.floor(num(b.intervalMonths)),
        dueDay: b.dueDay === undefined ? undefined : Math.floor(num(b.dueDay)),
        startDate: b.startDate === undefined ? undefined : String(b.startDate),
        endDate: b.endDate === undefined ? undefined : (b.endDate as string | null) || null,
        expectedPaymentMode: b.expectedPaymentMode === undefined ? undefined
          : (b.expectedPaymentMode as string | null) || null,
        notes: b.notes === undefined ? undefined : (b.notes as string | null),
        isActive: b.isActive === undefined ? undefined : Boolean(b.isActive),
      });
      if (!row) { res.status(404).json({ success: false, error: { message: 'Charge fixe introuvable' } }); return; }
      res.json({ success: true, data: row });
    } catch (err) {
      fail(res, err, 'Erreur lors de la mise a jour');
    }
  },

  /** DELETE /api/v1/recurring-charges/:id */
  async removeRecurring(req: AuthRequest, res: Response) {
    try {
      const out = await paymentScheduleRepository.deleteRecurringCharge(req.params.id);
      res.json({ success: true, data: out });
    } catch (err) {
      fail(res, err, 'Erreur lors de la suppression');
    }
  },
};
