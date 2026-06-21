import type { Response } from 'express';
import type { AuthRequest } from '../middleware/auth.middleware.js';
import { purchaseOrderRepository } from '../repositories/purchase-order.repository.js';
import { generatePurchaseOrderPdf } from '../services/purchase-order-pdf.service.js';
import { db } from '../config/database.js';
import { settingsRepository } from '../repositories/settings.repository.js';
import { existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

// Admin global : voit tous les BC, peu importe le store_id. Sinon, restreint au store de l'utilisateur.
function effectiveStoreFilter(req: AuthRequest): string | undefined {
  return req.user!.role === 'admin' ? undefined : req.user!.storeId;
}

export const purchaseOrderController = {
  async list(req: AuthRequest, res: Response) {
    const { supplierId, status, dateFrom, dateTo } = req.query as Record<string, string>;
    const data = await purchaseOrderRepository.findAll({
      supplierId, status, dateFrom, dateTo, storeId: effectiveStoreFilter(req),
    });
    res.json({ success: true, data });
  },

  async eligible(req: AuthRequest, res: Response) {
    const data = await purchaseOrderRepository.findEligibleForExpense(effectiveStoreFilter(req));
    res.json({ success: true, data });
  },

  async getById(req: AuthRequest, res: Response) {
    const po = await purchaseOrderRepository.findById(req.params.id);
    if (!po) { res.status(404).json({ success: false, error: { message: 'Bon de commande non trouve' } }); return; }
    const userStore = effectiveStoreFilter(req);
    if (userStore && po.store_id && po.store_id !== userStore) {
      res.status(403).json({ success: false, error: { message: 'Acces refuse' } }); return;
    }
    res.json({ success: true, data: po });
  },

  async create(req: AuthRequest, res: Response) {
    const { supplierId, expectedDeliveryDate, notes, items } = req.body;
    if (!supplierId || !items || items.length === 0) {
      res.status(400).json({ success: false, error: { message: 'Fournisseur et articles requis' } });
      return;
    }
    // try/catch obligatoire : en Express 4, une promesse rejetee dans un
    // handler async ne declenche PAS errorHandler -> la reponse n'est jamais
    // envoyee et le front reste fige sur "Creation...". On capture, on logue,
    // on renvoie une 500 propre.
    try {
      const po = await purchaseOrderRepository.create({
        supplierId, expectedDeliveryDate, notes,
        createdBy: req.user!.userId, storeId: req.user!.storeId,
        items,
      });
      res.status(201).json({ success: true, data: po });
    } catch (err) {
      console.error('[purchaseOrder.create] Error:', err);
      const message = err instanceof Error ? err.message : 'Erreur lors de la creation du bon de commande';
      res.status(500).json({ success: false, error: { message } });
    }
  },

  async send(req: AuthRequest, res: Response) {
    const po = await purchaseOrderRepository.findById(req.params.id);
    if (!po) { res.status(404).json({ success: false, error: { message: 'Bon de commande non trouve' } }); return; }
    if (po.status !== 'en_attente') {
      res.status(409).json({ success: false, error: { message: 'Le bon doit etre en attente pour etre envoye' } });
      return;
    }
    const updated = await purchaseOrderRepository.updateStatus(req.params.id, 'envoye');
    res.json({ success: true, data: updated });
  },

  async confirmDelivery(req: AuthRequest, res: Response) {
    try {
      const po = await purchaseOrderRepository.findById(req.params.id);
      if (!po) { res.status(404).json({ success: false, error: { message: 'Bon de commande non trouvé' } }); return; }
      if (!['envoye', 'livre_partiel'].includes(po.status)) {
        res.status(409).json({ success: false, error: { message: 'Le bon doit être envoyé ou en livraison partielle' } });
        return;
      }
      const { items, supplierInvoiceNumber, supplierInvoiceDate, forceComplete } = req.body;
      if (!items || items.length === 0) {
        res.status(400).json({ success: false, error: { message: 'Articles livrés requis' } });
        return;
      }
      // Stock toujours credite au store du BC ; fallback sur le storeId user si BC sans store.
      const stockStoreId = (po.store_id as string | undefined) ?? req.user!.storeId;
      const result = await purchaseOrderRepository.confirmDelivery(
        req.params.id, items, req.user!.userId, stockStoreId,
        supplierInvoiceNumber, supplierInvoiceDate, forceComplete
      );
      res.json({ success: true, data: result });
    } catch (err: unknown) {
      console.error('[confirmDelivery] Error:', err);
      const message = err instanceof Error ? err.message : 'Erreur lors de la confirmation de livraison';
      const statusCode = (err as { statusCode?: number })?.statusCode ?? 400;
      res.status(statusCode).json({ success: false, error: { message } });
    }
  },

  async markNotDelivered(req: AuthRequest, res: Response) {
    const po = await purchaseOrderRepository.findById(req.params.id);
    if (!po) { res.status(404).json({ success: false, error: { message: 'Bon de commande non trouve' } }); return; }
    const updated = await purchaseOrderRepository.updateStatus(req.params.id, 'non_livre');
    res.json({ success: true, data: updated });
  },

  async cancel(req: AuthRequest, res: Response) {
    const po = await purchaseOrderRepository.findById(req.params.id);
    if (!po) { res.status(404).json({ success: false, error: { message: 'Bon de commande non trouve' } }); return; }
    if (['livre_complet', 'annule'].includes(po.status)) {
      res.status(409).json({ success: false, error: { message: 'Impossible d\'annuler ce bon de commande' } });
      return;
    }
    const updated = await purchaseOrderRepository.updateStatus(req.params.id, 'annule');
    res.json({ success: true, data: updated });
  },

  async remove(req: AuthRequest, res: Response) {
    const po = await purchaseOrderRepository.findById(req.params.id);
    if (!po) { res.status(404).json({ success: false, error: { message: 'Bon de commande non trouve' } }); return; }
    if (!['en_attente', 'annule'].includes(po.status)) {
      res.status(409).json({ success: false, error: { message: 'Seuls les bons en attente ou annules peuvent etre supprimes' } });
      return;
    }
    try {
      await purchaseOrderRepository.delete(req.params.id);
      res.json({ success: true, data: null });
    } catch (err) {
      // Garde-fou FK : payments ou reception_vouchers reference encore le BC.
      const msg = err instanceof Error ? err.message : 'Erreur lors de la suppression';
      const isFk = /violates foreign key|reception_vouchers|payments/i.test(msg);
      res.status(isFk ? 409 : 500).json({
        success: false,
        error: { message: isFk
          ? 'Suppression refusee : des bons de reception ou paiements sont lies a ce BC.'
          : msg },
      });
    }
  },

  async updatePrices(req: AuthRequest, res: Response) {
    const po = await purchaseOrderRepository.findById(req.params.id);
    if (!po) { res.status(404).json({ success: false, error: { message: 'Bon de commande non trouve' } }); return; }
    const { items } = req.body;
    if (!items || items.length === 0) {
      res.status(400).json({ success: false, error: { message: 'Articles avec prix requis' } });
      return;
    }
    const result = await purchaseOrderRepository.updateItemPrices(req.params.id, items);
    res.json({ success: true, data: result });
  },

  /**
   * PUT /purchase-orders/:id — Modifie l'en-tete (notes, date prevue, fournisseur).
   * Admin/gerant. Pas de status ici.
   */
  async updateHeader(req: AuthRequest, res: Response) {
    const po = await purchaseOrderRepository.findById(req.params.id);
    if (!po) { res.status(404).json({ success: false, error: { message: 'Bon de commande non trouve' } }); return; }
    const userStore = effectiveStoreFilter(req);
    if (userStore && po.store_id && po.store_id !== userStore) {
      res.status(403).json({ success: false, error: { message: 'Acces refuse' } }); return;
    }
    const body = req.body as Record<string, unknown>;
    try {
      const updated = await purchaseOrderRepository.updateHeader(req.params.id, {
        supplierId: body.supplierId as string | undefined,
        expectedDeliveryDate: body.expectedDeliveryDate as string | null | undefined,
        notes: body.notes as string | null | undefined,
      });
      res.json({ success: true, data: updated });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Erreur lors de la mise a jour';
      res.status(400).json({ success: false, error: { message: msg } });
    }
  },

  /**
   * PUT /purchase-orders/:id/items — Remplace toutes les lignes (admin/gerant).
   * Bulk save : voir purchaseOrderRepository.replaceItems pour la logique de
   * diff (delete/update/insert) et l'impact stock pour quantity_delivered.
   */
  async replaceItems(req: AuthRequest, res: Response) {
    const po = await purchaseOrderRepository.findById(req.params.id);
    if (!po) { res.status(404).json({ success: false, error: { message: 'Bon de commande non trouve' } }); return; }
    const userStore = effectiveStoreFilter(req);
    if (userStore && po.store_id && po.store_id !== userStore) {
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
      id: raw.id as string | undefined,
      ingredientId: (raw.ingredientId as string | null) ?? null,
      packagingId: (raw.packagingId as string | null) ?? null,
      quantityOrdered: num(raw.quantityOrdered),
      quantityDelivered: raw.quantityDelivered !== undefined ? num(raw.quantityDelivered) : undefined,
      unitPrice: raw.unitPrice === null || raw.unitPrice === '' || raw.unitPrice === undefined
        ? null
        : num(raw.unitPrice),
    }));
    if (items.some(it => !(it.ingredientId || it.packagingId) || it.quantityOrdered <= 0)) {
      res.status(400).json({ success: false, error: { message: 'Chaque ligne doit avoir un article et une quantite > 0' } });
      return;
    }
    try {
      // Impact stock toujours sur le store du BC ; fallback sur user.storeId si BC sans store.
      const stockStoreId = (po.store_id as string | undefined) ?? req.user!.storeId;
      const updated = await purchaseOrderRepository.replaceItems(
        req.params.id, items, req.user!.userId, stockStoreId
      );
      res.json({ success: true, data: updated });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Erreur lors de la mise a jour des lignes';
      res.status(400).json({ success: false, error: { message: msg } });
    }
  },

  /**
   * POST /purchase-orders/:id/invoice — Genere manuellement la facture pour un
   * BC livre dont la facture auto n'a pas ete creee (saisie de prix tardive).
   */
  async generateInvoice(req: AuthRequest, res: Response) {
    const po = await purchaseOrderRepository.findById(req.params.id);
    if (!po) { res.status(404).json({ success: false, error: { message: 'Bon de commande non trouve' } }); return; }
    const userStore = effectiveStoreFilter(req);
    if (userStore && po.store_id && po.store_id !== userStore) {
      res.status(403).json({ success: false, error: { message: 'Acces refuse' } }); return;
    }
    try {
      // Store de la facture = store du BC ; fallback sur le store user si BC sans store.
      const invoiceStoreId = (po.store_id as string | undefined) ?? req.user!.storeId ?? null;
      const result = await purchaseOrderRepository.generateInvoice(req.params.id, req.user!.userId, invoiceStoreId);
      if (result.ok) {
        res.json({ success: true, data: result.invoice });
        return;
      }
      switch (result.code) {
        case 'not_found':
          res.status(404).json({ success: false, error: { message: 'Bon de commande non trouve' } });
          return;
        case 'wrong_status':
          res.status(409).json({ success: false, error: {
            message: `Le BC doit etre en statut "Livre" pour generer une facture (statut actuel : ${result.status}).`
          }});
          return;
        case 'missing_prices':
          res.status(409).json({ success: false, error: {
            message: 'Certaines lignes du BC n\'ont pas de prix unitaire. Edite le BC pour les renseigner d\'abord.'
          }});
          return;
        case 'invoice_exists':
          res.status(409).json({ success: false, error: { message: 'Une facture existe deja pour ce BC.' } });
          return;
      }
    } catch (err) {
      console.error('[generateInvoice] Error:', err);
      const message = err instanceof Error ? err.message : 'Erreur lors de la generation de la facture';
      res.status(500).json({ success: false, error: { message } });
    }
  },

  async overdue(req: AuthRequest, res: Response) {
    const days = parseInt((req.query as Record<string, string>).days || '3');
    const data = await purchaseOrderRepository.findOverdue(days);
    res.json({ success: true, data });
  },

  async downloadPdf(req: AuthRequest, res: Response) {
    try {
      const po = await purchaseOrderRepository.findById(req.params.id);
      if (!po) { res.status(404).json({ success: false, error: { message: 'Bon de commande non trouvé' } }); return; }

      // Get items
      const itemsResult = await db.query(
        `SELECT poi.*,
                COALESCE(ing.name, pkg.name) as ingredient_name,
                COALESCE(ing.unit, pkg.unit) as ingredient_unit
         FROM purchase_order_items poi
         LEFT JOIN ingredients ing ON ing.id = poi.ingredient_id
         LEFT JOIN packaging_items pkg ON pkg.id = poi.packaging_id
         WHERE poi.purchase_order_id = $1
         ORDER BY COALESCE(ing.name, pkg.name)`,
        [req.params.id]
      );

      // Get supplier info
      const supplierResult = await db.query(
        `SELECT * FROM suppliers WHERE id = $1`,
        [po.supplier_id]
      );
      const supplier = supplierResult.rows[0] || {};

      // Get company settings
      const settings = await settingsRepository.get();

      // Resolve logo
      const __filename = fileURLToPath(import.meta.url);
      const __dirname = dirname(__filename);
      const projectRoot = resolve(__dirname, '..', '..', '..');
      let logoPath: string | undefined;
      const logoCandidates = [
        settings?.logo_url ? resolve(projectRoot, 'uploads', settings.logo_url) : '',
        settings?.logo_url ? resolve(projectRoot, settings.logo_url) : '',
        resolve(projectRoot, 'client', 'public', 'images', 'logo-horizontal.png'),
        resolve(projectRoot, 'uploads', 'logos', 'logo-1775319515435.png'),
      ].filter(Boolean);
      for (const candidate of logoCandidates) {
        if (existsSync(candidate)) { logoPath = candidate; break; }
      }

      // Format dates
      const orderDate = new Date(po.order_date);
      const orderDateStr = orderDate.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' });
      let expectedDateStr = '';
      if (po.expected_delivery_date) {
        expectedDateStr = new Date(po.expected_delivery_date).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' });
      }

      // Build items
      const items = itemsResult.rows.map((item: Record<string, unknown>) => {
        const qty = parseFloat(item.quantity_ordered as string) || 0;
        const price = item.unit_price != null ? parseFloat(item.unit_price as string) : null;
        return {
          ingredientName: item.ingredient_name as string,
          unit: item.ingredient_unit as string,
          quantity: qty,
          unitPrice: price,
          subtotal: price != null ? qty * price : null,
        };
      });

      const totalHT = items.reduce((sum: number, it: { subtotal: number | null }) => sum + (it.subtotal || 0), 0);

      const buffer = await generatePurchaseOrderPdf({
        orderNumber: po.order_number,
        orderDate: orderDateStr,
        expectedDeliveryDate: expectedDateStr,
        notes: po.notes || '',
        supplierName: po.supplier_name || supplier.name || 'Fournisseur',
        supplierContact: supplier.contact_name || '',
        supplierPhone: supplier.phone || '',
        supplierEmail: supplier.email || '',
        supplierAddress: supplier.address || '',
        items,
        totalHT,
        companyName: 'TRIANGLE D\'ORIENT SARL',
        companyAddress: 'NR 22 RDC LOTISSEMENT FAJR MOHAMMEDIA',
        companyPhone: '06 49 83 77 67',
        companyEmail: 'gestion@ofauria.ma',
        companyRC: '38769',
        companyPatente: '39503652',
        companyIF: '68818304',
        companyICE: '003805857000072',
        logoPath,
      });

      const filename = `${po.order_number || 'BC'}.pdf`.replace(/[/\\]/g, '-');
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      res.setHeader('Content-Length', buffer.length);
      res.send(buffer);
    } catch (err) {
      console.error('Error generating PO PDF:', err);
      res.status(500).json({ success: false, error: { message: 'Erreur lors de la génération du PDF' } });
    }
  },
};
