import { db } from '../config/database.js';
import { nextDocumentNumber } from '../utils/document-number.js';

/**
 * Phase 11 (D3-37) — contrats-cadres / commandes ouvertes.
 *
 * Un contrat engage un volume (quantité d'un article) ou une valeur (montant),
 * consommé par des « appels » = des commandes rattachées (orders.sales_contract_id).
 * `getWithConsumption` calcule le consommé et le restant ; `recordRelease` lie
 * une commande au contrat.
 */

export interface ContractInput {
  customerId: string;
  basis: 'quantity' | 'value';
  productId?: string | null;
  committedQuantity?: number | null;
  committedValue?: number | null;
  unitPrice?: number | null;
  startDate: string;
  endDate?: string | null;
  notes?: string | null;
  createdBy?: string | null;
}

async function consumption(c: Record<string, unknown>) {
  let consumed = 0;
  if (c.basis === 'quantity') {
    consumed = Number((await db.query(
      `SELECT COALESCE(SUM(oi.quantity), 0) AS v
         FROM orders o JOIN order_items oi ON oi.order_id = o.id
        WHERE o.sales_contract_id = $1 AND oi.product_id = $2 AND o.status <> 'cancelled'`,
      [c.id, c.product_id])).rows[0].v);
  } else {
    consumed = Number((await db.query(
      `SELECT COALESCE(SUM(o.total), 0) AS v FROM orders o
        WHERE o.sales_contract_id = $1 AND o.status <> 'cancelled'`, [c.id])).rows[0].v);
  }
  const committed = Number(c.basis === 'quantity' ? c.committed_quantity : c.committed_value);
  return { consumed: Math.round(consumed * 1000) / 1000, committed, remaining: Math.round((committed - consumed) * 1000) / 1000 };
}

export const salesContractRepository = {
  async create(input: ContractInput) {
    if (input.basis === 'quantity' && (!input.productId || !(Number(input.committedQuantity) > 0))) {
      return { error: 'Contrat au volume : article et quantité engagée requis' };
    }
    if (input.basis === 'value' && !(Number(input.committedValue) > 0)) {
      return { error: 'Contrat à la valeur : montant engagé requis' };
    }
    const number = await nextDocumentNumber(db, 'sales_contract', input.startDate);
    const row = (await db.query(
      `INSERT INTO sales_contracts
         (number, customer_id, basis, product_id, committed_quantity, committed_value, unit_price, start_date, end_date, notes, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
      [number, input.customerId, input.basis, input.productId ?? null,
       input.basis === 'quantity' ? input.committedQuantity : null,
       input.basis === 'value' ? input.committedValue : null,
       input.unitPrice ?? null, input.startDate, input.endDate ?? null, input.notes ?? null, input.createdBy ?? null])).rows[0];
    return { data: row };
  },

  async list(customerId?: string) {
    const rows = (await db.query(
      `SELECT sc.*, p.name AS product_name,
              c.company_name, c.first_name, c.last_name
         FROM sales_contracts sc
         LEFT JOIN products p ON p.id = sc.product_id
         LEFT JOIN customers c ON c.id = sc.customer_id
        ${customerId ? 'WHERE sc.customer_id = $1' : ''}
        ORDER BY sc.created_at DESC`, customerId ? [customerId] : [])).rows;
    // Consommation par contrat (petits volumes : acceptable).
    return Promise.all(rows.map(async r => ({ ...r, ...(await consumption(r)) })));
  },

  async getWithConsumption(id: string) {
    const c = (await db.query(`SELECT * FROM sales_contracts WHERE id = $1`, [id])).rows[0];
    if (!c) return null;
    const releases = (await db.query(
      `SELECT id, order_number, total, status, created_at
         FROM orders WHERE sales_contract_id = $1 ORDER BY created_at`, [id])).rows;
    return { ...c, ...(await consumption(c)), releases };
  },

  /** Rattache une commande au contrat (appel). Le client doit correspondre. */
  async recordRelease(contractId: string, orderId: string) {
    const c = (await db.query(`SELECT id, customer_id, status FROM sales_contracts WHERE id = $1`, [contractId])).rows[0];
    if (!c) return { error: 'Contrat introuvable' };
    if (c.status !== 'active') return { error: 'Contrat clôturé' };
    const o = (await db.query(`SELECT id, customer_id FROM orders WHERE id = $1`, [orderId])).rows[0];
    if (!o) return { error: 'Commande introuvable' };
    if (o.customer_id && c.customer_id && o.customer_id !== c.customer_id) return { error: 'La commande vise un autre client' };
    await db.query(`UPDATE orders SET sales_contract_id = $1 WHERE id = $2`, [contractId, orderId]);
    return { data: await this.getWithConsumption(contractId) };
  },

  async close(id: string) {
    await db.query(`UPDATE sales_contracts SET status = 'closed' WHERE id = $1`, [id]);
  },
};
