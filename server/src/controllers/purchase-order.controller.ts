import type { Response } from 'express';
import type { AuthRequest } from '../middleware/auth.middleware.js';
import { purchaseOrderRepository } from '../repositories/purchase-order.repository.js';
import { generatePurchaseOrderPdf } from '../services/purchase-order-pdf.service.js';
import { db } from '../config/database.js';
import { settingsRepository } from '../repositories/settings.repository.js';
import { existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

export const purchaseOrderController = {
  async list(req: AuthRequest, res: Response) {
    const { supplierId, status, dateFrom, dateTo } = req.query as Record<string, string>;
    const data = await purchaseOrderRepository.findAll({
      supplierId, status, dateFrom, dateTo, storeId: req.user!.storeId,
    });
    res.json({ success: true, data });
  },

  async eligible(req: AuthRequest, res: Response) {
    const data = await purchaseOrderRepository.findEligibleForExpense(req.user!.storeId);
    res.json({ success: true, data });
  },

  async getById(req: AuthRequest, res: Response) {
    const po = await purchaseOrderRepository.findById(req.params.id);
    if (!po) { res.status(404).json({ success: false, error: { message: 'Bon de commande non trouve' } }); return; }
    if (req.user!.storeId && po.store_id && po.store_id !== req.user!.storeId) {
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
    const po = await purchaseOrderRepository.create({
      supplierId, expectedDeliveryDate, notes,
      createdBy: req.user!.userId, storeId: req.user!.storeId,
      items,
    });
    res.status(201).json({ success: true, data: po });
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
      const { items } = req.body;
      if (!items || items.length === 0) {
        res.status(400).json({ success: false, error: { message: 'Articles livrés requis' } });
        return;
      }
      const result = await purchaseOrderRepository.confirmDelivery(
        req.params.id, items, req.user!.userId, req.user!.storeId
      );
      res.json({ success: true, data: result });
    } catch (err: unknown) {
      console.error('[confirmDelivery] Error:', err);
      const message = err instanceof Error ? err.message : 'Erreur lors de la confirmation de livraison';
      res.status(400).json({ success: false, error: { message } });
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
    if (po.status !== 'en_attente') {
      res.status(409).json({ success: false, error: { message: 'Seuls les bons en attente peuvent etre supprimes' } });
      return;
    }
    await purchaseOrderRepository.delete(req.params.id);
    res.json({ success: true, data: null });
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
        `SELECT poi.*, ing.name as ingredient_name, ing.unit as ingredient_unit
         FROM purchase_order_items poi
         JOIN ingredients ing ON ing.id = poi.ingredient_id
         WHERE poi.purchase_order_id = $1
         ORDER BY ing.name`,
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
