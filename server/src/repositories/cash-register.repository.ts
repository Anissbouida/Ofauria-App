import { db } from '../config/database.js';
import { getUserTimezone, getLocalDateString } from '../utils/timezone.js';
import { FLAGS } from '../config/feature-flags.js';
import { fromClosureDiff, persistEntry } from '../services/journal-generator.service.js';

/**
 * Z-report — numerotation sequentielle inviolable (section 4.3).
 * Pattern : Z-YYYYMMDD-nnnn (nnnn zero-padded, sequence par jour local).
 * Advisory lock pour eviter les collisions sous concurrence, meme approche
 * que generateSaleNumber (sale.repository.ts).
 */
async function generateClosureNumber(
  client: { query: (text: string, params?: unknown[]) => Promise<{ rows: Record<string, string>[] }> }
) {
  await client.query(`SELECT pg_advisory_xact_lock(hashtext('closure_number'))`);
  const today = getLocalDateString();
  const prefix = `Z-${today.replace(/-/g, '')}-`;
  const result = await client.query(
    `SELECT closure_number FROM cash_register_sessions
      WHERE closure_number LIKE $1
      ORDER BY closure_number DESC LIMIT 1`,
    [prefix + '%']
  );
  let seq = 1;
  if (result.rows.length > 0) {
    const lastSeq = parseInt(result.rows[0].closure_number.split('-').pop() || '0', 10);
    seq = lastSeq + 1;
  }
  return `${prefix}${String(seq).padStart(4, '0')}`;
}

export const cashRegisterRepository = {
  async findOpenSession(userId: string) {
    const result = await db.query(
      `SELECT * FROM cash_register_sessions WHERE user_id = $1 AND status = 'open' ORDER BY opened_at DESC LIMIT 1`,
      [userId]
    );
    return result.rows[0] || null;
  },

  async findAll(params: { userId?: string; status?: string; dateFrom?: string; dateTo?: string; storeId?: string; limit: number; offset: number }) {
    const conditions: string[] = [];
    const values: unknown[] = [];
    let i = 1;

    if (params.storeId) { conditions.push(`cs.store_id = $${i++}`); values.push(params.storeId); }
    if (params.userId) { conditions.push(`cs.user_id = $${i++}`); values.push(params.userId); }
    if (params.status) { conditions.push(`cs.status = $${i++}`); values.push(params.status); }
    // Filtrage dans le fuseau utilisateur. Pour les sessions cloturees on filtre sur
    // closed_at (date a laquelle le CA a ete genere) — une passation ouverte hier soir
    // et close ce matin doit apparaitre sur la date de fermeture, pas la date d'ouverture.
    // Pour les sessions encore ouvertes (closed_at null) on retombe sur opened_at.
    const tzCs = getUserTimezone();
    const dateExpr = `COALESCE((cs.closed_at AT TIME ZONE '${tzCs}')::date, (cs.opened_at AT TIME ZONE '${tzCs}')::date)`;
    if (params.dateFrom) { conditions.push(`${dateExpr} >= $${i++}`); values.push(params.dateFrom); }
    if (params.dateTo) { conditions.push(`${dateExpr} <= $${i++}`); values.push(params.dateTo); }

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const countResult = await db.query(`SELECT COUNT(*) FROM cash_register_sessions cs ${where}`, values);
    const total = parseInt(countResult.rows[0].count, 10);

    values.push(params.limit, params.offset);
    const result = await db.query(
      `SELECT cs.*, u.first_name, u.last_name,
         dic.total_replenished as inv_total_replenished,
         dic.total_sold as inv_total_sold,
         dic.total_remaining as inv_total_remaining,
         dic.total_discrepancy as inv_total_discrepancy,
         (SELECT COUNT(DISTINCT o.id) FROM orders o JOIN sales s ON s.order_id = o.id
          WHERE s.session_id = cs.id AND s.sale_type = 'advance'
          AND o.status NOT IN ('completed', 'cancelled')) as pending_orders
       FROM cash_register_sessions cs
       JOIN users u ON u.id = cs.user_id
       LEFT JOIN daily_inventory_checks dic ON dic.session_id = cs.id
       ${where}
       ORDER BY cs.opened_at DESC
       LIMIT $${i++} OFFSET $${i}`,
      values
    );

    return { rows: result.rows, total };
  },

  async findById(id: string) {
    const result = await db.query(
      `SELECT cs.*, u.first_name, u.last_name,
         dic.total_replenished as inv_total_replenished,
         dic.total_sold as inv_total_sold,
         dic.total_remaining as inv_total_remaining,
         dic.total_discrepancy as inv_total_discrepancy,
         (SELECT COUNT(DISTINCT o.id) FROM orders o JOIN sales s ON s.order_id = o.id
          WHERE s.session_id = cs.id AND s.sale_type = 'advance'
          AND o.status NOT IN ('completed', 'cancelled')) as pending_orders
       FROM cash_register_sessions cs
       JOIN users u ON u.id = cs.user_id
       LEFT JOIN daily_inventory_checks dic ON dic.session_id = cs.id
       WHERE cs.id = $1`,
      [id]
    );
    return result.rows[0] || null;
  },

  async getInventoryItems(sessionId: string) {
    const result = await db.query(
      `SELECT dici.product_name, dici.replenished_qty, dici.sold_qty, dici.remaining_qty, dici.discrepancy
       FROM daily_inventory_check_items dici
       JOIN daily_inventory_checks dic ON dic.id = dici.check_id
       WHERE dic.session_id = $1
       ORDER BY dici.product_name`,
      [sessionId]
    );
    return result.rows;
  },

  async findLastClosedSession(storeId?: string) {
    const result = await db.query(
      `SELECT actual_amount FROM cash_register_sessions
       WHERE status = 'closed' ${storeId ? 'AND store_id = $1' : ''}
       ORDER BY closed_at DESC LIMIT 1`,
      storeId ? [storeId] : []
    );
    return result.rows[0] || null;
  },

  async open(userId: string, openingAmount: number, storeId?: string) {
    const result = await db.query(
      `INSERT INTO cash_register_sessions (user_id, opening_amount, store_id) VALUES ($1, $2, $3) RETURNING *`,
      [userId, openingAmount, storeId || null]
    );
    return result.rows[0];
  },

  async close(sessionId: string, closeType: string = 'fin_journee') {
    const client = await db.getClient();
    try {
      await client.query('BEGIN');

      // Calculate sales stats for this session, broken down by sale_type
      // Each sale.total reflects the REAL cash received for that transaction:
      //   standard = regular POS sale, advance = advance payment on order, delivery = remaining balance at delivery
      const statsResult = await client.query(
        `SELECT
          COUNT(*) as total_sales,
          COALESCE(SUM(total), 0) as total_revenue,
          COALESCE(SUM(CASE WHEN payment_method = 'cash' THEN total
                            WHEN payment_method = 'mixed' THEN COALESCE(cash_amount, 0)
                            ELSE 0 END), 0) as cash_revenue,
          COALESCE(SUM(CASE WHEN payment_method = 'card' THEN total
                            WHEN payment_method = 'mixed' THEN COALESCE(card_amount, 0)
                            ELSE 0 END), 0) as card_revenue,
          COALESCE(SUM(CASE WHEN payment_method = 'mobile' THEN total ELSE 0 END), 0) as mobile_revenue,
          COALESCE(SUM(CASE WHEN sale_type = 'standard' THEN total ELSE 0 END), 0) as standard_revenue,
          COALESCE(SUM(CASE WHEN sale_type = 'advance' THEN total ELSE 0 END), 0) as advance_revenue,
          COALESCE(SUM(CASE WHEN sale_type = 'delivery' THEN total ELSE 0 END), 0) as delivery_revenue,
          COUNT(CASE WHEN sale_type = 'standard' THEN 1 END) as standard_count,
          COUNT(CASE WHEN sale_type = 'advance' THEN 1 END) as advance_count,
          COUNT(CASE WHEN sale_type = 'delivery' THEN 1 END) as delivery_count
        FROM sales
        WHERE session_id = $1
          AND payment_status IS DISTINCT FROM 'unpaid'`,
        [sessionId]
      );

      // C9 — Ne soustraire du tiroir QUE les remboursements cash. Avant, un
      // retour d'une vente carte reduisait expected_cash comme s'il etait
      // sorti du tiroir -> deficit artificiel. On s'appuie sur le
      // payment_method de la vente d'origine (source de verite serveur),
      // car sale_returns lui-meme ne stocke pas le mode de remboursement
      // dans toutes les versions du schema.
      const refundsResult = await client.query(
        `SELECT COALESCE(SUM(sr.refund_amount), 0) AS total_refunds
           FROM sale_returns sr
           JOIN sales s ON s.id = sr.sale_id
          WHERE sr.session_id = $1
            AND sr.type = 'return'
            AND (
              s.payment_method = 'cash'
              OR (s.payment_method = 'mixed' AND COALESCE(s.cash_amount, 0) > 0)
            )`,
        [sessionId]
      );

      const stats = statsResult.rows[0];
      const totalRefunds = parseFloat(refundsResult.rows[0].total_refunds);
      const session = await client.query(`SELECT opening_amount FROM cash_register_sessions WHERE id = $1`, [sessionId]);
      const openingAmount = parseFloat(session.rows[0].opening_amount);

      const totalAdvances = parseFloat(stats.advance_revenue);

      // Count only orders that are NOT yet completed (truly pending delivery)
      const pendingOrdersResult = await client.query(
        `SELECT COUNT(DISTINCT o.id) as pending_count
         FROM orders o
         JOIN sales s ON s.order_id = o.id
         WHERE s.session_id = $1
           AND s.sale_type = 'advance'
           AND o.status NOT IN ('completed', 'cancelled')`,
        [sessionId]
      );
      const totalOrders = parseInt(pendingOrdersResult.rows[0].pending_count);

      const grossCashRevenue = parseFloat(stats.cash_revenue);
      const netCashRevenue = grossCashRevenue - totalRefunds;
      const netTotalRevenue = parseFloat(stats.total_revenue) - totalRefunds;

      // Section 4.3 — Paid-out : depenses reglees en cash depuis le tiroir
      // pendant le shift. Sans ce terme, une facture fournisseur payee au
      // guichet creait un « manquant » de meme montant a la cloture.
      const paidOutResult = await client.query(
        `SELECT COALESCE(SUM(amount), 0) AS paid_out
           FROM payments
          WHERE session_id = $1
            AND payment_method = 'cash'
            AND type != 'income'
            AND (payment_method NOT IN ('check', 'traite') OR cashed_at IS NOT NULL)`,
        [sessionId]
      );
      const paidOut = parseFloat(paidOutResult.rows[0].paid_out) || 0;
      const paidInResult = await client.query(
        `SELECT COALESCE(SUM(amount), 0) AS paid_in
           FROM payments
          WHERE session_id = $1
            AND payment_method = 'cash'
            AND type = 'income'`,
        [sessionId]
      );
      const paidIn = parseFloat(paidInResult.rows[0].paid_in) || 0;

      // Expected cash = fond + ventes cash net + entrees cash - depenses cash
      const expectedCash = openingAmount + netCashRevenue + paidIn - paidOut;

      // Section 4.3 — Z-report : generer un numero de cloture sequentiel
      // immuable, seulement s'il n'existe pas deja (idempotent en cas
      // de re-close avant submit).
      const existingCn = await client.query(
        `SELECT closure_number FROM cash_register_sessions WHERE id = $1`,
        [sessionId]
      );
      const closureNumber = existingCn.rows[0]?.closure_number
        || await generateClosureNumber(client);

      await client.query(
        `UPDATE cash_register_sessions SET
          total_sales = $1, total_revenue = $2,
          cash_revenue = $3, card_revenue = $4, mobile_revenue = $5,
          expected_cash = $6, total_advances = $7, total_orders = $8,
          close_type = $10,
          closure_number = COALESCE(closure_number, $11),
          -- C6 — Marquer l'entree en phase de comptage : le controller
          -- sale.controller.ts refuse desormais les ventes tant que
          -- closing_started_at IS NOT NULL. Sans ce flag, toute vente
          -- encaissee entre close() et submit() gonflait le tiroir sans
          -- que expected_cash le reflete -> faux excedent au submit.
          closing_started_at = COALESCE(closing_started_at, NOW())
        WHERE id = $9 AND status = 'open'`,
        [parseInt(stats.total_sales), netTotalRevenue,
         netCashRevenue, parseFloat(stats.card_revenue), parseFloat(stats.mobile_revenue),
         expectedCash, totalAdvances, totalOrders, sessionId, closeType,
         closureNumber]
      );

      await client.query('COMMIT');

      // Section 4.3 — Blind count : ne PAS renvoyer expected_cash ni
      // cash_revenue au client cote close(). Sinon la caissiere voit le
      // montant attendu avant de compter le tiroir -> comptage biaise. On
      // renvoie un payload minimal : id / closure_number / close_type + le
      // breakdown non monetaire (nombres de ventes). submit() recevra le
      // montant compte a l'aveugle et re-verrouillera la session.
      const sessionData = await this.findById(sessionId);
      if (!sessionData) return null;
      const blindData = {
        id: sessionData.id,
        closure_number: sessionData.closure_number,
        close_type: sessionData.close_type,
        opened_at: sessionData.opened_at,
        standard_count: parseInt(stats.standard_count),
        advance_count: parseInt(stats.advance_count),
        delivery_count: parseInt(stats.delivery_count),
        total_sales: parseInt(stats.total_sales),
        total_orders: totalOrders,
        // Info : le fond d'ouverture est deja affiche a l'operateur, l'y
        // laisser lui evite d'aller le chercher. Rien de sensible ici.
        opening_amount: sessionData.opening_amount,
        // Guides operationnels (nombre de billets a compter…), pas de montants.
      };
      return blindData;
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  },

  async submitActualAmount(
    sessionId: string,
    actualAmount: number,
    notes?: string,
    differenceReason?: string,
  ) {
    const session = await this.findById(sessionId);
    if (!session) return null;

    // C5 — Interdire la reecriture apres cloture. Avant ce fix une caissiere
    // pouvait « corriger » son ecart indefiniment via ce meme endpoint.
    if (session.status === 'closed' || session.locked_at) {
      const err = new Error('Session deja cloturee — ecart non modifiable');
      (err as Error & { code?: string }).code = 'SESSION_ALREADY_CLOSED';
      throw err;
    }
    // Il faut avoir appele close() (qui pose expected_cash + closing_started_at)
    // avant submit(). Sinon on stockait un difference=NaN.
    if (session.expected_cash == null) {
      const err = new Error('close() doit avoir ete appele avant submit()');
      (err as Error & { code?: string }).code = 'SESSION_NOT_IN_CLOSING';
      throw err;
    }

    const expectedCash = parseFloat(session.expected_cash);
    const difference = actualAmount - expectedCash;

    // Section 4.3 — Motif obligatoire si l'ecart depasse le seuil de
    // tolerance (5 DH, arrondi de rendu-monnaie). Sans motif, l'ecart etait
    // absorbe silencieusement dans le CA -> impossible de tracer les manques.
    const DISCREPANCY_THRESHOLD = 5;
    if (Math.abs(difference) > DISCREPANCY_THRESHOLD && !differenceReason) {
      const err = new Error(`Motif d'ecart obligatoire (ecart de ${difference.toFixed(2)} DH > seuil ${DISCREPANCY_THRESHOLD} DH)`);
      (err as Error & { code?: string }).code = 'DIFFERENCE_REASON_REQUIRED';
      throw err;
    }
    const validReasons = ['rendu_monnaie', 'vol', 'erreur_comptage', 'depense_hors_paidout', 'autre'];
    if (differenceReason && !validReasons.includes(differenceReason)) {
      const err = new Error(`Motif d'ecart invalide : ${differenceReason}`);
      (err as Error & { code?: string }).code = 'DIFFERENCE_REASON_INVALID';
      throw err;
    }

    // locked_at pose la cloture inviolable : les endpoints qui updaten la
    // session doivent verifier locked_at IS NULL. Le Z-report devient Z-final.
    const client = await db.getClient();
    try {
      await client.query('BEGIN');
      const updated = await client.query(
        `UPDATE cash_register_sessions SET
          actual_amount = $1, difference = $2, notes = $3,
          difference_reason = $5,
          status = 'closed', closed_at = NOW(),
          locked_at = NOW()
        WHERE id = $4 AND status = 'open' AND locked_at IS NULL RETURNING *`,
        [actualAmount, difference, notes || null, sessionId, differenceReason || null]
      );
      const row = updated.rows[0];
      if (!row) {
        await client.query('ROLLBACK');
        return null;
      }

      // Section 4.3 — Ecart de caisse comptabilise (658/758) au lieu d'etre
      // silencieusement absorbe dans le CA. SAVEPOINT non bloquant : la
      // cloture reste valide meme si la generation ledger echoue (backfill
      // possible via /accounting endpoints).
      if (FLAGS.LEDGER_AUTOGEN && Math.abs(difference) > 5) {
        await client.query('SAVEPOINT closure_ledger');
        try {
          const entry = await fromClosureDiff(client, row);
          if (entry) await persistEntry(client, entry, { userId: session.user_id });
          await client.query('RELEASE SAVEPOINT closure_ledger');
        } catch (genErr) {
          await client.query('ROLLBACK TO SAVEPOINT closure_ledger');
          // eslint-disable-next-line no-console
          console.error('[ledger] generation echec ecart caisse', row.id,
            genErr instanceof Error ? genErr.message : genErr);
        }
      }
      await client.query('COMMIT');
      return row;
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  },
};
