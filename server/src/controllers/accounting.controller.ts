import type { Response } from 'express';
import type { AuthRequest } from '../middleware/auth.middleware.js';
import { caisseRepository, supplierRepository, expenseCategoryRepository, revenueCategoryRepository, invoiceRepository, paymentRepository } from '../repositories/accounting.repository.js';
import { saleRepository } from '../repositories/sale.repository.js';
import { orderRepository } from '../repositories/order.repository.js';
import { generateInvoicePdf } from '../services/invoice-pdf.service.js';
import { settingsRepository } from '../repositories/settings.repository.js';
import { db } from '../config/database.js';

export const caisseController = {
  async register(req: AuthRequest, res: Response) {
    const year = parseInt(req.query.year as string);
    const month = parseInt(req.query.month as string);
    if (!year || !month) { res.status(400).json({ success: false, error: { message: 'year et month requis' } }); return; }
    const data = await caisseRepository.getRegister(year, month, req.user!.storeId);
    res.json({ success: true, data });
  },
};

export const supplierController = {
  async list(_req: AuthRequest, res: Response) {
    const suppliers = await supplierRepository.findAll();
    res.json({ success: true, data: suppliers });
  },
  async getById(req: AuthRequest, res: Response) {
    const supplier = await supplierRepository.findById(req.params.id);
    if (!supplier) { res.status(404).json({ success: false, error: { message: 'Fournisseur non trouve' } }); return; }
    res.json({ success: true, data: supplier });
  },
  async create(req: AuthRequest, res: Response) {
    const supplier = await supplierRepository.create(req.body);
    res.status(201).json({ success: true, data: supplier });
  },
  async update(req: AuthRequest, res: Response) {
    const supplier = await supplierRepository.update(req.params.id, req.body);
    res.json({ success: true, data: supplier });
  },
  async remove(req: AuthRequest, res: Response) {
    await supplierRepository.delete(req.params.id);
    res.json({ success: true, data: null });
  },
};

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
  async cancel(req: AuthRequest, res: Response) {
    const invoice = await invoiceRepository.updateStatus(req.params.id, 'cancelled');
    res.json({ success: true, data: invoice });
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
    if (body.expectedPaymentMode && !['cash', 'check', 'transfer'].includes(body.expectedPaymentMode as string)) {
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
        expectedPaymentMode: body.expectedPaymentMode as string | null | undefined,
        receptionDate: body.receptionDate as string | null | undefined,
        checkNumber: body.checkNumber as string | null | undefined,
      });
      res.json({ success: true, data: updated });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Erreur lors de la mise a jour';
      res.status(400).json({ success: false, error: { message: msg } });
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
      res.status(400).json({ success: false, error: { message: msg } });
    }
  },
  async paymentAlerts(req: AuthRequest, res: Response) {
    const alertDays = req.query.days ? Math.max(1, Math.min(60, parseInt(req.query.days as string) || 7)) : 7;
    const rows = await invoiceRepository.findPaymentAlerts({ storeId: req.user!.storeId, alertDays });
    res.json({ success: true, data: rows });
  },
  /**
   * GET /invoices/debts — Dettes & creances ouvertes, separees par sens.
   *   - receivables : factures emises non soldees (clients qui nous doivent)
   *   - payables    : factures recues non soldees (ce qu'on doit aux fournisseurs)
   */
  async debts(req: AuthRequest, res: Response) {
    const rows = await invoiceRepository.findOpenDebts({ storeId: req.user!.storeId });
    const receivables = rows.filter((r: Record<string, unknown>) => r.invoice_type === 'emitted');
    const payables = rows.filter((r: Record<string, unknown>) => r.invoice_type === 'received');
    res.json({ success: true, data: { receivables, payables } });
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
    const items = (body.items as Record<string, unknown>[]).map((raw) => ({
      productId: (raw.productId as string | null | undefined) || null,
      ingredientId: (raw.ingredientId as string | null | undefined) || null,
      description: (raw.description as string | null | undefined) || null,
      quantity: num(raw.quantity),
      unitPrice: num(raw.unitPrice),
      subtotal: raw.subtotal !== undefined ? num(raw.subtotal) : num(raw.quantity) * num(raw.unitPrice),
    }));
    try {
      const updated = await invoiceRepository.replaceItems(req.params.id, items);
      res.json({ success: true, data: updated });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Erreur lors de la mise a jour des lignes';
      res.status(400).json({ success: false, error: { message: msg } });
    }
  },
  async updatePaymentTerms(req: AuthRequest, res: Response) {
    const invoice = await invoiceRepository.findById(req.params.id);
    if (!invoice) { res.status(404).json({ success: false, error: { message: 'Facture non trouvee' } }); return; }
    if (req.user!.storeId && invoice.store_id && invoice.store_id !== req.user!.storeId) {
      res.status(403).json({ success: false, error: { message: 'Acces refuse' } }); return;
    }
    const { dueDate, expectedPaymentMode, receptionDate } = req.body as Record<string, string | null | undefined>;
    if (expectedPaymentMode && !['cash', 'check', 'transfer'].includes(expectedPaymentMode)) {
      res.status(400).json({ success: false, error: { message: 'Mode de reglement invalide' } });
      return;
    }
    const updated = await invoiceRepository.updatePaymentTerms(req.params.id, {
      dueDate, expectedPaymentMode, receptionDate,
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
                ii.quantity, ii.unit_price, ii.subtotal,
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

      // Customer info
      let customerName = 'Client';
      let customerAddress = '';
      const inv = invoice as Record<string, unknown>;
      if (inv.customer_first_name) {
        customerName = `${inv.customer_first_name} ${inv.customer_last_name || ''}`.trim();
      } else if (inv.supplier_name) {
        customerName = inv.supplier_name as string;
      }

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
      const logoCandidates = [
        settings?.logo_url ? pathMod.join(projectRoot, 'uploads', settings.logo_url) : '',
        settings?.logo_url ? pathMod.join(projectRoot, settings.logo_url) : '',
        pathMod.join(projectRoot, 'client', 'public', 'images', 'logo-horizontal.png'),
        pathMod.join(projectRoot, 'uploads', 'logos', 'logo-1775319515435.png'),
      ].filter(Boolean);
      for (const candidate of logoCandidates) {
        if (fsMod.existsSync(candidate)) { logoPath = candidate; break; }
      }
      console.log('[Invoice PDF] Logo resolution:', { projectRoot, logoPath, found: !!logoPath });

      const buffer = await generateInvoicePdf({
        invoiceNumber: inv.invoice_number as string,
        invoiceDate: dateStr,
        dueDate: dueDateStr,
        paymentMethod: '',
        customerName,
        customerAddress,
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
        companyName: 'TRIANGLE D\'ORIENT SARL',
        companyAddress: 'NR 22 RDC LOTISSEMENT FAJR MOHAMMEDIA',
        companyPhone: '06 49 83 77 67',
        companyEmail: 'gestion@ofauria.ma',
        companyRC: '38769',
        companyPatente: '39503652',
        companyIF: '68818304',
        companyCNSS: '',
        companyICE: '003805857000072',
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

    // ─── BC OBLIGATOIRE — DESACTIVE TEMPORAIREMENT ───────────────────
    // Pour reactiver : passer ENFORCE_PO_REQUIREMENT a true.
    // Doit etre coherent avec le flag client (AccountingPage.tsx).
    const ENFORCE_PO_REQUIREMENT = false;
    if (ENFORCE_PO_REQUIREMENT && data.type === 'expense' && data.categoryId) {
      const category = await expenseCategoryRepository.findById(data.categoryId);
      if (category && category.requires_po && !data.purchaseOrderId) {
        res.status(400).json({
          success: false,
          error: { message: `La categorie "${category.name}" necessite un bon de commande. Veuillez selectionner un BC.` }
        });
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
    const payment = await paymentRepository.update(req.params.id, req.body);
    res.json({ success: true, data: payment });
  },
  async remove(req: AuthRequest, res: Response) {
    await paymentRepository.delete(req.params.id);
    res.json({ success: true, data: null });
  },
  async summary(req: AuthRequest, res: Response) {
    const { dateFrom, dateTo } = req.query as Record<string, string>;
    if (!dateFrom || !dateTo) { res.status(400).json({ success: false, error: { message: 'dateFrom et dateTo requis' } }); return; }
    const summary = await paymentRepository.summary({ dateFrom, dateTo, storeId: req.user!.storeId });
    const byCategory = await paymentRepository.summaryByCategory({ dateFrom, dateTo, storeId: req.user!.storeId });
    res.json({ success: true, data: { summary, byCategory } });
  },
};
