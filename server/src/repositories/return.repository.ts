import { db } from '../config/database.js';
import { nextDocumentNumber } from '../utils/document-number.js';
import { adjustVitrineStock } from './product-stock.helper.js';
import { productLotRepository } from './product-lot.repository.js';
import { generateSaleNumber } from './sale.repository.js';
import { reverseForSale } from '../services/loyalty.js';

export const returnRepository = {
  async findAll(params: { dateFrom?: string; dateTo?: string; storeId?: string; limit?: number; offset?: number }) {
    const conditions: string[] = [];
    const values: unknown[] = [];
    let i = 1;

    if (params.storeId) { conditions.push(`sr.store_id = $${i++}`); values.push(params.storeId); }
    if (params.dateFrom) { conditions.push(`sr.created_at >= $${i++}`); values.push(params.dateFrom); }
    if (params.dateTo) { conditions.push(`sr.created_at < ($${i++}::date + 1)`); values.push(params.dateTo); }

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

    const countResult = await db.query(`SELECT COUNT(*) FROM sale_returns sr ${where}`, values);
    const total = parseInt(countResult.rows[0].count, 10);

    const limit = params.limit || 100;
    const offset = params.offset || 0;
    values.push(limit, offset);

    const result = await db.query(
      `SELECT sr.*,
              u.first_name as user_first_name, u.last_name as user_last_name,
              s.sale_number as original_sale_number
       FROM sale_returns sr
       JOIN users u ON u.id = sr.user_id
       JOIN sales s ON s.id = sr.original_sale_id
       ${where}
       ORDER BY sr.created_at DESC
       LIMIT $${i++} OFFSET $${i}`,
      values
    );

    // Load return items for each return
    for (const ret of result.rows) {
      const itemsResult = await db.query(
        `SELECT sri.*, p.name as product_name
         FROM sale_return_items sri
         JOIN products p ON p.id = sri.product_id
         WHERE sri.return_id = $1`,
        [ret.id]
      );
      ret.items = itemsResult.rows;
    }

    return { rows: result.rows, total };
  },

  async findBySaleId(saleId: string) {
    const result = await db.query(
      `SELECT sr.*, u.first_name as user_first_name, u.last_name as user_last_name
       FROM sale_returns sr
       JOIN users u ON u.id = sr.user_id
       WHERE sr.original_sale_id = $1
       ORDER BY sr.created_at DESC`,
      [saleId]
    );

    // Load return items for each return
    for (const ret of result.rows) {
      const itemsResult = await db.query(
        `SELECT sri.*, p.name as product_name
         FROM sale_return_items sri
         JOIN products p ON p.id = sri.product_id
         WHERE sri.return_id = $1`,
        [ret.id]
      );
      ret.items = itemsResult.rows;
    }

    return result.rows;
  },

  /** Get total returned quantity per sale_item_id for a given sale */
  async getReturnedQuantities(saleId: string): Promise<Record<string, number>> {
    const result = await db.query(
      `SELECT sri.sale_item_id, SUM(sri.quantity) as returned_qty
       FROM sale_return_items sri
       JOIN sale_returns sr ON sr.id = sri.return_id
       WHERE sr.original_sale_id = $1
       GROUP BY sri.sale_item_id`,
      [saleId]
    );
    const map: Record<string, number> = {};
    for (const row of result.rows) {
      map[row.sale_item_id] = parseInt(row.returned_qty, 10);
    }
    return map;
  },

  async create(data: {
    originalSaleId: string;
    userId: string;
    sessionId?: string;
    storeId?: string;
    type: 'return' | 'exchange';
    reason?: string;
    refundAmount: number;
    items: { saleItemId: string; productId: string; quantity: number; unitPrice: number; subtotal: number }[];
    exchangeProducts?: { saleItemId: string; newProductId: string; quantity: number }[];
    exchangePaymentMethod?: 'cash' | 'card' | 'mobile';
  }) {
    const client = await db.getClient();
    try {
      await client.query('BEGIN');

      const returnNumber = await generateReturnNumber(client);

      let exchangeSaleId: string | null = null;
      let exchangeTotal = 0;

      // For exchanges, create a new sale with the replacement products
      if (data.type === 'exchange' && data.exchangeProducts?.length) {
        // Look up prices for replacement products
        const exchangeItems: { productId: string; quantity: number; unitPrice: number; subtotal: number }[] = [];
        for (const ep of data.exchangeProducts) {
          const prodResult = await client.query('SELECT id, price FROM products WHERE id = $1', [ep.newProductId]);
          if (!prodResult.rows[0]) throw new Error(`Produit de remplacement ${ep.newProductId} non trouve`);
          const price = parseFloat(prodResult.rows[0].price);
          exchangeItems.push({
            productId: ep.newProductId,
            quantity: ep.quantity,
            unitPrice: price,
            subtotal: price * ep.quantity,
          });
        }

        exchangeTotal = exchangeItems.reduce((sum, it) => sum + it.subtotal, 0);

        // AUDIT V4 : la generation par COUNT(*)+1 causait des collisions
        // apres tout hard-delete. On reutilise le meme generateur MAX+advisory
        // que le checkout POS (sale.repository.generateSaleNumber).
        const exchangeSaleNumber = await generateSaleNumber(client);

        // AUDIT V3 : le total de la vente d'echange = ce que le client paie
        // effectivement (max 0, priceDiff). L'ancien code enregistrait
        // total=exchangeTotal (valeur des articles neufs) -> CA du jour et
        // expected_cash surevalues du montant du retour.
        // Le detail des articles neufs reste dans sale_items pour la tracabilite.
        const priceDiff = Math.round((exchangeTotal - data.refundAmount) * 100) / 100;
        const saleTotal = Math.max(0, priceDiff);
        // Mode de reglement : plus de 'cash' en dur — on prend celui passe
        // par le controller (par defaut cash cote validator).
        const paymentMethod = data.exchangePaymentMethod || 'cash';

        const exchangeSaleResult = await client.query(
          `INSERT INTO sales (sale_number, user_id, subtotal, tax_amount, discount_amount, total, payment_method, notes, session_id, store_id)
           VALUES ($1, $2, $3, 0, 0, $4, $5, $6, $7, $8) RETURNING *`,
          [
            exchangeSaleNumber,
            data.userId,
            saleTotal,
            saleTotal,
            paymentMethod,
            `Echange - Retour ${returnNumber} - Articles neufs ${exchangeTotal.toFixed(2)} DH, avoir retour ${data.refundAmount.toFixed(2)} DH${priceDiff > 0 ? ` - Client paie ${priceDiff.toFixed(2)} DH` : priceDiff < 0 ? ` - Rendre ${Math.abs(priceDiff).toFixed(2)} DH au client` : ''}`,
            data.sessionId || null,
            data.storeId || null,
          ]
        );

        exchangeSaleId = exchangeSaleResult.rows[0].id;

        // Insert exchange sale items (prix unitaires reels des articles neufs,
        // pour la tracabilite produit — le total de vente ci-dessus reste egal
        // au complement encaisse).
        for (const item of exchangeItems) {
          await client.query(
            `INSERT INTO sale_items (sale_id, product_id, quantity, unit_price, subtotal)
             VALUES ($1, $2, $3, $4, $5)`,
            [exchangeSaleId, item.productId, item.quantity, item.unitPrice, item.subtotal]
          );
        }
      }

      // For exchanges, validate exchange product stock BEFORE any stock changes
      // to avoid asymmetry if an exchange product is out of stock.
      if (data.type === 'exchange' && data.exchangeProducts?.length) {
        if (!data.storeId) {
          throw new Error('storeId requis pour un echange (vitrine strictement par magasin)');
        }
        for (const ep of data.exchangeProducts) {
          const stockCheck = await client.query(
            `SELECT vitrine_quantity FROM product_store_stock
             WHERE product_id = $1 AND store_id = $2 FOR UPDATE`,
            [ep.newProductId, data.storeId]
          );
          const available = stockCheck.rows[0] ? parseFloat(stockCheck.rows[0].vitrine_quantity) : 0;
          if (available < ep.quantity) {
            throw new Error(`Stock vitrine insuffisant pour le produit d'échange ${ep.newProductId}: disponible ${available}, demandé ${ep.quantity}`);
          }
        }
      }

      const returnResult = await client.query(
        `INSERT INTO sale_returns (return_number, original_sale_id, user_id, session_id, type, reason, refund_amount, exchange_sale_id, store_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *`,
        [returnNumber, data.originalSaleId, data.userId, data.sessionId || null,
         data.type, data.reason || null, data.refundAmount, exchangeSaleId, data.storeId || null]
      );

      // Fidélité (mig 372) : un remboursement retire la part correspondante des points gagnés.
      if (data.type === 'return' && data.refundAmount > 0) {
        const orig = await client.query(`SELECT total FROM sales WHERE id = $1`, [data.originalSaleId]);
        const origTotal = parseFloat(orig.rows[0]?.total ?? '0') || 0;
        if (origTotal > 0) await reverseForSale(client, data.originalSaleId, data.refundAmount / origTotal, data.userId, `Retour ${returnNumber}`);
      }

      for (const item of data.items) {
        await client.query(
          `INSERT INTO sale_return_items (return_id, sale_item_id, product_id, quantity, unit_price, subtotal)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [returnResult.rows[0].id, item.saleItemId, item.productId, item.quantity, item.unitPrice, item.subtotal]
        );

        // Restore vitrine stock on return — the returned item goes back on display.
        if (!data.storeId) {
          throw new Error('storeId requis pour un retour (vitrine strictement par magasin)');
        }
        // F-045/F-036 — On recredite le(s) lot(s) d'ou l'article a ete vendu
        // (sale_item_lots), pour garder product_lots en phase avec
        // product_store_stock. Avant, le retour ne touchait que
        // product_store_stock -> derive vitrine > lots. On ne remet en rayon que
        // ce qui retrouve un lot ACTIF : un article dont le lot d'origine est
        // perime/epuise n'est pas reexpose (il serait invendable, cf. F-037).
        const soldLots = await client.query(
          `SELECT sil.product_lot_id, sil.quantity, pl.status
             FROM sale_item_lots sil
             JOIN product_lots pl ON pl.id = sil.product_lot_id
            WHERE sil.sale_item_id = $1
            ORDER BY pl.produced_at DESC
            FOR UPDATE OF pl`,
          [item.saleItemId]
        );
        let restored = 0;
        let remaining = item.quantity;
        for (const s of soldLots.rows) {
          if (remaining <= 0) break;
          if (s.status !== 'active') continue;
          const give = Math.min(remaining, parseFloat(s.quantity));
          if (give <= 0) continue;
          await client.query(
            `UPDATE product_lots
                SET vitrine_qty = vitrine_qty + $2,
                    sold_qty    = GREATEST(0, sold_qty - $2),
                    updated_at  = NOW()
              WHERE id = $1`,
            [s.product_lot_id, give]
          );
          restored += give;
          remaining -= give;
        }
        // Repli : vente orpheline sans sale_item_lots (anterieure au suivi par
        // lot) -> on remet la quantite complete comme avant, il n'y a pas de lot
        // a synchroniser pour cette vente.
        const toShelve = soldLots.rows.length === 0 ? item.quantity : restored;
        const stockAfter = await adjustVitrineStock(client, item.productId, data.storeId, toShelve);
        const note = toShelve < item.quantity
          ? `Retour ${returnNumber} — ${toShelve}/${item.quantity} remis en rayon (lot(s) d'origine perime(s)/epuise(s))`
          : `Retour ${returnNumber}`;
        await client.query(
          `INSERT INTO product_stock_transactions (product_id, type, quantity_change, stock_after, note, reference_id, performed_by, store_id)
           VALUES ($1, 'return', $2, $3, $4, $5, $6, $7)`,
          [item.productId, toShelve, stockAfter, note, returnResult.rows[0].id, data.userId, data.storeId]
        );
      }

      // For exchanges, decrement vitrine stock for the new product given to the customer.
      // Stock availability was already validated above (with FOR UPDATE lock held).
      if (data.type === 'exchange' && data.exchangeProducts?.length) {
        for (const ep of data.exchangeProducts) {
          const stockAfter = await adjustVitrineStock(client, ep.newProductId, data.storeId!, -ep.quantity);
          await client.query(
            `INSERT INTO product_stock_transactions (product_id, type, quantity_change, stock_after, note, reference_id, performed_by, store_id)
             VALUES ($1, 'exchange', $2, $3, $4, $5, $6, $7)`,
            [ep.newProductId, -ep.quantity, stockAfter,
             `Echange ${returnNumber}`, returnResult.rows[0].id, data.userId, data.storeId]
          );
          // F-045/F-036 — comme une vente, on decremente aussi un/des lot(s) FEFO
          // du nouveau produit donne au client, pour garder product_lots en phase.
          const fefo = await productLotRepository.planFefoVitrineConsumption(
            client, ep.newProductId, data.storeId!, ep.quantity
          );
          for (const step of fefo) {
            await productLotRepository.consumeVitrineSold(
              client, step.lotId, step.qty, { type: 'exchange', id: returnResult.rows[0].id }
            );
          }
        }
      }

      await client.query('COMMIT');

      const result = returnResult.rows[0];
      if (exchangeSaleId) {
        result.exchange_sale_id = exchangeSaleId;
        result.exchange_total = exchangeTotal;
        result.price_difference = exchangeTotal - data.refundAmount;
      }
      return result;
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  },
};

async function generateReturnNumber(client: { query: (text: string, params?: unknown[]) => Promise<{ rows: Record<string, unknown>[] }> }) {
  // Serie « sale_return » (Parametres > Numerotation, mig 329) : l'ancien COUNT(*)+1
  // du jour reattribuait un numero apres suppression d'un retour.
  return nextDocumentNumber(client, 'sale_return');
}
