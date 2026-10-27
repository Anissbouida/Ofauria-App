import { db } from '../config/database.js';
import { haccpRepository } from './haccp.repository.js';
import { complaintRepository } from './complaint.repository.js';

/**
 * Contrôle & Qualité (mig 313) : lectures transverses, rien n'est saisi ici.
 *   - registre des pertes unifié (v_loss_register), au coût de revient ;
 *   - vue d'ensemble des anomalies, une ligne par contrôle, valorisée en DH.
 * Convention commune : un écart négatif est un manque.
 */

export type LossFamily = 'production' | 'invendu' | 'vitrine' | 'perime' | 'recyclage' | 'matiere';

type Range = { dateFrom?: string; dateTo?: string; storeId?: string };

function whereRange(r: Range, dateCol: string, storeCol: string, values: unknown[]) {
  const add = (v: unknown) => { values.push(v); return `$${values.length}`; };
  const cond: string[] = ['true'];
  if (r.dateFrom) cond.push(`${dateCol}::date >= ${add(r.dateFrom)}::date`);
  if (r.dateTo) cond.push(`${dateCol}::date <= ${add(r.dateTo)}::date`);
  if (r.storeId) cond.push(`(${storeCol} IS NULL OR ${storeCol} = ${add(r.storeId)}::uuid)`);
  return { cond, add };
}

export const controleRepository = {
  /** Registre des pertes : paginé, filtré ; total du filtre et coûts manquants inclus. */
  async lossesBoard(p: Range & { family?: string; source?: string; search?: string; limit: number; offset: number }) {
    const values: unknown[] = [];
    const { cond, add } = whereRange(p, 'occurred_at', 'store_id', values);
    if (p.family) cond.push(`family = ${add(p.family)}`);
    if (p.source) cond.push(`source = ${add(p.source)}`);
    if (p.search) {
      const s = add(`%${p.search}%`);
      cond.push(`(item_name ILIKE ${s} OR COALESCE(note, '') ILIKE ${s} OR COALESCE(declared_by_name, '') ILIKE ${s} OR COALESCE(reason_code, '') ILIKE ${s})`);
    }
    const lim = add(p.limit);
    const off = add(p.offset);
    const r = await db.query(
      `SELECT l.*, COUNT(*) OVER() AS total_count,
              SUM(value) OVER() AS sum_value,
              COUNT(*) FILTER (WHERE cost_missing) OVER() AS missing_count
         FROM v_loss_register l
        WHERE ${cond.join(' AND ')}
        ORDER BY occurred_at DESC
        LIMIT ${lim} OFFSET ${off}`,
      values);
    const first = r.rows[0];
    return {
      rows: r.rows.map(({ total_count: _a, sum_value: _b, missing_count: _c, ...row }) => row),
      total: first ? parseInt(first.total_count, 10) : 0,
      sumValue: first ? Number(first.sum_value ?? 0) : 0,
      missingCost: first ? Number(first.missing_count) : 0,
    };
  },

  /** Synthèse des pertes : par famille, période précédente de même durée, articles les plus coûteux. */
  async lossesSummary(p: Range) {
    const values: unknown[] = [];
    const { cond } = whereRange(p, 'occurred_at', 'store_id', values);
    const byFamily = await db.query(
      `SELECT family, COUNT(*)::int AS count, COALESCE(SUM(value), 0) AS value,
              COUNT(*) FILTER (WHERE cost_missing)::int AS missing
         FROM v_loss_register WHERE ${cond.join(' AND ')} GROUP BY family`, values);
    const top = await db.query(
      `SELECT item_name, source, unit, SUM(quantity) AS quantity, COALESCE(SUM(value), 0) AS value, COUNT(*)::int AS count
         FROM v_loss_register WHERE ${cond.join(' AND ')}
        GROUP BY item_name, source, unit ORDER BY 5 DESC, 6 DESC LIMIT 5`, values);
    // Période précédente de même durée (comparaison « vs période précédente »).
    let previousValue: number | null = null;
    if (p.dateFrom) {
      const to = p.dateTo ?? new Date().toISOString().slice(0, 10);
      const v2: unknown[] = [p.dateFrom, to];
      const storeSql = p.storeId ? (v2.push(p.storeId), ` AND (store_id IS NULL OR store_id = $3::uuid)`) : '';
      const prev = await db.query(
        `SELECT COALESCE(SUM(value), 0) AS value FROM v_loss_register
          WHERE occurred_at::date < $1::date
            AND occurred_at::date >= $1::date - ($2::date - $1::date + 1)${storeSql}`, v2);
      previousValue = Number(prev.rows[0].value);
    }
    return { byFamily: byFamily.rows, top: top.rows, previousValue };
  },

  /**
   * Vue d'ensemble : un indicateur par contrôle. Chaque requête est isolée — une
   * source absente ou en erreur n'empêche pas les autres de s'afficher.
   */
  /**
   * Anomalies de production, une ligne par anomalie, toutes sortes confondues :
   *   - rendement : production sous le seuil de rendement de la fiche ;
   *   - qc        : étape à contrôle qualité terminée avec un point non conforme, ou sans résultat ;
   *   - pesee     : pesée hors tolérance (écart motivé au pesage) ;
   *   - refus     : bon de sortie refusé par le chef à la réception.
   * Paginé côté serveur ; compteurs par sorte renvoyés pour les cartes.
   */
  async productionIssues(p: Range & { kind?: string; search?: string; limit: number; offset: number }) {
    const values: unknown[] = [];
    const add = (v: unknown) => { values.push(v); return `$${values.length}`; };
    const from = p.dateFrom ? add(p.dateFrom) : null;
    const to = p.dateTo ? add(p.dateTo) : null;
    const store = p.storeId ? add(p.storeId) : null;
    const inRange = (col: string) => [
      from ? `${col}::date >= ${from}::date` : 'true',
      to ? `${col}::date <= ${to}::date` : 'true',
    ].join(' AND ');
    const inStore = (col: string) => (store ? `(${col} IS NULL OR ${col} = ${store}::uuid)` : 'true');

    const src = `
      WITH issues AS (
        SELECT 'rendement'::text AS kind, r.plan_item_id::text AS id, r.recorded_at AS occurred_at,
               r.plan_id, pp.plan_date, COALESCE(pr.name, r.format_nom, 'Production') AS label,
               round(r.rendement_net_unites_pct, 1)::text || ' % pour un seuil de ' || round(r.seuil_rendement_pct, 1)::text || ' %' AS detail,
               round(r.rendement_net_unites_pct - r.seuil_rendement_pct, 1) AS gap,
               NULLIF(r.ecart_cout_estime, 0) AS value, NULL::text AS by_name
          FROM v_plan_item_rendement r
          JOIN production_plans pp ON pp.id = r.plan_id
          LEFT JOIN products pr ON pr.id = r.product_id
         WHERE r.recorded_at IS NOT NULL AND r.rendement_net_unites_pct < r.seuil_rendement_pct
           AND ${inRange('r.recorded_at')} AND ${inStore('pp.store_id')}
        UNION ALL
        SELECT 'qc', e.id::text, COALESCE(e.completed_at, e.updated_at), pi.plan_id, pp.plan_date,
               COALESCE(pr.name, 'Production') || ' · ' || e.nom,
               CASE WHEN jsonb_array_length(COALESCE(e.checklist_resultats, '[]'::jsonb)) = 0
                    THEN 'contrôle qualité non renseigné'
                    ELSE (SELECT string_agg(x->>'label', ', ') FROM jsonb_array_elements(e.checklist_resultats) x
                           WHERE (x->>'ok')::boolean IS FALSE) || ' : non conforme' END,
               NULL::numeric, NULL::numeric, COALESCE(u.first_name || ' ' || u.last_name, u.email)
          FROM production_item_etapes e
          JOIN production_plan_items pi ON pi.id = e.plan_item_id
          JOIN production_plans pp ON pp.id = pi.plan_id
          LEFT JOIN products pr ON pr.id = pi.product_id
          LEFT JOIN users u ON u.id = e.completed_by
         WHERE e.controle_qualite AND e.status = 'completed'
           AND (jsonb_array_length(COALESCE(e.checklist_resultats, '[]'::jsonb)) = 0
                OR EXISTS (SELECT 1 FROM jsonb_array_elements(e.checklist_resultats) x WHERE (x->>'ok')::boolean IS FALSE))
           AND ${inRange('COALESCE(e.completed_at, e.updated_at)')} AND ${inStore('pp.store_id')}
        UNION ALL
        SELECT 'pesee', h.id::text, h.changed_at, bs.plan_id, pp.plan_date,
               COALESCE(ing.name, pkg.name, 'Article') || ' · ' || COALESCE(bs.numero, 'bon supprimé'),
               'écart ' || round(h.ecart_quantity, 3)::text || ' (tolérance ' || round(COALESCE(h.tolerance_applied, 0), 3)::text || ') · ' || h.ecart_reason,
               round(h.ecart_quantity, 3), NULL::numeric, COALESCE(u.first_name || ' ' || u.last_name, u.email)
          FROM bsi_weighing_history h
          LEFT JOIN production_bons_sortie bs ON bs.id = h.bon_id
          LEFT JOIN production_plans pp ON pp.id = bs.plan_id
          LEFT JOIN ingredients ing ON ing.id = h.ingredient_id
          LEFT JOIN packaging_items pkg ON pkg.id = h.packaging_id
          LEFT JOIN users u ON u.id = h.changed_by
         WHERE h.ecart_reason IS NOT NULL AND h.ecart_reason <> ''
           AND ${inRange('h.changed_at')} AND ${inStore('bs.store_id')}
        UNION ALL
        SELECT 'refus', bs.id::text, COALESCE(bs.chef_reject_at, bs.updated_at), bs.plan_id, pp.plan_date,
               'Bon ' || bs.numero, bs.chef_reject_reason, NULL::numeric, NULL::numeric,
               COALESCE(u.first_name || ' ' || u.last_name, u.email)
          FROM production_bons_sortie bs
          LEFT JOIN production_plans pp ON pp.id = bs.plan_id
          LEFT JOIN users u ON u.id = bs.chef_reject_by
         WHERE bs.chef_reject_reason IS NOT NULL
           AND ${inRange('COALESCE(bs.chef_reject_at, bs.updated_at)')} AND ${inStore('bs.store_id')}
      )`;
    const counts = await db.query(`${src} SELECT kind, COUNT(*)::int AS count FROM issues GROUP BY kind`, values);
    const cond: string[] = ['true'];
    if (p.kind) cond.push(`kind = ${add(p.kind)}`);
    if (p.search) { const s = add(`%${p.search}%`); cond.push(`(label ILIKE ${s} OR COALESCE(detail, '') ILIKE ${s})`); }
    const lim = add(p.limit);
    const off = add(p.offset);
    const r = await db.query(
      `${src} SELECT i.*, COUNT(*) OVER() AS total_count FROM issues i
        WHERE ${cond.join(' AND ')} ORDER BY occurred_at DESC NULLS LAST LIMIT ${lim} OFFSET ${off}`, values);
    return {
      rows: r.rows.map(({ total_count: _t, ...row }) => row),
      total: r.rows[0] ? parseInt(r.rows[0].total_count, 10) : 0,
      counts: Object.fromEntries(counts.rows.map(c => [c.kind, c.count])) as Record<string, number>,
    };
  },

  /**
   * Contrôles à réception : un bon de réception = un contrôle (température, aspect,
   * emballage, étiquetage, verdict). Bons extournés exclus. Compteurs par état.
   */
  async receptions(p: Range & { status?: string; search?: string; limit: number; offset: number }) {
    const values: unknown[] = [];
    const { cond, add } = whereRange(p, 'rv.reception_date', 'rv.store_id', values);
    cond.push(`rv.reverses_voucher_id IS NULL AND rv.reversed_at IS NULL`);
    const base = `
      WITH r AS (
        SELECT rv.id, rv.voucher_number, rv.reception_date, rv.supplier_invoice_number,
               po.order_number, s.name AS supplier_name,
               (SELECT COUNT(*) FROM reception_voucher_items i WHERE i.reception_voucher_id = rv.id)::int AS line_count,
               COALESCE(u.first_name || ' ' || u.last_name, u.email) AS received_by_name,
               q.id AS check_id, q.temperature_ok, q.temperature_value, q.visual_ok, q.packaging_ok, q.labels_ok,
               q.overall_conformity, q.notes AS check_notes, q.checked_at,
               COALESCE(qu.first_name || ' ' || qu.last_name, qu.email) AS checked_by_name,
               CASE WHEN q.id IS NULL THEN 'a_controler'
                    WHEN q.overall_conformity THEN 'conforme' ELSE 'non_conforme' END AS check_status
          FROM reception_vouchers rv
          LEFT JOIN purchase_orders po ON po.id = rv.purchase_order_id
          LEFT JOIN suppliers s ON s.id = po.supplier_id
          LEFT JOIN users u ON u.id = rv.received_by
          LEFT JOIN reception_quality_checks q ON q.reception_voucher_id = rv.id
          LEFT JOIN users qu ON qu.id = q.checked_by
         WHERE ${cond.join(' AND ')}
      )`;
    const counts = await db.query(`${base} SELECT check_status, COUNT(*)::int AS count FROM r GROUP BY check_status`, values);
    const c2: string[] = ['true'];
    if (p.status) c2.push(`check_status = ${add(p.status)}`);
    if (p.search) { const s = add(`%${p.search}%`); c2.push(`(voucher_number ILIKE ${s} OR COALESCE(supplier_name, '') ILIKE ${s} OR COALESCE(order_number, '') ILIKE ${s})`); }
    const lim = add(p.limit);
    const off = add(p.offset);
    const rows = await db.query(
      `${base} SELECT r.*, COUNT(*) OVER() AS total_count FROM r WHERE ${c2.join(' AND ')}
        ORDER BY (check_status = 'a_controler') DESC, reception_date DESC, voucher_number DESC
        LIMIT ${lim} OFFSET ${off}`, values);
    return {
      rows: rows.rows.map(({ total_count: _t, ...row }) => row),
      total: rows.rows[0] ? parseInt(rows.rows[0].total_count, 10) : 0,
      counts: Object.fromEntries(counts.rows.map(c => [c.check_status, c.count])) as Record<string, number>,
    };
  },

  async overview(p: Range) {
    const run = async <T>(fn: () => Promise<T>): Promise<T | null> => {
      try { return await fn(); } catch { return null; }
    };
    const one = async (sql: string, vals: unknown[]) => (await db.query(sql, vals)).rows[0] ?? {};
    const rng = (dateCol: string, storeCol: string) => {
      const v: unknown[] = [];
      const { cond } = whereRange(p, dateCol, storeCol, v);
      return { where: cond.join(' AND '), v };
    };

    const [ventes, caisse, holds, rni, reception, rendement, pesees, refus, pertes, lotsMatiere, lotsProduit, haccp, rappels, sav] = await Promise.all([
      run(() => { const r = rng('d.business_date', 'd.store_id'); return one(
        `SELECT COUNT(*) FILTER (WHERE l.ecart_qty < 0)::int AS count,
                COALESCE(SUM(l.ecart_value) FILTER (WHERE l.ecart_value < 0), 0) AS value
           FROM recon_lines l JOIN recon_days d ON d.id = l.recon_day_id
          WHERE NOT COALESCE(l.hidden, false) AND ${r.where}`, r.v); }),
      run(() => { const r = rng('s.closed_at', 's.store_id'); return one(
        `SELECT COUNT(*) FILTER (WHERE abs(COALESCE(s.difference, 0)) > 5)::int AS count,
                COALESCE(SUM(s.difference) FILTER (WHERE COALESCE(s.difference, 0) < -5), 0) AS value
           FROM cash_register_sessions s WHERE s.closed_at IS NOT NULL AND ${r.where}`, r.v); }),
      run(() => one(
        `SELECT COUNT(DISTINCT h.invoice_id) FILTER (WHERE h.blocks_payment)::int AS count,
                COUNT(DISTINCT h.invoice_id)::int AS all_count
           FROM invoice_holds h JOIN invoices i ON i.id = h.invoice_id AND i.status NOT IN ('cancelled', 'paid')
          WHERE h.released_at IS NULL`, [])),
      run(() => one(
        `SELECT COUNT(DISTINCT po_id)::int AS count, COALESCE(SUM(amount_at_po_price), 0) AS value,
                COUNT(*) FILTER (WHERE age_days > 30)::int AS aged
           FROM kpi_received_not_invoiced`, [])),
      run(() => { const r = rng('entry_date', 'store_id'); return one(
        `SELECT COUNT(*) FILTER (WHERE incomplete)::int AS incomplete,
                COUNT(*) FILTER (WHERE overall_conformity = false)::int AS nonconform,
                COUNT(*)::int AS total
           FROM v_goods_entry_register WHERE ${r.where}`, r.v); }),
      run(() => { const r = rng('recorded_at', 'NULL::uuid'); return one(
        `SELECT COUNT(*) FILTER (WHERE rendement_net_unites_pct < seuil_rendement_pct)::int AS count,
                COUNT(*)::int AS total,
                COALESCE(SUM(ecart_cout_estime) FILTER (WHERE rendement_net_unites_pct < seuil_rendement_pct), 0) AS value
           FROM v_plan_item_rendement WHERE recorded_at IS NOT NULL AND ${r.where}`, r.v); }),
      run(() => { const r = rng('changed_at', 'NULL::uuid'); return one(
        `SELECT COUNT(*) FILTER (WHERE ecart_reason IS NOT NULL AND ecart_reason <> '')::int AS count
           FROM bsi_weighing_history WHERE ${r.where}`, r.v); }),
      run(() => { const r = rng('updated_at', 'store_id'); return one(
        `SELECT COUNT(*) FILTER (WHERE chef_reject_reason IS NOT NULL)::int AS count
           FROM production_bons_sortie WHERE ${r.where}`, r.v); }),
      run(() => { const r = rng('occurred_at', 'store_id'); return one(
        `SELECT COUNT(*)::int AS count, COALESCE(SUM(value), 0) AS value,
                COUNT(*) FILTER (WHERE cost_missing)::int AS missing
           FROM v_loss_register WHERE ${r.where}`, r.v); }),
      run(() => one(
        `SELECT COUNT(*)::int AS count,
                COALESCE(SUM((COALESCE(economat_quantity, 0) + COALESCE(pesage_quantity, 0)) * COALESCE(unit_cost, 0)), 0) AS value
           FROM ingredient_lots
          WHERE status = 'active' AND expiration_date IS NOT NULL AND expiration_date < CURRENT_DATE
            AND COALESCE(economat_quantity, 0) + COALESCE(pesage_quantity, 0) > 0
            ${p.storeId ? 'AND (store_id IS NULL OR store_id = $1::uuid)' : ''}`, p.storeId ? [p.storeId] : [])),
      run(() => one(
        `SELECT COUNT(*)::int AS count
           FROM product_lots
          WHERE expires_at IS NOT NULL AND expires_at < NOW()
            AND COALESCE(backroom_qty, 0) + COALESCE(vitrine_qty, 0) > 0
            ${p.storeId ? 'AND (store_id IS NULL OR store_id = $1::uuid)' : ''}`, p.storeId ? [p.storeId] : [])),
      // Mig 315 : plan de maîtrise sanitaire.
      run(() => haccpRepository.indicators(p.storeId ?? null, p.dateFrom, p.dateTo)),
      run(() => complaintRepository.indicators(p)),
      // Mig 316 : rappels en cours, quelle que soit la période.
      run(() => one(`SELECT COUNT(*)::int AS count FROM product_recalls WHERE status IN ('open', 'blocked')`, [])),
    ]);

    const num = (o: Record<string, any> | null, k: string) => (o ? Number(o[k] ?? 0) : null);
    // severity : danger (à traiter tout de suite) / warning (à surveiller) / ok
    const sev = (count: number | null, danger = false) => count === null ? 'unknown' : count === 0 ? 'ok' : danger ? 'danger' : 'warning';
    return [
      { key: 'ventes_ecart', domain: 'ventes', label: 'Manquants de ventes', hint: 'écart vendu + invendu − reçu < 0',
        count: num(ventes, 'count'), value: num(ventes, 'value'), severity: sev(num(ventes, 'count'), true), target: 'ventes' },
      { key: 'caisse_ecart', domain: 'ventes', label: 'Écarts de caisse', hint: 'sessions avec plus de 5 DH d\'écart',
        count: num(caisse, 'count'), value: num(caisse, 'value'), severity: sev(num(caisse, 'count')), target: 'ventes' },
      { key: 'factures_bloquees', domain: 'achats', label: 'Factures bloquées', hint: 'paiement suspendu par un contrôle',
        count: num(holds, 'count'), value: null, severity: sev(num(holds, 'count'), true), target: 'achats' },
      { key: 'recu_non_facture', domain: 'achats', label: 'Reçu non facturé', hint: 'BC livrés sans facture',
        count: num(rni, 'count'), value: num(rni, 'value'), severity: sev(num(rni, 'aged')), target: 'achats', aged: num(rni, 'aged') },
      { key: 'reception_incomplete', domain: 'achats', label: 'Réceptions sans lot ni DLC', hint: 'traçabilité incomplète',
        count: num(reception, 'incomplete'), value: null, severity: sev(num(reception, 'incomplete')), target: 'achats' },
      { key: 'reception_non_conforme', domain: 'achats', label: 'Réceptions non conformes', hint: 'contrôle à réception refusé',
        count: num(reception, 'nonconform'), value: null, severity: sev(num(reception, 'nonconform'), true), target: 'achats' },
      { key: 'rendement', domain: 'production', label: 'Rendement sous le seuil', hint: 'productions en dessous du rendement attendu',
        count: num(rendement, 'count'), value: num(rendement, 'value'), severity: sev(num(rendement, 'count')), target: 'production' },
      { key: 'pesees', domain: 'production', label: 'Pesées hors tolérance', hint: 'écart de pesée motivé',
        count: num(pesees, 'count'), value: null, severity: sev(num(pesees, 'count')), target: 'production' },
      { key: 'refus_chef', domain: 'production', label: 'Bons refusés par le chef', hint: 'préparation à reprendre',
        count: num(refus, 'count'), value: null, severity: sev(num(refus, 'count')), target: 'production' },
      { key: 'pertes', domain: 'pertes', label: 'Pertes déclarées', hint: 'produits finis, invendus et matières',
        count: num(pertes, 'count'), value: num(pertes, 'value'), severity: sev(num(pertes, 'count')), target: 'pertes', missing: num(pertes, 'missing') },
      { key: 'lots_matiere_perimes', domain: 'pertes', label: 'Matières périmées encore en stock', hint: 'lots à retirer',
        count: num(lotsMatiere, 'count'), value: num(lotsMatiere, 'value'), severity: sev(num(lotsMatiere, 'count'), true), target: 'stock' },
      { key: 'lots_produit_perimes', domain: 'pertes', label: 'Produits finis périmés en stock', hint: 'à sortir de la vitrine / réserve',
        count: num(lotsProduit, 'count'), value: null, severity: sev(num(lotsProduit, 'count'), true), target: 'produits' },
      { key: 'haccp_releves', domain: 'haccp', label: 'Enceintes sans relevé aujourd\'hui', hint: 'frigos, cellule, vitrines à relever',
        count: num(haccp, 'missing_today'), value: null, severity: sev(num(haccp, 'missing_today')), target: 'haccp' },
      { key: 'haccp_hors_plage', domain: 'haccp', label: 'Températures hors plage', hint: 'relevés hors des seuils sur la période',
        count: num(haccp, 'out_of_range'), value: null, severity: sev(num(haccp, 'out_of_range')), target: 'haccp' },
      { key: 'haccp_actions_ouvertes', domain: 'haccp', label: 'Actions correctives ouvertes', hint: 'anomalie constatée, rien de fait',
        count: num(haccp, 'actions_open'), value: null, severity: sev(num(haccp, 'actions_open'), true), target: 'haccp' },
      { key: 'haccp_a_valider', domain: 'haccp', label: 'Actions à valider', hint: 'réalisées par les chefs, en attente du gérant',
        count: num(haccp, 'actions_to_validate'), value: null, severity: sev(num(haccp, 'actions_to_validate')), target: 'haccp' },
      { key: 'haccp_nettoyage', domain: 'haccp', label: 'Nettoyages en retard', hint: 'tâches du plan de nettoyage non faites',
        count: num(haccp, 'cleaning_late'), value: null, severity: sev(num(haccp, 'cleaning_late')), target: 'haccp' },
      { key: 'rappels', domain: 'haccp', label: 'Rappels produit en cours', hint: 'lots à retirer et à solder',
        count: num(rappels, 'count'), value: null, severity: sev(num(rappels, 'count'), true), target: 'tracabilite' },
      // SAV (mig 357) : réclamations clients.
      { key: 'sav_ouvertes', domain: 'sav', label: 'Réclamations ouvertes', hint: 'à prendre en charge ou en cours',
        count: num(sav, 'open'), value: num(sav, 'amount'), severity: sev(num(sav, 'open')), target: 'sav' },
      { key: 'sav_retard', domain: 'sav', label: 'Réclamations en retard', hint: 'délai de traitement dépassé',
        count: num(sav, 'overdue'), value: null, severity: sev(num(sav, 'overdue'), true), target: 'sav' },
      { key: 'sav_critiques', domain: 'sav', label: 'Réclamations critiques', hint: 'sécurité, allergène : à traiter sans délai',
        count: num(sav, 'critical'), value: null, severity: sev(num(sav, 'critical'), true), target: 'sav' },
    ];
  },
};
