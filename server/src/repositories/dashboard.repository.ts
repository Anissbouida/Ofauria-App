import { db } from '../config/database.js';

/**
 * Dashboard "Pilotage" : agrege les indicateurs financiers transverses
 * pour donner a l'admin une vue de synthese sur 3 dimensions :
 *
 *   1. ENGAGEMENT (comptable, date facture) : ce que l'entreprise doit,
 *      independamment du paiement effectif. Source = factures recues.
 *
 *   2. TRESORERIE (cash, date encaissement effectif) : ce qui est sorti
 *      du compte bancaire. Source = payments avec date effective (cashed_at
 *      pour cheques, payment_date sinon). Coherent avec ChargesTab.
 *
 *   3. PIPELINE (a venir) : ce qui va impacter la tresorerie. Source =
 *      factures impayees + cheques non encaisses + receptions sans facture.
 *
 * Le DELTA entre engagement et tresorerie = ce qui reste a debourser sur la
 * periode. Ca evite la confusion classique : 'j'ai recu 50k de marchandise
 * et seulement 10k ont quitte le compte, ou sont les 40k ?'
 */
export const dashboardRepository = {
  async getFinanceOverview(params: { dateFrom: string; dateTo: string; storeId?: string }) {
    const { dateFrom, dateTo, storeId } = params;
    const storeFilterInv = storeId ? 'AND inv.store_id = $3' : '';
    const storeFilterP = storeId ? 'AND p.store_id = $3' : '';
    const storeFilterPo = storeId ? 'AND po.store_id = $3' : '';
    const baseParams: unknown[] = [dateFrom, dateTo];
    if (storeId) baseParams.push(storeId);

    // 1. ENGAGEMENT : total facture sur la periode (toutes statuts sauf annulees)
    const engagementRes = await db.query(
      `SELECT COUNT(*)::text AS count, COALESCE(SUM(total_amount), 0)::text AS total
       FROM invoices inv
       WHERE invoice_type = 'received'
         AND status != 'cancelled'
         AND invoice_date BETWEEN $1 AND $2
         ${storeFilterInv}`,
      baseParams
    );

    // 2. TRESORERIE : cash sorti sur la periode (cash + cheques encaisses)
    // - cash/virement : paiement effectif a payment_date
    // - cheque : cash sort a cashed_at, exclu si non encaisse
    // Filtree sur la date EFFECTIVE, pas sur payment_date
    const treasuryRes = await db.query(
      `WITH effective AS (
         SELECT p.payment_method, p.amount,
                CASE WHEN p.payment_method = 'check' THEN p.cashed_at
                     ELSE p.payment_date
                END AS effective_date
         FROM payments p
         WHERE p.type IN ('invoice', 'salary', 'expense')
           AND (p.payment_method != 'check' OR p.cashed_at IS NOT NULL)
           ${storeFilterP}
       )
       SELECT payment_method, COUNT(*)::text AS count, COALESCE(SUM(amount), 0)::text AS total
       FROM effective
       WHERE effective_date BETWEEN $1 AND $2
       GROUP BY payment_method`,
      baseParams
    );

    // 3. RESTE A PAYER sur les factures de la periode
    // (factures recues qui ne sont pas encore integralement payees)
    const remainingRes = await db.query(
      `SELECT COUNT(*)::text AS count,
              COALESCE(SUM(total_amount - paid_amount), 0)::text AS total
       FROM invoices inv
       WHERE invoice_type = 'received'
         AND status NOT IN ('cancelled', 'paid')
         AND invoice_date BETWEEN $1 AND $2
         ${storeFilterInv}`,
      baseParams
    );

    // 4. RECEPTIONS SANS FACTURE (BC livrés mais sans facture associée)
    // C'est de l'engagement non-comptabilise : tu as recu la marchandise
    // mais la facture fournisseur n'est pas encore saisie. Souvent un
    // angle mort qui sous-estime les charges reelles du mois.
    const receivedNotInvoicedRes = await db.query(
      `SELECT COUNT(*)::text AS count,
              COALESCE(SUM(
                (SELECT COALESCE(SUM(quantity_delivered * COALESCE(unit_price, 0)), 0)
                 FROM purchase_order_items WHERE purchase_order_id = po.id)
              ), 0)::text AS total
       FROM purchase_orders po
       WHERE po.status IN ('livre_complet', 'livre_partiel')
         AND po.delivery_date BETWEEN $1 AND $2
         AND NOT EXISTS (
           SELECT 1 FROM invoices i
           WHERE i.purchase_order_id = po.id
             AND i.invoice_type = 'received'
             AND i.status != 'cancelled'
         )
         ${storeFilterPo}`,
      baseParams
    );

    // ─── PIPELINE (vue a date, pas filtree par periode) ─────────────────
    const storeFilterInvNow = storeId ? 'AND inv.store_id = $1' : '';
    const storeFilterPNow = storeId ? 'AND p.store_id = $1' : '';
    const storeFilterPoNow = storeId ? 'AND po.store_id = $1' : '';
    const nowParams: unknown[] = storeId ? [storeId] : [];

    // 5. FACTURES IMPAYEES (totales, pas filtre periode)
    const unpaidInvoicesRes = await db.query(
      `SELECT COUNT(*)::text AS count,
              COALESCE(SUM(total_amount - paid_amount), 0)::text AS total
       FROM invoices inv
       WHERE invoice_type = 'received'
         AND status IN ('pending', 'partial')
         ${storeFilterInvNow}`,
      nowParams
    );

    // 6. CHEQUES EMIS NON ENCAISSES (avec breakdown par echeance)
    const uncashedChecksRes = await db.query(
      `SELECT COUNT(*)::text AS count,
              COALESCE(SUM(p.amount), 0)::text AS total,
              COALESCE(SUM(CASE WHEN inv.due_date IS NOT NULL AND inv.due_date < CURRENT_DATE THEN p.amount ELSE 0 END), 0)::text AS overdue,
              COALESCE(SUM(CASE WHEN inv.due_date BETWEEN CURRENT_DATE AND CURRENT_DATE + 7 THEN p.amount ELSE 0 END), 0)::text AS next7d,
              COALESCE(SUM(CASE WHEN inv.due_date BETWEEN CURRENT_DATE + 8 AND CURRENT_DATE + 30 THEN p.amount ELSE 0 END), 0)::text AS next30d,
              COALESCE(SUM(CASE WHEN inv.due_date IS NULL OR inv.due_date > CURRENT_DATE + 30 THEN p.amount ELSE 0 END), 0)::text AS later
       FROM payments p
       LEFT JOIN invoices inv ON inv.id = p.invoice_id
       WHERE p.payment_method = 'check'
         AND p.cashed_at IS NULL
         ${storeFilterPNow}`,
      nowParams
    );

    // 7. TOP FOURNISSEURS CREDITEURS (top 10 par solde du)
    // Total du = factures impayees + cheques en attente d'encaissement
    const topSuppliersRes = await db.query(
      `WITH supplier_unpaid AS (
         SELECT inv.supplier_id,
                COALESCE(SUM(inv.total_amount - inv.paid_amount), 0) AS total,
                COUNT(*) AS cnt
         FROM invoices inv
         WHERE inv.invoice_type = 'received'
           AND inv.status IN ('pending', 'partial')
           ${storeFilterInvNow}
         GROUP BY inv.supplier_id
       ),
       supplier_uncashed AS (
         SELECT p.supplier_id,
                COALESCE(SUM(p.amount), 0) AS total,
                COUNT(*) AS cnt
         FROM payments p
         WHERE p.payment_method = 'check'
           AND p.cashed_at IS NULL
           ${storeFilterPNow}
         GROUP BY p.supplier_id
       )
       SELECT s.id, s.name,
              COALESCE(u.total, 0)::text AS unpaid_total,
              COALESCE(u.cnt, 0)::text AS unpaid_count,
              COALESCE(c.total, 0)::text AS uncashed_checks_total,
              COALESCE(c.cnt, 0)::text AS uncashed_checks_count,
              (COALESCE(u.total, 0) + COALESCE(c.total, 0))::text AS total_due
       FROM suppliers s
       LEFT JOIN supplier_unpaid u ON u.supplier_id = s.id
       LEFT JOIN supplier_uncashed c ON c.supplier_id = s.id
       WHERE COALESCE(u.total, 0) + COALESCE(c.total, 0) > 0
       ORDER BY total_due DESC
       LIMIT 10`,
      nowParams
    );

    // 8. RECEPTIONS LIVREES SANS FACTURE — liste detaillee (top 10)
    const receivedNotInvoicedListRes = await db.query(
      `SELECT po.id, po.order_number,
              s.name AS supplier_name,
              po.delivery_date::text,
              (SELECT COALESCE(SUM(quantity_delivered * COALESCE(unit_price, 0)), 0)
               FROM purchase_order_items WHERE purchase_order_id = po.id)::text AS total
       FROM purchase_orders po
       JOIN suppliers s ON s.id = po.supplier_id
       WHERE po.status IN ('livre_complet', 'livre_partiel')
         AND NOT EXISTS (
           SELECT 1 FROM invoices i
           WHERE i.purchase_order_id = po.id
             AND i.invoice_type = 'received'
             AND i.status != 'cancelled'
         )
         ${storeFilterPoNow}
       ORDER BY po.delivery_date DESC NULLS LAST
       LIMIT 10`,
      nowParams
    );

    // ─── Assemble la reponse ──────────────────────────────────────────
    const treasury = treasuryRes.rows;
    const byMethod: Record<string, { count: number; total: number }> = {
      cash: { count: 0, total: 0 },
      check: { count: 0, total: 0 },
      transfer: { count: 0, total: 0 },
      bank: { count: 0, total: 0 },
    };
    for (const t of treasury) {
      byMethod[t.payment_method] = {
        count: parseInt(t.count),
        total: parseFloat(t.total),
      };
    }
    const treasuryTotal = Object.values(byMethod).reduce((s, m) => s + m.total, 0);

    const engagement = engagementRes.rows[0];
    const remaining = remainingRes.rows[0];
    const receivedNotInvoiced = receivedNotInvoicedRes.rows[0];
    const unpaidInvoices = unpaidInvoicesRes.rows[0];
    const uncashedChecks = uncashedChecksRes.rows[0];

    return {
      period: { dateFrom, dateTo },
      kpis: {
        engagement: {
          total: parseFloat(engagement.total),
          count: parseInt(engagement.count),
        },
        treasury: {
          total: treasuryTotal,
          byMethod,
        },
        remainingToPay: {
          total: parseFloat(remaining.total),
          count: parseInt(remaining.count),
        },
        receivedNotInvoiced: {
          total: parseFloat(receivedNotInvoiced.total),
          count: parseInt(receivedNotInvoiced.count),
        },
      },
      pipeline: {
        unpaidInvoices: {
          total: parseFloat(unpaidInvoices.total),
          count: parseInt(unpaidInvoices.count),
        },
        uncashedChecks: {
          total: parseFloat(uncashedChecks.total),
          count: parseInt(uncashedChecks.count),
          overdue: parseFloat(uncashedChecks.overdue),
          next7d: parseFloat(uncashedChecks.next7d),
          next30d: parseFloat(uncashedChecks.next30d),
          later: parseFloat(uncashedChecks.later),
        },
        receivedNotInvoiced: {
          total: parseFloat(receivedNotInvoiced.total),
          count: parseInt(receivedNotInvoiced.count),
          list: receivedNotInvoicedListRes.rows.map(r => ({
            id: r.id,
            orderNumber: r.order_number,
            supplierName: r.supplier_name,
            deliveryDate: r.delivery_date,
            total: parseFloat(r.total),
          })),
        },
      },
      topSuppliers: topSuppliersRes.rows.map(r => ({
        id: r.id,
        name: r.name,
        unpaidTotal: parseFloat(r.unpaid_total),
        unpaidCount: parseInt(r.unpaid_count),
        uncashedChecksTotal: parseFloat(r.uncashed_checks_total),
        uncashedChecksCount: parseInt(r.uncashed_checks_count),
        totalDue: parseFloat(r.total_due),
      })),
    };
  },
};
