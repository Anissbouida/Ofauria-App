import type { Response } from 'express';
import type { AuthRequest } from '../middleware/auth.middleware.js';
import { returnRepository } from '../repositories/return.repository.js';
import { saleRepository } from '../repositories/sale.repository.js';
import { cashRegisterRepository } from '../repositories/cash-register.repository.js';

export const returnController = {
  /** List all returns with date filtering */
  async list(req: AuthRequest, res: Response) {
    const { dateFrom, dateTo, limit, offset } = req.query as Record<string, string>;
    const result = await returnRepository.findAll({
      dateFrom, dateTo, storeId: req.user!.storeId,
      limit: limit ? parseInt(limit) : 100,
      offset: offset ? parseInt(offset) : 0,
    });
    res.json({ success: true, data: result.rows, total: result.total });
  },

  /** Search a sale by its sale_number */
  async searchSale(req: AuthRequest, res: Response) {
    const { saleNumber } = req.query as Record<string, string>;
    if (!saleNumber) {
      res.status(400).json({ success: false, error: { message: 'Numero de vente requis' } });
      return;
    }

    const result = await saleRepository.findBySaleNumber(saleNumber.trim());
    if (!result) {
      res.status(404).json({ success: false, error: { message: 'Vente non trouvee' } });
      return;
    }

    // Get already returned quantities per sale_item
    const returnedQtys = await returnRepository.getReturnedQuantities(result.id);

    // Attach returned_quantity to each item
    const items = (result.items || []).map((item: Record<string, unknown>) => ({
      ...item,
      returned_quantity: returnedQtys[item.id as string] || 0,
      returnable_quantity: (item.quantity as number) - (returnedQtys[item.id as string] || 0),
    }));

    const returns = await returnRepository.findBySaleId(result.id);

    res.json({ success: true, data: { ...result, items, returns } });
  },

  /** Create a return or exchange */
  async create(req: AuthRequest, res: Response) {
    // Le body est deja valide/normalise par validate(createReturnSchema).
    // items = [{ saleItemId, quantity }] uniquement — unit_price/subtotal
    // sont resolus cote serveur depuis sale_items (audit V2 : jamais faire
    // confiance au montant envoye par le client).
    const { originalSaleId, type, reason, items, exchangeProducts, exchangePaymentMethod } = req.body as {
      originalSaleId: string;
      type: 'return' | 'exchange';
      reason?: string;
      items: { saleItemId: string; quantity: number }[];
      exchangeProducts?: { saleItemId: string; newProductId: string; quantity: number }[];
      exchangePaymentMethod?: 'cash' | 'card' | 'mobile';
    };

    const sale = await saleRepository.findById(originalSaleId);
    if (!sale) {
      res.status(404).json({ success: false, error: { message: 'Vente non trouvee' } });
      return;
    }

    // V6 : le retour doit se faire dans le magasin d'origine de la vente.
    // Sinon une caissiere du magasin B pourrait rembourser un ticket du magasin A
    // sur sa propre caisse (fraude directe) + re-crediter la vitrine du mauvais store.
    const userStoreId = req.user!.storeId;
    const saleStoreId = (sale as Record<string, unknown>).store_id as string | null;
    if (!userStoreId) {
      res.status(403).json({ success: false, error: { message: 'Utilisateur sans magasin — retour impossible' } });
      return;
    }
    if (saleStoreId && saleStoreId !== userStoreId) {
      res.status(403).json({
        success: false,
        error: { message: 'Cette vente appartient a un autre magasin. Le retour doit se faire dans le magasin d\'origine.' },
      });
      return;
    }

    // Require an open cash register session
    const activeSession = await cashRegisterRepository.findOpenSession(req.user!.userId);
    if (!activeSession) {
      res.status(400).json({ success: false, error: { message: 'Vous devez ouvrir la caisse' } });
      return;
    }

    // Recupere les quantites deja retournees et resout unit_price/product_id
    // pour CHAQUE saleItemId depuis sale_items. Tout ce qui vient du client
    // apres saleItemId+quantity est ignore.
    const returnedQtys = await returnRepository.getReturnedQuantities(originalSaleId);
    const saleItems = (sale.items || []) as Record<string, unknown>[];

    const resolvedItems: {
      saleItemId: string; productId: string; quantity: number;
      unitPrice: number; subtotal: number;
    }[] = [];

    for (const item of items) {
      const saleItem = saleItems.find((si) => si.id === item.saleItemId);
      if (!saleItem) {
        res.status(400).json({ success: false, error: { message: `Article ${item.saleItemId} non trouve dans la vente` } });
        return;
      }
      const alreadyReturned = returnedQtys[item.saleItemId] || 0;
      const originalQty = parseFloat(String(saleItem.quantity)) || 0;
      const maxReturnable = originalQty - alreadyReturned;
      if (item.quantity > maxReturnable + 1e-6) {
        res.status(400).json({
          success: false,
          error: { message: `L'article "${saleItem.product_name}" a deja ete retourne (${alreadyReturned}/${originalQty}). Maximum retournable: ${maxReturnable}` }
        });
        return;
      }
      // Prix pris depuis sale_items uniquement — le remboursement equivaut au
      // prorata du prix effectivement paye pour cette ligne.
      const unitPrice = parseFloat(String(saleItem.unit_price)) || 0;
      const subtotal = Math.round(unitPrice * item.quantity * 100) / 100;
      resolvedItems.push({
        saleItemId: item.saleItemId,
        productId: saleItem.product_id as string,
        quantity: item.quantity,
        unitPrice,
        subtotal,
      });
    }

    const refundAmount = Math.round(resolvedItems.reduce((sum, it) => sum + it.subtotal, 0) * 100) / 100;

    const result = await returnRepository.create({
      originalSaleId,
      userId: req.user!.userId,
      sessionId: activeSession.id,
      storeId: userStoreId,
      type,
      reason,
      refundAmount,
      items: resolvedItems,
      exchangeProducts: type === 'exchange' ? exchangeProducts : undefined,
      exchangePaymentMethod,
    });

    res.status(201).json({ success: true, data: result });
  },
};
