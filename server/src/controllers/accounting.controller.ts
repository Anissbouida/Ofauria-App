import type { Response } from 'express';
import type { AuthRequest } from '../middleware/auth.middleware.js';
import { caisseRepository, supplierRepository, expenseCategoryRepository, invoiceRepository, paymentRepository } from '../repositories/accounting.repository.js';
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
  async list(_req: AuthRequest, res: Response) {
    const categories = await expenseCategoryRepository.findAll();
    res.json({ success: true, data: categories });
  },
  async create(req: AuthRequest, res: Response) {
    const category = await expenseCategoryRepository.create(req.body);
    res.status(201).json({ success: true, data: category });
  },
  async update(req: AuthRequest, res: Response) {
    const category = await expenseCategoryRepository.update(req.params.id, req.body);
    res.json({ success: true, data: category });
  },
  async remove(req: AuthRequest, res: Response) {
    await expenseCategoryRepository.delete(req.params.id);
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
  async getById(req: AuthRequest, res: Response) {
    const invoice = await invoiceRepository.findById(req.params.id);
    if (!invoice) { res.status(404).json({ success: false, error: { message: 'Facture non trouvee' } }); return; }
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
  async cancel(req: AuthRequest, res: Response) {
    const invoice = await invoiceRepository.updateStatus(req.params.id, 'cancelled');
    res.json({ success: true, data: invoice });
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

      // Get invoice items with product category (join by product_id, fallback by product name)
      const itemsResult = await db.query(
        `SELECT ii.description, ii.quantity, ii.unit_price, ii.subtotal,
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

      // If amount (HT) is 0 or equals totalAmount (TTC), recalculate from TTC
      if (amount <= 0 || (taxAmount <= 0 && totalAmount > 0)) {
        // total_amount is TTC, calculate HT = TTC / (1 + tvaRate/100)
        amount = Math.round((totalAmount / (1 + tvaRate / 100)) * 100) / 100;
        taxAmount = Math.round((totalAmount - amount) * 100) / 100;
      } else if (amount > 0 && taxAmount > 0) {
        tvaRate = Math.round((taxAmount / amount) * 100);
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
  async create(req: AuthRequest, res: Response) {
    const data = { ...req.body, createdBy: req.user!.userId, storeId: req.user!.storeId };

    // Enforce PO linkage for expense categories that require it
    if (data.type === 'expense' && data.categoryId) {
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
