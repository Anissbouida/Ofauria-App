import { db } from '../config/database.js';

/**
 * Générateur de rapports configurables (mig 394).
 *
 * SÉCURITÉ — aucune injection possible : toutes les expressions SQL (dimensions,
 * indicateurs, filtres, FROM) proviennent UNIQUEMENT de ce registre figé. L'appelant
 * ne fournit que des CLÉS (validées contre le registre) et des VALEURS de filtre
 * (toujours paramétrées via $N). Le tri est une clé sélectionnée ; la limite est bornée.
 */

type Dimension = { key: string; label: string; sql: string; type: 'date' | 'text' };
type Measure = { key: string; label: string; sql: string; format: 'currency' | 'number' | 'integer' };
type FilterDef = { key: string; label: string; sql: string; type: 'enum'; optionsSql?: string };
type DataSource = {
  key: string; label: string;
  from: string;
  dateColumn: string;
  storeColumn?: string;
  dimensions: Dimension[];
  measures: Measure[];
  filters: FilterDef[];
};

const SOURCES: Record<string, DataSource> = {
  ventes: {
    key: 'ventes', label: 'Ventes',
    from: `sales s
           JOIN sale_items si ON si.sale_id = s.id
           LEFT JOIN products p ON p.id = si.product_id
           LEFT JOIN categories c ON c.id = p.category_id
           LEFT JOIN employees e ON e.id = s.employee_id`,
    dateColumn: 's.created_at',
    storeColumn: 's.store_id',
    dimensions: [
      { key: 'date_day', label: 'Jour', sql: `s.created_at::date`, type: 'date' },
      { key: 'date_month', label: 'Mois', sql: `to_char(s.created_at, 'YYYY-MM')`, type: 'text' },
      { key: 'category', label: 'Catégorie', sql: `COALESCE(c.name, 'Sans catégorie')`, type: 'text' },
      { key: 'product', label: 'Produit', sql: `COALESCE(p.name, '—')`, type: 'text' },
      { key: 'payment_method', label: 'Mode de paiement', sql: `COALESCE(s.payment_method, '—')`, type: 'text' },
      { key: 'sale_type', label: 'Type de vente', sql: `COALESCE(s.sale_type, 'standard')`, type: 'text' },
      { key: 'seller', label: 'Vendeur', sql: `COALESCE(e.first_name || ' ' || e.last_name, 'Non attribué')`, type: 'text' },
    ],
    measures: [
      { key: 'revenue', label: 'CA HT', sql: `SUM(si.subtotal)`, format: 'currency' },
      { key: 'quantity', label: 'Quantité', sql: `SUM(si.quantity)`, format: 'number' },
      { key: 'sales_count', label: 'Nb ventes', sql: `COUNT(DISTINCT s.id)`, format: 'integer' },
      { key: 'lines', label: 'Lignes', sql: `COUNT(*)`, format: 'integer' },
      { key: 'discount', label: 'Remise', sql: `SUM(COALESCE(si.promo_discount, 0))`, format: 'currency' },
      { key: 'avg_unit_price', label: 'Prix moyen', sql: `CASE WHEN SUM(si.quantity) > 0 THEN SUM(si.subtotal) / SUM(si.quantity) ELSE 0 END`, format: 'currency' },
    ],
    filters: [
      { key: 'payment_method', label: 'Mode de paiement', sql: `s.payment_method`, type: 'enum', optionsSql: `SELECT DISTINCT payment_method AS v FROM sales WHERE payment_method IS NOT NULL ORDER BY 1` },
      { key: 'sale_type', label: 'Type de vente', sql: `s.sale_type`, type: 'enum', optionsSql: `SELECT DISTINCT sale_type AS v FROM sales WHERE sale_type IS NOT NULL ORDER BY 1` },
      { key: 'category', label: 'Catégorie', sql: `c.name`, type: 'enum', optionsSql: `SELECT DISTINCT name AS v FROM categories WHERE name IS NOT NULL ORDER BY 1` },
    ],
  },
  production: {
    key: 'production', label: 'Production',
    from: `production_plan_items pi
           JOIN production_plans pl ON pl.id = pi.plan_id
           JOIN products p ON p.id = pi.product_id
           LEFT JOIN categories c ON c.id = p.category_id`,
    dateColumn: 'pl.plan_date',
    storeColumn: 'pl.store_id',
    dimensions: [
      { key: 'date_day', label: 'Jour', sql: `pl.plan_date`, type: 'date' },
      { key: 'date_month', label: 'Mois', sql: `to_char(pl.plan_date, 'YYYY-MM')`, type: 'text' },
      { key: 'category', label: 'Catégorie', sql: `COALESCE(c.name, 'Sans catégorie')`, type: 'text' },
      { key: 'product', label: 'Produit', sql: `p.name`, type: 'text' },
      { key: 'atelier', label: 'Atelier', sql: `COALESCE(pl.target_role, 'Général')`, type: 'text' },
      { key: 'plan_status', label: 'Statut du plan', sql: `pl.status`, type: 'text' },
    ],
    measures: [
      { key: 'planned', label: 'Planifié', sql: `SUM(pi.planned_quantity)`, format: 'number' },
      { key: 'produced', label: 'Produit', sql: `SUM(COALESCE(pi.actual_quantity, 0))`, format: 'number' },
      { key: 'items', label: 'Lignes', sql: `COUNT(*)`, format: 'integer' },
    ],
    filters: [
      { key: 'plan_status', label: 'Statut du plan', sql: `pl.status`, type: 'enum', optionsSql: `SELECT DISTINCT status AS v FROM production_plans WHERE status IS NOT NULL ORDER BY 1` },
      { key: 'atelier', label: 'Atelier', sql: `pl.target_role`, type: 'enum', optionsSql: `SELECT DISTINCT target_role AS v FROM production_plans WHERE target_role IS NOT NULL ORDER BY 1` },
    ],
  },
};

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export type RunConfig = {
  sourceKey: string;
  dimensions?: string[];
  measures?: string[];
  filters?: Record<string, string>;
  dateFrom?: string;
  dateTo?: string;
  sort?: { key: string; dir: 'asc' | 'desc' };
  limit?: number;
};

export const reportBuilderRepository = {
  /** Catalogue des sources (métadonnées pour le constructeur) — sans les expressions SQL. */
  listSources() {
    return Object.values(SOURCES).map(s => ({
      key: s.key, label: s.label,
      dimensions: s.dimensions.map(d => ({ key: d.key, label: d.label, type: d.type })),
      measures: s.measures.map(m => ({ key: m.key, label: m.label, format: m.format })),
      filters: s.filters.map(f => ({ key: f.key, label: f.label, type: f.type })),
    }));
  },

  /** Valeurs possibles d'un filtre enum (pour alimenter la liste déroulante). */
  async filterOptions(sourceKey: string, filterKey: string) {
    const src = SOURCES[sourceKey];
    const f = src?.filters.find(x => x.key === filterKey);
    if (!f?.optionsSql) return [];
    const { rows } = await db.query(f.optionsSql);
    return rows.map((r: { v: string }) => r.v).filter((v: string) => v != null);
  },

  /**
   * Exécute un rapport. Construit une requête d'agrégation à partir d'expressions
   * exclusivement issues du registre ; seules les valeurs (dates, filtres) sont
   * paramétrées. Retourne les colonnes (ordre dimensions puis indicateurs) et les lignes.
   */
  async run(cfg: RunConfig, ctx: { storeId: string | null }) {
    const src = SOURCES[cfg.sourceKey];
    if (!src) return { error: 'Source inconnue' as const };

    const dims = (cfg.dimensions ?? []).map(k => src.dimensions.find(d => d.key === k)).filter((d): d is Dimension => !!d);
    const meas = (cfg.measures ?? []).map(k => src.measures.find(m => m.key === k)).filter((m): m is Measure => !!m);
    if (!meas.length) return { error: 'Choisissez au moins un indicateur' as const };

    const values: unknown[] = [];
    const add = (v: unknown) => { values.push(v); return `$${values.length}`; };
    const where: string[] = [];

    // Portée magasin.
    if (src.storeColumn && ctx.storeId) where.push(`(${src.storeColumn} = ${add(ctx.storeId)}::uuid OR ${src.storeColumn} IS NULL)`);
    // Plage de dates.
    if (cfg.dateFrom && ISO_DATE.test(cfg.dateFrom)) where.push(`${src.dateColumn}::date >= ${add(cfg.dateFrom)}::date`);
    if (cfg.dateTo && ISO_DATE.test(cfg.dateTo)) where.push(`${src.dateColumn}::date <= ${add(cfg.dateTo)}::date`);
    // Filtres (clés validées, valeurs paramétrées).
    for (const [key, val] of Object.entries(cfg.filters ?? {})) {
      const f = src.filters.find(x => x.key === key);
      if (!f || val == null || val === '') continue;
      where.push(`${f.sql} = ${add(val)}`);
    }

    const selectParts = [
      ...dims.map(d => `${d.sql} AS "${d.key}"`),
      ...meas.map(m => `${m.sql} AS "${m.key}"`),
    ];
    let sql = `SELECT ${selectParts.join(', ')} FROM ${src.from}`;
    if (where.length) sql += ` WHERE ${where.join(' AND ')}`;
    if (dims.length) sql += ` GROUP BY ${dims.map(d => d.sql).join(', ')}`;

    // Tri : une clé sélectionnée (dimension ou indicateur), sinon le 1er indicateur desc.
    const sortKey = cfg.sort?.key && [...dims, ...meas].some(x => x.key === cfg.sort!.key) ? cfg.sort.key : meas[0].key;
    const sortDir = cfg.sort?.dir === 'asc' ? 'ASC' : 'DESC';
    sql += ` ORDER BY "${sortKey}" ${sortDir} NULLS LAST`;

    const limit = Math.min(Math.max(1, Number(cfg.limit) || 200), 1000);
    sql += ` LIMIT ${limit}`;

    const { rows } = await db.query(sql, values);
    const columns = [
      ...dims.map(d => ({ key: d.key, label: d.label, kind: 'dimension' as const, type: d.type })),
      ...meas.map(m => ({ key: m.key, label: m.label, kind: 'measure' as const, format: m.format })),
    ];
    return { columns, rows, source_key: src.key };
  },

  /* ─── Rapports enregistrés ────────────────────────────────────────────── */
  async list(storeId: string | null) {
    const { rows } = await db.query(
      `SELECT r.id, r.name, r.source_key, r.config, r.created_at, r.updated_at,
              u.first_name || ' ' || u.last_name AS created_by_name
         FROM report_definitions r LEFT JOIN users u ON u.id = r.created_by
        WHERE ($1::uuid IS NULL OR r.store_id IS NULL OR r.store_id = $1)
        ORDER BY r.name`, [storeId]);
    return rows;
  },

  async get(id: string) {
    const { rows } = await db.query(`SELECT * FROM report_definitions WHERE id = $1`, [id]);
    return rows[0] ?? null;
  },

  async create(input: { name: string; sourceKey: string; config: Record<string, unknown> }, ctx: { userId: string; storeId: string | null }) {
    if (!SOURCES[input.sourceKey]) return { error: 'Source inconnue' };
    const { rows } = await db.query(
      `INSERT INTO report_definitions (name, source_key, config, store_id, created_by) VALUES ($1, $2, $3, $4, $5) RETURNING id`,
      [input.name.trim(), input.sourceKey, JSON.stringify(input.config ?? {}), ctx.storeId, ctx.userId]);
    return { id: rows[0].id };
  },

  async update(id: string, input: { name: string; sourceKey: string; config: Record<string, unknown> }) {
    if (!SOURCES[input.sourceKey]) return { error: 'Source inconnue' };
    const { rows } = await db.query(
      `UPDATE report_definitions SET name = $2, source_key = $3, config = $4, updated_at = now() WHERE id = $1 RETURNING id`,
      [id, input.name.trim(), input.sourceKey, JSON.stringify(input.config ?? {})]);
    return rows[0] ? { id } : { error: 'Rapport introuvable' };
  },

  async remove(id: string) {
    await db.query(`DELETE FROM report_definitions WHERE id = $1`, [id]);
  },
};
