import type { PoolClient } from 'pg';
import { db } from '../config/database.js';
import { nextDocumentNumber } from '../utils/document-number.js';
import { getUserTimezone } from '../utils/timezone.js';
import { FLAGS } from '../config/feature-flags.js';
import { postOrQueue, postGoodsReceiptsForPo } from '../services/ledger-posting.service.js';
import { fromInvoice, fromPaymentEmission, fromSale, persistEntry, autoLettrer, reverseEntriesForSource, regenerateInvoiceEntry, regeneratePaymentEntries, fromGoodsReceipt } from '../services/journal-generator.service.js';
import { round2, lineTvaAmount, headerTotalsFromLines } from '../utils/tva.js';
import { withActor, assertReasonCode, recordAction } from '../services/document-actions.service.js';

/**
 * Règle d'édition d'une facture reçue (mig 309, G-D6-08) : annulée = jamais ; réglée même
 * partiellement = jamais (correction par avoir). Les factures émises ne sont pas concernées.
 */
function assertInvoiceEditable(row: { invoice_type: string; validation_status: string }, paidAmount: number) {
  if (row.invoice_type !== 'received') return;
  const fail = (m: string) => { const e = new Error(m) as Error & { statusCode: number; code: string }; e.statusCode = 409; e.code = 'INVOICE_LOCKED'; throw e; };
  if (row.validation_status === 'cancelled') fail('Cette facture est annulée : elle ne se modifie plus.');
  if (paidAmount > 0.005) fail('Cette facture a déjà un règlement : elle ne se modifie plus, la correction passe par un avoir.');
}

/* ═══ Caisse / Daily Register ═══ */
export const caisseRepository = {
  async getRegister(year: number, month: number, storeId?: string) {
    const tz = getUserTimezone();
    const startDate = `${year}-${String(month).padStart(2, '0')}-01`;
    const lastDay = new Date(year, month, 0).getDate();
    const endDate = `${year}-${String(month).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;

    // Convention app : store_id NULL = paiement global (cree par un compte
    // sans magasin, ex. salaires payes par l'admin) -> visible dans toutes
    // les caisses, comme pour employees/salary_advances.
    const storeFilterP = storeId ? ' AND (p.store_id = $3 OR p.store_id IS NULL)' : '';
    const storeFilterS = storeId ? ' AND store_id = $3' : '';
    const baseParams = [startDate, endDate];
    const params = storeId ? [...baseParams, storeId] : baseParams;

    // All payments for the month — vue TRESORERIE (cash effectif).
    //
    // Cheques : on filtre sur cashed_at et on exclut ceux pas encore encaisses
    // (sinon ils apparaitraient dans Caisse/Resume du jour de signature alors
    // que le cash n'a pas encore quitte la banque). Le payment_date renvoye
    // est aussi remplace par cashed_at pour que le frontend buckete sur le
    // bon jour. Pour les autres methodes (cash/transfer), payment_date = date
    // d'effet, on garde tel quel.
    const payments = await db.query(
      `SELECT p.id,
              (CASE WHEN p.payment_method IN ('check', 'traite') THEN p.cashed_at ELSE p.payment_date END) AS payment_date,
              p.type, p.amount, p.payment_method, p.description, p.reference,
              s.name as supplier_name, ec.name as category_name, ec.type as category_type,
              e.first_name as employee_first_name, e.last_name as employee_last_name
       FROM payments p
       LEFT JOIN suppliers s ON s.id = p.supplier_id
       LEFT JOIN expense_categories ec ON ec.id = p.category_id
       LEFT JOIN employees e ON e.id = p.employee_id
       WHERE (p.payment_method NOT IN ('check', 'traite') OR p.cashed_at IS NOT NULL)
         AND (CASE WHEN p.payment_method IN ('check', 'traite') THEN p.cashed_at ELSE p.payment_date END) BETWEEN $1 AND $2
         ${storeFilterP}
       ORDER BY (CASE WHEN p.payment_method IN ('check', 'traite') THEN p.cashed_at ELSE p.payment_date END), p.created_at`,
      params
    );

    // Cash register sessions grouped by date (cashier-reported + system amounts)
    //
    // AUDIT C2/C4 : cash_caissiere = FLUX net de la session
    // (actual_amount - opening_amount), pas le tiroir brut. Sinon :
    //   - le fond de caisse etait recompte chaque jour comme une recette
    //     (1 000 DH x 30 j = +30 000 DH fictifs au report) ;
    //   - passation + fin_journee le meme jour empilaient le tiroir du matin.
    // On clamp a 0 vers le bas cote UI, mais on garde le signe brut ici pour
    // que la reconciliation reste juste (un tiroir final < ouverture = deficit
    // de session).
    const sessions = await db.query(
      `SELECT TO_CHAR(DATE(closed_at AT TIME ZONE '${tz}'), 'YYYY-MM-DD') as session_date,
              COALESCE(SUM(actual_amount - COALESCE(opening_amount, 0)), 0) as cash_caissiere,
              COALESCE(SUM(cash_revenue), 0) as cash_systeme,
              COALESCE(SUM(card_revenue), 0) as card_revenue,
              COALESCE(SUM(COALESCE(mobile_revenue, 0)), 0) as mobile_revenue,
              COUNT(*) as session_count
       FROM cash_register_sessions
       WHERE status = 'closed'
         AND DATE(closed_at AT TIME ZONE '${tz}') BETWEEN $1 AND $2${storeFilterS}
       GROUP BY DATE(closed_at AT TIME ZONE '${tz}')
       ORDER BY DATE(closed_at AT TIME ZONE '${tz}')`,
      params
    );

    // Daily sales totals with payment method breakdown (source of truth for cash/card).
    // Une vente a plus tard est rattachee au jour de son encaissement (paid_at)
    // et exclue tant qu'elle n'est pas encaissee.
    // On UNION ALL les saisies manuelles (matin+soir, montants `_reel`) — le temps
    // que le POS soit adopte. Voir migration 149.
    //
    // GARDE-FOU anti-double-comptage (audit C1) : quand une saisie manuelle
    // existe pour un (store, jour), elle est AUTORITAIRE. Les ventes POS de
    // ce meme (store, jour) sont EXCLUES pour eviter de comptabiliser le CA
    // deux fois. Meme regle que le journal-generator (fromSale l.306-313).
    const storeFilterManual = storeId ? ' AND store_id = $3' : '';
    const salesStoreFilter = storeId ? ' AND s.store_id = $3' : '';
    const sales = await db.query(
      `SELECT sale_date,
              SUM(total_sales) as total_sales,
              SUM(cash_sales) as cash_sales,
              SUM(card_sales) as card_sales,
              SUM(mobile_sales) as mobile_sales,
              SUM(sale_count) as sale_count
       FROM (
         SELECT TO_CHAR(DATE(COALESCE(s.paid_at, s.created_at) AT TIME ZONE '${tz}'), 'YYYY-MM-DD') as sale_date,
                COALESCE(SUM(s.total), 0) as total_sales,
                COALESCE(SUM(CASE WHEN s.payment_method = 'cash' THEN s.total
                                  WHEN s.payment_method = 'mixed' THEN COALESCE(s.cash_amount, 0)
                                  ELSE 0 END), 0) as cash_sales,
                COALESCE(SUM(CASE WHEN s.payment_method = 'card' THEN s.total
                                  WHEN s.payment_method = 'mixed' THEN COALESCE(s.card_amount, 0)
                                  ELSE 0 END), 0) as card_sales,
                COALESCE(SUM(CASE WHEN s.payment_method = 'mobile' THEN s.total ELSE 0 END), 0) as mobile_sales,
                COUNT(*) as sale_count
         FROM sales s
         WHERE s.payment_status IS DISTINCT FROM 'unpaid'
           AND DATE(COALESCE(s.paid_at, s.created_at) AT TIME ZONE '${tz}') BETWEEN $1 AND $2${salesStoreFilter}
           AND NOT EXISTS (
             SELECT 1 FROM manual_shift_entries mse
             WHERE mse.store_id = s.store_id
               AND mse.entry_date = DATE(COALESCE(s.paid_at, s.created_at) AT TIME ZONE '${tz}')
           )
         GROUP BY DATE(COALESCE(s.paid_at, s.created_at) AT TIME ZONE '${tz}')
         UNION ALL
         SELECT TO_CHAR(entry_date, 'YYYY-MM-DD') as sale_date,
                COALESCE(matin_cash_reel,0)+COALESCE(matin_carte_reel,0)+COALESCE(soir_cash_reel,0)+COALESCE(soir_carte_reel,0) as total_sales,
                COALESCE(matin_cash_reel,0)+COALESCE(soir_cash_reel,0) as cash_sales,
                COALESCE(matin_carte_reel,0)+COALESCE(soir_carte_reel,0) as card_sales,
                0 as mobile_sales,
                0 as sale_count
         FROM manual_shift_entries
         WHERE entry_date BETWEEN $1 AND $2${storeFilterManual}
       ) combined
       GROUP BY sale_date
       ORDER BY sale_date`,
      params
    );

    // Ancre admin : la correction de report la plus recente <= 1er du mois.
    // Si elle existe, le report = valeurs de l'ancre + flux entre l'ancre et
    // le 1er du mois (fenetre vide si l'ancre est le mois affiche lui-meme).
    const anchorRes = await db.query(
      `SELECT TO_CHAR(effective_month, 'YYYY-MM-DD') as effective_month, cash_net, card_cumul, note
       FROM caisse_balance_overrides
       WHERE effective_month <= $1::date
         AND ${storeId ? 'store_id = $2' : 'store_id IS NULL'}
       ORDER BY effective_month DESC LIMIT 1`,
      storeId ? [startDate, storeId] : [startDate]
    );
    const anchor = anchorRes.rows[0] || null;
    // Borne basse des fenetres "historique avant le mois" (epoch si pas d'ancre)
    const sinceDate = anchor ? anchor.effective_month : '1970-01-01';

    // Previous balance: payments in [anchor, start of month)
    const prevStoreFilter = storeId ? ' AND (p.store_id = $3 OR p.store_id IS NULL)' : '';
    const prevParams = storeId ? [startDate, sinceDate, storeId] : [startDate, sinceDate];

    // Solde reporte : meme logique tresorerie que la requete principale.
    // Cheques non encaisses exclus ; effective_date utilisee pour le filtre.
    const prevPayments = await db.query(
      `SELECT
        COALESCE(SUM(CASE WHEN p.type = 'income' AND p.payment_method = 'cash' THEN p.amount ELSE 0 END), 0) as cash_entries,
        COALESCE(SUM(CASE WHEN p.type = 'income' AND p.payment_method != 'cash' THEN p.amount ELSE 0 END), 0) as bank_entries,
        COALESCE(SUM(CASE WHEN p.type != 'income' AND p.payment_method = 'cash' THEN p.amount ELSE 0 END), 0) as cash_exits,
        COALESCE(SUM(CASE WHEN p.type != 'income' AND p.payment_method != 'cash' THEN p.amount ELSE 0 END), 0) as bank_exits
       FROM payments p
       WHERE (p.payment_method NOT IN ('check', 'traite') OR p.cashed_at IS NOT NULL)
         AND (CASE WHEN p.payment_method IN ('check', 'traite') THEN p.cashed_at ELSE p.payment_date END) < $1
         AND (CASE WHEN p.payment_method IN ('check', 'traite') THEN p.cashed_at ELSE p.payment_date END) >= $2
         ${prevStoreFilter}`,
      prevParams
    );

    // Previous balance: cash register sessions in [anchor, start of month)
    const prevStoreFilterS = storeId ? ' AND store_id = $3' : '';
    const prevSessionParams = storeId ? [startDate, sinceDate, storeId] : [startDate, sinceDate];

    // Meme correction C2 sur le report : flux net (actual - opening) plutot
    // que le stock brut du tiroir.
    const prevSessions = await db.query(
      `SELECT COALESCE(SUM(actual_amount - COALESCE(opening_amount, 0)), 0) as cash_total
       FROM cash_register_sessions
       WHERE status = 'closed'
         AND DATE(closed_at AT TIME ZONE '${tz}') < $1
         AND DATE(closed_at AT TIME ZONE '${tz}') >= $2${prevStoreFilterS}`,
      prevSessionParams
    );

    // Previous sales totals (cash + card) from actual sales + saisies manuelles
    // Meme garde-fou C1 : les ventes POS d'un jour deja couvert par une saisie
    // manuelle sont exclues pour eviter le double-comptage.
    const prevSalesFilterS = storeId ? ' AND store_id = $3' : '';
    const prevSalesFilterSAliased = storeId ? ' AND s.store_id = $3' : '';
    const prevSalesParams = storeId ? [startDate, sinceDate, storeId] : [startDate, sinceDate];

    // C3 — Segmenter les 3 sources pour eviter le double-comptage :
    //   1. Sessions POS closes : cash_flow (actual - opening) — deja calcule
    //      dans prevSessionCash.
    //   2. Saisies manuelles : cash/card reel des shifts saisis.
    //   3. Ventes POS sans session ni saisie manuelle (cas rare : session
    //      supprimee, cheval de bataille legacy) : cash/card des ventes.
    // Avant : la ternaire prevSessionCash > 0 ? prevSessionCash : prevSalesCash
    // ignorait 30 j de saisies manuelles des qu'UNE session de test existait.
    const prevSales = await db.query(
      `SELECT
        SUM(cash_total) as cash_total,
        SUM(card_total) as card_total
       FROM (
         SELECT
           COALESCE(SUM(CASE WHEN s.payment_method = 'cash' THEN s.total
                             WHEN s.payment_method = 'mixed' THEN COALESCE(s.cash_amount, 0)
                             ELSE 0 END), 0) as cash_total,
           COALESCE(SUM(CASE WHEN s.payment_method = 'card' THEN s.total
                             WHEN s.payment_method = 'mixed' THEN COALESCE(s.card_amount, 0)
                             ELSE 0 END), 0) as card_total
         FROM sales s
         WHERE s.payment_status IS DISTINCT FROM 'unpaid'
           AND DATE(COALESCE(s.paid_at, s.created_at) AT TIME ZONE '${tz}') < $1
           AND DATE(COALESCE(s.paid_at, s.created_at) AT TIME ZONE '${tz}') >= $2${prevSalesFilterSAliased}
           AND NOT EXISTS (
             SELECT 1 FROM manual_shift_entries mse
             WHERE mse.store_id = s.store_id
               AND mse.entry_date = DATE(COALESCE(s.paid_at, s.created_at) AT TIME ZONE '${tz}')
           )
           -- C3 — Aussi exclure les jours qui ont deja une session close : sinon
           -- prevSessionCash (cash_flow) + prevSalesCash (cash_sales) comptent
           -- le meme tiroir deux fois pour ces jours-la.
           AND NOT EXISTS (
             SELECT 1 FROM cash_register_sessions crs
             WHERE crs.status = 'closed'
               AND crs.store_id = s.store_id
               AND DATE(crs.closed_at AT TIME ZONE '${tz}') = DATE(COALESCE(s.paid_at, s.created_at) AT TIME ZONE '${tz}')
           )
         UNION ALL
         SELECT
           COALESCE(SUM(COALESCE(matin_cash_reel,0)+COALESCE(soir_cash_reel,0)), 0) as cash_total,
           COALESCE(SUM(COALESCE(matin_carte_reel,0)+COALESCE(soir_carte_reel,0)), 0) as card_total
         FROM manual_shift_entries
         WHERE entry_date < $1 AND entry_date >= $2${prevSalesFilterS}
       ) combined`,
      prevSalesParams
    );

    const cashEntries = parseFloat(prevPayments.rows[0].cash_entries);
    const bankEntries = parseFloat(prevPayments.rows[0].bank_entries);
    const cashExits = parseFloat(prevPayments.rows[0].cash_exits);
    const bankExits = parseFloat(prevPayments.rows[0].bank_exits);
    const prevSessionCash = parseFloat(prevSessions.rows[0].cash_total);
    const prevSalesCash = parseFloat(prevSales.rows[0].cash_total);
    const prevCardSales = parseFloat(prevSales.rows[0].card_total);

    // C3 — Somme des 3 sources complementaires (garanties disjointes par les
    // NOT EXISTS de prevSales : sessions | manual | POS-sans-l'un-ni-l'autre).
    const prevCash = prevSessionCash + prevSalesCash;
    const anchorCash = anchor ? parseFloat(anchor.cash_net) : 0;
    const anchorCard = anchor ? parseFloat(anchor.card_cumul) : 0;

    // Detect discrepancies between session-reported cash and system cash sales
    const DISCREPANCY_THRESHOLD = 5; // DH — ignore rounding differences
    const reconciliationAlerts: { date: string; cashCaissiere: number; cashSysteme: number; ecart: number }[] = [];

    for (const session of sessions.rows) {
      const cashCaissiere = parseFloat(session.cash_caissiere);
      const cashSysteme = parseFloat(session.cash_systeme);
      const ecart = cashCaissiere - cashSysteme;
      if (Math.abs(ecart) > DISCREPANCY_THRESHOLD) {
        reconciliationAlerts.push({
          date: session.session_date,
          cashCaissiere,
          cashSysteme,
          ecart,
        });
      }
    }

    return {
      payments: payments.rows,
      sessions: sessions.rows,
      sales: sales.rows,
      reconciliationAlerts,
      previousBalance: {
        cashNet: anchorCash + cashEntries + prevCash - cashExits,
        cardCumul: anchorCard + prevCardSales + bankEntries - bankExits,
      },
      // Ajustement exact du mois affiche (pour pre-remplir/supprimer cote UI) ;
      // une ancre d'un mois anterieur influence le report sans etre renvoyee ici.
      reportOverride: anchor && sinceDate === startDate
        ? { cashNet: anchorCash, cardCumul: anchorCard, note: anchor.note }
        : null,
    };
  },

  /** Fixe le report du mois (year/month) — upsert par (mois, magasin). */
  async saveBalanceOverride(data: {
    year: number; month: number; storeId?: string;
    cashNet: number; cardCumul: number; note?: string; userId?: string;
  }) {
    const effectiveMonth = `${data.year}-${String(data.month).padStart(2, '0')}-01`;
    const result = await db.query(
      `INSERT INTO caisse_balance_overrides (effective_month, store_id, cash_net, card_cumul, note, created_by)
       VALUES ($1, $2, $3::numeric, $4::numeric, $5, $6)
       ON CONFLICT (effective_month, COALESCE(store_id, '00000000-0000-0000-0000-000000000000'::uuid))
       DO UPDATE SET cash_net = EXCLUDED.cash_net, card_cumul = EXCLUDED.card_cumul,
                     note = EXCLUDED.note, created_by = EXCLUDED.created_by, updated_at = NOW()
       RETURNING *`,
      [effectiveMonth, data.storeId || null, data.cashNet, data.cardCumul, data.note || null, data.userId || null]
    );
    return result.rows[0];
  },

  /** Supprime l'ajustement du mois — le report redevient calcule. */
  async deleteBalanceOverride(year: number, month: number, storeId?: string) {
    const effectiveMonth = `${year}-${String(month).padStart(2, '0')}-01`;
    await db.query(
      `DELETE FROM caisse_balance_overrides
       WHERE effective_month = $1 AND ${storeId ? 'store_id = $2' : 'store_id IS NULL'}`,
      storeId ? [effectiveMonth, storeId] : [effectiveMonth]
    );
  },
};

/* ═══ Suppliers ═══ */
// Déplacé dans supplier.repository.ts (refonte Achats D1, mig 304) ; ré-exporté pour les imports existants.
export { supplierRepository } from './supplier.repository.js';

/* ═══ Expense Categories (hierarchical) ═══ */
export const expenseCategoryRepository = {
  async findAll() {
    const result = await db.query(
      `SELECT ec.*, p.name as parent_name
       FROM expense_categories ec
       LEFT JOIN expense_categories p ON p.id = ec.parent_id
       WHERE ec.is_active = true
       ORDER BY ec.level, ec.display_order, ec.name`
    );
    return result.rows;
  },
  async findAllTree() {
    const result = await db.query(
      `SELECT ec.*, p.name as parent_name
       FROM expense_categories ec
       LEFT JOIN expense_categories p ON p.id = ec.parent_id
       ORDER BY ec.level, ec.display_order, ec.name`
    );
    return result.rows;
  },
  async findById(id: string) {
    const result = await db.query('SELECT * FROM expense_categories WHERE id = $1', [id]);
    return result.rows[0] || null;
  },
  async findByLevel(level: number) {
    const result = await db.query(
      'SELECT * FROM expense_categories WHERE level = $1 AND is_active = true ORDER BY display_order, name',
      [level]
    );
    return result.rows;
  },
  async findChildren(parentId: string) {
    const result = await db.query(
      'SELECT * FROM expense_categories WHERE parent_id = $1 AND is_active = true ORDER BY display_order, name',
      [parentId]
    );
    return result.rows;
  },
  async create(data: { name: string; description?: string; parent_id?: string; level?: number; requires_po?: boolean; display_order?: number }) {
    const level = data.level || (data.parent_id ? 2 : 1);
    const result = await db.query(
      `INSERT INTO expense_categories (name, type, description, parent_id, level, requires_po, display_order)
       VALUES ($1, 'expense', $2, $3, $4, $5, $6) RETURNING *`,
      [data.name, data.description || null, data.parent_id || null, level,
       data.requires_po ?? false, data.display_order || 0]
    );
    return result.rows[0];
  },
  async update(id: string, data: Record<string, unknown>) {
    const mapping: Record<string, string> = {
      name: 'name', description: 'description', parent_id: 'parent_id',
      level: 'level', requires_po: 'requires_po', display_order: 'display_order', is_active: 'is_active',
    };
    const fields: string[] = []; const values: unknown[] = []; let i = 1;
    for (const [key, col] of Object.entries(mapping)) {
      if (data[key] !== undefined) { fields.push(`${col} = $${i++}`); values.push(data[key]); }
    }
    if (fields.length === 0) return null;
    values.push(id);
    const result = await db.query(`UPDATE expense_categories SET ${fields.join(', ')} WHERE id = $${i} RETURNING *`, values);
    return result.rows[0];
  },
  async deactivate(id: string) {
    // Soft-delete: deactivate self + all children recursively
    await db.query(`
      WITH RECURSIVE tree AS (
        SELECT id FROM expense_categories WHERE id = $1
        UNION ALL
        SELECT ec.id FROM expense_categories ec JOIN tree t ON ec.parent_id = t.id
      )
      UPDATE expense_categories SET is_active = false WHERE id IN (SELECT id FROM tree)
    `, [id]);
  },
  async delete(id: string) {
    await db.query('UPDATE expense_categories SET is_active = false WHERE id = $1', [id]);
  },
};

/* ═══ Revenue Categories (hierarchical) ═══ */
export const revenueCategoryRepository = {
  async findAll() {
    const result = await db.query(
      `SELECT rc.*, p.name as parent_name
       FROM revenue_categories rc
       LEFT JOIN revenue_categories p ON p.id = rc.parent_id
       WHERE rc.is_active = true
       ORDER BY rc.level, rc.display_order, rc.name`
    );
    return result.rows;
  },
  async findAllTree() {
    const result = await db.query(
      `SELECT rc.*, p.name as parent_name
       FROM revenue_categories rc
       LEFT JOIN revenue_categories p ON p.id = rc.parent_id
       ORDER BY rc.level, rc.display_order, rc.name`
    );
    return result.rows;
  },
  async findById(id: string) {
    const result = await db.query('SELECT * FROM revenue_categories WHERE id = $1', [id]);
    return result.rows[0] || null;
  },
  async findChildren(parentId: string) {
    const result = await db.query(
      'SELECT * FROM revenue_categories WHERE parent_id = $1 AND is_active = true ORDER BY display_order, name',
      [parentId]
    );
    return result.rows;
  },
  async create(data: { name: string; description?: string; parent_id?: string; level?: number; display_order?: number }) {
    const level = data.level || (data.parent_id ? 2 : 1);
    const result = await db.query(
      `INSERT INTO revenue_categories (name, description, parent_id, level, display_order)
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [data.name, data.description || null, data.parent_id || null, level, data.display_order || 0]
    );
    return result.rows[0];
  },
  async update(id: string, data: Record<string, unknown>) {
    const mapping: Record<string, string> = {
      name: 'name', description: 'description', parent_id: 'parent_id',
      level: 'level', display_order: 'display_order', is_active: 'is_active',
    };
    const fields: string[] = []; const values: unknown[] = []; let i = 1;
    for (const [key, col] of Object.entries(mapping)) {
      if (data[key] !== undefined) { fields.push(`${col} = $${i++}`); values.push(data[key]); }
    }
    if (fields.length === 0) return null;
    values.push(id);
    const result = await db.query(`UPDATE revenue_categories SET ${fields.join(', ')} WHERE id = $${i} RETURNING *`, values);
    return result.rows[0];
  },
  async deactivate(id: string) {
    await db.query(`
      WITH RECURSIVE tree AS (
        SELECT id FROM revenue_categories WHERE id = $1
        UNION ALL
        SELECT rc.id FROM revenue_categories rc JOIN tree t ON rc.parent_id = t.id
      )
      UPDATE revenue_categories SET is_active = false WHERE id IN (SELECT id FROM tree)
    `, [id]);
  },
  async delete(id: string) {
    await db.query('UPDATE revenue_categories SET is_active = false WHERE id = $1', [id]);
  },
};

/* ═══ Invoices ═══ */
export const invoiceRepository = {
  async findAll(params: { supplierId?: string; customerId?: string; status?: string; dateFrom?: string; dateTo?: string; storeId?: string; invoiceType?: string }) {
    const conditions: string[] = []; const values: unknown[] = []; let i = 1;
    const invoiceType = params.invoiceType || 'received';
    conditions.push(`inv.invoice_type = $${i++}`); values.push(invoiceType);
    if (params.storeId) { conditions.push(`inv.store_id = $${i++}`); values.push(params.storeId); }
    if (params.supplierId) { conditions.push(`inv.supplier_id = $${i++}`); values.push(params.supplierId); }
    if (params.customerId) { conditions.push(`inv.customer_id = $${i++}`); values.push(params.customerId); }
    if (params.status) { conditions.push(`inv.status = $${i++}`); values.push(params.status); }
    if (params.dateFrom) { conditions.push(`inv.invoice_date >= $${i++}`); values.push(params.dateFrom); }
    if (params.dateTo) { conditions.push(`inv.invoice_date <= $${i++}`); values.push(params.dateTo); }
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

    const result = await db.query(
      `SELECT inv.*,
              s.name as supplier_name,
              c.first_name as customer_first_name, c.last_name as customer_last_name, c.phone as customer_phone,
              ec.name as category_name,
              po.order_number as purchase_order_number,
              rv.voucher_number as reception_voucher_number,
              o.order_number as order_number_ref,
              -- Contrôle (mig 309) : blocages ouverts, dont bloquants pour le paiement.
              (SELECT count(*) FROM invoice_holds h WHERE h.invoice_id = inv.id AND h.released_at IS NULL)::int AS open_holds,
              (SELECT count(*) FROM invoice_holds h WHERE h.invoice_id = inv.id AND h.released_at IS NULL AND h.blocks_payment)::int AS blocking_holds
       FROM invoices inv
       LEFT JOIN suppliers s ON s.id = inv.supplier_id
       LEFT JOIN customers c ON c.id = inv.customer_id
       LEFT JOIN expense_categories ec ON ec.id = inv.category_id
       LEFT JOIN purchase_orders po ON po.id = inv.purchase_order_id
       LEFT JOIN reception_vouchers rv ON rv.id = inv.reception_voucher_id
       LEFT JOIN orders o ON o.id = inv.order_id
       ${where}
       ORDER BY inv.invoice_date DESC`,
      values
    );
    return result.rows;
  },

  /**
   * Factures reçues par étape du processus (écran Factures) : paginé, filtré côté
   * serveur. view=open → à traiter (brouillon, bloquée/litige, à payer, partielle) ;
   * view=history → réglées et annulées. Totaux calculés sur tout le filtre.
   */
  async findReceivedBoard(params: {
    storeId?: string; view: 'open' | 'history'; stage?: string; status?: string;
    supplierId?: string; categoryId?: string; search?: string; dateFrom?: string; dateTo?: string;
    sort: string; dir: 'asc' | 'desc'; limit: number; offset: number;
  }) {
    const values: unknown[] = [];
    const add = (v: unknown) => { values.push(v); return `$${values.length}`; };
    const cond: string[] = [params.view === 'history' ? `stage IN ('paid', 'cancelled')` : `stage NOT IN ('paid', 'cancelled')`];
    if (params.stage) cond.push(`stage = ${add(params.stage)}`);
    // Statuts « métier » : late / blocked / to_check sont dérivés, les autres sont des valeurs de status.
    if (params.status === 'late') cond.push('is_late');
    else if (params.status === 'blocked') cond.push('blocking_holds > 0');
    else if (params.status === 'to_check') cond.push('open_holds > blocking_holds');
    else if (params.status === 'pending') cond.push(`status IN ('pending', 'overdue')`);
    else if (params.status) cond.push(`status = ${add(params.status)}`);
    if (params.supplierId) cond.push(`supplier_id = ${add(params.supplierId)}`);
    if (params.categoryId) cond.push(`category_id = ${add(params.categoryId)}`);
    if (params.search) {
      const p = add(`%${params.search}%`);
      cond.push(`(invoice_number ILIKE ${p} OR COALESCE(supplier_invoice_number, '') ILIKE ${p} OR COALESCE(supplier_name, '') ILIKE ${p}
                 OR COALESCE(purchase_order_number, '') ILIKE ${p} OR COALESCE(category_name, '') ILIKE ${p})`);
    }
    if (params.dateFrom) cond.push(`invoice_date >= ${add(params.dateFrom)}::date`);
    if (params.dateTo) cond.push(`invoice_date <= ${add(params.dateTo)}::date`);
    const SORTS: Record<string, string> = {
      invoice_date: 'invoice_date', due_date: 'due_date', total_amount: 'total_amount',
      supplier_name: 'supplier_name', invoice_number: 'invoice_number', category_name: 'category_name',
    };
    const dir = params.dir === 'asc' ? 'ASC' : 'DESC';
    // Défaut « à traiter » : retards puis échéance la plus proche ; historique : plus récentes.
    const orderBy = params.sort === 'urgency'
      ? 'is_late DESC, due_date ASC NULLS LAST, invoice_date DESC'
      : `${SORTS[params.sort] ?? 'invoice_date'} ${dir} NULLS LAST, created_at DESC`;
    const cte = this._receivedStagedCte(params.storeId ? add(params.storeId) : null);
    const limit = add(params.limit);
    const offset = add(params.offset);
    const result = await db.query(
      `${cte}, filtered AS (SELECT * FROM staged WHERE ${cond.join(' AND ')})
       SELECT f.*, COUNT(*) OVER() AS total_count,
              SUM(total_amount) OVER() AS sum_total,
              SUM(CASE WHEN stage <> 'cancelled' THEN total_amount - paid_amount ELSE 0 END) OVER() AS sum_remaining
       FROM filtered f
       ORDER BY ${orderBy}
       LIMIT ${limit} OFFSET ${offset}`,
      values
    );
    const first = result.rows[0];
    return {
      rows: result.rows.map(({ total_count: _a, sum_total: _b, sum_remaining: _c, ...r }) => r),
      total: first ? parseInt(first.total_count, 10) : 0,
      sumTotal: first ? Number(first.sum_total) : 0,
      sumRemaining: first ? Number(first.sum_remaining) : 0,
    };
  },

  /** Compteurs par étape, factures en retard de paiement et catégories utilisées. */
  async receivedPipeline(storeId?: string) {
    const values: unknown[] = storeId ? [storeId] : [];
    const cte = this._receivedStagedCte(storeId ? '$1' : null);
    const [stages, late, categories] = await Promise.all([
      db.query(
        `${cte}
         SELECT stage, COUNT(*)::int AS count,
                COALESCE(SUM(total_amount), 0) AS amount,
                COALESCE(SUM(total_amount - paid_amount), 0) AS remaining,
                COUNT(*) FILTER (WHERE is_late)::int AS late_count
         FROM staged GROUP BY stage`,
        values
      ),
      db.query(
        `${cte}
         SELECT id, invoice_number, supplier_name, due_date, total_amount - paid_amount AS remaining,
                (CURRENT_DATE - due_date::date)::int AS days_late
         FROM staged WHERE is_late ORDER BY due_date ASC LIMIT 5`,
        values
      ),
      db.query(
        `${cte}
         SELECT category_id AS id, category_name AS name, COUNT(*)::int AS count
         FROM staged WHERE category_id IS NOT NULL
         GROUP BY category_id, category_name ORDER BY category_name`,
        values
      ),
    ]);
    return { stages: stages.rows, late: late.rows, categories: categories.rows };
  },

  /** CTE commune : factures reçues + blocages + étape du processus. */
  _receivedStagedCte(storeParam: string | null) {
    return `WITH base AS (
        SELECT inv.*,
               s.name AS supplier_name,
               ec.name AS category_name,
               po.order_number AS purchase_order_number,
               (SELECT count(*) FROM invoice_holds h WHERE h.invoice_id = inv.id AND h.released_at IS NULL)::int AS open_holds,
               (SELECT count(*) FROM invoice_holds h WHERE h.invoice_id = inv.id AND h.released_at IS NULL AND h.blocks_payment)::int AS blocking_holds
        FROM invoices inv
        LEFT JOIN suppliers s ON s.id = inv.supplier_id
        LEFT JOIN expense_categories ec ON ec.id = inv.category_id
        LEFT JOIN purchase_orders po ON po.id = inv.purchase_order_id
        WHERE inv.invoice_type = 'received' ${storeParam ? `AND inv.store_id = ${storeParam}` : ''}
      ), staged AS (
        SELECT base.*,
               CASE
                 WHEN status = 'cancelled' OR validation_status = 'cancelled' THEN 'cancelled'
                 WHEN status = 'paid' THEN 'paid'
                 WHEN validation_status = 'draft' THEN 'draft'
                 WHEN status = 'disputed' OR blocking_holds > 0 THEN 'blocked'
                 WHEN status = 'partial' THEN 'partial'
                 ELSE 'to_pay'
               END AS stage,
               (status NOT IN ('paid', 'cancelled')
                 AND (status = 'overdue' OR (due_date IS NOT NULL AND due_date::date < CURRENT_DATE))) AS is_late
        FROM base
      )`;
  },

  async findById(id: string) {
    const result = await db.query(
      `SELECT inv.*,
              s.name as supplier_name, s.phone as supplier_phone, s.ice as supplier_ice, s.address as supplier_address, s.city as supplier_city,
              c.first_name as customer_first_name, c.last_name as customer_last_name, c.phone as customer_phone, c.email as customer_email,
              c.company_name as customer_company_name, c.customer_type as customer_type,
              c.address as customer_address, c.city as customer_city,
              c.ice as customer_ice, c.if_fiscal as customer_if, c.rc as customer_rc,
              ec.name as category_name,
              po.order_number as purchase_order_number,
              rv.voucher_number as reception_voucher_number
       FROM invoices inv
       LEFT JOIN suppliers s ON s.id = inv.supplier_id
       LEFT JOIN customers c ON c.id = inv.customer_id
       LEFT JOIN expense_categories ec ON ec.id = inv.category_id
       LEFT JOIN purchase_orders po ON po.id = inv.purchase_order_id
       LEFT JOIN reception_vouchers rv ON rv.id = inv.reception_voucher_id
       WHERE inv.id = $1`, [id]
    );
    if (!result.rows[0]) return null;

    // Get invoice items
    const itemsResult = await db.query(
      `SELECT ii.*, p.name as product_name, COALESCE(ing.name, pkg.name) as ingredient_name
       FROM invoice_items ii
       LEFT JOIN products p ON p.id = ii.product_id
       LEFT JOIN ingredients ing ON ing.id = ii.ingredient_id
       LEFT JOIN packaging_items pkg ON pkg.id = ii.packaging_id
       WHERE ii.invoice_id = $1
       ORDER BY ii.created_at`, [id]
    );

    // Get payments linked to this invoice
    const paymentsResult = await db.query(
      `SELECT p.* FROM payments p WHERE p.invoice_id = $1 ORDER BY p.payment_date DESC`, [id]
    );

    return { ...result.rows[0], items: itemsResult.rows, payments: paymentsResult.rows };
  },

  async generateInvoiceNumber(type: 'received' | 'emitted', client?: { query: (text: string, params?: unknown[]) => Promise<{ rows: Record<string, unknown>[] }> }): Promise<string> {
    // Series « invoice_received » / « invoice_emitted » (mig 329). L'ancien
    // COUNT(*)+1 reattribuait un numero existant apres une suppression et comptait
    // les numeros fournisseurs saisis. Le client transactionnel est requis pour
    // une numerotation continue des factures emises (ROLLBACK = numero rendu).
    return nextDocumentNumber(client ?? db, type === 'received' ? 'invoice_received' : 'invoice_emitted');
  },

  async create(data: {
    invoiceNumber?: string; invoiceType?: string;
    supplierId?: string; customerId?: string; categoryId?: string;
    purchaseOrderId?: string; receptionVoucherId?: string; orderId?: string;
    invoiceDate: string; dueDate?: string; amount: number;
    taxAmount?: number; totalAmount?: number; notes?: string; createdBy: string; storeId?: string;
    expectedPaymentMode?: string; receptionDate?: string;
    checkNumber?: string;
    items?: { productId?: string; ingredientId?: string; description?: string; quantity: number; unitPrice: number; subtotal: number; tvaRate?: number | null }[];
  }) {
    const client = await db.getClient();
    try {
      await client.query('BEGIN');

      const invoiceType = data.invoiceType || 'received';
      const invoiceNumber = data.invoiceNumber || await this.generateInvoiceNumber(invoiceType as 'received' | 'emitted', client);

      // Si des lignes portent un taux de TVA explicite, elles font foi :
      // HT/TVA/TTC d'en-tete sont derives de la somme des lignes (sinon on
      // respecte les montants d'en-tete fournis par l'appelant).
      let headerAmount = data.amount || 0;
      let headerTax = data.taxAmount || 0;
      if (data.items && data.items.length > 0) {
        const t = headerTotalsFromLines(data.items);
        if (t.hasPerLineTva) {
          headerAmount = t.amount;
          headerTax = t.taxAmount as number;
        }
      }
      const totalAmount = data.totalAmount || (headerAmount + headerTax);

      const invResult = await client.query(
        `INSERT INTO invoices (invoice_number, invoice_type, supplier_id, customer_id, category_id,
          purchase_order_id, reception_voucher_id, order_id,
          invoice_date, due_date, amount, tax_amount, total_amount, notes, created_by, store_id,
          expected_payment_mode, reception_date, check_number)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19) RETURNING *`,
        [invoiceNumber, invoiceType, data.supplierId || null, data.customerId || null,
         data.categoryId || null, data.purchaseOrderId || null, data.receptionVoucherId || null,
         data.orderId || null, data.invoiceDate, data.dueDate || null,
         headerAmount, headerTax, totalAmount,
         data.notes || null, data.createdBy, data.storeId || null,
         data.expectedPaymentMode || null, data.receptionDate || null,
         data.checkNumber || null]
      );

      // Insert invoice items if provided
      if (data.items && data.items.length > 0) {
        for (const item of data.items) {
          const tvaRate = item.tvaRate ?? null;
          const tvaAmount = lineTvaAmount(item.subtotal, tvaRate);
          await client.query(
            `INSERT INTO invoice_items (invoice_id, product_id, ingredient_id, description, quantity, unit_price, subtotal, tva_rate, tva_amount)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
            [invResult.rows[0].id, item.productId || null, item.ingredientId || null,
             item.description || null, item.quantity, item.unitPrice, item.subtotal, tvaRate, tvaAmount]
          );
        }
      }

      // Generation auto de l'ecriture comptable (LEDGER_AUTOGEN)
      // SAVEPOINT pour isoler : si la generation echoue, la facture reste
      // creee, l'ecriture sera regeneree par le job de reconciliation.
      // Mig 311 (G-D8-01) : comptabilisation obligatoire ; un échec part en file d'attente
      // (ledger_outbox) ou annule la pièce en mode strict — plus d'échec silencieux.
      await postOrQueue(client, { kind: 'invoice', id: invResult.rows[0].id }, async () => {
        const entry = await fromInvoice(client, invResult.rows[0]);
        if (entry) {
        await persistEntry(client, entry, { userId: data.createdBy });
        }
      });

      await client.query('COMMIT');
      return invResult.rows[0];
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  },

  async createFromOrder(orderId: string, createdBy: string, storeId?: string) {
    const client = await db.getClient();
    try {
      await client.query('BEGIN');

      // Get order + items
      const orderResult = await client.query(
        `SELECT o.*, c.first_name as customer_first_name, c.last_name as customer_last_name
         FROM orders o LEFT JOIN customers c ON c.id = o.customer_id WHERE o.id = $1`, [orderId]
      );
      const order = orderResult.rows[0];
      if (!order) throw new Error('Commande non trouvee');

      const itemsResult = await client.query(
        `SELECT oi.*, p.name as product_name FROM order_items oi
         JOIN products p ON p.id = oi.product_id WHERE oi.order_id = $1`, [orderId]
      );

      const invoiceNumber = await this.generateInvoiceNumber('emitted', client);

      const invResult = await client.query(
        `INSERT INTO invoices (invoice_number, invoice_type, customer_id, order_id,
          invoice_date, amount, tax_amount, total_amount, notes, created_by, store_id)
         VALUES ($1, 'emitted', $2, $3, CURRENT_DATE, $4, $5, $6, $7, $8, $9) RETURNING *`,
        [invoiceNumber, order.customer_id, orderId,
         parseFloat(order.subtotal), parseFloat(order.tax_amount),
         parseFloat(order.total),
         `Facture generee depuis commande ${order.order_number}`,
         createdBy, storeId || null]
      );

      for (const item of itemsResult.rows) {
        await client.query(
          `INSERT INTO invoice_items (invoice_id, product_id, description, quantity, unit_price, subtotal)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [invResult.rows[0].id, item.product_id, item.product_name,
           item.quantity, parseFloat(item.unit_price), parseFloat(item.subtotal)]
        );
      }

      // Generation de l'ecriture de facture client (pattern B : 3421 / 7111 + TVA).
      // Mig 311 (G-D8-01) : comptabilisation obligatoire ; un échec part en file d'attente
      // (ledger_outbox) ou annule la pièce en mode strict — plus d'échec silencieux.
      await postOrQueue(client, { kind: 'invoice', id: invResult.rows[0].id }, async () => {
        const entry = await fromInvoice(client, invResult.rows[0]);
        if (entry) await persistEntry(client, entry, { userId: createdBy });
      });

      await client.query('COMMIT');
      return invResult.rows[0];
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  },

  /**
   * Fusionne les factures fournisseurs des BCs passes en parametre en une seule
   * facture. Regle metier classique : un fournisseur peut livrer plusieurs BCs
   * en une fois avec une seule facture (un seul N° facture). Apres reception
   * separee de chaque BC, l'utilisateur peut consolider via cette fonction.
   *
   * Garde-fous :
   *   - Tous les BCs doivent etre du MEME fournisseur.
   *   - Aucune des factures concernees ne doit avoir de paiement enregistre
   *     (sinon il faudrait re-router les paiements vers la facture maitre,
   *     ce qui complique le rapprochement comptable — refus explicite).
   *   - Au moins 2 factures distinctes (sinon rien a fusionner).
   *
   * Strategie :
   *   - On prend la premiere facture comme maitre.
   *   - On reaffecte ses invoice_items + ceux des autres vers la maitre.
   *   - On recalcule amount / total_amount via SUM des subtotals.
   *   - On lie tous les BCs a la maitre via invoice_purchase_orders.
   *   - On supprime les autres factures (CASCADE nettoie leurs items).
   *   - On met a jour le N° facture fournisseur (supplier_invoice_number sur
   *     les reception_vouchers des BCs concernes, pour la coherence).
   */
  async mergeForPurchaseOrders(
    purchaseOrderIds: string[],
    options: { supplierInvoiceNumber?: string; invoiceDate?: string; createdBy: string; storeId?: string | null }
  ): Promise<Record<string, unknown>> {
    if (purchaseOrderIds.length < 2) {
      throw new Error('Selectionnez au moins 2 BCs a fusionner.');
    }

    const client = await db.getClient();
    try {
      await client.query('BEGIN');

      // Fusion = réécriture contrôlée de factures validées (mig 309) : contexte explicite.
      await client.query(`SELECT set_config('app.invoice_edit', 'on', true)`);

      // 0. Pre-generer une facture pour les BCs partiels sans facture. On
      //    importe la fonction dynamiquement pour eviter une dependance
      //    circulaire entre accounting.repository et reception-voucher.repository.
      //    createInvoiceFromPo est idempotent (pas de doublon) et utilise les
      //    quantites deja livrees + prix saisis en reception. Les BCs sans
      //    aucun article livre ressortent en erreur metier plus bas (filtre
      //    minimum 2 factures).
      const { createInvoiceFromPo } = await import('./reception-voucher.repository.js');
      for (const poId of purchaseOrderIds) {
        await createInvoiceFromPo(client, poId, null, options.createdBy, options.storeId ?? null);
      }

      // 1. Recuperer toutes les factures liees a ces BCs (via la colonne
      //    historique purchase_order_id OU la table de jonction). DISTINCT
      //    sur id pour eviter les doublons quand un BC apparait dans les deux.
      const invRes = await client.query(
        `SELECT DISTINCT inv.*
         FROM invoices inv
         WHERE inv.id IN (
           SELECT id FROM invoices WHERE purchase_order_id = ANY($1::uuid[])
           UNION
           SELECT invoice_id FROM invoice_purchase_orders WHERE purchase_order_id = ANY($1::uuid[])
         )`,
        [purchaseOrderIds]
      );
      const invoices = invRes.rows as Record<string, unknown>[];

      if (invoices.length < 2) {
        throw new Error('Aucune facture fusionnable trouvee pour ces BCs (il en faut au moins 2).');
      }

      // 2. Verifier : meme fournisseur
      const suppliers = new Set(invoices.map((inv) => inv.supplier_id as string));
      if (suppliers.size !== 1) {
        throw new Error('Les factures doivent toutes provenir du meme fournisseur.');
      }

      // 3. Verifier : aucun paiement enregistre
      const invoiceIds = invoices.map((inv) => inv.id as string);
      const payRes = await client.query(
        `SELECT COUNT(*)::int AS cnt FROM payments WHERE invoice_id = ANY($1::uuid[])`,
        [invoiceIds]
      );
      if (parseInt(payRes.rows[0].cnt, 10) > 0) {
        throw new Error(
          'Au moins une des factures a deja un paiement. Annule les paiements avant la fusion.'
        );
      }

      // 4. Choisir la maitre (la plus ancienne par invoice_date puis created_at).
      invoices.sort((a, b) => {
        const da = new Date(a.invoice_date as string).getTime();
        const db_ = new Date(b.invoice_date as string).getTime();
        if (da !== db_) return da - db_;
        return new Date(a.created_at as string).getTime() - new Date(b.created_at as string).getTime();
      });
      const master = invoices[0];
      const otherIds = invoices.slice(1).map((inv) => inv.id as string);

      // 5. Deplacer les invoice_items des autres factures vers la maitre.
      await client.query(
        `UPDATE invoice_items SET invoice_id = $1 WHERE invoice_id = ANY($2::uuid[])`,
        [master.id, otherIds]
      );

      // 6. Recalculer amount + total_amount via SUM des subtotals.
      const sumRes = await client.query(
        `SELECT COALESCE(SUM(subtotal), 0)::numeric AS amount FROM invoice_items WHERE invoice_id = $1`,
        [master.id]
      );
      const newAmount = parseFloat(sumRes.rows[0].amount);

      // tax_amount conserve : on additionne ceux des factures fusionnees.
      const newTax = invoices.reduce(
        (acc, inv) => acc + (parseFloat((inv.tax_amount as string) || '0') || 0),
        0
      );
      const newTotal = newAmount + newTax;

      // 7. Mettre a jour la maitre (numero fournisseur optionnel, date, totaux).
      const sets: string[] = ['amount = $1', 'tax_amount = $2', 'total_amount = $3'];
      const values: unknown[] = [newAmount, newTax, newTotal];
      let i = 4;
      if (options.supplierInvoiceNumber && options.supplierInvoiceNumber.trim()) {
        sets.push(`invoice_number = $${i++}`);
        values.push(options.supplierInvoiceNumber.trim());
      }
      if (options.invoiceDate) {
        sets.push(`invoice_date = $${i++}`);
        values.push(options.invoiceDate);
      }
      values.push(master.id);
      await client.query(
        `UPDATE invoices SET ${sets.join(', ')} WHERE id = $${i}`,
        values
      );

      // 8. Lier tous les BCs a la maitre via la table de jonction. ON CONFLICT
      //    DO NOTHING pour idempotence (un BC peut deja etre dans la junction
      //    via le backfill).
      for (const poId of purchaseOrderIds) {
        await client.query(
          `INSERT INTO invoice_purchase_orders (invoice_id, purchase_order_id)
           VALUES ($1, $2) ON CONFLICT DO NOTHING`,
          [master.id, poId]
        );
      }

      // 9. Propager le N° facture fournisseur sur les reception_vouchers des
      //    BCs concernes, pour que la coherence soit visible cote receptions.
      if (options.supplierInvoiceNumber && options.supplierInvoiceNumber.trim()) {
        await client.query(
          `UPDATE reception_vouchers
              SET supplier_invoice_number = $1
            WHERE purchase_order_id = ANY($2::uuid[])`,
          [options.supplierInvoiceNumber.trim(), purchaseOrderIds]
        );
      }

      // 10. Les autres factures sont ANNULÉES, jamais supprimées (mig 309, G-D6-03) : la pièce reste,
      //     son écriture est extournée, la facture maître porte la sienne régénérée.
      await client.query(
        `UPDATE invoices
            SET status = 'cancelled', validation_status = 'cancelled', cancelled_at = NOW(), cancelled_by = $2,
                cancel_note = 'Fusionnée dans ' || $3, source = source, merged_into_invoice_id = $4
          WHERE id = ANY($1::uuid[])`,
        [otherIds, options.createdBy, master.invoice_number ?? master.id, master.id]
      );
      if (FLAGS.LEDGER_AUTOGEN) {
        for (const oid of otherIds) {
          await reverseEntriesForSource(client, { sourceId: oid, sourceKinds: ['invoice', 'backfill'] });
        }
        await regenerateInvoiceEntry(client, master.id as string, options.createdBy);
      }

      await client.query('COMMIT');

      // Retourne la facture maitre rafraichie.
      const finalRes = await db.query(`SELECT * FROM invoices WHERE id = $1`, [master.id]);
      return finalRes.rows[0];
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  },

  /**
   * Trouve la facture emise liee a une commande (ou null s'il n'y en a pas).
   * Utilise pour resynchroniser la facture quand la commande est modifiee.
   */
  async findEmittedByOrderId(orderId: string) {
    const result = await db.query(
      `SELECT * FROM invoices WHERE order_id = $1 AND invoice_type = 'emitted' LIMIT 1`,
      [orderId]
    );
    return result.rows[0] || null;
  },

  // existingClient : si fourni, on s'execute DANS la transaction de l'appelant
  // (sans BEGIN/COMMIT/release) pour que la maj legacy paid_amount soit atomique
  // avec l'ecriture comptable + le lettrage du paiement. Sinon, transaction propre
  // (appels autonomes : recompute manuel, etc.).
  async updatePaidAmount(id: string, existingClient?: PoolClient) {
    const client = existingClient ?? await db.getClient();
    const ownTxn = !existingClient;
    try {
      if (ownTxn) await client.query('BEGIN');

      // Lock invoice row to prevent concurrent payment race conditions.
      // (En transaction partagee, la facture est deja verrouillee par l'appelant
      // — le FOR UPDATE est alors re-entrant sans cout.)
      const inv = await client.query('SELECT total_amount, status FROM invoices WHERE id = $1 FOR UPDATE', [id]);
      if (!inv.rows[0]) { if (ownTxn) await client.query('ROLLBACK'); return null; }
      const totalAmount = parseFloat(inv.rows[0].total_amount);
      const currentStatus = inv.rows[0].status as string;

      const paymentsResult = await client.query(
        `SELECT COALESCE(SUM(amount), 0) as total_paid FROM payments WHERE invoice_id = $1`, [id]
      );
      const totalPaid = parseFloat(paymentsResult.rows[0].total_paid);

      let status = 'pending';
      if (totalPaid >= totalAmount) status = 'paid';
      else if (totalPaid > 0) status = 'partial';

      // Preserve manual statuses (disputed/cancelled) unless invoice is now fully paid.
      // Avoids overwriting a deliberate "En litige" flag when a partial payment arrives.
      if ((currentStatus === 'disputed' || currentStatus === 'cancelled') && status !== 'paid') {
        status = currentStatus;
      }

      const result = await client.query(
        `UPDATE invoices SET paid_amount = $1, status = $2 WHERE id = $3 RETURNING *`,
        [totalPaid, status, id]
      );

      if (ownTxn) await client.query('COMMIT');
      return result.rows[0];
    } catch (err) {
      if (ownTxn) await client.query('ROLLBACK');
      throw err;
    } finally {
      if (ownTxn) client.release();
    }
  },

  /**
   * Annulation motivée d'une facture reçue (mig 309) : refusée si un règlement existe ; la pièce
   * reste, son écriture est extournée, le contrôle libère ses blocages.
   */
  async cancelReceived(id: string, userId: string, reasonCodeId: string, note: string | null) {
    const client = await db.getClient();
    try {
      await client.query('BEGIN');
      await client.query(`SELECT set_config('app.user_id', $1, true)`, [userId]);
      const cur = (await client.query(`SELECT * FROM invoices WHERE id = $1 FOR UPDATE`, [id])).rows[0];
      const fail = (code: number, m: string) => { const e = new Error(m) as Error & { statusCode: number }; e.statusCode = code; return e; };
      if (!cur) throw fail(404, 'Facture non trouvee');
      if (cur.validation_status === 'cancelled') throw fail(409, 'Facture déjà annulée');
      if (parseFloat(cur.paid_amount || '0') > 0.005) throw fail(409, 'Facture déjà réglée (même partiellement) : annulez d\'abord les paiements ou faites un avoir');
      const ok = await client.query(
        `SELECT 1 FROM ref_entries WHERE id = $1 AND table_id = 'purchase_reason_codes' AND is_active AND metadata->'scope' ? 'cancel_invoice'`, [reasonCodeId]);
      if (!ok.rowCount) throw fail(400, 'Motif invalide pour une annulation de facture');
      const r = await client.query(
        `UPDATE invoices SET status = 'cancelled', validation_status = 'cancelled', cancelled_at = NOW(), cancelled_by = $2,
                cancel_reason_code_id = $3, cancel_note = $4, updated_by = $2
          WHERE id = $1 RETURNING *`,
        [id, userId, reasonCodeId, note]
      );
      if (FLAGS.LEDGER_AUTOGEN) await regenerateInvoiceEntry(client, id, userId);
      await client.query('COMMIT');
      return r.rows[0];
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  },

  /** Contrôle d'une facture : blocages, mentions légales, rapprochement par ligne (mig 309). */
  async control(id: string, revalidate = false) {
    if (revalidate) await db.query(`SELECT fn_validate_invoice($1)`, [id]);
    const inv = (await db.query(
      `SELECT i.id, i.invoice_number, i.supplier_invoice_number, i.validation_status, i.payment_status, i.legal_issues, i.checked_at,
              i.declared_ttc, i.total_amount, p.payable
         FROM invoices i LEFT JOIN v_invoice_payable p ON p.invoice_id = i.id WHERE i.id = $1`, [id])).rows[0];
    if (!inv) return null;
    const holds = (await db.query(
      `SELECT h.id, h.hold_code, hc.label, h.blocks_payment, h.is_system, h.details, h.held_at, h.released_at, h.release_mode,
              h.release_note, re.label AS release_reason, COALESCE(u.first_name || ' ' || u.last_name, u.email) AS released_by_name
         FROM invoice_holds h JOIN hold_codes hc ON hc.code = h.hold_code
         LEFT JOIN ref_entries re ON re.id = h.release_reason_code_id
         LEFT JOIN users u ON u.id = h.released_by
        WHERE h.invoice_id = $1 ORDER BY h.released_at NULLS FIRST, h.held_at DESC`, [id])).rows;
    const match = (await db.query(`SELECT * FROM v_invoice_item_match WHERE invoice_id = $1 ORDER BY item_name`, [id])).rows;
    return { ...inv, holds, match };
  },

  /** Levée manuelle d'un blocage, motif obligatoire ; le blocage reste dans l'historique. */
  async releaseHold(holdId: string, userId: string, reasonCodeId: string, note: string | null) {
    const ok = await db.query(
      `SELECT 1 FROM ref_entries WHERE id = $1 AND table_id = 'purchase_reason_codes' AND is_active AND metadata->'scope' ? 'release_hold'`, [reasonCodeId]);
    if (!ok.rowCount) { const e = new Error('Motif invalide pour lever un blocage') as Error & { statusCode: number }; e.statusCode = 400; throw e; }
    const r = await db.query(
      `UPDATE invoice_holds SET released_at = NOW(), released_by = $2, release_mode = 'manual', release_reason_code_id = $3, release_note = $4
        WHERE id = $1 AND released_at IS NULL RETURNING invoice_id`,
      [holdId, userId, reasonCodeId, note]);
    if (!r.rowCount) { const e = new Error('Blocage introuvable ou déjà levé') as Error & { statusCode: number }; e.statusCode = 404; throw e; }
    return r.rows[0];
  },

  /** Blocage manuel (litige, qualité…) : bloque le paiement jusqu'à levée motivée. */
  async addManualHold(invoiceId: string, userId: string, note: string) {
    const r = await db.query(
      `INSERT INTO invoice_holds (invoice_id, hold_code, blocks_payment, is_system, details, held_by)
       VALUES ($1, 'MANUAL', true, false, jsonb_build_object('note', $3::text), $2) RETURNING *`,
      [invoiceId, userId, note]);
    return r.rows[0];
  },

  async taxCodes(at?: string) {
    const r = await db.query(
      `SELECT code, label, rate, kind, recoverable, valid_from, valid_to, legal_ref FROM tax_codes
        WHERE country_code = COALESCE((SELECT value->>'code' FROM module_parameters WHERE key = 'company.country_code'), 'MA')
          AND valid_from <= COALESCE($1::date, CURRENT_DATE) AND (valid_to IS NULL OR valid_to >= COALESCE($1::date, CURRENT_DATE))
        ORDER BY rate DESC, code`, [at ?? null]);
    return r.rows;
  },

  async updateStatus(id: string, status: string) {
    if (!FLAGS.LEDGER_AUTOGEN) {
      const result = await db.query(`UPDATE invoices SET status = $1 WHERE id = $2 RETURNING *`, [status, id]);
      return result.rows[0];
    }
    // Transactionnel : la maj de statut + la resync de l'ecriture sont atomiques.
    // regenerateInvoiceEntry gere l'annulation (reverse seul) ET la reactivation
    // (reverse + regenerate). Si la periode est close, l'erreur remonte et
    // annule toute la transaction (on ne peut pas annuler une facture comptee
    // dans une periode cloturee).
    const client = await db.getClient();
    try {
      await client.query('BEGIN');
      const result = await client.query(`UPDATE invoices SET status = $1 WHERE id = $2 RETURNING *`, [status, id]);
      await regenerateInvoiceEntry(client, id, result.rows[0].created_by);
      await client.query('COMMIT');
      return result.rows[0];
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  },

  async updateCategory(id: string, categoryId: string | null) {
    const result = await db.query(
      `UPDATE invoices SET category_id = $1 WHERE id = $2 RETURNING *`,
      [categoryId, id]
    );
    return result.rows[0];
  },

  // Categorise UNE seule ligne de charge (invoice_items ou
  // reception_voucher_items). Contrairement a updateCategory (qui touche la
  // facture entiere), chaque ligne garde sa propre categorie.
  /**
   * Catégorie d'une ligne (mig 194). Mig 311 (G-D8-04/08) : l'imputation
   * comptable se fait par ligne, donc l'écriture de la pièce est régénérée dans
   * la même transaction (extourne + nouvelle écriture) : CPC et écran Charges
   * racontent la même histoire.
   */
  async updateLineCategory(lineId: string, source: string, categoryId: string | null, userId?: string) {
    const isReception = source === 'reception_item';
    const table = isReception ? 'reception_voucher_items' : 'invoice_items';
    const client = await db.getClient();
    try {
      await client.query('BEGIN');
      if (userId) await client.query(`SELECT set_config('app.user_id', $1, true)`, [userId]);
      const result = await client.query(
        `UPDATE ${table} SET category_id = $1 WHERE id = $2 RETURNING *`,
        [categoryId, lineId]
      );
      const row = result.rows[0];
      if (row) {
        if (isReception) {
          const hadGr = await client.query(
            `SELECT 1 FROM journal_entries WHERE source_id = $1 AND source_kind IN ('goods_receipt','goods_receipt_return') AND status = 'posted' LIMIT 1`, [lineId]);
          if (hadGr.rows[0]) {
            await reverseEntriesForSource(client, { sourceId: lineId, sourceKinds: ['goods_receipt', 'goods_receipt_return'] });
            await postOrQueue(client, { kind: 'goods_receipt', id: lineId }, async () => {
              const entry = await fromGoodsReceipt(client, lineId);
              if (entry) await persistEntry(client, entry, { userId: userId ?? row.created_by });
            });
          }
        } else if (row.invoice_id) {
          await postOrQueue(client, { kind: 'invoice', id: row.invoice_id }, async () => {
            await regenerateInvoiceEntry(client, row.invoice_id, userId);
          });
        }
      }
      await client.query('COMMIT');
      return row ?? null;
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  },

  async updateAttachment(id: string, url: string | null) {
    const result = await db.query(`UPDATE invoices SET attachment_url = $1 WHERE id = $2 RETURNING *`, [url, id]);
    return result.rows[0];
  },

  /**
   * Met a jour les modalites de reglement d'une facture (echeance, mode prevu,
   * date de reception). Champs additifs, tous optionnels.
   */
  async updatePaymentTerms(id: string, data: {
    dueDate?: string | null;
    expectedPaymentMode?: string | null;
    receptionDate?: string | null;
  }) {
    const sets: string[] = []; const values: unknown[] = []; let i = 1;
    if (data.dueDate !== undefined) { sets.push(`due_date = $${i++}`); values.push(data.dueDate || null); }
    if (data.expectedPaymentMode !== undefined) {
      sets.push(`expected_payment_mode = $${i++}`);
      values.push(data.expectedPaymentMode || null);
    }
    if (data.receptionDate !== undefined) { sets.push(`reception_date = $${i++}`); values.push(data.receptionDate || null); }
    if (sets.length === 0) return this.findById(id);
    values.push(id);
    const result = await db.query(
      `UPDATE invoices SET ${sets.join(', ')} WHERE id = $${i} RETURNING *`,
      values
    );
    return result.rows[0];
  },

  /**
   * Remplace les lignes (invoice_items) d'une facture en une seule transaction.
   *
   * Politique :
   *   - Approche "bulk save" : on supprime toutes les lignes existantes et on
   *     reinsere celles fournies. Plus simple a piloter cote UI (un seul Save)
   *     et evite de tracker les diffs ligne par ligne.
   *   - Recalcule automatiquement invoices.amount = SUM(subtotal). Ne touche
   *     PAS au taxAmount existant (le gerant peut le saisir separement via PUT
   *     /:id si besoin) mais recalcule total_amount = amount + tax_amount.
   *   - Rejette si nouveau total_amount < paid_amount (incoherence comptable).
   *   - Resync statut a la fin (pending/partial/paid).
   *
   * Note : on prefere subtotal envoye par le client (deja arrondi a l'affichage)
   * plutot que recalculer qty * unit_price, pour eviter les drift de centimes.
   */
  async replaceItems(id: string, items: { productId?: string | null; ingredientId?: string | null; description?: string | null; quantity: number; unitPrice: number; subtotal: number; tvaRate?: number | null }[]) {
    const client = await db.getClient();
    try {
      await client.query('BEGIN');

      const cur = await client.query(
        `SELECT tax_amount, paid_amount, invoice_type, validation_status FROM invoices WHERE id = $1 FOR UPDATE`,
        [id]
      );
      if (!cur.rows[0]) { await client.query('ROLLBACK'); return null; }
      const paidAmount = parseFloat(cur.rows[0].paid_amount || '0');
      // Facture reçue validée (mig 309) : modifiable seulement tant qu'aucun règlement n'existe ;
      // au-delà, la correction passe par un avoir. Le contrôle est rejoué au commit.
      assertInvoiceEditable(cur.rows[0], paidAmount);
      await client.query(`SELECT set_config('app.invoice_edit', 'on', true)`);

      // Si au moins une ligne porte un taux, la TVA est la somme des TVA
      // lignes. Sinon on conserve la TVA globale d'en-tete (retrocompat).
      const totals = headerTotalsFromLines(items);
      const newAmount = totals.amount;
      const taxAmount = totals.hasPerLineTva
        ? (totals.taxAmount as number)
        : parseFloat(cur.rows[0].tax_amount || '0');
      const newTotal = round2(newAmount + taxAmount);
      if (newTotal < paidAmount - 0.001) {
        await client.query('ROLLBACK');
        throw new Error(
          `Le nouveau total (${newTotal.toFixed(2)} DH) est inferieur au deja paye (${paidAmount.toFixed(2)} DH). ` +
          `Rembourse ou supprime des paiements avant de baisser le montant.`
        );
      }

      await client.query(`DELETE FROM invoice_items WHERE invoice_id = $1`, [id]);
      for (const it of items) {
        if (!Number.isFinite(it.quantity) || !Number.isFinite(it.unitPrice)) continue;
        const tvaRate = it.tvaRate ?? null;
        const tvaAmount = lineTvaAmount(it.subtotal, tvaRate);
        await client.query(
          `INSERT INTO invoice_items (invoice_id, product_id, ingredient_id, description, quantity, unit_price, subtotal, tva_rate, tva_amount)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
          [id, it.productId || null, it.ingredientId || null, it.description || null,
           it.quantity, it.unitPrice, it.subtotal, tvaRate, tvaAmount]
        );
      }

      await client.query(
        `UPDATE invoices SET amount = $1, tax_amount = $2, total_amount = $3 WHERE id = $4`,
        [newAmount, taxAmount, newTotal, id]
      );

      // Le montant a change -> reverser + regenerer l'ecriture de la facture
      // depuis l'etat courant, et re-lettrer si des paiements la soldent.
      if (FLAGS.LEDGER_AUTOGEN) {
        await regenerateInvoiceEntry(client, id, null);
      }

      await client.query('COMMIT');
      return await this.updatePaidAmount(id);
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  },

  /**
   * Mise a jour complete d'une facture (admin/gerant). Champs additifs et
   * optionnels — seuls ceux fournis dans `data` sont modifies.
   *
   * Cas particuliers :
   *   - Si amount ou taxAmount change, total_amount est recalcule automatiquement
   *     (sauf si totalAmount est explicitement fourni — ex: reduction commerciale)
   *   - Si totalAmount baisse en-dessous de paid_amount, on rejette l'update
   *     (sinon on aurait une facture "trop payee" — incoherence comptable)
   *   - Les statuts derivees (pending/partial/paid) sont resynchronises a la fin
   */
  async update(id: string, data: {
    invoiceNumber?: string;
    supplierId?: string | null;
    customerId?: string | null;
    categoryId?: string | null;
    invoiceDate?: string;
    dueDate?: string | null;
    amount?: number;
    taxAmount?: number;
    totalAmount?: number;
    notes?: string | null;
    expectedPaymentMode?: string | null;
    receptionDate?: string | null;
    checkNumber?: string | null;
  }) {
    const client = await db.getClient();
    try {
      await client.query('BEGIN');

      // Lock + lecture etat courant pour valider totalAmount vs paid_amount
      const current = await client.query(
        `SELECT amount, tax_amount, total_amount, paid_amount, invoice_type, validation_status FROM invoices WHERE id = $1 FOR UPDATE`,
        [id]
      );
      if (!current.rows[0]) {
        await client.query('ROLLBACK');
        return null;
      }
      assertInvoiceEditable(current.rows[0], parseFloat(current.rows[0].paid_amount || '0'));
      await client.query(`SELECT set_config('app.invoice_edit', 'on', true)`);
      const currentAmount = parseFloat(current.rows[0].amount);
      const currentTax = parseFloat(current.rows[0].tax_amount);
      const paidAmount = parseFloat(current.rows[0].paid_amount || '0');

      // Recalcule totalAmount si HT ou TVA change et qu'il n'est pas explicitement fourni
      const nextAmount = data.amount !== undefined ? data.amount : currentAmount;
      const nextTax = data.taxAmount !== undefined ? data.taxAmount : currentTax;
      const nextTotal = data.totalAmount !== undefined
        ? data.totalAmount
        : (data.amount !== undefined || data.taxAmount !== undefined)
        ? nextAmount + nextTax
        : undefined;

      if (nextTotal !== undefined && nextTotal < paidAmount) {
        await client.query('ROLLBACK');
        throw new Error(`Le montant total (${nextTotal.toFixed(2)} DH) ne peut etre inferieur au deja paye (${paidAmount.toFixed(2)} DH).`);
      }

      const sets: string[] = []; const values: unknown[] = []; let i = 1;
      if (data.invoiceNumber !== undefined) { sets.push(`invoice_number = $${i++}`); values.push(data.invoiceNumber); }
      if (data.supplierId !== undefined) { sets.push(`supplier_id = $${i++}`); values.push(data.supplierId || null); }
      if (data.customerId !== undefined) { sets.push(`customer_id = $${i++}`); values.push(data.customerId || null); }
      if (data.categoryId !== undefined) { sets.push(`category_id = $${i++}`); values.push(data.categoryId || null); }
      if (data.invoiceDate !== undefined) { sets.push(`invoice_date = $${i++}`); values.push(data.invoiceDate); }
      if (data.dueDate !== undefined) { sets.push(`due_date = $${i++}`); values.push(data.dueDate || null); }
      if (data.amount !== undefined) { sets.push(`amount = $${i++}`); values.push(data.amount); }
      if (data.taxAmount !== undefined) { sets.push(`tax_amount = $${i++}`); values.push(data.taxAmount); }
      if (nextTotal !== undefined) { sets.push(`total_amount = $${i++}`); values.push(nextTotal); }
      if (data.notes !== undefined) { sets.push(`notes = $${i++}`); values.push(data.notes || null); }
      if (data.expectedPaymentMode !== undefined) {
        sets.push(`expected_payment_mode = $${i++}`);
        values.push(data.expectedPaymentMode || null);
      }
      if (data.receptionDate !== undefined) { sets.push(`reception_date = $${i++}`); values.push(data.receptionDate || null); }
      if (data.checkNumber !== undefined) { sets.push(`check_number = $${i++}`); values.push(data.checkNumber || null); }

      if (sets.length === 0) {
        await client.query('ROLLBACK');
        return current.rows[0];
      }

      values.push(id);
      await client.query(
        `UPDATE invoices SET ${sets.join(', ')} WHERE id = $${i} RETURNING *`,
        values
      );

      // Champs impactant l'ecriture (montant, tiers, categorie, date) ont pu
      // changer -> reverser + regenerer l'ecriture depuis l'etat courant.
      if (FLAGS.LEDGER_AUTOGEN) {
        await regenerateInvoiceEntry(client, id, null);
      }

      await client.query('COMMIT');
      // Resync statut derive (pending/partial/paid) au cas ou totalAmount a change
      if (nextTotal !== undefined) {
        return await this.updatePaidAmount(id);
      }
      return await this.findById(id);
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  },

  /**
   * Suppression physique d'une facture (admin/gerant).
   *
   * Politique :
   *   - invoice_items est supprime en CASCADE (FK ON DELETE CASCADE en migration 055)
   *   - payments lies bloquent par defaut (FK sans CASCADE — preserve la
   *     coherence comptable). force=true supprime aussi les paiements.
   *
   * Retourne { deleted: true, deletedPayments: N } ou throws une erreur lisible
   * si payments existent et force=false.
   */
  async deleteById(id: string, opts: { force?: boolean } = {}): Promise<{ deleted: boolean; deletedPayments: number }> {
    const client = await db.getClient();
    try {
      await client.query('BEGIN');

      const inv = await client.query(`SELECT id FROM invoices WHERE id = $1 FOR UPDATE`, [id]);
      if (!inv.rows[0]) {
        await client.query('ROLLBACK');
        throw new Error('Facture introuvable');
      }

      const paymentsCount = await client.query(
        `SELECT COUNT(*)::int AS n FROM payments WHERE invoice_id = $1`, [id]
      );
      const nPayments = paymentsCount.rows[0].n as number;

      if (nPayments > 0 && !opts.force) {
        await client.query('ROLLBACK');
        throw new Error(`Cette facture a ${nPayments} paiement(s) lie(s). Utilisez force=true pour supprimer aussi les paiements, ou annulez la facture a la place.`);
      }

      // Reverser les ecritures comptables des paiements lies AVANT de les
      // supprimer (sinon ecritures orphelines + lettrage fantome).
      if (FLAGS.LEDGER_AUTOGEN && nPayments > 0 && opts.force) {
        const payIds = await client.query(`SELECT id FROM payments WHERE invoice_id = $1`, [id]);
        for (const row of payIds.rows) {
          await reverseEntriesForSource(client, { sourceId: row.id, sourceKinds: ['payment', 'backfill'] });
        }
      }

      let deletedPayments = 0;
      if (nPayments > 0 && opts.force) {
        const delPay = await client.query(`DELETE FROM payments WHERE invoice_id = $1`, [id]);
        deletedPayments = delPay.rowCount || 0;
      }

      // Reverser l'ecriture de la facture elle-meme avant suppression.
      if (FLAGS.LEDGER_AUTOGEN) {
        await reverseEntriesForSource(client, { sourceId: id, sourceKinds: ['invoice', 'backfill'] });
      }

      await client.query(`DELETE FROM invoices WHERE id = $1`, [id]);

      await client.query('COMMIT');
      return { deleted: true, deletedPayments };
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  },

  /**
   * Retourne les echeances fournisseurs a <= alertDays jours (defaut 7),
   * en deux familles distinguees par `kind` :
   *   - kind='invoice' : factures recues non finalisees dont due_date approche
   *     (inclut celles deja en retard).
   *   - kind='check'   : cheques/traites EMIS mais pas encore encaisses dont
   *     l'echeance effective (check_date, sinon due_date de la facture liee)
   *     approche. Une facture reglee par cheque passe en 'paid' et sort de la
   *     premiere famille, mais le cash ne quitte la banque qu'a l'encaissement —
   *     sans cette branche, l'echeance disparaissait du radar.
   *   - kind='schedule' (mig 258) : echeances de l'echeancier — mensualite d'un
   *     materiel achete a credit, loyer ou electricite du mois. Une facture
   *     ECHELONNEE sort de la famille 'invoice' (elle y apparaitrait a sa date
   *     finale, pas a la prochaine mensualite) : ses echeances la remplacent.
   */
  async findPaymentAlerts(params: { storeId?: string; alertDays?: number }) {
    const alertDays = params.alertDays ?? 7;
    const values: unknown[] = [String(alertDays)];
    let storeFilterInv = '';
    let storeFilterP = '';
    let storeFilterSp = '';
    if (params.storeId) {
      storeFilterInv = 'AND inv.store_id = $2';
      storeFilterP = 'AND p.store_id = $2';
      storeFilterSp = 'AND (sp.store_id IS NULL OR sp.store_id = $2)';
      values.push(params.storeId);
    }
    // Les echeances recurrentes a venir doivent exister pour pouvoir alerter :
    // la generation est idempotente, l'appeler ici est sans effet de bord.
    await db.query('SELECT fn_generate_recurring_schedules(90)');
    const result = await db.query(
      `SELECT * FROM (
         SELECT inv.id, 'invoice' AS kind, NULL::varchar AS label, inv.invoice_number, inv.supplier_id,
                inv.invoice_date, inv.due_date, inv.total_amount, inv.paid_amount,
                inv.status, inv.expected_payment_mode, inv.notes,
                inv.check_number,
                s.name AS supplier_name,
                (inv.total_amount - inv.paid_amount) AS remaining_amount,
                (inv.due_date - CURRENT_DATE) AS days_until_due,
                (inv.due_date < CURRENT_DATE) AS is_overdue
           FROM invoices inv
           LEFT JOIN suppliers s ON s.id = inv.supplier_id
          WHERE inv.invoice_type = 'received'
            AND inv.due_date IS NOT NULL
            AND inv.due_date <= CURRENT_DATE + ($1 || ' days')::interval
            AND inv.status IN ('pending', 'partial', 'overdue', 'disputed')
            AND NOT EXISTS (
              SELECT 1 FROM scheduled_payments sp
               WHERE sp.invoice_id = inv.id AND sp.status IN ('pending', 'partial')
            )
            ${storeFilterInv}
         UNION ALL
         SELECT p.id, 'check' AS kind, NULL::varchar AS label, inv.invoice_number, p.supplier_id,
                inv.invoice_date, COALESCE(p.check_date, inv.due_date) AS due_date,
                p.amount AS total_amount, 0 AS paid_amount,
                'check_pending' AS status, p.payment_method AS expected_payment_mode,
                p.description AS notes,
                p.check_number,
                COALESCE(s.name, e.first_name || ' ' || e.last_name) AS supplier_name,
                p.amount AS remaining_amount,
                (COALESCE(p.check_date, inv.due_date) - CURRENT_DATE) AS days_until_due,
                (COALESCE(p.check_date, inv.due_date) < CURRENT_DATE) AS is_overdue
           FROM payments p
           LEFT JOIN invoices inv ON inv.id = p.invoice_id
           LEFT JOIN suppliers s ON s.id = p.supplier_id
           LEFT JOIN employees e ON e.id = p.employee_id
          WHERE p.payment_method IN ('check', 'traite')
            AND p.cashed_at IS NULL
            AND COALESCE(p.check_date, inv.due_date) IS NOT NULL
            AND COALESCE(p.check_date, inv.due_date) <= CURRENT_DATE + ($1 || ' days')::interval
            ${storeFilterP}
         UNION ALL
         SELECT sp.id, 'schedule' AS kind, sp.label, inv2.invoice_number, sp.supplier_id,
                NULL::date AS invoice_date, sp.due_date,
                COALESCE(sp.amount_due, 0) AS total_amount, sp.amount_paid AS paid_amount,
                sp.status, sp.expected_payment_mode, sp.notes,
                NULL::varchar AS check_number,
                COALESCE(s2.name, d.label, rc.label) AS supplier_name,
                COALESCE(sp.amount_due, 0) - sp.amount_paid AS remaining_amount,
                (sp.due_date - CURRENT_DATE) AS days_until_due,
                (sp.due_date < CURRENT_DATE) AS is_overdue
           FROM scheduled_payments sp
           LEFT JOIN suppliers s2         ON s2.id = sp.supplier_id
           LEFT JOIN invoices inv2        ON inv2.id = sp.invoice_id
           LEFT JOIN debts d              ON d.id = sp.debt_id
           LEFT JOIN recurring_charges rc ON rc.id = sp.recurring_charge_id
          WHERE sp.status IN ('pending', 'partial')
            AND sp.due_date <= CURRENT_DATE + ($1 || ' days')::interval
            ${storeFilterSp}
       ) t
       ORDER BY t.due_date ASC, t.invoice_date ASC NULLS LAST`,
      values
    );
    return result.rows;
  },

  /**
   * Dettes & creances ouvertes (vue "qui doit quoi").
   *
   * Renvoie toutes les factures non soldees (reste a payer > 0), tous tiers
   * confondus, a plat. Le frontend (DettesTab) les separe en deux sens :
   *   - invoice_type='emitted'  -> creances (un client nous doit)
   *   - invoice_type='received' -> dettes   (on doit a un fournisseur)
   * et les agrege par tiers.
   *
   * Aucune table dediee : pure agregation sur invoices. `remaining_amount`
   * (total_amount - paid_amount) et `is_overdue` (echeance depassee) sont
   * calcules ici. Statuts exclus : paid (solde) et cancelled (annulee) ;
   * pending / partial / overdue / disputed sont inclus.
   */
  async findOpenDebts(params: { storeId?: string }) {
    const conditions: string[] = [
      `inv.status NOT IN ('paid', 'cancelled')`,
      `(inv.total_amount - inv.paid_amount) > 0.01`,
    ];
    const values: unknown[] = [];
    let i = 1;
    if (params.storeId) { conditions.push(`inv.store_id = $${i++}`); values.push(params.storeId); }
    const result = await db.query(
      `SELECT inv.id, inv.invoice_number, inv.invoice_type,
              inv.invoice_date, inv.due_date,
              inv.total_amount, inv.paid_amount, inv.status,
              inv.expected_payment_mode, inv.notes,
              (inv.total_amount - inv.paid_amount) AS remaining_amount,
              CASE WHEN inv.due_date IS NOT NULL AND inv.due_date < CURRENT_DATE
                   THEN true ELSE false END AS is_overdue,
              inv.supplier_id, s.name AS supplier_name, s.phone AS supplier_phone,
              inv.customer_id, c.first_name AS customer_first_name,
              c.last_name AS customer_last_name, c.phone AS customer_phone
         FROM invoices inv
         LEFT JOIN suppliers s ON s.id = inv.supplier_id
         LEFT JOIN customers c ON c.id = inv.customer_id
         WHERE ${conditions.join(' AND ')}
         ORDER BY inv.due_date ASC NULLS LAST, inv.invoice_date ASC`,
      values
    );
    return result.rows;
  },

  /**
   * Eclate les factures recues en une ligne par ingredient.
   *
   * Deux sources possibles selon comment la facture a ete saisie :
   *   1. `invoice_items` : creation manuelle via le modal Facture.
   *   2. `reception_voucher_items` : factures importees depuis Excel ou
   *      generees via le flux PO -> reception. Pas de invoice_items dans ce
   *      cas, on prend les lignes du bon de reception associe.
   *
   * On fait un UNION ALL des deux, en evitant les doublons pour les factures
   * qui ont les deux (priorite a invoice_items).
   */
  async findLineExpenses(params: { dateFrom?: string; dateTo?: string; supplierId?: string; storeId?: string }) {
    // Logique tresorerie (cash effectif) : une facture n'entre dans les charges
    // que lorsqu'elle est INTEGRALEMENT payee. La date utilisee est celle du
    // dernier paiement qui a cloture la facture (ex : un cheque encaisse le
    // 10/07 fait apparaitre la charge ce jour-la, pas a la date de facture).
    // Les factures impayees / partielles sont visibles ailleurs (onglet
    // "Factures recues" du module Achats) mais exclues des charges pour ne
    // pas fausser la tresorerie quotidienne.
    const conditions: string[] = [
      `inv.invoice_type = 'received'`,
      `inv.status = 'paid'`,
    ];
    const values: unknown[] = [];
    let i = 1;
    if (params.storeId) { conditions.push(`inv.store_id = $${i++}`); values.push(params.storeId); }
    // Note : dateFrom/dateTo filtrent sur la DATE EFFECTIVE de paiement
    // (pi.effective_date), pas sur invoice_date. C'est ce qui donne une vue
    // tresorerie coherente.
    if (params.dateFrom) { conditions.push(`pi.effective_date >= $${i++}`); values.push(params.dateFrom); }
    if (params.dateTo) { conditions.push(`pi.effective_date <= $${i++}`); values.push(params.dateTo); }
    if (params.supplierId) { conditions.push(`inv.supplier_id = $${i++}`); values.push(params.supplierId); }
    const where = `WHERE ${conditions.join(' AND ')}`;

    const result = await db.query(
      `WITH paid_invoices AS (
         -- Date effective d'apparition de la charge = jour ou le cash sort
         -- vraiment du compte. Differente du payment_date qui est la DATE
         -- D'ACTION (jour ou l'utilisateur a clique 'Payer').
         --
         -- Cheques :
         --   - p.cashed_at IS NOT NULL : l'utilisateur a confirme l'encaissement
         --     via l'onglet Cheques -> date exacte du debit bancaire.
         --   - p.cashed_at IS NULL : cheque pas encore encaisse. On exclut
         --     cette facture des charges (logique tresorerie stricte : pas de
         --     cash sorti = pas de charge). Visible dans l'onglet Cheques en
         --     attente.
         --
         -- Cash / virement : pas de delai d'encaissement, payment_date = date
         -- d'effet, on garde tel quel.
         --
         -- Si plusieurs paiements partiels, on prend le plus tardif (celui
         -- qui a cloture la facture). DISTINCT ON garde aussi la METHODE de
         -- ce dernier paiement (cash/check/transfer...) pour que l'UI puisse
         -- afficher et filtrer les lignes par mode de paiement.
         SELECT DISTINCT ON (p.invoice_id)
           p.invoice_id,
           CASE
             WHEN p.payment_method IN ('check', 'traite') THEN p.cashed_at
             ELSE p.payment_date
           END AS effective_date,
           p.payment_method
         FROM payments p
         WHERE p.invoice_id IS NOT NULL
           -- Exclut les paiements non concretises (cheques pas encore encaisses).
           -- Une facture status=paid dont le seul paiement est un cheque en
           -- attente n'a alors aucune ligne ici -> exclue des charges
           -- (logique tresorerie stricte).
           AND (p.payment_method NOT IN ('check', 'traite') OR p.cashed_at IS NOT NULL)
           AND (
             CASE
               WHEN p.payment_method IN ('check', 'traite') THEN p.cashed_at
               ELSE p.payment_date
             END
           ) IS NOT NULL
         ORDER BY p.invoice_id,
           CASE
             WHEN p.payment_method IN ('check', 'traite') THEN p.cashed_at
             ELSE p.payment_date
           END DESC
       ),
       ii_lines AS (
         -- Ratio TTC/HT par facture : reparti au prorata sur chaque ligne pour
         -- que les montants affiches dans Charges & Depenses incluent la TVA.
         -- tax_amount=0 (auto-facture non editee) -> ratio=1, lignes restent HT.
         -- tax_amount>0 -> ratio=(amount+tax_amount)/amount, lignes en TTC.
         SELECT
           ii.id                                       AS id,
           inv.id                                      AS invoice_id,
           inv.invoice_number                          AS invoice_number,
           pi.effective_date                           AS payment_date,
           pi.payment_method                           AS payment_method,
           inv.status                                  AS invoice_status,
           inv.supplier_id                             AS supplier_id,
           inv.category_id                             AS invoice_category_id,
           ii.category_id                              AS line_category_id,
           -- Categorie propre a l'ARTICLE (ingredient ou emballage) : repli
           -- intermediaire entre la categorie de ligne et celle de la facture.
           COALESCE(ing.category_id, pkg.category_id)  AS item_category_id,
           'invoice_item'::text                        AS line_source,
           inv.purchase_order_id                       AS invoice_po_id,
           ii.ingredient_id                            AS ingredient_id,
           COALESCE(ing.name, p.name, ii.description)  AS designation,
           ing.category                                AS ingredient_category,
           ii.quantity                                 AS quantity,
           ROUND((ii.unit_price * COALESCE(inv.total_amount / NULLIF(inv.amount, 0), 1))::numeric, 4) AS unit_price,
           ROUND((ii.subtotal    * COALESCE(inv.total_amount / NULLIF(inv.amount, 0), 1))::numeric, 2) AS amount,
           ii.created_at                               AS sort_at
         FROM invoice_items ii
         JOIN invoices inv ON inv.id = ii.invoice_id
         JOIN paid_invoices pi ON pi.invoice_id = inv.id
         LEFT JOIN ingredients ing ON ing.id = ii.ingredient_id
         LEFT JOIN packaging_items pkg ON pkg.id = ii.packaging_id
         LEFT JOIN products p ON p.id = ii.product_id
         ${where}
       ),
       rv_lines AS (
         SELECT
           rvi.id                                                  AS id,
           inv.id                                                  AS invoice_id,
           inv.invoice_number                                      AS invoice_number,
           pi.effective_date                                       AS payment_date,
           pi.payment_method                                       AS payment_method,
           inv.status                                              AS invoice_status,
           inv.supplier_id                                         AS supplier_id,
           inv.category_id                                         AS invoice_category_id,
           rvi.category_id                                         AS line_category_id,
           COALESCE(ing.category_id, pkg.category_id)              AS item_category_id,
           'reception_item'::text                                  AS line_source,
           inv.purchase_order_id                                   AS invoice_po_id,
           rvi.ingredient_id                                       AS ingredient_id,
           COALESCE(ing.name, pkg.name)                            AS designation,
           ing.category                                            AS ingredient_category,
           rvi.quantity_received                                   AS quantity,
           ROUND((COALESCE(rvi.unit_price, 0) * COALESCE(inv.total_amount / NULLIF(inv.amount, 0), 1))::numeric, 4) AS unit_price,
           ROUND((rvi.quantity_received * COALESCE(rvi.unit_price, 0) * COALESCE(inv.total_amount / NULLIF(inv.amount, 0), 1))::numeric, 2) AS amount,
           rvi.created_at                                          AS sort_at
         FROM reception_voucher_items rvi
         JOIN reception_vouchers rv ON rv.id = rvi.reception_voucher_id
         JOIN invoices inv ON inv.reception_voucher_id = rv.id
         JOIN paid_invoices pi ON pi.invoice_id = inv.id
         LEFT JOIN ingredients ing ON ing.id = rvi.ingredient_id
         LEFT JOIN packaging_items pkg ON pkg.id = rvi.packaging_id
         ${where}
           AND NOT EXISTS (SELECT 1 FROM invoice_items WHERE invoice_id = inv.id)
       ),
       all_lines AS (
         SELECT * FROM ii_lines
         UNION ALL
         SELECT * FROM rv_lines
       )
       SELECT
         al.id, al.invoice_id, al.invoice_number, al.payment_date,
         al.payment_method,
         al.invoice_status, al.supplier_id, al.ingredient_id,
         al.designation, al.ingredient_category,
         al.quantity, al.unit_price, al.amount,
         'invoice'::text       AS type,
         -- line_source : indique a l'UI quelle table mettre a jour pour
         -- categoriser CETTE ligne (invoice_items vs reception_voucher_items).
         al.line_source        AS line_source,
         s.name                AS supplier_name,
         po.order_number       AS purchase_order_number,
         -- category_id (effective) : categorie propre a la ligne si definie,
         -- sinon celle de l'ARTICLE (ingredient/emballage), sinon repli sur
         -- celle de la facture. Sert de root a la cascade UI.
         COALESCE(al.line_category_id, al.item_category_id, al.invoice_category_id) AS category_id,
         -- Description : sert d'etiquette dans la colonne Designation cote UI.
         CONCAT(
           al.designation,
           CASE WHEN al.quantity IS NOT NULL
                THEN ' (' || TRIM(BOTH '0' FROM TRIM(TRAILING '.' FROM al.quantity::text)) || ' x ' || ROUND(al.unit_price::numeric, 2) || ')'
                ELSE ''
           END
         )                     AS description,
         -- Categorie affichee (leaf) :
         --   - si une categorie de ligne a ete choisie explicitement, on
         --     affiche cette feuille (le choix de l'utilisateur prime) ;
         --   - sinon on prefere la categorie de l'ingredient (farines /
         --     produits_laitiers / ...), puis celle de l'article emballage,
         --     et en dernier recours celle de la facture (ec suit la meme
         --     cascade que category_id, donc ec.name = feuille effective).
         COALESCE(
           CASE WHEN al.line_category_id IS NOT NULL THEN ec.name END,
           al.ingredient_category,
           ec.name
         ) AS category_name
       FROM all_lines al
       LEFT JOIN suppliers s ON s.id = al.supplier_id
       LEFT JOIN purchase_orders po ON po.id = al.invoice_po_id
       LEFT JOIN expense_categories ec ON ec.id = COALESCE(al.line_category_id, al.item_category_id, al.invoice_category_id)
       ORDER BY al.payment_date DESC, al.invoice_number, al.sort_at`,
      values
    );
    return result.rows;
  },
};

/* ═══ Payments ═══ */
export const paymentRepository = {
  /**
   * Liste des paiements vue TRESORERIE (utilise par ChargesTab).
   *
   * Une date "effective" est calculee par paiement :
   *   - Cheque : cashed_at (date d'encaissement confirmee), NULL si pas encore
   *     encaisse -> exclu de la liste (logique tresorerie stricte).
   *   - Cash / virement / autre : payment_date (cash sort le jour de l'action).
   *
   * Le filtre dateFrom/dateTo s'applique sur cette date effective. C'est ce
   * qui fait qu'un cheque signe aujourd'hui mais encaisse dans 1 mois apparait
   * dans le mois prochain et pas aujourd'hui.
   *
   * Pour voir TOUS les paiements (y compris cheques en attente), utiliser
   * findChecks() pour l'onglet Cheques dedie.
   */
  async findAll(params: { type?: string; dateFrom?: string; dateTo?: string; supplierId?: string; storeId?: string }) {
    const conditions: string[] = [
      // Exclut les cheques pas encore encaisses (cash pas encore sorti)
      `(p.payment_method NOT IN ('check', 'traite') OR p.cashed_at IS NOT NULL)`,
    ];
    const values: unknown[] = []; let i = 1;
    // store_id NULL = paiement global (voir getRegister) : toujours visible
    if (params.storeId) { conditions.push(`(p.store_id = $${i++} OR p.store_id IS NULL)`); values.push(params.storeId); }
    if (params.type) { conditions.push(`p.type = $${i++}`); values.push(params.type); }
    // Date filter applique sur la date effective (cashed_at pour cheque, sinon payment_date)
    const effectiveDateExpr = `(CASE WHEN p.payment_method IN ('check', 'traite') THEN p.cashed_at ELSE p.payment_date END)`;
    if (params.dateFrom) { conditions.push(`${effectiveDateExpr} >= $${i++}`); values.push(params.dateFrom); }
    if (params.dateTo) { conditions.push(`${effectiveDateExpr} <= $${i++}`); values.push(params.dateTo); }
    if (params.supplierId) { conditions.push(`p.supplier_id = $${i++}`); values.push(params.supplierId); }
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const result = await db.query(
      `SELECT p.*, s.name as supplier_name, e.first_name as employee_first_name, e.last_name as employee_last_name,
              ec.name as category_name, ec.type as category_type, ec.requires_po,
              inv.invoice_number,
              po.order_number as purchase_order_number,
              -- Date effective (cash sorti) : utilisee par l'UI Charges pour
              -- afficher la date juste, et pour le tri.
              ${effectiveDateExpr} AS effective_date
       FROM payments p
       LEFT JOIN suppliers s ON s.id = p.supplier_id
       LEFT JOIN employees e ON e.id = p.employee_id
       LEFT JOIN expense_categories ec ON ec.id = p.category_id
       LEFT JOIN invoices inv ON inv.id = p.invoice_id
       LEFT JOIN purchase_orders po ON po.id = p.purchase_order_id
       ${where}
       ORDER BY ${effectiveDateExpr} DESC, p.created_at DESC`,
      values
    );
    return result.rows;
  },

  /**
   * Liste des cheques pour l'onglet "Cheques" (gestion encaissement).
   *
   * Renvoie TOUS les paiements payment_method='check', y compris ceux en
   * attente d'encaissement. Filtres :
   *   - status : 'pending' (cashed_at NULL), 'cashed' (cashed_at NOT NULL), 'all'
   *   - dateFrom/dateTo : filtre sur payment_date (date de signature)
   *   - supplierId / employeeId : restreint au beneficiaire
   *
   * Expose les colonnes utiles pour l'UI : beneficiaire, montant, dates,
   * facture associee (si reglement de facture), echeance prevue, etc.
   */
  async findChecks(params: {
    status?: 'pending' | 'cashed' | 'all';
    dateFrom?: string; dateTo?: string;
    supplierId?: string; employeeId?: string;
    storeId?: string;
  }) {
    // Mig 310 : un chèque annulé (et sa contre-pièce) sort du registre d'encaissement.
    const conditions: string[] = [`p.payment_method IN ('check', 'traite')`, `p.status <> 'void'`, `p.voids_payment_id IS NULL`];
    const values: unknown[] = []; let i = 1;
    if (params.storeId) { conditions.push(`p.store_id = $${i++}`); values.push(params.storeId); }
    if (params.status === 'pending') conditions.push(`p.cashed_at IS NULL`);
    else if (params.status === 'cashed') conditions.push(`p.cashed_at IS NOT NULL`);
    if (params.dateFrom) { conditions.push(`p.payment_date >= $${i++}`); values.push(params.dateFrom); }
    if (params.dateTo) { conditions.push(`p.payment_date <= $${i++}`); values.push(params.dateTo); }
    if (params.supplierId) { conditions.push(`p.supplier_id = $${i++}`); values.push(params.supplierId); }
    if (params.employeeId) { conditions.push(`p.employee_id = $${i++}`); values.push(params.employeeId); }
    const where = `WHERE ${conditions.join(' AND ')}`;

    const result = await db.query(
      `SELECT p.id, p.amount, p.payment_date, p.check_number, p.check_date,
              p.cashed_at, p.cashed_note, p.created_at, p.description, p.reference,
              p.type AS payment_type, p.payment_method,
              s.name AS supplier_name, s.id AS supplier_id,
              COALESCE(e.first_name || ' ' || e.last_name, NULL) AS employee_name,
              e.id AS employee_id,
              ec.name AS category_name,
              inv.id AS invoice_id, inv.invoice_number, inv.invoice_date, inv.due_date AS invoice_due_date,
              inv.total_amount AS invoice_total,
              po.order_number AS purchase_order_number,
              cby.first_name || ' ' || cby.last_name AS cashed_by_name,
              -- Etat derive pour l'UI. Echeance effective = check_date (date
              -- marquee sur le cheque/la traite) sinon due_date de la facture
              -- liee. Une traite peut etre tiree a 60j sans que la facture ait
              -- de due_date — sans COALESCE elle ne passerait jamais "overdue".
              CASE WHEN p.cashed_at IS NOT NULL THEN 'cashed'
                   WHEN COALESCE(p.check_date, inv.due_date) IS NOT NULL
                        AND COALESCE(p.check_date, inv.due_date) < CURRENT_DATE THEN 'overdue'
                   ELSE 'pending'
              END AS status
       FROM payments p
       LEFT JOIN suppliers s ON s.id = p.supplier_id
       LEFT JOIN employees e ON e.id = p.employee_id
       LEFT JOIN expense_categories ec ON ec.id = p.category_id
       LEFT JOIN invoices inv ON inv.id = p.invoice_id
       LEFT JOIN purchase_orders po ON po.id = p.purchase_order_id
       LEFT JOIN users cby ON cby.id = p.cashed_by
       ${where}
       ORDER BY
         -- En attente d'abord (action requise), puis par echeance/date
         CASE WHEN p.cashed_at IS NULL THEN 0 ELSE 1 END,
         COALESCE(p.check_date, inv.due_date, p.payment_date) ASC,
         p.created_at DESC`,
      values
    );
    return result.rows;
  },

  /**
   * Confirme l'encaissement d'un cheque (marquage manuel par l'utilisateur).
   * Verifie qu'il s'agit bien d'un cheque, qu'il n'est pas deja encaisse.
   * cashedAt par defaut = aujourd'hui.
   */
  async markCashed(id: string, data: { cashedAt?: string; cashedBy: string; note?: string }) {
    const cur = await db.query(`SELECT payment_method, cashed_at FROM payments WHERE id = $1`, [id]);
    if (!cur.rows[0]) throw new Error('Paiement introuvable');
    if (cur.rows[0].payment_method !== 'check' && cur.rows[0].payment_method !== 'traite') {
      throw new Error('Seuls les cheques et traites peuvent etre marques encaisses');
    }
    if (cur.rows[0].cashed_at) {
      throw new Error('Ce moyen de paiement est deja marque encaisse');
    }
    const client = await db.getClient();
    try {
      await client.query('BEGIN');
      const result = await client.query(
        `UPDATE payments
         SET cashed_at = COALESCE($1::date, CURRENT_DATE),
             cashed_by = $2,
             cashed_note = $3
         WHERE id = $4
         RETURNING *`,
        [data.cashedAt || null, data.cashedBy, data.note || null, id]
      );
      // L'encaissement genere l'ecriture de tresorerie (5111->5141 pour cheque,
      // 4415->5141 pour traite). regeneratePaymentEntries reconstruit emission
      // + cashing depuis l'etat courant (idempotent via source_detail).
      if (FLAGS.LEDGER_AUTOGEN) {
        await regeneratePaymentEntries(client, id, data.cashedBy);
      }
      await client.query('COMMIT');
      return result.rows[0];
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  },

  /**
   * Annule la confirmation d'encaissement (admin uniquement, cf. routes).
   * Sert pour corriger une erreur de saisie. Re-bascule le cheque en attente.
   */
  async unmarkCashed(id: string) {
    const client = await db.getClient();
    try {
      await client.query('BEGIN');
      const result = await client.query(
        `UPDATE payments
         SET cashed_at = NULL, cashed_by = NULL, cashed_note = NULL
         WHERE id = $1 AND payment_method IN ('check', 'traite')
         RETURNING *`,
        [id]
      );
      if (!result.rows[0]) { await client.query('ROLLBACK'); throw new Error('Cheque introuvable ou non eligible'); }
      // Plus de cashed_at -> l'ecriture d'encaissement doit disparaitre.
      // regeneratePaymentEntries reconstruit emission seule (cashing = null).
      if (FLAGS.LEDGER_AUTOGEN) {
        await regeneratePaymentEntries(client, id, result.rows[0].cashed_by ?? result.rows[0].created_by);
      }
      await client.query('COMMIT');
      return result.rows[0];
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  },
  async create(data: {
    reference?: string; type: string; categoryId?: string; invoiceId?: string;
    supplierId?: string; employeeId?: string; amount: number;
    paymentMethod: string; paymentDate: string; description?: string; createdBy: string; storeId?: string;
    purchaseOrderId?: string; checkNumber?: string; checkDate?: string; checkAttachmentUrl?: string;
    withholdingTypeId?: string | null; withholdingAmount?: number | null;
    avoirAmount?: number | null;
    sessionId?: string; // Section 4.3 — paid-out/paid-in rattache a une session ouverte
    // Mig 258 — echeance soldee par ce paiement (echeancier dettes/charges fixes).
    // Le trigger trg_sync_scheduled_payment recalcule amount_paid/status.
    scheduledPaymentId?: string | null;
    // Mig 310 (D7) — mode typé, compte de trésorerie, ré-émission, dérogation espèces.
    paymentMode?: string | null;
    treasuryAccountId?: string | null;
    toTreasuryAccountId?: string | null;
    replacesPaymentId?: string | null;
    cashOverride?: { reasonCodeId: string; note?: string | null } | null;
  }) {
    // Contexte de session lu par les triggers (auteur, dérogation au plafond espèces).
    const applyContext = async (client: PoolClient) => {
      await withActor(client, data.createdBy);
      if (data.cashOverride?.reasonCodeId) {
        await assertReasonCode(client, data.cashOverride.reasonCodeId, 'cash_override', data.cashOverride.note);
        await client.query(`SELECT set_config('app.cash_override_reason', $1, true), set_config('app.cash_override_note', $2, true)`,
          [data.cashOverride.reasonCodeId, data.cashOverride.note ?? '']);
      }
    };
    // Garde sur-paiement d'echeance (equivalent de la garde facture plus bas,
    // pour les echeances de dette autonome / charge fixe qui n'ont pas de
    // facture en face). Tolerance 0.01 DH pour les arrondis d'echeancier.
    if (data.scheduledPaymentId && !data.invoiceId) {
      const sched = await db.query(
        `SELECT label, amount_due, amount_paid FROM scheduled_payments WHERE id = $1`,
        [data.scheduledPaymentId]
      );
      if (!sched.rows[0]) {
        const e: Error & { statusCode?: number } = new Error('Echeance introuvable');
        e.statusCode = 404;
        throw e;
      }
      const due = sched.rows[0].amount_due !== null ? parseFloat(sched.rows[0].amount_due) : null;
      if (due === null) {
        const e: Error & { statusCode?: number } = new Error(
          `Le montant de l'échéance « ${sched.rows[0].label} » n'est pas encore renseigné. `
          + 'Saisissez-le avant d\'enregistrer le règlement.'
        );
        e.statusCode = 400;
        throw e;
      }
      const dejaPaye = parseFloat(sched.rows[0].amount_paid || '0');
      if (dejaPaye + data.amount > due + 0.01) {
        const reste = Math.max(0, due - dejaPaye);
        const e: Error & { statusCode?: number } = new Error(
          `Le règlement de ${data.amount.toFixed(2)} DH dépasse le reste à payer `
          + `(${reste.toFixed(2)} DH) de l'échéance « ${sched.rows[0].label} ».`
        );
        e.statusCode = 409;
        throw e;
      }
    }

    // ─── Cas simple : pas de facture liee ───────────────────────────────
    if (!data.invoiceId) {
      // Toujours en transaction : le contexte de session (auteur, dérogation)
      // est local à la transaction (mig 310).
      const client = await db.getClient();
      try {
        await client.query('BEGIN');
        await applyContext(client);
        const result = await client.query(
          `INSERT INTO payments (reference, type, category_id, invoice_id, supplier_id, employee_id,
            amount, payment_method, payment_date, description, created_by, store_id, purchase_order_id,
            check_number, check_date, check_attachment_url, withholding_type_id, withholding_amount,
            session_id, scheduled_payment_id, payment_mode, treasury_account_id, to_treasury_account_id,
            replaces_payment_id)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24) RETURNING *`,
          [data.reference || null, data.type, data.categoryId || null, null,
           data.supplierId || null, data.employeeId || null, data.amount,
           data.paymentMethod || 'cash', data.paymentDate, data.description || null, data.createdBy,
           data.storeId || null, data.purchaseOrderId || null,
           data.checkNumber || null, data.checkDate || null, data.checkAttachmentUrl || null,
           data.withholdingTypeId || null, data.withholdingAmount ?? null,
           data.sessionId || null, data.scheduledPaymentId || null,
           data.paymentMode || null, data.treasuryAccountId || null, data.toTreasuryAccountId || null,
           data.replacesPaymentId || null]
        );
        // Mig 311 (G-D8-01) : comptabilisation obligatoire ; un échec part en file d'attente
        // (ledger_outbox) ou annule la pièce en mode strict — plus d'échec silencieux.
        await postOrQueue(client, { kind: 'payment', id: result.rows[0].id }, async () => {
          const emission = await fromPaymentEmission(client, result.rows[0]);
          if (emission) await persistEntry(client, emission, { userId: data.createdBy });
        });
        await client.query('COMMIT');
        return result.rows[0];
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      } finally {
        client.release();
      }
    }

    // ─── Cas facture liee : transaction + FOR UPDATE pour eviter ──────────
    // les doublons et sur-paiements en cas de double-clic / requetes concurrentes.
    const client = await db.getClient();
    try {
      await client.query('BEGIN');
      await applyContext(client);

      // Lock la facture + lit l'etat courant
      const inv = await client.query(
        `SELECT total_amount, paid_amount, invoice_number FROM invoices WHERE id = $1 FOR UPDATE`,
        [data.invoiceId]
      );
      if (!inv.rows[0]) {
        const e: Error & { statusCode?: number } = new Error('Facture introuvable');
        e.statusCode = 404;
        throw e;
      }
      const totalAmount = parseFloat(inv.rows[0].total_amount);
      const currentPaid = parseFloat(inv.rows[0].paid_amount || '0');
      const invoiceNumber = inv.rows[0].invoice_number as string;

      // Garde 1 — sur-paiement : refuse si le cumul depasse le total.
      // Tolerance de 0.01 DH pour arrondis flottants.
      const effectiveAmount = data.amount + (data.avoirAmount ?? 0);
      if (currentPaid + effectiveAmount > totalAmount + 0.01) {
        const remaining = Math.max(0, totalAmount - currentPaid);
        const e: Error & { statusCode?: number } = new Error(
          `Le paiement de ${data.amount.toFixed(2)} DH dépasse le reste à payer ` +
          `(${remaining.toFixed(2)} DH sur ${totalAmount.toFixed(2)} DH) pour la facture ${invoiceNumber}.`
        );
        e.statusCode = 409;
        throw e;
      }

      // Garde 2 — doublon de cheque : un meme N° de cheque ne peut pas etre
      // saisi deux fois pour la meme facture (cas concret du bug observe).
      if (data.checkNumber && data.checkNumber.trim()) {
        const dup = await client.query(
          `SELECT id FROM payments WHERE invoice_id = $1 AND check_number = $2 LIMIT 1`,
          [data.invoiceId, data.checkNumber.trim()]
        );
        if (dup.rows.length > 0) {
          const e: Error & { statusCode?: number } = new Error(
            `Un paiement avec le chèque N° ${data.checkNumber.trim()} existe déjà pour la facture ${invoiceNumber}.`
          );
          e.statusCode = 409;
          throw e;
        }
      }

      const result = await client.query(
        `INSERT INTO payments (reference, type, category_id, invoice_id, supplier_id, employee_id,
          amount, payment_method, payment_date, description, created_by, store_id, purchase_order_id,
          check_number, check_date, check_attachment_url, withholding_type_id, withholding_amount,
          scheduled_payment_id, payment_mode, treasury_account_id, replaces_payment_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22) RETURNING *`,
        [data.reference || null, data.type, data.categoryId || null, data.invoiceId,
         data.supplierId || null, data.employeeId || null, data.amount,
         data.paymentMethod || 'cash', data.paymentDate, data.description || null, data.createdBy,
         data.storeId || null, data.purchaseOrderId || null,
         data.checkNumber || null, data.checkDate || null, data.checkAttachmentUrl || null,
         data.withholdingTypeId || null, data.withholdingAmount ?? null,
         data.scheduledPaymentId || null,
         data.paymentMode || null, data.treasuryAccountId || null, data.replacesPaymentId || null]
      );

      // Sync invoice.check_number avec le N° reellement utilise au paiement.
      // Sinon le modal facture continue a afficher l'ancien N° prevu alors que
      // l'onglet Effets montre le vrai → incoherence visible par l'utilisateur.
      const insertedMethod = result.rows[0].payment_method as string;
      if ((insertedMethod === 'check' || insertedMethod === 'traite') && data.checkNumber) {
        await client.query(
          `UPDATE invoices SET check_number = $1 WHERE id = $2`,
          [data.checkNumber, data.invoiceId]
        );
      }

      // Avoir fournisseur : cree un 2e paiement "avoir" dans la meme transaction.
      // Le montant de l'avoir vient en deduction du reste a payer sans sortie de
      // tresorerie — seul le cheque/traite sort reellement.
      if (data.avoirAmount && data.avoirAmount > 0) {
        const avoirResult = await client.query(
          `INSERT INTO payments (type, category_id, invoice_id, supplier_id, employee_id,
            amount, payment_method, payment_date, description, created_by, store_id,
            scheduled_payment_id)
           VALUES ($1,$2,$3,$4,$5,$6,'avoir',$7,$8,$9,$10,$11) RETURNING *`,
          [data.type, data.categoryId || null, data.invoiceId,
           data.supplierId || null, data.employeeId || null,
           data.avoirAmount, data.paymentDate,
           `Avoir déduit du ${insertedMethod === 'traite' ? 'traite' : 'chèque'} ${data.checkNumber || ''}`.trim(),
           data.createdBy, data.storeId || null, data.scheduledPaymentId || null]
        );
        // Mig 311 (G-D8-01) : comptabilisation obligatoire ; un échec part en file d'attente
        // (ledger_outbox) ou annule la pièce en mode strict — plus d'échec silencieux.
        await postOrQueue(client, { kind: 'payment', id: avoirResult.rows[0].id }, async () => {
          const avoirEmission = await fromPaymentEmission(client, avoirResult.rows[0]);
          if (avoirEmission) await persistEntry(client, avoirEmission, { userId: data.createdBy });
        });
      }

      // Generation auto de l'ecriture comptable + auto-lettrage (LEDGER_AUTOGEN)
      // Mig 311 (G-D8-01) : comptabilisation obligatoire ; un échec part en file d'attente
      // (ledger_outbox) ou annule la pièce en mode strict — plus d'échec silencieux.
      await postOrQueue(client, { kind: 'payment', id: result.rows[0].id }, async () => {
        const emission = await fromPaymentEmission(client, result.rows[0]);
        if (emission) await persistEntry(client, emission, { userId: data.createdBy });
        // Auto-lettrage : si la somme paiement+facture s'equilibre sur le tiers
        await autoLettrer(client, data.invoiceId as string);
      });

      // Resync paid_amount + status DANS la meme transaction : legacy et ledger
      // sont ainsi commit/rollback ensemble (plus de derive paid_amount vs ledger).
      await invoiceRepository.updatePaidAmount(data.invoiceId, client);

      await client.query('COMMIT');

      return result.rows[0];
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  },
  /**
   * Modification d'un paiement (mig 310, G-D7-07). Seuls les champs descriptifs
   * restent modifiables : montant, mode, date, tiers d'un paiement exécuté sont
   * figés par trigger (OF409) — corriger = annuler avec motif puis ressaisir.
   */
  async update(id: string, data: {
    categoryId?: string; description?: string; reference?: string; checkDate?: string | null;
    amount?: number; paymentMethod?: string; paymentDate?: string;
  }, userId?: string) {
    const sets: string[] = []; const values: unknown[] = []; let i = 1;
    if (data.categoryId !== undefined) { sets.push(`category_id = $${i++}`); values.push(data.categoryId || null); }
    if (data.description !== undefined) { sets.push(`description = $${i++}`); values.push(data.description); }
    if (data.reference !== undefined) { sets.push(`reference = $${i++}`); values.push(data.reference || null); }
    if (data.checkDate !== undefined) { sets.push(`check_date = $${i++}`); values.push(data.checkDate || null); }
    // Montant / mode / date : transmis tels quels, le trigger refuse si le paiement est exécuté.
    if (data.amount !== undefined) { sets.push(`amount = $${i++}`); values.push(data.amount); }
    if (data.paymentMethod !== undefined) { sets.push(`payment_method = $${i++}`); values.push(data.paymentMethod); }
    if (data.paymentDate !== undefined) { sets.push(`payment_date = $${i++}`); values.push(data.paymentDate); }
    if (sets.length === 0) return null;
    if (userId) { sets.push(`updated_by = $${i++}`); values.push(userId); }

    const client = await db.getClient();
    try {
      await client.query('BEGIN');
      await withActor(client, userId);
      values.push(id);
      const result = await client.query(`UPDATE payments SET ${sets.join(', ')} WHERE id = $${i} RETURNING *`, values);
      if (!result.rows[0]) throw Object.assign(new Error('Paiement introuvable'), { statusCode: 404 });
      // La catégorie d'une dépense change son compte de charge : on régénère.
      if (FLAGS.LEDGER_AUTOGEN && data.categoryId !== undefined && result.rows[0].status === 'executed') {
        await regeneratePaymentEntries(client, id, userId ?? result.rows[0].created_by);
      }
      await recordAction(client, { documentType: 'payment', documentId: id, action: 'changed', actorId: userId ?? null,
        diff: { fields: Object.keys(data).filter(k => (data as Record<string, unknown>)[k] !== undefined) } });
      await client.query('COMMIT');
      return result.rows[0];
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  },

  /** Suppression physique : réservée aux brouillons (trigger payments_no_delete). Sinon → void. */
  async delete(id: string) {
    const st = await db.query(`SELECT status FROM payments WHERE id = $1`, [id]);
    if (!st.rows[0]) throw Object.assign(new Error('Paiement introuvable'), { statusCode: 404 });
    if (st.rows[0].status !== 'draft') {
      throw Object.assign(new Error('Un paiement exécuté ne se supprime pas : utilisez « Annuler le paiement » avec un motif.'),
        { statusCode: 409 });
    }
    await db.query('DELETE FROM payments WHERE id = $1', [id]);
  },

  /**
   * Annulation (void) d'un paiement — mig 310, G-D7-08.
   *  - le paiement reste, passe en statut 'void' avec motif, auteur, date ;
   *  - une contre-pièce de montant négatif (voids_payment_id) neutralise toutes
   *    les sommes (reste dû facture, solde caisse, échéancier) ;
   *  - ses écritures sont EXTOURNÉES (jamais supprimées), même en période ouverte ;
   *  - refus si chèque/effet déjà encaissé ou écriture pointée sur un relevé bancaire.
   */
  async voidPayment(id: string, input: { reasonCodeId: string; note?: string | null; userId: string }) {
    const client = await db.getClient();
    try {
      await client.query('BEGIN');
      await withActor(client, input.userId);
      await assertReasonCode(client, input.reasonCodeId, 'void_payment', input.note);

      const r = await client.query(`SELECT * FROM payments WHERE id = $1 FOR UPDATE`, [id]);
      const p = r.rows[0];
      if (!p) throw Object.assign(new Error('Paiement introuvable'), { statusCode: 404 });
      const conflict = (msg: string) => Object.assign(new Error(msg), { statusCode: 409 });
      if (p.voids_payment_id) throw conflict('Une contre-pièce d\'annulation ne s\'annule pas.');
      if (p.status === 'void') throw conflict('Ce paiement est déjà annulé.');
      if (p.payment_method === 'avoir') throw conflict('Un avoir déduit ne s\'annule pas ici : il suit le règlement qui l\'a appliqué.');
      if (p.type === 'salary' || p.type === 'advance') {
        throw conflict('Un paiement de paie ou d\'avance s\'annule depuis le module Paie, qui tient aussi le bulletin et la retenue.');
      }
      if (p.cashed_at) {
        throw conflict(`Le ${p.payment_method === 'traite' ? 'effet' : 'chèque'} est déjà encaissé le ${String(p.cashed_at).slice(0, 10)} : annulez d'abord l'encaissement.`);
      }
      const reconciled = await client.query(
        `SELECT 1 FROM bank_statement_lines bsl
           JOIN journal_entry_lines jel ON jel.id = bsl.matched_entry_line_id
           JOIN journal_entries je ON je.id = jel.journal_entry_id
          WHERE je.source_id = $1 LIMIT 1`, [id]);
      if (reconciled.rows[0]) throw conflict('Ce paiement est rapproché sur un relevé bancaire : dé-rapprochez la ligne avant de l\'annuler.');

      // Avoir déduit dans le même acte (même facture, même date) : il suit le règlement.
      const linkedAvoir = p.invoice_id ? await client.query(
        `SELECT id FROM payments WHERE invoice_id = $1 AND payment_method = 'avoir' AND payment_date = $2
           AND status <> 'void' AND voids_payment_id IS NULL AND created_at BETWEEN $3::timestamptz - interval '5 seconds' AND $3::timestamptz + interval '5 seconds'`,
        [p.invoice_id, p.payment_date, p.created_at]) : { rows: [] as { id: string }[] };

      const toVoid = [p.id as string, ...linkedAvoir.rows.map((a: { id: string }) => a.id)];
      const today = new Date().toISOString().slice(0, 10);
      for (const pid of toVoid) {
        await client.query(
          `UPDATE payments SET status = 'void', voided_at = now(), voided_by = $2, void_reason_code_id = $3,
                  void_note = $4, updated_by = $2 WHERE id = $1`,
          [pid, input.userId, input.reasonCodeId, input.note ?? null]);
        // Contre-pièce : mêmes attributs, montant opposé, même date (les cumuls du jour se neutralisent).
        await client.query(
          `INSERT INTO payments (reference, type, category_id, invoice_id, supplier_id, employee_id, amount,
              payment_method, payment_mode, payment_date, description, created_by, store_id, purchase_order_id,
              withholding_type_id, withholding_amount, session_id, scheduled_payment_id, treasury_account_id,
              to_treasury_account_id, status, voids_payment_id, executed_at, executed_by)
           SELECT reference, type, category_id, invoice_id, supplier_id, employee_id, -amount,
              payment_method, payment_mode, payment_date,
              'Annulation : ' || COALESCE(description, reference, check_number, ''), $2, store_id, purchase_order_id,
              withholding_type_id, -withholding_amount, session_id, scheduled_payment_id, treasury_account_id,
              to_treasury_account_id, 'void', id, now(), $2
             FROM payments WHERE id = $1`,
          [pid, input.userId]);
        if (FLAGS.LEDGER_AUTOGEN) {
          await reverseEntriesForSource(client, {
            sourceId: pid, sourceKinds: ['payment', 'backfill'], forceExtourne: true, extourneDate: today,
          });
        }
      }

      if (p.invoice_id) {
        await invoiceRepository.updatePaidAmount(p.invoice_id, client);
        if (FLAGS.LEDGER_AUTOGEN) await autoLettrer(client, p.invoice_id);
      }
      await recordAction(client, {
        documentType: 'payment', documentId: id, action: 'cancelled', actorId: input.userId,
        reasonCodeId: input.reasonCodeId, note: input.note ?? null, snapshotAmount: parseFloat(p.amount),
        diff: linkedAvoir.rows.length ? { linked_avoirs: linkedAvoir.rows.map((a: { id: string }) => a.id) } : null,
      });
      await client.query('COMMIT');
      const out = await db.query(`SELECT * FROM payments WHERE id = $1`, [id]);
      return out.rows[0];
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  },

  /**
   * Ré-émission d'un paiement annulé (chèque perdu, rejet) : nouveau paiement lié
   * (replaces_payment_id), mêmes facture / tiers / montant, nouveau mode et référence.
   */
  async reissue(id: string, input: {
    paymentMode: string; reference?: string | null; checkNumber?: string | null; checkDate?: string | null;
    paymentDate: string; treasuryAccountId?: string | null; userId: string; storeId?: string;
    cashOverride?: { reasonCodeId: string; note?: string | null } | null;
  }) {
    const r = await db.query(`SELECT * FROM payments WHERE id = $1`, [id]);
    const p = r.rows[0];
    if (!p) throw Object.assign(new Error('Paiement introuvable'), { statusCode: 404 });
    if (p.status !== 'void' || p.voids_payment_id) {
      throw Object.assign(new Error('Seul un paiement annulé peut être ré-émis.'), { statusCode: 409 });
    }
    const already = await db.query(`SELECT id FROM payments WHERE replaces_payment_id = $1 AND status <> 'void' LIMIT 1`, [id]);
    if (already.rows[0]) throw Object.assign(new Error('Ce paiement a déjà été ré-émis.'), { statusCode: 409 });
    return this.create({
      type: p.type, categoryId: p.category_id ?? undefined, invoiceId: p.invoice_id ?? undefined,
      supplierId: p.supplier_id ?? undefined, employeeId: p.employee_id ?? undefined,
      amount: parseFloat(p.amount), paymentMethod: '', paymentMode: input.paymentMode,
      paymentDate: input.paymentDate, reference: input.reference ?? undefined,
      checkNumber: input.checkNumber ?? undefined, checkDate: input.checkDate ?? undefined,
      description: p.description ? `${p.description} (ré-émission)` : 'Ré-émission',
      createdBy: input.userId, storeId: p.store_id ?? input.storeId,
      purchaseOrderId: p.purchase_order_id ?? undefined,
      withholdingTypeId: p.withholding_type_id, withholdingAmount: p.withholding_amount != null ? parseFloat(p.withholding_amount) : null,
      scheduledPaymentId: p.scheduled_payment_id, treasuryAccountId: input.treasuryAccountId ?? null,
      replacesPaymentId: id, cashOverride: input.cashOverride ?? null,
    });
  },

  /** Modes de paiement typés et comptes de trésorerie actifs (mig 310). */
  async listModes() {
    const [modes, accounts] = await Promise.all([
      db.query(`SELECT code, label, legacy_method, is_cash, treasury_kind, requires_reference, deductible_over_cash_limit
                  FROM payment_modes WHERE is_active ORDER BY display_order`),
      db.query(`SELECT id, code, label, kind, account_code, bank_name, is_default
                  FROM treasury_accounts WHERE is_active ORDER BY kind DESC, label`),
    ]);
    return { modes: modes.rows, treasuryAccounts: accounts.rows };
  },

  /**
   * Prévisualisation du compteur espèces (G-D7-04) avant saisie : cumul jour et
   * mois chez le fournisseur, plafonds datés, seuil d'alerte, effet du montant saisi.
   */
  async cashCumul(supplierId: string, date: string, amount = 0) {
    const r = await db.query(
      `SELECT c.day_total, c.month_total, c.day_count,
              fn_fiscal_threshold('CASH_DAILY_PER_SUPPLIER', $2::date)   AS day_limit,
              fn_fiscal_threshold('CASH_MONTHLY_PER_SUPPLIER', $2::date) AS month_limit,
              COALESCE(fn_fiscal_threshold('CASH_WARN_PCT', $2::date), 80) AS warn_pct,
              s.name, s.kind, s.supplies_unprocessed_agri,
              (SELECT value->>'mode' FROM module_parameters WHERE key = 'purchasing.cash_limit_enforcement') AS enforcement
         FROM suppliers s, fn_cash_cumul($1, $2::date) c
        WHERE s.id = $1`, [supplierId, date]);
    const row = r.rows[0];
    if (!row) throw Object.assign(new Error('Fournisseur introuvable'), { statusCode: 404 });
    const dayAfter = parseFloat(row.day_total) + amount;
    const monthAfter = parseFloat(row.month_total) + amount;
    const dayLimit = row.day_limit != null ? parseFloat(row.day_limit) : null;
    const monthLimit = row.month_limit != null ? parseFloat(row.month_limit) : null;
    const warnPct = parseFloat(row.warn_pct);
    const pctDay = dayLimit ? Math.round((dayAfter / dayLimit) * 1000) / 10 : null;
    const pctMonth = monthLimit ? Math.round((monthAfter / monthLimit) * 1000) / 10 : null;
    const applies = row.kind !== 'divers';
    const exceeded = applies && ((dayLimit != null && dayAfter > dayLimit) || (monthLimit != null && monthAfter > monthLimit));
    return {
      supplierName: row.name, applies, agriException: row.supplies_unprocessed_agri as boolean,
      enforcement: (row.enforcement as string) || 'warn',
      dayTotal: parseFloat(row.day_total), monthTotal: parseFloat(row.month_total), dayCount: row.day_count as number,
      dayLimit, monthLimit, warnPct, amount, dayAfter, monthAfter, pctDay, pctMonth,
      warning: applies && ((pctDay ?? 0) >= warnPct || (pctMonth ?? 0) >= warnPct),
      exceeded,
      blocked: exceeded && !row.supplies_unprocessed_agri && row.enforcement === 'block',
    };
  },

  /** Dépassements et fractionnements suspects (vue v_cash_limit_breaches). */
  async cashLimitBreaches() {
    const r = await db.query(`SELECT * FROM v_cash_limit_breaches ORDER BY payment_date DESC`);
    return r.rows;
  },

  /** Virement interne entre deux comptes de trésorerie (G-D7-17) : ni charge, ni tiers. */
  async createInternalTransfer(input: {
    fromAccountId: string; toAccountId: string; amount: number; paymentDate: string;
    reference?: string | null; description?: string | null; userId: string; storeId?: string;
  }) {
    const acc = await db.query(`SELECT id, kind FROM treasury_accounts WHERE id = ANY($1::uuid[]) AND is_active`,
      [[input.fromAccountId, input.toAccountId]]);
    const from = acc.rows.find((a: { id: string }) => a.id === input.fromAccountId);
    if (!from || acc.rows.length < 2) throw Object.assign(new Error('Compte de trésorerie introuvable ou inactif'), { statusCode: 400 });
    const mode = from.kind === 'cash' ? 'cash' : 'virement';
    return this.create({
      type: 'internal_transfer', amount: input.amount, paymentMethod: '', paymentMode: mode,
      paymentDate: input.paymentDate, reference: input.reference ?? undefined,
      description: input.description || (from.kind === 'cash' ? 'Versement espèces en banque' : 'Virement interne'),
      createdBy: input.userId, storeId: input.storeId,
      treasuryAccountId: input.fromAccountId, toTreasuryAccountId: input.toAccountId,
    });
  },

  async summary(params: { dateFrom: string; dateTo: string; storeId?: string }) {
    const storeFilter = params.storeId ? ' AND p.store_id = $3' : '';
    const values: unknown[] = [params.dateFrom, params.dateTo];
    if (params.storeId) values.push(params.storeId);

    const result = await db.query(
      `SELECT
        -- 'advance' compte comme sortie (vue tresorerie) : pas de double
        -- comptage car le paiement salaire est net de la retenue d'avance
        -- (avance + salaire paye = net reel decaisse).
        COALESCE(SUM(CASE WHEN ec.type = 'expense' OR p.type IN ('invoice','salary','expense','advance') THEN p.amount ELSE 0 END), 0) as total_expenses,
        COALESCE(SUM(CASE WHEN ec.type = 'income' OR p.type = 'income' THEN p.amount ELSE 0 END), 0) as total_income,
        COUNT(*) as total_payments
       FROM payments p
       LEFT JOIN expense_categories ec ON ec.id = p.category_id
       WHERE p.payment_date BETWEEN $1 AND $2${storeFilter}`,
      values
    );
    return result.rows[0];
  },
  async summaryByCategory(params: { dateFrom: string; dateTo: string; storeId?: string }) {
    const storeFilter = params.storeId ? ' AND p.store_id = $3' : '';
    const values: unknown[] = [params.dateFrom, params.dateTo];
    if (params.storeId) values.push(params.storeId);

    const result = await db.query(
      `SELECT ec.name as category_name, ec.type as category_type,
              COUNT(p.id) as payment_count, SUM(p.amount) as total_amount
       FROM payments p
       LEFT JOIN expense_categories ec ON ec.id = p.category_id
       WHERE p.payment_date BETWEEN $1 AND $2${storeFilter}
       GROUP BY ec.id, ec.name, ec.type
       ORDER BY total_amount DESC`,
      values
    );
    return result.rows;
  },
};
