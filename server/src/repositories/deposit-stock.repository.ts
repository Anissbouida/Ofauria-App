import { db, withTransaction } from '../config/database.js';

/**
 * Stock détenu pour le compte de clients (entrepôt logistique, mig 719). Registre séparé :
 * n'entre ni dans l'inventaire, ni dans la valeur, ni dans la consommation de la société.
 */
export class DepositStockError extends Error {
  constructor(message: string, public statusCode = 400) { super(message); }
}

const CUST = `COALESCE(c.company_name, NULLIF(TRIM(COALESCE(c.first_name,'')||' '||COALESCE(c.last_name,'')), ''), 'Client')`;

export const depositStockRepository = {
  async articles(customerId?: string) {
    const params: unknown[] = [];
    const where = customerId ? (params.push(customerId), 'WHERE a.customer_id = $1') : '';
    return (await db.query(
      `SELECT a.*, ${CUST} AS customer_name,
              COALESCE((SELECT SUM(s.quantity) FROM v_deposit_stock s WHERE s.article_id = a.id), 0)::float8 AS quantity
         FROM deposit_articles a JOIN customers c ON c.id = a.customer_id ${where}
        ORDER BY customer_name, a.code`, params)).rows;
  },

  async createArticle(a: { customerId: string; code: string; label: string; unit?: string | null }, userId: string) {
    if (!a.customerId) throw new DepositStockError('Client déposant obligatoire');
    if (!a.code?.trim() || !a.label?.trim()) throw new DepositStockError('Code et désignation obligatoires');
    try {
      return (await db.query(
        `INSERT INTO deposit_articles (customer_id, code, label, unit, created_by) VALUES ($1, $2, $3, $4, $5) RETURNING *`,
        [a.customerId, a.code.trim().slice(0, 60), a.label.trim().slice(0, 200), a.unit?.trim() || 'unité', userId])).rows[0];
    } catch (e) {
      if ((e as { code?: string }).code === '23505') throw new DepositStockError('Ce code existe déjà pour ce client', 409);
      throw e;
    }
  },

  /** Stock par lot (quantités non nulles), filtré par client. */
  async stock(customerId?: string) {
    const params: unknown[] = [];
    const where = customerId ? (params.push(customerId), 'AND s.customer_id = $1') : '';
    return (await db.query(
      `SELECT s.*, s.quantity::float8 AS quantity, ${CUST} AS customer_name
         FROM v_deposit_stock s JOIN customers c ON c.id = s.customer_id
        WHERE s.quantity <> 0 ${where}
        ORDER BY customer_name, s.code, s.expiration_date NULLS LAST`, params)).rows;
  },

  async movements(customerId?: string, limit = 200) {
    const params: unknown[] = [];
    const where = customerId ? (params.push(customerId), 'WHERE a.customer_id = $1') : '';
    params.push(limit);
    return (await db.query(
      `SELECT m.*, m.quantity::float8 AS quantity, a.code, a.label, a.unit, ${CUST} AS customer_name, sl.name AS location_name,
              u.first_name || ' ' || u.last_name AS recorded_by_name
         FROM deposit_movements m JOIN deposit_articles a ON a.id = m.article_id JOIN customers c ON c.id = a.customer_id
         LEFT JOIN stock_locations sl ON sl.id = m.location_id LEFT JOIN users u ON u.id = m.recorded_by
         ${where} ORDER BY m.moved_at DESC LIMIT $${params.length}`, params)).rows;
  },

  /**
   * Entrée (réception à quai) ou sortie (expédition pour le client). Une sortie ne dépasse
   * jamais le stock du lot ; tout le bon est refusé si une ligne dépasse.
   */
  async move(kind: 'in' | 'out', data: { reference?: string | null; note?: string | null; locationId?: string | null;
    lines: { articleId: string; quantity: number; lotNumber?: string | null; expirationDate?: string | null }[] }, ctx: { userId: string; storeId: string | null }) {
    if (!data.lines?.length) throw new DepositStockError('Au moins une ligne');
    if (data.lines.some(l => !(Number(l.quantity) > 0))) throw new DepositStockError('Quantité attendue positive');
    return withTransaction(async () => {
      for (const l of data.lines) {
        const art = (await db.query(`SELECT id, label, is_active FROM deposit_articles WHERE id = $1 FOR UPDATE`, [l.articleId])).rows[0];
        if (!art) throw new DepositStockError('Article inconnu', 404);
        const lot = l.lotNumber?.trim() || null;
        if (kind === 'out') {
          const have = Number((await db.query(
            `SELECT COALESCE(SUM(CASE WHEN kind = 'in' THEN quantity ELSE -quantity END), 0) AS q
               FROM deposit_movements WHERE article_id = $1 AND lot_number IS NOT DISTINCT FROM $2`, [l.articleId, lot])).rows[0].q);
          if (Number(l.quantity) > have + 1e-9) {
            throw new DepositStockError(`Stock insuffisant pour ${art.label}${lot ? ` (lot ${lot})` : ''} : ${have} disponible`);
          }
        } else if (!art.is_active) {
          throw new DepositStockError(`Article inactif : ${art.label}`);
        }
        await db.query(
          `INSERT INTO deposit_movements (article_id, kind, quantity, lot_number, expiration_date, location_id, reference, note, store_id, recorded_by)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
          [l.articleId, kind, Number(l.quantity), lot, kind === 'in' ? l.expirationDate || null : null, data.locationId || null,
           data.reference?.trim() || null, data.note?.trim() || null, ctx.storeId, ctx.userId]);
      }
      return { count: data.lines.length };
    });
  },
};
