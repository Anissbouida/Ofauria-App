import { db } from '../config/database.js';
import { recordAction, withActor, assertReasonCode } from '../services/document-actions.service.js';
import { createInvoiceFromPo } from './reception-voucher.repository.js';

/**
 * Actions motivées sur le bon de commande (refonte Achats D3, lot 1 — mig 306).
 *
 * Chaque transition est faite dans UNE transaction qui : verrouille le BC (FOR UPDATE),
 * vérifie l'état de départ, contrôle le motif (code + périmètre + note si exigée),
 * écrit la mutation, journalise l'action (document_actions) et pose l'auteur pour
 * l'audit SGBD. Les règles d'intégrité (verrou, hold, motif obligatoire) sont aussi
 * dans la base : ce module traduit les cas courants en messages clairs.
 */

type HttpError = Error & { statusCode: number; code?: string };
function httpError(statusCode: number, message: string, code?: string): HttpError {
  const e = new Error(message) as HttpError;
  e.statusCode = statusCode;
  if (code) e.code = code;
  return e;
}

type Po = { id: string; order_number: string; status: string; on_hold: boolean; frozen: boolean; store_id: string | null };

async function inTx<T>(userId: string, fn: (client: Awaited<ReturnType<typeof db.getClient>>) => Promise<T>): Promise<T> {
  const client = await db.getClient();
  try {
    await client.query('BEGIN');
    await withActor(client, userId);
    const out = await fn(client);
    await client.query('COMMIT');
    return out;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

async function lockPo(client: { query: typeof db.query }, id: string, storeId?: string): Promise<Po> {
  const r = await client.query(
    `SELECT id, order_number, status, on_hold, frozen, store_id FROM purchase_orders WHERE id = $1 FOR UPDATE`, [id],
  );
  const po = r.rows[0] as Po | undefined;
  if (!po) throw httpError(404, 'Bon de commande non trouvé');
  if (storeId && po.store_id && po.store_id !== storeId) throw httpError(403, 'Accès refusé');
  return po;
}

export type ReasonInput = { reasonCodeId: string; note?: string | null };

export type ChangeOrderInput = ReasonInput & {
  header?: { expectedDeliveryDate?: string | null; notes?: string | null };
  lines?: Array<{ id: string; qtyContainer?: number; unitPrice?: number | null; discountPct?: number; tvaRate?: number | null; expectedDate?: string | null }>;
};

/** Diff lisible entre deux snapshots fn_po_snapshot : [{path, old, new}]. */
function diffSnapshots(prev: Record<string, any> | null, next: Record<string, any>): Array<{ path: string; old: unknown; new: unknown }> {
  const out: Array<{ path: string; old: unknown; new: unknown }> = [];
  if (!prev) return [{ path: 'version', old: null, new: 'première version figée' }];
  for (const k of Object.keys(next.header ?? {})) {
    if (JSON.stringify(prev.header?.[k]) !== JSON.stringify(next.header[k])) out.push({ path: `en-tête.${k}`, old: prev.header?.[k] ?? null, new: next.header[k] });
  }
  const prevLines = new Map<string, Record<string, unknown>>((prev.lines ?? []).map((l: Record<string, unknown>) => [l.id as string, l]));
  for (const l of next.lines ?? []) {
    const p = prevLines.get(l.id);
    for (const f of ['qty_container', 'quantity_ordered', 'unit_price', 'discount_pct', 'tva_rate', 'expected_date']) {
      if (!p) { out.push({ path: `${l.item}.ajout`, old: null, new: l.quantity_ordered }); break; }
      if (JSON.stringify(p[f]) !== JSON.stringify(l[f])) out.push({ path: `${l.item}.${f}`, old: p[f] ?? null, new: l[f] ?? null });
    }
  }
  return out;
}

export const purchaseOrderActionsRepository = {
  /** Annulation : BC non livré en totalité. Libère les demandes couvertes (trigger mig 305). */
  async cancel(id: string, input: ReasonInput, userId: string, storeId?: string) {
    return inTx(userId, async (client) => {
      const po = await lockPo(client, id, storeId);
      if (['livre_complet', 'en_attente_facturation', 'annule', 'non_livre'].includes(po.status)) {
        throw httpError(409, `Impossible d'annuler le BC ${po.order_number} (statut ${po.status})`, 'PO_NOT_CANCELLABLE');
      }
      if (po.status === 'livre_partiel') {
        throw httpError(409, `Le BC ${po.order_number} est partiellement livré : annulez d'abord la réception ou clôturez le reliquat`, 'PO_PARTIALLY_RECEIVED');
      }
      const rec = await client.query(
        `SELECT COALESCE(SUM(qty_received_base), 0) AS q FROM purchase_order_items WHERE purchase_order_id = $1`, [id]);
      if (Number(rec.rows[0].q) > 0.0001) {
        throw httpError(409, `Le BC ${po.order_number} a déjà reçu de la marchandise : clôturez le reliquat au lieu d'annuler`, 'PO_HAS_RECEIPTS');
      }
      const reason = await assertReasonCode(client, input.reasonCodeId, 'cancel', input.note);
      const r = await client.query(
        `UPDATE purchase_orders
            SET status = 'annule', cancel_reason_code_id = $2, cancel_note = $3, cancelled_by = $4, cancelled_at = now(), updated_at = now()
          WHERE id = $1 RETURNING *`,
        [id, reason, input.note ?? null, userId],
      );
      await recordAction(client, { documentType: 'purchase_order', documentId: id, action: 'cancelled', actorId: userId, reasonCodeId: reason, note: input.note });
      return r.rows[0];
    });
  },

  /** Non livré : le fournisseur n'a pas livré un BC envoyé. */
  async markNotDelivered(id: string, input: ReasonInput, userId: string, storeId?: string) {
    return inTx(userId, async (client) => {
      const po = await lockPo(client, id, storeId);
      if (po.status !== 'envoye') {
        throw httpError(409, `Seul un BC envoyé et non réceptionné peut être déclaré non livré (statut ${po.status})`, 'PO_NOT_SENT');
      }
      const reason = await assertReasonCode(client, input.reasonCodeId, 'not_delivered', input.note);
      const r = await client.query(
        `UPDATE purchase_orders
            SET status = 'non_livre', cancel_reason_code_id = $2, cancel_note = $3, cancelled_by = $4, cancelled_at = now(), updated_at = now()
          WHERE id = $1 RETURNING *`,
        [id, reason, input.note ?? null, userId],
      );
      // Non livré = tout le reliquat clôturé avec ce motif (mig 307) : les compteurs de ligne
      // restent cohérents avec le statut et les demandes d'achat couvertes se libèrent.
      await client.query(
        `INSERT INTO po_line_events (po_line_id, event_type, sign, qty_base, ref_doc_type, ref_doc_id, reason_code_id, posted_by, note)
         SELECT poi.id, 'CANCEL', 1, poi.quantity_ordered - poi.qty_received_base - poi.qty_cancelled_base,
                'close_remainder', gen_random_uuid(), $2, $3, 'BC déclaré non livré'
           FROM purchase_order_items poi
          WHERE poi.purchase_order_id = $1 AND poi.quantity_ordered - poi.qty_received_base - poi.qty_cancelled_base > 0.0001`,
        [id, reason, userId],
      );
      await recordAction(client, { documentType: 'purchase_order', documentId: id, action: 'not_delivered', actorId: userId, reasonCodeId: reason, note: input.note });
      return r.rows[0];
    });
  },

  /** Blocage : suspend réception et facturation (litige, non-conformité…). */
  async hold(id: string, input: ReasonInput, userId: string, storeId?: string) {
    return inTx(userId, async (client) => {
      const po = await lockPo(client, id, storeId);
      if (po.on_hold) throw httpError(409, `Le BC ${po.order_number} est déjà bloqué`, 'PO_ALREADY_HELD');
      if (['annule', 'non_livre'].includes(po.status)) throw httpError(409, `Le BC ${po.order_number} est clos`, 'PO_CLOSED');
      const reason = await assertReasonCode(client, input.reasonCodeId, 'hold', input.note);
      const r = await client.query(
        `UPDATE purchase_orders SET on_hold = true, hold_reason_code_id = $2, hold_note = $3, held_by = $4, held_at = now(), updated_at = now()
          WHERE id = $1 RETURNING *`,
        [id, reason, input.note ?? null, userId],
      );
      await recordAction(client, { documentType: 'purchase_order', documentId: id, action: 'held', actorId: userId, reasonCodeId: reason, note: input.note });
      return r.rows[0];
    });
  },

  async release(id: string, note: string | null, userId: string, storeId?: string) {
    return inTx(userId, async (client) => {
      const po = await lockPo(client, id, storeId);
      if (!po.on_hold) throw httpError(409, `Le BC ${po.order_number} n'est pas bloqué`, 'PO_NOT_HELD');
      // Le motif du blocage reste dans le journal ; les colonnes décrivent l'état courant.
      const r = await client.query(
        `UPDATE purchase_orders SET on_hold = false, hold_reason_code_id = NULL, hold_note = NULL, held_by = NULL, held_at = NULL, updated_at = now()
          WHERE id = $1 RETURNING *`,
        [id],
      );
      await recordAction(client, { documentType: 'purchase_order', documentId: id, action: 'released', actorId: userId, note });
      return r.rows[0];
    });
  },

  /** Gel : en-tête et lignes figés quel que soit le statut ; réception et facture possibles. */
  async setFrozen(id: string, frozen: boolean, note: string | null, userId: string, storeId?: string) {
    return inTx(userId, async (client) => {
      const po = await lockPo(client, id, storeId);
      if (po.frozen === frozen) throw httpError(409, `Le BC ${po.order_number} est déjà ${frozen ? 'gelé' : 'dégelé'}`, 'PO_FROZEN_UNCHANGED');
      const r = await client.query(
        `UPDATE purchase_orders SET frozen = $2, frozen_by = CASE WHEN $2 THEN $3::uuid END, frozen_at = CASE WHEN $2 THEN now() END, updated_at = now()
          WHERE id = $1 RETURNING *`,
        [id, frozen, userId],
      );
      await recordAction(client, { documentType: 'purchase_order', documentId: id, action: frozen ? 'frozen' : 'unfrozen', actorId: userId, note });
      return r.rows[0];
    });
  },

  /** Envoi : seule la transition est journalisée ici (l'envoi réel au fournisseur relève de D4). */
  async send(id: string, userId: string, storeId?: string) {
    return inTx(userId, async (client) => {
      const po = await lockPo(client, id, storeId);
      if (po.status !== 'en_attente') throw httpError(409, 'Le bon doit être en attente pour être envoyé', 'PO_NOT_DRAFT');
      const r = await client.query(`UPDATE purchase_orders SET status = 'envoye', updated_at = now() WHERE id = $1 RETURNING *`, [id]);
      // Version 0 figée à l'engagement (mig 307) : ce qui a été commandé reste prouvable.
      await client.query(
        `INSERT INTO purchase_order_versions (purchase_order_id, version_no, snapshot, created_by)
         VALUES ($1, 0, fn_po_snapshot($1), $2) ON CONFLICT (purchase_order_id, version_no) DO NOTHING`,
        [id, userId],
      );
      const total = await client.query(
        `SELECT COALESCE(SUM(quantity_ordered * COALESCE(unit_price, 0)), 0) AS t FROM purchase_order_items WHERE purchase_order_id = $1`, [id],
      );
      await recordAction(client, { documentType: 'purchase_order', documentId: id, action: 'sent', actorId: userId, snapshotAmount: Number(total.rows[0].t) });
      return r.rows[0];
    });
  },

  /**
   * Clôture du reliquat d'une ligne (ou de toutes) : la part non reçue devient une quantité
   * annulée tracée (événement CANCEL). Rien n'est supprimé ni réécrit ; réversible.
   */
  async closeRemainder(id: string, lineId: string | null, input: ReasonInput, userId: string, storeId?: string) {
    return inTx(userId, async (client) => {
      const po = await lockPo(client, id, storeId);
      if (!['envoye', 'livre_partiel'].includes(po.status)) {
        throw httpError(409, `Le BC ${po.order_number} n'a pas de reliquat ouvert (statut ${po.status})`, 'PO_NO_REMAINDER');
      }
      const reason = await assertReasonCode(client, input.reasonCodeId, 'force_close', input.note);
      const ins = await client.query(
        `INSERT INTO po_line_events (po_line_id, event_type, sign, qty_base, ref_doc_type, ref_doc_id, reason_code_id, posted_by, note)
         SELECT poi.id, 'CANCEL', 1, poi.quantity_ordered - poi.qty_received_base - poi.qty_cancelled_base,
                'close_remainder', gen_random_uuid(), $3, $4, $5
           FROM purchase_order_items poi
          WHERE poi.purchase_order_id = $1 AND ($2::uuid IS NULL OR poi.id = $2)
            AND poi.quantity_ordered - poi.qty_received_base - poi.qty_cancelled_base > 0.0001
         RETURNING id`,
        [id, lineId, reason, userId, input.note ?? null],
      );
      if (!ins.rowCount) throw httpError(409, 'Aucun reliquat à clôturer sur cette ligne', 'PO_NO_REMAINDER');
      const after = await this._resyncStatus(client, id, userId);
      await recordAction(client, { documentType: 'purchase_order', documentId: id, action: 'force_closed', actorId: userId, reasonCodeId: reason,
        note: input.note, diff: { lines: ins.rowCount, line_id: lineId } });
      return after;
    });
  },

  /** Réouverture d'un reliquat clôturé (événement CANCEL_REVERSAL), tant que le BC n'est pas facturé. */
  async reopenRemainder(id: string, lineId: string, note: string | null, userId: string, storeId?: string) {
    return inTx(userId, async (client) => {
      const po = await lockPo(client, id, storeId);
      if (['annule', 'non_livre'].includes(po.status)) throw httpError(409, `Le BC ${po.order_number} est clos`, 'PO_CLOSED');
      const inv = await client.query(`SELECT 1 FROM invoices WHERE purchase_order_id = $1 AND status <> 'cancelled' LIMIT 1`, [id]);
      if (inv.rowCount) throw httpError(409, `Le BC ${po.order_number} est déjà facturé : le reliquat ne peut plus être rouvert`, 'PO_INVOICED');
      const ins = await client.query(
        `INSERT INTO po_line_events (po_line_id, event_type, sign, qty_base, ref_doc_type, ref_doc_id, posted_by, note)
         SELECT poi.id, 'CANCEL_REVERSAL', -1, poi.qty_cancelled_base, 'reopen_remainder', gen_random_uuid(), $3, $4
           FROM purchase_order_items poi
          WHERE poi.purchase_order_id = $1 AND poi.id = $2 AND poi.qty_cancelled_base > 0.0001
         RETURNING id`,
        [id, lineId, userId, note],
      );
      if (!ins.rowCount) throw httpError(409, 'Aucun reliquat clôturé sur cette ligne', 'PO_NOTHING_TO_REOPEN');
      const after = await this._resyncStatus(client, id, userId);
      await recordAction(client, { documentType: 'purchase_order', documentId: id, action: 'reopened', actorId: userId, note, diff: { line_id: lineId } });
      return after;
    });
  },

  /**
   * Demande de changement (avenant) sur un BC engagé : modifications motivées, contrôlées,
   * appliquées sous le contexte app.change_order, puis figées dans une nouvelle version.
   *
   * Interdits : quantité sous ce qui est déjà reçu + clôturé ; changer le prix d'un BC facturé ;
   * changer de fournisseur après une réception ; supprimer une ligne ayant des mouvements.
   */
  async changeOrder(id: string, input: ChangeOrderInput, userId: string, storeId?: string) {
    return inTx(userId, async (client) => {
      const po = await lockPo(client, id, storeId);
      if (['annule', 'non_livre'].includes(po.status)) throw httpError(409, `Le BC ${po.order_number} est clos`, 'PO_CLOSED');
      if (po.frozen) throw httpError(409, `Le BC ${po.order_number} est gelé`, 'PO_FROZEN');
      if (po.status === 'en_attente') throw httpError(409, 'Un BC en brouillon se modifie directement', 'PO_IS_DRAFT');
      const reason = await assertReasonCode(client, input.reasonCodeId, 'change', input.note);
      const invoiced = (await client.query(`SELECT 1 FROM invoices WHERE purchase_order_id = $1 AND status <> 'cancelled' LIMIT 1`, [id])).rowCount! > 0;
      await client.query(`SELECT set_config('app.change_order', 'on', true)`);

      if (input.header?.expectedDeliveryDate !== undefined || input.header?.notes !== undefined) {
        await client.query(
          `UPDATE purchase_orders SET
             expected_delivery_date = CASE WHEN $2::boolean THEN $3::date ELSE expected_delivery_date END,
             notes = CASE WHEN $4::boolean THEN $5 ELSE notes END,
             updated_at = now()
           WHERE id = $1`,
          [id, input.header.expectedDeliveryDate !== undefined, input.header.expectedDeliveryDate ?? null,
           input.header.notes !== undefined, input.header.notes ?? null],
        );
      }

      for (const l of input.lines ?? []) {
        const cur = (await client.query(
          `SELECT * FROM purchase_order_items WHERE id = $1 AND purchase_order_id = $2 FOR UPDATE`, [l.id, id])).rows[0];
        if (!cur) throw httpError(404, 'Ligne de BC introuvable');
        const floor = Number(cur.qty_received_base) + Number(cur.qty_cancelled_base);
        let newQty = Number(cur.quantity_ordered);
        if (l.qtyContainer !== undefined) newQty = l.qtyContainer * Number(cur.qty_per_container);
        if (newQty < floor - 0.0001) {
          throw httpError(409, `Quantité impossible : ${floor} déjà reçu ou clôturé sur cette ligne`, 'PO_QTY_BELOW_RECEIVED');
        }
        if (l.unitPrice !== undefined && invoiced && Number(l.unitPrice) !== Number(cur.unit_price)) {
          throw httpError(409, 'Le BC est facturé : un écart de prix se traite par avoir ou facture complémentaire', 'PO_INVOICED');
        }
        await client.query(
          `UPDATE purchase_order_items SET
             qty_container = COALESCE($2, qty_container),
             unit_price    = CASE WHEN $3::boolean THEN $4 ELSE unit_price END,
             discount_pct  = COALESCE($5, discount_pct),
             tva_rate      = CASE WHEN $6::boolean THEN $7 ELSE tva_rate END,
             expected_date = CASE WHEN $8::boolean THEN $9::date ELSE expected_date END
           WHERE id = $1`,
          [l.id, l.qtyContainer ?? null, l.unitPrice !== undefined, l.unitPrice ?? null, l.discountPct ?? null,
           l.tvaRate !== undefined, l.tvaRate ?? null, l.expectedDate !== undefined, l.expectedDate ?? null],
        );
      }

      // Version suivante : snapshot de l'état obtenu + diff avec la version précédente.
      const prev = await client.query(
        `SELECT version_no, snapshot FROM purchase_order_versions WHERE purchase_order_id = $1 ORDER BY version_no DESC LIMIT 1`, [id]);
      const snap = (await client.query(`SELECT fn_po_snapshot($1) AS s`, [id])).rows[0].s;
      const diff = diffSnapshots(prev.rows[0]?.snapshot ?? null, snap);
      if (diff.length === 0) throw httpError(400, 'Aucune modification à enregistrer', 'PO_CHANGE_EMPTY');
      const nextNo = prev.rows[0] ? Number(prev.rows[0].version_no) + 1 : 1;
      await client.query(
        `INSERT INTO purchase_order_versions (purchase_order_id, version_no, reason_code_id, reason_note, snapshot, diff, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [id, nextNo, reason, input.note ?? null, JSON.stringify(snap), JSON.stringify(diff), userId],
      );
      await client.query(`UPDATE purchase_orders SET current_version = $2, updated_at = now() WHERE id = $1`, [id, nextNo]);
      await client.query(`SELECT set_config('app.change_order', '', true)`);
      const after = await this._resyncStatus(client, id, userId);
      await recordAction(client, { documentType: 'purchase_order', documentId: id, action: 'changed', actorId: userId,
        reasonCodeId: reason, note: input.note, diff: { version: nextNo, changes: diff } });
      return { ...after, version_no: nextNo, diff };
    });
  },

  async versions(id: string) {
    const r = await db.query(
      `SELECT v.version_no, v.reason_note, v.diff, v.snapshot, v.reconstituted, v.created_at,
              re.label AS reason_label, COALESCE(u.first_name || ' ' || u.last_name, u.email) AS created_by_name
         FROM purchase_order_versions v
         LEFT JOIN ref_entries re ON re.id = v.reason_code_id
         LEFT JOIN users u ON u.id = v.created_by
        WHERE v.purchase_order_id = $1 ORDER BY v.version_no`,
      [id],
    );
    return r.rows;
  },

  /** Recalcule le statut de livraison par la règle en base ; crée la facture auto si le BC devient complet. */
  async _resyncStatus(client: { query: typeof db.query }, id: string, userId: string) {
    const st = (await client.query(`SELECT fn_po_delivery_status($1) AS s, status FROM purchase_orders WHERE id = $1`, [id])).rows[0];
    let next = st.s as string;
    // Un BC engagé sans aucune réception reste « envoyé » (fn renvoie envoye) ; tout clôturé sans rien reçu = non livré.
    if (next === 'en_attente') next = st.status;
    const r = await client.query(
      `UPDATE purchase_orders SET status = $2, updated_at = now() WHERE id = $1 AND status IS DISTINCT FROM $2 RETURNING *`, [id, next]);
    if (next === 'livre_complet') {
      const po = (await client.query(`SELECT store_id FROM purchase_orders WHERE id = $1`, [id])).rows[0];
      await createInvoiceFromPo(client as never, id, null, userId, (po?.store_id as string | null) ?? null);
    }
    return r.rows[0] ?? (await client.query(`SELECT * FROM purchase_orders WHERE id = $1`, [id])).rows[0];
  },

  /** Journalise une action hors transaction de mutation (création, réception, modification, suppression). */
  async log(id: string, action: 'created' | 'received' | 'changed' | 'reversed' | 'deleted' | 'invoiced', userId: string, extra: { note?: string | null; diff?: Record<string, unknown> | null; snapshotAmount?: number | null } = {}) {
    await recordAction(db, { documentType: 'purchase_order', documentId: id, action, actorId: userId, ...extra });
  },
};
