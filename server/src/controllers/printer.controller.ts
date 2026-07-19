import type { Response } from 'express';
import type { AuthRequest } from '../middleware/auth.middleware.js';
import { printerRepository } from '../repositories/printer.repository.js';
import { printerService } from '../services/printer.service.js';
import { settingsRepository } from '../repositories/settings.repository.js';
import { saleRepository } from '../repositories/sale.repository.js';

export const printerController = {
  async list(req: AuthRequest, res: Response) {
    if (!req.user!.storeId) {
      res.status(400).json({ success: false, error: { message: 'Utilisateur non rattache a un magasin' } });
      return;
    }
    const items = await printerRepository.findAll(req.user!.storeId);
    res.json({ success: true, data: items });
  },

  async create(req: AuthRequest, res: Response) {
    if (!req.user!.storeId) {
      res.status(400).json({ success: false, error: { message: 'Utilisateur non rattache a un magasin' } });
      return;
    }
    const created = await printerRepository.create({ ...req.body, storeId: req.user!.storeId });
    res.status(201).json({ success: true, data: created });
  },

  async update(req: AuthRequest, res: Response) {
    const existing = await printerRepository.findById(req.params.id);
    if (!existing) { res.status(404).json({ success: false, error: { message: 'Imprimante introuvable' } }); return; }
    if (existing.store_id !== req.user!.storeId) {
      res.status(403).json({ success: false, error: { message: 'Acces refuse' } });
      return;
    }
    const updated = await printerRepository.update(req.params.id, req.body);
    res.json({ success: true, data: updated });
  },

  async remove(req: AuthRequest, res: Response) {
    const existing = await printerRepository.findById(req.params.id);
    if (!existing) { res.status(404).json({ success: false, error: { message: 'Imprimante introuvable' } }); return; }
    if (existing.store_id !== req.user!.storeId) {
      res.status(403).json({ success: false, error: { message: 'Acces refuse' } });
      return;
    }
    await printerRepository.delete(req.params.id);
    res.json({ success: true, data: null });
  },

  async test(req: AuthRequest, res: Response) {
    const existing = await printerRepository.findById(req.params.id);
    if (!existing) { res.status(404).json({ success: false, error: { message: 'Imprimante introuvable' } }); return; }
    if (existing.store_id !== req.user!.storeId) {
      res.status(403).json({ success: false, error: { message: 'Acces refuse' } });
      return;
    }
    const result = await printerService.testPrint(req.params.id);
    if (result.ok) {
      res.json({ success: true, data: { message: 'Test envoye a l\'imprimante' } });
    } else {
      res.status(502).json({ success: false, error: { message: result.error } });
    }
  },

  async openDrawer(req: AuthRequest, res: Response) {
    const existing = await printerRepository.findById(req.params.id);
    if (!existing) { res.status(404).json({ success: false, error: { message: 'Imprimante introuvable' } }); return; }
    if (existing.store_id !== req.user!.storeId) {
      res.status(403).json({ success: false, error: { message: 'Acces refuse' } });
      return;
    }
    const result = await printerService.openCashDrawer(req.params.id);
    if (result.ok) {
      res.json({ success: true, data: { message: 'Tiroir ouvert' } });
    } else {
      res.status(502).json({ success: false, error: { message: result.error } });
    }
  },

  // POST /sales/:id/print — imprime un ticket existant
  async printSale(req: AuthRequest, res: Response) {
    if (!req.user!.storeId) {
      res.status(400).json({ success: false, error: { message: 'Caissier non rattache a un magasin' } });
      return;
    }

    const sale = await saleRepository.findById(req.params.id);
    if (!sale) { res.status(404).json({ success: false, error: { message: 'Vente introuvable' } }); return; }
    if (sale.store_id !== req.user!.storeId) {
      res.status(403).json({ success: false, error: { message: 'Acces refuse' } });
      return;
    }

    const settings = await settingsRepository.get();
    const { cashGiven, changeAmount, openDrawer, printerId } = req.body as {
      cashGiven?: number; changeAmount?: number; openDrawer?: boolean;
      // Imprimante choisie par le poste (parametres locaux du terminal POS).
      // Validee cote service (store + active + type receipt), fallback defaut.
      printerId?: string;
    };

    const result = await printerService.printReceipt({
      storeId: req.user!.storeId,
      sale: {
        sale_number: sale.sale_number,
        created_at: sale.created_at,
        total: parseFloat(sale.total),
        subtotal: parseFloat(sale.subtotal),
        discount_amount: parseFloat(sale.discount_amount || '0'),
        payment_method: sale.payment_method,
        cashier_name: sale.cashier_first_name
          ? `${sale.cashier_first_name} ${sale.cashier_last_name || ''}`.trim()
          : undefined,
        customer_name: sale.customer_first_name
          ? `${sale.customer_first_name} ${sale.customer_last_name || ''}`.trim()
          : undefined,
        items: (sale.items as Array<Record<string, unknown>>).map((it) => ({
          name: String(it.product_name),
          quantity: parseFloat(String(it.quantity)),
          unit_price: parseFloat(String(it.unit_price)),
          subtotal: parseFloat(String(it.subtotal)),
          unit: (it.unit === 'g' ? 'g' : 'unit') as 'unit' | 'g',
          display_unit: (it.display_unit === 'kg' ? 'kg' : it.display_unit === 'g' ? 'g' : null) as 'g' | 'kg' | null,
        })),
        cash_given: cashGiven,
        change_amount: changeAmount,
        cash_part: sale.cash_amount != null ? parseFloat(sale.cash_amount) : null,
        card_part: sale.card_amount != null ? parseFloat(sale.card_amount) : null,
      },
      company: {
        name: settings?.company_name || 'Ofauria',
        subtitle: settings?.subtitle || undefined,
        receipt_header: settings?.receipt_header || undefined,
        receipt_footer: settings?.receipt_footer || undefined,
        receipt_extra_lines: settings?.receipt_extra_lines || undefined,
      },
      options: {
        openDrawer: openDrawer ?? settings?.receipt_open_drawer ?? false,
        numCopies: settings?.receipt_num_copies || 1,
        printerId: typeof printerId === 'string' && printerId ? printerId : undefined,
      },
    });

    if (result.ok) {
      res.json({ success: true, data: { message: 'Ticket envoye a l\'imprimante' } });
    } else {
      res.status(502).json({ success: false, error: { message: result.error } });
    }
  },
};
