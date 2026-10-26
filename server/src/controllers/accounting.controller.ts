import { ROLES } from '@ofauria/shared';
import type { Response } from 'express';
import { approvalService } from '../services/approval.service.js';
import type { AuthRequest } from '../middleware/auth.middleware.js';
import { caisseRepository, expenseCategoryRepository, revenueCategoryRepository, invoiceRepository, paymentRepository } from '../repositories/accounting.repository.js';
import { cashRegisterRepository } from '../repositories/cash-register.repository.js';
import { saleRepository } from '../repositories/sale.repository.js';
import { orderRepository } from '../repositories/order.repository.js';
import { generateInvoicePdf } from '../services/invoice-pdf.service.js';
import { settingsRepository } from '../repositories/settings.repository.js';
import { db } from '../config/database.js';
import { refEntryRepository } from '../repositories/referentiel.repository.js';
import { paymentScheduleRepository } from '../repositories/payment-schedule.repository.js';
import { getParameter, type ExpenseRequiresPo } from '../services/module-parameters.service.js';
import { loadCompanyLegal } from '../utils/company-legal.js';

// Valide un code de mode de reglement contre le referentiel payment_methods
// (table de reference) plutot que contre une liste figee en dur.
// F-013 — Deux vocabulaires de modes de reglement coexistent : payment_modes
// (paiements : virement|cheque|effet…) et payment_methods (factures :
// transfer|check|traite…). Saisir « virement » sur une facture levait « Mode de
// reglement invalide ». On normalise le vocabulaire paiement vers celui des
// factures, et on l'accepte a la saisie comme au stockage.
const PAYMENT_MODE_TO_METHOD: Record<string, string> = {
  virement: 'transfer',
  cheque: 'check',
  cheque_barre: 'check',
  effet: 'traite',
  carte: 'card',
  cash: 'cash',
  mobile: 'mobile',
};
export function normalizePaymentMethod(code: string | null | undefined): string | null | undefined {
  if (code === null || code === undefined || code === '') return code;
  return PAYMENT_MODE_TO_METHOD[code] ?? code;
}
async function isValidPaymentMode(code: string): Promise<boolean> {
  const norm = normalizePaymentMethod(code);
  const entries = await refEntryRepository.findAll('payment_methods');
  return entries.some((e: { code: string }) => e.code === norm);
}

export const caisseController = {
  async register(req: AuthRequest, res: Response) {
    const year = parseInt(req.query.year as string);
    const month = parseInt(req.query.month as string);
    if (!year || !month) { res.status(400).json({ success: false, error: { message: 'year et month requis' } }); return; }
    const data = await caisseRepository.getRegister(year, month, req.user!.storeId);
    res.json({ success: true, data });
  },

  // Admin : fixe le « Report mois précédent » d'un mois (correction d'historique)
  async saveReportOverride(req: AuthRequest, res: Response) {
    const { year, month, cashNet, cardCumul, note } = req.body;
    const y = parseInt(year); const m = parseInt(month);
    if (!y || !m || m < 1 || m > 12) { res.status(400).json({ success: false, error: { message: 'year et month requis' } }); return; }
    const cash = Number(cashNet); const card = Number(cardCumul);
    if (!Number.isFinite(cash) || !Number.isFinite(card)) {
      res.status(400).json({ success: false, error: { message: 'cashNet et cardCumul doivent etre des nombres' } }); return;
    }
    const row = await caisseRepository.saveBalanceOverride({
      year: y, month: m, storeId: req.user!.storeId,
      cashNet: cash, cardCumul: card, note, userId: req.user!.userId,
    });
    res.json({ success: true, data: row });
  },

  // Admin : supprime l'ajustement — le report redevient calcule
  async deleteReportOverride(req: AuthRequest, res: Response) {
    const year = parseInt(req.query.year as string);
    const month = parseInt(req.query.month as string);
    if (!year || !month) { res.status(400).json({ success: false, error: { message: 'year et month requis' } }); return; }
    await caisseRepository.deleteBalanceOverride(year, month, req.user!.storeId);
    res.json({ success: true, data: null });
  },
};

// supplierController : déplacé dans supplier.controller.ts (refonte Achats D1).

export const expenseCategoryController = {
  async list(req: AuthRequest, res: Response) {
    const includeInactive = req.query.all === 'true';
    const categories = includeInactive
      ? await expenseCategoryRepository.findAllTree()
      : await expenseCategoryRepository.findAll();
    res.json({ success: true, data: categories });
  },
  async children(req: AuthRequest, res: Response) {
    const children = await expenseCategoryRepository.findChildren(req.params.id as string);
    res.json({ success: true, data: children });
  },
  async create(req: AuthRequest, res: Response) {
    const category = await expenseCategoryRepository.create(req.body);
    res.status(201).json({ success: true, data: category });
  },
  async update(req: AuthRequest, res: Response) {
    const category = await expenseCategoryRepository.update(req.params.id as string, req.body);
    res.json({ success: true, data: category });
  },
  async remove(req: AuthRequest, res: Response) {
    // Check if referenced in payments
    const usage = await db.query('SELECT COUNT(*)::int as count FROM payments WHERE category_id = $1', [req.params.id]);
    if (usage.rows[0].count > 0) {
      res.status(409).json({ success: false, error: { message: `Impossible : utilisee dans ${usage.rows[0].count} paiement(s)` } });
      return;
    }
    await expenseCategoryRepository.deactivate(req.params.id as string);
    res.json({ success: true, data: null });
  },
};

export const revenueCategoryController = {
  async list(req: AuthRequest, res: Response) {
    const includeInactive = req.query.all === 'true';
    const categories = includeInactive
      ? await revenueCategoryRepository.findAllTree()
      : await revenueCategoryRepository.findAll();
    res.json({ success: true, data: categories });
  },
  async children(req: AuthRequest, res: Response) {
    const children = await revenueCategoryRepository.findChildren(req.params.id as string);
    res.json({ success: true, data: children });
  },
  async create(req: AuthRequest, res: Response) {
    const category = await revenueCategoryRepository.create(req.body);
    res.status(201).json({ success: true, data: category });
  },
  async update(req: AuthRequest, res: Response) {
    const category = await revenueCategoryRepository.update(req.params.id as string, req.body);
    res.json({ success: true, data: category });
  },
  async remove(req: AuthRequest, res: Response) {
    await revenueCategoryRepository.deactivate(req.params.id as string);
    res.json({ success: true, data: null });
  },
};

export const invoiceController = {
  async list(req: AuthRequest, res: Response) {
    const { supplierId, customerId, status, dateFrom, dateTo, invoiceType } = req.query as Record<string, string>;
    const invoices = await invoiceRepository.findAll({
      supplierId, customerId, status, dateFrom, dateTo,
      invoiceType: invoiceType || 'received',
      storeId: req.user!.storeId,
    });
    res.json({ success: true, data: invoices });
  },
  /** Écran Factures reçues : liste paginée par étape (à traiter) ou par période (historique). */
  async receivedBoard(req: AuthRequest, res: Response) {
    const q = req.query as Record<string, string>;
    const STAGES = ['draft', 'blocked', 'to_pay', 'partial', 'paid', 'cancelled'];
    const STATUSES = ['pending', 'partial', 'overdue', 'disputed', 'paid', 'cancelled', 'late', 'blocked', 'to_check'];
    const isDate = (d?: string) => (d && /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : undefined);
    const pageSize = Math.min(Math.max(parseInt(q.pageSize || '25', 10) || 25, 1), 100);
    const page = Math.max(parseInt(q.page || '1', 10) || 1, 1);
    const data = await invoiceRepository.findReceivedBoard({
      storeId: req.user!.storeId,
      view: q.view === 'history' ? 'history' : 'open',
      stage: STAGES.includes(q.stage) ? q.stage : undefined,
      status: STATUSES.includes(q.status) ? q.status : undefined,
      supplierId: q.supplierId || undefined,
      categoryId: q.categoryId || undefined,
      search: q.search?.trim() || undefined,
      dateFrom: isDate(q.dateFrom),
      dateTo: isDate(q.dateTo),
      sort: q.sort || 'invoice_date',
      dir: q.dir === 'asc' ? 'asc' : 'desc',
      limit: pageSize,
      offset: (page - 1) * pageSize,
    });
    res.json({ success: true, data: { ...data, page, pageSize } });
  },
  async receivedPipeline(req: AuthRequest, res: Response) {
    const data = await invoiceRepository.receivedPipeline(req.user!.storeId);
    res.json({ success: true, data });
  },
  async lineExpenses(req: AuthRequest, res: Response) {
    const { supplierId, dateFrom, dateTo } = req.query as Record<string, string>;
    const rows = await invoiceRepository.findLineExpenses({
      supplierId, dateFrom, dateTo, storeId: req.user!.storeId,
    });
    res.json({ success: true, data: rows });
  },
  async updateCategory(req: AuthRequest, res: Response) {
    const { id } = req.params;
    const { categoryId } = req.body as { categoryId?: string | null };
    const invoice = await invoiceRepository.findById(id);
    if (!invoice) { res.status(404).json({ success: false, error: { message: 'Facture non trouvee' } }); return; }
    if (req.user!.storeId && invoice.store_id && invoice.store_id !== req.user!.storeId) {
      res.status(403).json({ success: false, error: { message: 'Acces refuse' } }); return;
    }
    const updated = await invoiceRepository.updateCategory(id, categoryId ?? null);
    res.json({ success: true, data: updated });
  },
  // Categorise une seule ligne de charge (ne touche pas les autres lignes de
  // la meme facture / bon de commande).
  async updateLineCategory(req: AuthRequest, res: Response) {
    const { id } = req.params;
    const { categoryId, source } = req.body as { categoryId?: string | null; source?: string };
    const target = source === 'reception_item' ? 'reception_item' : 'invoice_item';
    const updated = await invoiceRepository.updateLineCategory(id, target, categoryId ?? null, req.user!.userId);
    if (!updated) { res.status(404).json({ success: false, error: { message: 'Ligne non trouvee' } }); return; }
    res.json({ success: true, data: updated });
  },
  async getById(req: AuthRequest, res: Response) {
    const invoice = await invoiceRepository.findById(req.params.id);
    if (!invoice) { res.status(404).json({ success: false, error: { message: 'Facture non trouvee' } }); return; }
    if (req.user!.storeId && invoice.store_id && invoice.store_id !== req.user!.storeId) {
      res.status(403).json({ success: false, error: { message: 'Acces refuse' } }); return;
    }
    res.json({ success: true, data: invoice });
  },
  async create(req: AuthRequest, res: Response) {
    const data = { ...req.body, createdBy: req.user!.userId, storeId: req.user!.storeId };
    if (!data.totalAmount) data.totalAmount = (parseFloat(data.amount) || 0) + (parseFloat(data.taxAmount) || 0);
    const invoice = await invoiceRepository.create(data);
    res.status(201).json({ success: true, data: invoice });
  },
  async createFromOrder(req: AuthRequest, res: Response) {
    const invoice = await invoiceRepository.createFromOrder(
      req.params.orderId, req.user!.userId, req.user!.storeId
    );
    res.status(201).json({ success: true, data: invoice });
  },
  /**
   * POST /invoices/merge — fusionne les factures fournisseurs liees aux BCs
   * passes en parametre. Cas typique : le fournisseur a livre plusieurs BCs
   * en une seule fois avec un seul N° facture.
   */
  async merge(req: AuthRequest, res: Response) {
    const { purchaseOrderIds, supplierInvoiceNumber, invoiceDate } = req.body as {
      purchaseOrderIds?: string[]; supplierInvoiceNumber?: string; invoiceDate?: string;
    };
    if (!Array.isArray(purchaseOrderIds) || purchaseOrderIds.length < 2) {
      res.status(400).json({ success: false, error: { message: 'Selectionnez au moins 2 BCs a fusionner.' } });
      return;
    }
    try {
      const invoice = await invoiceRepository.mergeForPurchaseOrders(
        purchaseOrderIds,
        {
          supplierInvoiceNumber,
          invoiceDate,
          createdBy: req.user!.userId,
          storeId: req.user!.storeId ?? null,
        }
      );
      res.json({ success: true, data: invoice });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Erreur lors de la fusion';
      res.status(409).json({ success: false, error: { message: msg } });
    }
  },
  /** Annulation motivée (mig 309) pour une facture reçue ; inchangé pour une facture émise. */
  async cancel(req: AuthRequest, res: Response) {
    const current = await invoiceRepository.findById(req.params.id);
    if (!current) { res.status(404).json({ success: false, error: { message: 'Facture non trouvee' } }); return; }
    if (current.invoice_type === 'received') {
      const { reasonCodeId, note } = (req.body ?? {}) as { reasonCodeId?: string; note?: string };
      if (!reasonCodeId) { res.status(400).json({ success: false, error: { message: 'Motif d\'annulation requis' } }); return; }
      const invoice = await invoiceRepository.cancelReceived(req.params.id, req.user!.userId, reasonCodeId, note?.trim() || null);
      res.json({ success: true, data: invoice });
      return;
    }
    if (current.status === 'cancelled') { res.status(409).json({ success: false, error: { message: 'Facture déjà annulée' } }); return; }
    // Circuit d'approbation (lot 8) : l'annulation d'une facture émise vaut
    // avoir (numérotation continue, mig 329) et passe par un approbateur.
    const approval = await approvalService.submit({
      docType: 'invoice_cancel', docId: req.params.id,
      docLabel: `Annulation facture ${current.invoice_number ?? ''}`.trim(),
      amount: Number(current.total_amount ?? 0),
      values: { amount: Number(current.total_amount ?? 0), invoice_type: current.invoice_type },
      storeId: current.store_id ?? req.user!.storeId ?? null, requestedBy: req.user!.userId,
    });
    if (approval.outcome === 'already_pending') {
      res.status(409).json({ success: false, error: { message: 'Cette annulation attend déjà une approbation' }, approval: approval.request });
      return;
    }
    if (approval.outcome === 'submitted') {
      res.status(202).json({ success: true, data: current, approval: approval.request });
      return;
    }
    const invoice = await invoiceRepository.updateStatus(req.params.id, 'cancelled');
    res.json({ success: true, data: invoice });
  },

  /** GET /invoices/:id/control — blocages, mentions légales, rapprochement par ligne (mig 309). */
  async control(req: AuthRequest, res: Response) {
    const data = await invoiceRepository.control(req.params.id, req.query.revalidate === 'true');
    if (!data) { res.status(404).json({ success: false, error: { message: 'Facture non trouvee' } }); return; }
    res.json({ success: true, data });
  },

  async releaseHold(req: AuthRequest, res: Response) {
    const { reasonCodeId, note } = req.body as { reasonCodeId: string; note?: string | null };
    const r = await invoiceRepository.releaseHold(req.params.holdId, req.user!.userId, reasonCodeId, note ?? null);
    res.json({ success: true, data: r });
  },

  async addHold(req: AuthRequest, res: Response) {
    const r = await invoiceRepository.addManualHold(req.params.id, req.user!.userId, String(req.body.note ?? '').trim());
    res.status(201).json({ success: true, data: r });
  },

  async taxCodes(req: AuthRequest, res: Response) {
    res.json({ success: true, data: await invoiceRepository.taxCodes(typeof req.query.at === 'string' ? req.query.at : undefined) });
  },
  /**
   * PUT /invoices/:id — Modification complete (admin + gerant).
   * Sert aussi pour les ajustements (montant, dates, fournisseur, etc.).
   * Champs additifs : seuls ceux fournis sont modifies.
   */
  async update(req: AuthRequest, res: Response) {
    const invoice = await invoiceRepository.findById(req.params.id);
    if (!invoice) {
      res.status(404).json({ success: false, error: { message: 'Facture non trouvee' } });
      return;
    }
    if (req.user!.storeId && invoice.store_id && invoice.store_id !== req.user!.storeId) {
      res.status(403).json({ success: false, error: { message: 'Acces refuse' } });
      return;
    }

    const body = req.body as Record<string, unknown>;
    // Validation mode de reglement
    if (body.expectedPaymentMode && !(await isValidPaymentMode(body.expectedPaymentMode as string))) {
      res.status(400).json({ success: false, error: { message: 'Mode de reglement invalide' } });
      return;
    }

    const num = (v: unknown): number | undefined => {
      if (v === undefined || v === null || v === '') return undefined;
      const n = typeof v === 'number' ? v : parseFloat(String(v));
      return Number.isFinite(n) ? n : undefined;
    };

    try {
      const updated = await invoiceRepository.update(req.params.id, {
        invoiceNumber: body.invoiceNumber as string | undefined,
        supplierId: body.supplierId as string | null | undefined,
        customerId: body.customerId as string | null | undefined,
        categoryId: body.categoryId as string | null | undefined,
        invoiceDate: body.invoiceDate as string | undefined,
        dueDate: body.dueDate as string | null | undefined,
        amount: num(body.amount),
        taxAmount: num(body.taxAmount),
        totalAmount: num(body.totalAmount),
        notes: body.notes as string | null | undefined,
        expectedPaymentMode: normalizePaymentMethod(body.expectedPaymentMode as string | null | undefined),
        receptionDate: body.receptionDate as string | null | undefined,
        checkNumber: body.checkNumber as string | null | undefined,
      });
      res.json({ success: true, data: updated });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Erreur lors de la mise a jour';
      const e = err as { statusCode?: number; code?: string };
      res.status(e?.statusCode ?? (e?.code === 'OF409' || e?.code === '23505' ? 409 : 400)).json({ success: false, error: { message: msg } });
    }
  },
  /**
   * DELETE /invoices/:id — Suppression physique (admin + gerant).
   * Bloquee par defaut si paiements lies. ?force=true cascade les paiements.
   */
  async remove(req: AuthRequest, res: Response) {
    const invoice = await invoiceRepository.findById(req.params.id);
    if (!invoice) {
      res.status(404).json({ success: false, error: { message: 'Facture non trouvee' } });
      return;
    }
    if (req.user!.storeId && invoice.store_id && invoice.store_id !== req.user!.storeId) {
      res.status(403).json({ success: false, error: { message: 'Acces refuse' } });
      return;
    }
    const force = String(req.query.force || '').toLowerCase() === 'true';
    try {
      const result = await invoiceRepository.deleteById(req.params.id, { force });
      res.json({ success: true, data: result });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Erreur lors de la suppression';
      res.status((err as { code?: string })?.code === 'OF409' ? 409 : 400).json({ success: false, error: { message: msg } });
    }
  },
  async paymentAlerts(req: AuthRequest, res: Response) {
    const alertDays = req.query.days ? Math.max(1, Math.min(60, parseInt(req.query.days as string) || 7)) : 7;
    const rows = await invoiceRepository.findPaymentAlerts({ storeId: req.user!.storeId, alertDays });
    res.json({ success: true, data: rows });
  },
  /**
   * GET /invoices/debts — Dettes & creances ouvertes, separees par sens.
   *   - receivables    : factures emises non soldees (clients qui nous doivent)
   *   - payables       : factures recues non soldees (ce qu'on doit aux fournisseurs)
   *   - standaloneDebts: dettes echelonnees SANS facture (mig 258) — materiel a
   *     credit saisi directement. Renvoyees a part pour ne pas etre confondues
   *     avec des factures, mais a additionner au total "nous leur devons" :
   *     sans elles le total sous-estime ce qu'on doit reellement.
   */
  async debts(req: AuthRequest, res: Response) {
    const [rows, standaloneDebts] = await Promise.all([
      invoiceRepository.findOpenDebts({ storeId: req.user!.storeId }),
      paymentScheduleRepository.findDebts({ storeId: req.user!.storeId }),
    ]);
    const receivables = rows.filter((r: Record<string, unknown>) => r.invoice_type === 'emitted');
    const payables = rows.filter((r: Record<string, unknown>) => r.invoice_type === 'received');
    res.json({ success: true, data: { receivables, payables, standaloneDebts } });
  },
  /**
   * PUT /invoices/:id/items — Remplace les lignes d'une facture (admin/gerant).
   * Recalcule amount + total_amount automatiquement (cf. invoiceRepository.replaceItems).
   */
  async replaceItems(req: AuthRequest, res: Response) {
    const invoice = await invoiceRepository.findById(req.params.id);
    if (!invoice) { res.status(404).json({ success: false, error: { message: 'Facture non trouvee' } }); return; }
    if (req.user!.storeId && invoice.store_id && invoice.store_id !== req.user!.storeId) {
      res.status(403).json({ success: false, error: { message: 'Acces refuse' } }); return;
    }
    const body = req.body as { items?: unknown };
    if (!Array.isArray(body.items)) {
      res.status(400).json({ success: false, error: { message: 'Champ "items" requis (tableau)' } });
      return;
    }
    const num = (v: unknown): number => {
      const n = typeof v === 'number' ? v : parseFloat(String(v));
      return Number.isFinite(n) ? n : 0;
    };
    // tvaRate : taux TVA de la ligne en %. undefined/null/'' => pas de taux
    // explicite (la ligne retombe sur la TVA globale d'en-tete).
    const rate = (v: unknown): number | null => {
      if (v === undefined || v === null || v === '') return null;
      const n = typeof v === 'number' ? v : parseFloat(String(v));
      return Number.isFinite(n) ? n : null;
    };
    const items = (body.items as Record<string, unknown>[]).map((raw) => ({
      productId: (raw.productId as string | null | undefined) || null,
      ingredientId: (raw.ingredientId as string | null | undefined) || null,
      description: (raw.description as string | null | undefined) || null,
      quantity: num(raw.quantity),
      unitPrice: num(raw.unitPrice),
      subtotal: raw.subtotal !== undefined ? num(raw.subtotal) : num(raw.quantity) * num(raw.unitPrice),
      tvaRate: rate(raw.tvaRate),
    }));
    try {
      const updated = await invoiceRepository.replaceItems(req.params.id, items);
      res.json({ success: true, data: updated });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Erreur lors de la mise a jour des lignes';
      const e = err as { statusCode?: number; code?: string };
      res.status(e?.statusCode ?? (e?.code === 'OF409' ? 409 : 400)).json({ success: false, error: { message: msg } });
    }
  },
  async updatePaymentTerms(req: AuthRequest, res: Response) {
    const invoice = await invoiceRepository.findById(req.params.id);
    if (!invoice) { res.status(404).json({ success: false, error: { message: 'Facture non trouvee' } }); return; }
    if (req.user!.storeId && invoice.store_id && invoice.store_id !== req.user!.storeId) {
      res.status(403).json({ success: false, error: { message: 'Acces refuse' } }); return;
    }
    const { dueDate, expectedPaymentMode, receptionDate } = req.body as Record<string, string | null | undefined>;
    if (expectedPaymentMode && !(await isValidPaymentMode(expectedPaymentMode))) {
      res.status(400).json({ success: false, error: { message: 'Mode de reglement invalide' } });
      return;
    }
    const updated = await invoiceRepository.updatePaymentTerms(req.params.id, {
      dueDate, expectedPaymentMode: normalizePaymentMethod(expectedPaymentMode), receptionDate,
    });
    res.json({ success: true, data: updated });
  },
  async updateStatusManual(req: AuthRequest, res: Response) {
    const invoice = await invoiceRepository.findById(req.params.id);
    if (!invoice) { res.status(404).json({ success: false, error: { message: 'Facture non trouvee' } }); return; }
    if (req.user!.storeId && invoice.store_id && invoice.store_id !== req.user!.storeId) {
      res.status(403).json({ success: false, error: { message: 'Acces refuse' } }); return;
    }
    const { status } = req.body as { status?: string };
    // Mig 309 (G-D6-08) : « payée / partiellement payée / à payer » découlent des paiements et ne se
    // posent plus à la main ; l'annulation passe par /cancel avec un motif. Reste manuel : le litige.
    if (invoice.invoice_type === 'received') {
      if (status === 'disputed') {
        res.json({ success: true, data: await invoiceRepository.updateStatus(req.params.id, 'disputed') });
        return;
      }
      if (status === 'pending' || status === 'partial' || status === 'paid') {
        // Lever un litige : le statut redevient celui que dictent les paiements.
        if (invoice.status === 'disputed') await invoiceRepository.updateStatus(req.params.id, 'pending');
        res.json({ success: true, data: await invoiceRepository.updatePaidAmount(req.params.id) });
        return;
      }
      res.status(400).json({ success: false, error: { message: 'Statut non modifiable à la main : le règlement découle des paiements, l\'annulation exige un motif.' } });
      return;
    }
    const allowed = ['pending', 'partial', 'paid', 'overdue', 'cancelled', 'disputed'];
    if (!status || !allowed.includes(status)) {
      res.status(400).json({ success: false, error: { message: 'Statut invalide' } });
      return;
    }
    const updated = await invoiceRepository.updateStatus(req.params.id, status);
    res.json({ success: true, data: updated });
  },
  async uploadAttachment(req: AuthRequest, res: Response) {
    if (!req.file) {
      res.status(400).json({ success: false, error: { message: 'Aucun fichier envoye' } });
      return;
    }
    const url = `/uploads/invoices/${req.file.filename}`;
    const invoice = await invoiceRepository.updateAttachment(req.params.id, url);
    res.json({ success: true, data: invoice });
  },
  async removeAttachment(req: AuthRequest, res: Response) {
    const invoice = await invoiceRepository.updateAttachment(req.params.id, null);
    res.json({ success: true, data: invoice });
  },
  async downloadDocx(req: AuthRequest, res: Response) {
    try {
      const invoice = await invoiceRepository.findById(req.params.id);
      if (!invoice) { res.status(404).json({ success: false, error: { message: 'Facture non trouvee' } }); return; }

      // Get invoice items with product category (join by product_id, fallback by product name).
      // Description fallback : la ligne de commande peut etre creee sans description
      // texte (notes ligne). On retombe sur le nom du produit lie pour eviter une
      // colonne DESIGNATION vide sur la facture.
      const itemsResult = await db.query(
        `SELECT COALESCE(NULLIF(ii.description, ''), p.name, p2.name, '') AS description,
                ii.quantity, ii.unit_price, ii.subtotal, ii.tva_rate, ii.tva_amount,
                COALESCE(cat.name, cat2.name, '') AS category_name
         FROM invoice_items ii
         LEFT JOIN products p ON p.id = ii.product_id
         LEFT JOIN categories cat ON cat.id = p.category_id
         LEFT JOIN products p2 ON p2.name = ii.description AND ii.product_id IS NULL
         LEFT JOIN categories cat2 ON cat2.id = p2.category_id
         WHERE ii.invoice_id = $1 ORDER BY ii.id`,
        [req.params.id]
      );

      // If no invoice_items, build from invoice itself
      let items = itemsResult.rows;
      if (items.length === 0) {
        items = [{
          description: (invoice as Record<string, unknown>).notes || 'Prestation',
          quantity: 1,
          unit_price: parseFloat((invoice as Record<string, unknown>).amount as string) || 0,
          subtotal: parseFloat((invoice as Record<string, unknown>).total_amount as string) || 0,
          category_name: '',
        }];
      }

      // Get company settings
      const settings = await settingsRepository.get();

      // Customer / supplier info (facturer à)
      let customerName = 'Client';
      let customerAddress = '';
      let customerICE = '';
      const inv = invoice as Record<string, unknown>;
      const isMoral = ['professionnel', 'association', 'revendeur'].includes(inv.customer_type as string);
      if (isMoral && inv.customer_company_name) {
        customerName = inv.customer_company_name as string;
      } else if (inv.customer_first_name || inv.customer_last_name) {
        customerName = `${inv.customer_first_name || ''} ${inv.customer_last_name || ''}`.trim();
      } else if (inv.supplier_name) {
        customerName = inv.supplier_name as string;
      }
      // Adresse : client ou fournisseur selon le type de facture
      const addrParts: string[] = [];
      if (inv.customer_address) addrParts.push(inv.customer_address as string);
      if (inv.customer_city) addrParts.push(inv.customer_city as string);
      if (addrParts.length === 0 && inv.supplier_address) {
        addrParts.push(inv.supplier_address as string);
        if (inv.supplier_city) addrParts.push(inv.supplier_city as string);
      }
      customerAddress = addrParts.join(', ');
      // Identifiant fiscal : ICE d'abord, sinon IF, sinon ICE fournisseur
      customerICE = (inv.customer_ice as string) || (inv.customer_if as string) || (inv.supplier_ice as string) || '';

      const totalAmount = parseFloat(inv.total_amount as string) || 0;
      let amount = parseFloat(inv.amount as string) || 0;
      let taxAmount = parseFloat(inv.tax_amount as string) || 0;
      let tvaRate = 20; // Default TVA rate

      // amount manquant entierement → reverse-calc depuis le TTC en supposant 20%.
      // Si amount est present mais sans tax_amount, on respecte : facture sans TVA.
      if (amount <= 0 && totalAmount > 0) {
        amount = Math.round((totalAmount / (1 + tvaRate / 100)) * 100) / 100;
        taxAmount = Math.round((totalAmount - amount) * 100) / 100;
      } else if (amount > 0 && taxAmount > 0) {
        tvaRate = Math.round((taxAmount / amount) * 100);
      } else {
        // amount > 0 et taxAmount = 0 : facture HT = TTC, pas de TVA.
        tvaRate = 0;
      }

      const invoiceDate = new Date(inv.invoice_date as string);
      const dateStr = invoiceDate.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' });

      // Due date: 30 days after invoice date if not set
      let dueDateStr = '';
      if (inv.due_date) {
        dueDateStr = new Date(inv.due_date as string).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' });
      } else {
        const dueDate = new Date(invoiceDate);
        dueDate.setDate(dueDate.getDate() + 30);
        dueDateStr = dueDate.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' });
      }

      // Resolve logo path — use __dirname to get absolute path relative to this file
      let logoPath: string | undefined;
      const pathMod = await import('path');
      const fsMod = await import('fs');
      const { fileURLToPath } = await import('url');
      const __filename = fileURLToPath(import.meta.url);
      const __dirname = pathMod.dirname(__filename);
      // server/src/controllers/ -> go up 3 levels to project root
      const projectRoot = pathMod.resolve(__dirname, '..', '..', '..');
      if (settings?.logo_url && settings.logo_url.startsWith('data:')) {
        // Logo persiste en base (data URI) : transmis tel quel, le service PDF le decode.
        logoPath = settings.logo_url;
      } else {
        const logoCandidates = [
          settings?.logo_url ? pathMod.join(projectRoot, 'uploads', settings.logo_url) : '',
          settings?.logo_url ? pathMod.join(projectRoot, settings.logo_url) : '',
          pathMod.join(projectRoot, 'client', 'public', 'images', 'logo-horizontal.png'),
          pathMod.join(projectRoot, 'uploads', 'logos', 'logo-1775319515435.png'),
        ].filter(Boolean);
        for (const candidate of logoCandidates) {
          if (fsMod.existsSync(candidate)) { logoPath = candidate; break; }
        }
      }

      // Ventilation TVA par taux a partir des lignes (factures multi-taux).
      // Vide si aucune ligne ne porte de taux explicite -> rendu ligne unique.
      const tvaBreakdownMap = new Map<number, number>();
      for (const it of items as Record<string, unknown>[]) {
        if (it.tva_rate === null || it.tva_rate === undefined) continue;
        const rate = parseFloat(it.tva_rate as string);
        if (!Number.isFinite(rate)) continue;
        const amt = it.tva_amount != null ? (parseFloat(it.tva_amount as string) || 0) : 0;
        tvaBreakdownMap.set(rate, (tvaBreakdownMap.get(rate) || 0) + amt);
      }
      const tvaBreakdown = [...tvaBreakdownMap.entries()]
        .sort((a, b) => a[0] - b[0])
        .map(([rate, amt]) => ({ rate, amount: Math.round(amt * 100) / 100 }));

      const legal = await loadCompanyLegal();
      const buffer = await generateInvoicePdf({
        invoiceNumber: inv.invoice_number as string,
        invoiceDate: dateStr,
        dueDate: dueDateStr,
        paymentMethod: '',
        customerName,
        customerAddress,
        customerICE,
        items: items.map((it: Record<string, unknown>) => ({
          description: (it.description as string) || '',
          category: (it.category_name as string) || '',
          quantity: parseFloat(it.quantity as string) || 1,
          unit_price: parseFloat(it.unit_price as string) || 0,
          subtotal: parseFloat(it.subtotal as string) || 0,
        })),
        totalHT: amount,
        tvaRate,
        totalTVA: taxAmount,
        totalTTC: totalAmount,
        tvaBreakdown,
        companyName: legal.name,
        companyAddress: legal.address,
        companyPhone: legal.phone,
        companyEmail: legal.email,
        companyRC: legal.rc,
        companyPatente: legal.patente,
        companyIF: legal.if,
        companyICE: legal.ice,
        companyCNSS: '',
        companyBankAccount: '',
        logoPath,
      });

      const filename = `${inv.invoice_number || 'facture'}.pdf`.replace(/[/\\]/g, '-');
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      res.setHeader('Content-Length', buffer.length);
      res.send(buffer);
    } catch (err) {
      console.error('Error generating invoice PDF:', err);
      res.status(500).json({ success: false, error: { message: 'Erreur lors de la generation du document' } });
    }
  },
};

export const paymentController = {
  async list(req: AuthRequest, res: Response) {
    const { type, dateFrom, dateTo, supplierId } = req.query as Record<string, string>;
    const payments = await paymentRepository.findAll({ type, dateFrom, dateTo, supplierId, storeId: req.user!.storeId });
    res.json({ success: true, data: payments });
  },
  /**
   * GET /payments/checks?status=&dateFrom=&dateTo=
   * Liste les paiements par cheque pour la gestion d'encaissement.
   */
  async listChecks(req: AuthRequest, res: Response) {
    const { status, dateFrom, dateTo, supplierId, employeeId } = req.query as Record<string, string>;
    const allowed = ['pending', 'cashed', 'all'];
    const safeStatus = status && allowed.includes(status) ? (status as 'pending' | 'cashed' | 'all') : 'all';
    const checks = await paymentRepository.findChecks({
      status: safeStatus, dateFrom, dateTo, supplierId, employeeId,
      storeId: req.user!.storeId,
    });
    res.json({ success: true, data: checks });
  },
  /**
   * POST /payments/:id/mark-cashed
   * Body: { cashedAt?: 'YYYY-MM-DD', note?: string }
   * Confirme l'encaissement d'un cheque. cashedBy est l'utilisateur courant.
   */
  async markCashed(req: AuthRequest, res: Response) {
    const { cashedAt, note } = req.body as { cashedAt?: string; note?: string };
    try {
      const payment = await paymentRepository.markCashed(req.params.id, {
        cashedAt, cashedBy: req.user!.userId, note,
      });
      res.json({ success: true, data: payment });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Erreur lors de la confirmation';
      res.status(400).json({ success: false, error: { message: msg } });
    }
  },
  /**
   * POST /payments/:id/unmark-cashed — Admin uniquement (correction d'erreur).
   * Re-bascule un cheque deja confirme en attente.
   */
  async unmarkCashed(req: AuthRequest, res: Response) {
    try {
      const payment = await paymentRepository.unmarkCashed(req.params.id);
      res.json({ success: true, data: payment });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Erreur';
      res.status(400).json({ success: false, error: { message: msg } });
    }
  },
  async create(req: AuthRequest, res: Response) {
    const data = { ...req.body, createdBy: req.user!.userId, storeId: req.user!.storeId };

    // Dérogation au plafond espèces (mig 310, G-D7-04) : administrateur uniquement.
    if (data.cashOverride && req.user!.role !== ROLES.ADMIN) {
      res.status(403).json({ success: false, error: { message: 'Seul un administrateur peut déroger au plafond espèces.' } });
      return;
    }
    // Un mouvement entre nos comptes passe par POST /payments/internal-transfer.
    if (data.type === 'internal_transfer') {
      res.status(400).json({ success: false, error: { message: 'Utilisez « Mouvement interne » pour un virement entre caisse et banque.' } });
      return;
    }

    // Section 4.3 — Paid-out : si un paiement cash est cree pendant qu'une
    // session de caisse est ouverte pour l'utilisateur courant, on l'y
    // rattache pour que cash-register.close() le deduise du montant attendu
    // du tiroir. Sinon la depense creait un « manquant » artificiel a la
    // cloture. On skip quand la session est deja en phase de comptage
    // (closing_started_at posé) pour rester coherent avec le blocage des
    // ventes (C6).
    if (data.paymentMethod === 'cash' && !data.sessionId) {
      const openSession = await cashRegisterRepository.findOpenSession(req.user!.userId);
      if (openSession && !openSession.closing_started_at) {
        data.sessionId = openSession.id;
      }
    }

    // Reglement d'une echeance (mig 258) : on herite categorie / fournisseur de
    // l'echeance quand ils ne sont pas fournis, pour que la depense se classe
    // toute seule dans Charges (et passe la garde "categorie obligatoire").
    if (data.scheduledPaymentId && (!data.categoryId || !data.supplierId)) {
      const sched = await paymentScheduleRepository.findById(String(data.scheduledPaymentId));
      if (sched) {
        if (!data.categoryId) data.categoryId = sched.category_id || undefined;
        if (!data.supplierId) data.supplierId = sched.supplier_id || sched.invoice_supplier_id || undefined;
      }
    }

    // ─── BC OBLIGATOIRE AVANT DÉPENSE (mig 306, G-D3-02) ─────────────
    // Règle portée par le paramètre purchasing.expense_requires_po (table module_parameters),
    // et non plus par une constante de code. Désactivée par défaut : décision du gérant.
    if (data.type === 'expense' && data.categoryId) {
      const rule = await getParameter<ExpenseRequiresPo>('purchasing.expense_requires_po');
      const amount = Number(data.amount) || 0;
      if (rule?.enabled && amount >= (rule.threshold ?? 0)) {
        const category = await expenseCategoryRepository.findById(data.categoryId);
        if (category && category.requires_po) {
          if (!data.purchaseOrderId) {
            res.status(400).json({
              success: false,
              error: { message: `La catégorie « ${category.name} » exige un bon de commande engagé au-delà de ${rule.threshold} ${rule.currency}. Sélectionnez un BC.` },
            });
            return;
          }
          const po = await db.query(`SELECT status, on_hold FROM purchase_orders WHERE id = $1`, [data.purchaseOrderId]);
          const st = po.rows[0]?.status as string | undefined;
          if (!st || !['envoye', 'livre_partiel', 'livre_complet', 'en_attente_facturation'].includes(st) || po.rows[0].on_hold) {
            res.status(400).json({ success: false, error: { message: 'Le bon de commande doit être engagé (envoyé ou livré) et non bloqué.' } });
            return;
          }
        }
      }
    }
    // Mig 311 (G-D8-09) : une catégorie financière (virement caisse → banque…) n'est pas une charge.
    if (data.type === 'expense' && data.categoryId) {
      const blocked = await db.query(
        `WITH RECURSIVE chain AS (
           SELECT id, parent_id, name, posting_block_reason FROM expense_categories WHERE id = $1
           UNION ALL SELECT c.id, c.parent_id, c.name, c.posting_block_reason FROM expense_categories c JOIN chain ch ON ch.parent_id = c.id)
         SELECT name, posting_block_reason FROM chain WHERE posting_block_reason IS NOT NULL LIMIT 1`, [data.categoryId]);
      if (blocked.rows[0]) {
        res.status(400).json({ success: false, error: { message: `« ${blocked.rows[0].name} » : ${blocked.rows[0].posting_block_reason}` } });
        return;
      }
    }
    // If type is expense and no category selected, also block
    if (data.type === 'expense' && !data.categoryId) {
      res.status(400).json({
        success: false,
        error: { message: 'Veuillez selectionner une categorie pour cette depense.' }
      });
      return;
    }

    const payment = await paymentRepository.create(data);

    // When an emitted invoice linked to a deferred order is fully paid, create the sale
    if (data.invoiceId) {
      try {
        const invoice = await invoiceRepository.findById(data.invoiceId);
        if (invoice && invoice.invoice_type === 'emitted' && invoice.status === 'paid' && invoice.order_id) {
          const order = await orderRepository.findById(invoice.order_id);
          if (order && order.payment_method === 'deferred') {
            // Check if a sale was already created for this order
            const { db: database } = await import('../config/database.js');
            const existingSale = await database.query(
              `SELECT id FROM sales WHERE notes LIKE $1 LIMIT 1`,
              [`%Livraison commande ${order.order_number}%`]
            );
            if (existingSale.rows.length === 0) {
              const saleItems = order.items.map((item: Record<string, unknown>) => ({
                productId: item.product_id as string,
                quantity: item.quantity as number,
                unitPrice: parseFloat(item.unit_price as string),
                subtotal: parseFloat(item.subtotal as string),
              }));
              await saleRepository.create({
                customerId: order.customer_id,
                userId: req.user!.userId,
                subtotal: parseFloat(order.subtotal),
                taxAmount: parseFloat(order.tax_amount),
                discountAmount: parseFloat(order.discount_amount),
                total: parseFloat(order.total),
                paymentMethod: data.paymentMethod || 'cash',
                notes: `Livraison commande ${order.order_number} — Paiement facture ${invoice.invoice_number}`,
                storeId: req.user!.storeId,
                items: saleItems,
              });
            }
          }
        }
      } catch (err) {
        console.error('Failed to create sale from paid invoice:', err);
      }
    }

    res.status(201).json({ success: true, data: payment });
  },
  async update(req: AuthRequest, res: Response) {
    const payment = await paymentRepository.update(req.params.id, req.body, req.user!.userId);
    res.json({ success: true, data: payment });
  },
  async remove(req: AuthRequest, res: Response) {
    await paymentRepository.delete(req.params.id);
    res.json({ success: true, data: null });
  },
  /** POST /payments/:id/void — annulation motivée par contre-pièce (mig 310, G-D7-08). */
  async voidPayment(req: AuthRequest, res: Response) {
    const { reasonCodeId, note } = req.body as { reasonCodeId: string; note: string | null };
    const payment = await paymentRepository.voidPayment(req.params.id, { reasonCodeId, note, userId: req.user!.userId });
    res.json({ success: true, data: payment });
  },
  /** POST /payments/:id/reissue — nouveau règlement lié à un paiement annulé. */
  async reissue(req: AuthRequest, res: Response) {
    if (req.body.cashOverride && req.user!.role !== ROLES.ADMIN) {
      res.status(403).json({ success: false, error: { message: 'Seul un administrateur peut déroger au plafond espèces.' } });
      return;
    }
    const payment = await paymentRepository.reissue(req.params.id, { ...req.body, userId: req.user!.userId, storeId: req.user!.storeId });
    res.status(201).json({ success: true, data: payment });
  },
  async modes(_req: AuthRequest, res: Response) {
    res.json({ success: true, data: await paymentRepository.listModes() });
  },
  /** GET /payments/cash-cumul?supplierId=&date=&amount= — jauge du plafond espèces. */
  async cashCumul(req: AuthRequest, res: Response) {
    const { supplierId, date, amount } = req.query as Record<string, string>;
    res.json({ success: true, data: await paymentRepository.cashCumul(supplierId, date, amount ? parseFloat(amount) || 0 : 0) });
  },
  async cashLimitBreaches(_req: AuthRequest, res: Response) {
    res.json({ success: true, data: await paymentRepository.cashLimitBreaches() });
  },
  /** POST /payments/internal-transfer — versement en banque, retrait (G-D7-17). */
  async internalTransfer(req: AuthRequest, res: Response) {
    const payment = await paymentRepository.createInternalTransfer({ ...req.body, userId: req.user!.userId, storeId: req.user!.storeId });
    res.status(201).json({ success: true, data: payment });
  },
  async summary(req: AuthRequest, res: Response) {
    const { dateFrom, dateTo } = req.query as Record<string, string>;
    if (!dateFrom || !dateTo) { res.status(400).json({ success: false, error: { message: 'dateFrom et dateTo requis' } }); return; }
    const summary = await paymentRepository.summary({ dateFrom, dateTo, storeId: req.user!.storeId });
    const byCategory = await paymentRepository.summaryByCategory({ dateFrom, dateTo, storeId: req.user!.storeId });
    res.json({ success: true, data: { summary, byCategory } });
  },
};
