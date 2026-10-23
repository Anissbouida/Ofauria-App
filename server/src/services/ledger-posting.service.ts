/**
 * Comptabilisation des pièces (mig 311, D8 G-D8-01).
 *
 * La comptabilité n'est plus une option : chaque pièce financière tente son
 * écriture dans la transaction métier. En cas d'échec (paramétrage manquant,
 * prix BC absent…), selon le paramètre ledger.posting_mode :
 *   - outbox (défaut) : la pièce passe, l'échec est inscrit dans ledger_outbox
 *     (motif lisible, rejouable) — plus de console.error silencieux ;
 *   - strict : l'échec annule la pièce (équivalent d'un FORM_TRIGGER_FAILURE).
 */
import type { PoolClient } from 'pg';
import { db } from '../config/database.js';
import {
  fromGoodsReceipt, persistEntry, regenerateInvoiceEntry, regeneratePaymentEntries,
} from './journal-generator.service.js';

export type PostingMode = 'outbox' | 'strict';

export async function getPostingMode(client: PoolClient | typeof db = db): Promise<PostingMode> {
  const r = await client.query(`SELECT value->>'mode' AS mode FROM module_parameters WHERE key = 'ledger.posting_mode'`);
  return r.rows[0]?.mode === 'strict' ? 'strict' : 'outbox';
}

let spSeq = 0;

/**
 * Exécute `post` dans un SAVEPOINT. Succès : la ligne d'outbox éventuelle passe
 * 'posted'. Échec : rollback du savepoint puis file d'attente (outbox) ou
 * propagation (strict).
 */
export async function postOrQueue(
  client: PoolClient,
  source: { kind: string; id: string; detail?: string | null },
  post: () => Promise<unknown>,
): Promise<boolean> {
  const sp = `ledger_post_${++spSeq}`;
  await client.query(`SAVEPOINT ${sp}`);
  try {
    await post();
    await client.query(`RELEASE SAVEPOINT ${sp}`);
    await client.query(
      `UPDATE ledger_outbox SET status = 'posted', posted_at = now(), updated_at = now()
        WHERE source_kind = $1 AND source_id = $2 AND source_detail = $3 AND status <> 'posted'`,
      [source.kind, source.id, source.detail ?? '']);
    return true;
  } catch (err) {
    await client.query(`ROLLBACK TO SAVEPOINT ${sp}`);
    const message = err instanceof Error ? err.message : String(err);
    if ((await getPostingMode(client)) === 'strict') {
      throw Object.assign(new Error(`Comptabilisation impossible : ${message}`), { statusCode: 409 });
    }
    await client.query(
      `INSERT INTO ledger_outbox (source_kind, source_id, source_detail, status, last_error)
       VALUES ($1, $2, $3, 'pending', $4)
       ON CONFLICT (source_kind, source_id, source_detail)
       DO UPDATE SET status = 'pending', attempts = ledger_outbox.attempts + 1, last_error = EXCLUDED.last_error, updated_at = now()`,
      [source.kind, source.id, source.detail ?? '', message.slice(0, 2000)]);
    return false;
  }
}

/**
 * Réceptions GR/IR d'un BC (G-D8-05) : une écriture par ligne de réception qui
 * n'en a pas encore. Règle de bascule : une ligne « receive » est comptabilisée
 * si le BC n'a pas de facture active au moment de la comptabilisation (l'historique
 * déjà facturé ne passe pas en 4417) ; une ligne d'extourne ou de correction suit
 * sa ligne d'origine (comptabilisée seulement si l'origine l'a été).
 */
export async function postGoodsReceiptsForPo(client: PoolClient, purchaseOrderId: string, userId: string): Promise<number> {
  const rows = await client.query(
    `SELECT rvi.id, rvi.kind, rvi.parent_item_id
       FROM reception_voucher_items rvi
       JOIN reception_vouchers rv ON rv.id = rvi.reception_voucher_id
      WHERE rv.purchase_order_id = $1 AND rvi.purchase_order_item_id IS NOT NULL
        AND NOT EXISTS (SELECT 1 FROM journal_entries je WHERE je.source_id = rvi.id AND je.status <> 'draft')
      ORDER BY rvi.created_at, rvi.id`, [purchaseOrderId]);
  if (rows.rows.length === 0) return 0;
  const invoiced = await client.query(
    `SELECT 1 FROM invoices i WHERE i.status <> 'cancelled'
        AND (i.purchase_order_id = $1 OR EXISTS (SELECT 1 FROM invoice_purchase_orders ipo WHERE ipo.invoice_id = i.id AND ipo.purchase_order_id = $1))
      LIMIT 1`, [purchaseOrderId]);
  let posted = 0;
  for (const r of rows.rows as { id: string; kind: string; parent_item_id: string | null }[]) {
    if (r.kind === 'receive') {
      if (invoiced.rows[0]) continue;
    } else {
      if (!r.parent_item_id) continue;
      const parent = await client.query(`SELECT 1 FROM journal_entries WHERE source_id = $1 AND source_kind = 'goods_receipt' LIMIT 1`, [r.parent_item_id]);
      if (!parent.rows[0]) continue;
    }
    const ok = await postOrQueue(client, { kind: 'goods_receipt', id: r.id }, async () => {
      const entry = await fromGoodsReceipt(client, r.id);
      if (entry) await persistEntry(client, entry, { userId });
    });
    if (ok) posted++;
  }
  return posted;
}

/** Rejoue la file d'attente : chaque pièce dans sa propre transaction. */
export async function replayOutbox(userId: string, onlyId?: string) {
  const items = await db.query(
    `SELECT id, source_kind, source_id, source_detail FROM ledger_outbox
      WHERE status <> 'posted' ${onlyId ? 'AND id = $1' : ''} ORDER BY created_at`, onlyId ? [onlyId] : []);
  const result = { replayed: 0, posted: 0, failed: 0, errors: [] as string[] };
  for (const it of items.rows as { id: string; source_kind: string; source_id: string; source_detail: string }[]) {
    result.replayed++;
    const client = await db.getClient();
    try {
      await client.query('BEGIN');
      await client.query(`SELECT set_config('app.user_id', $1, true)`, [userId]);
      if (it.source_kind === 'invoice') await regenerateInvoiceEntry(client, it.source_id, userId);
      else if (it.source_kind === 'payment') await regeneratePaymentEntries(client, it.source_id, userId);
      else if (it.source_kind === 'goods_receipt') {
        const entry = await fromGoodsReceipt(client, it.source_id);
        if (entry) await persistEntry(client, entry, { userId });
      } else throw new Error(`Type de pièce non rejouable : ${it.source_kind}`);
      await client.query(`UPDATE ledger_outbox SET status = 'posted', posted_at = now(), updated_at = now() WHERE id = $1`, [it.id]);
      await client.query('COMMIT');
      result.posted++;
    } catch (err) {
      await client.query('ROLLBACK');
      const message = err instanceof Error ? err.message : String(err);
      await db.query(`UPDATE ledger_outbox SET attempts = attempts + 1, last_error = $2, updated_at = now() WHERE id = $1`,
        [it.id, message.slice(0, 2000)]);
      result.failed++;
      if (result.errors.length < 10) result.errors.push(`${it.source_kind} ${it.source_id} : ${message}`);
    } finally {
      client.release();
    }
  }
  return result;
}

export async function listOutbox(status?: string) {
  const r = await db.query(
    `SELECT o.*,
            CASE o.source_kind
              WHEN 'invoice' THEN (SELECT invoice_number FROM invoices WHERE id = o.source_id)
              WHEN 'payment' THEN (SELECT COALESCE(reference, check_number, description) FROM payments WHERE id = o.source_id)
              WHEN 'goods_receipt' THEN (SELECT rv.voucher_number FROM reception_voucher_items rvi JOIN reception_vouchers rv ON rv.id = rvi.reception_voucher_id WHERE rvi.id = o.source_id)
            END AS document_label
       FROM ledger_outbox o
      WHERE ($1::text IS NULL OR o.status = $1)
      ORDER BY o.status <> 'posted' DESC, o.created_at DESC LIMIT 500`, [status ?? null]);
  return r.rows;
}
