import { db } from '../config/database.js';
import { productionMarkupRepository } from './production-markup.repository.js';
import {
  forecastProduct, mape,
  type DemandObservation, type ForecastEvent, type ForecastResult,
} from '../services/demand-forecast.js';

/**
 * Prévision de la demande (mig 314). Charge les faits (v_demand_daily, événements,
 * saisies manuelles, marge) et délègue le calcul à services/demand-forecast.ts.
 *
 * Un produit apparaît dans la grille s'il a été vendu sur les 8 dernières semaines
 * ou s'il porte une saisie manuelle : 365 lignes à zéro n'aident personne.
 */

/** Fenêtre d'historique : 6 mêmes jours (42 j) + tendance (42 j) + marge. */
const HISTORY_DAYS = 56;

type EventRow = ForecastEvent & { id: string; store_id: string | null; category_id: number | null };

export interface ForecastProductRow {
  product_id: string;
  product_name: string;
  category_id: number | null;
  category_name: string | null;
  price: number;
}

function addDays(date: string, n: number): string {
  const d = new Date(Date.parse(`${date}T00:00:00Z`) + n * 86_400_000);
  return d.toISOString().slice(0, 10);
}

function datesBetween(from: string, to: string): string[] {
  const out: string[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) out.push(d);
  return out;
}

export const forecastRepository = {
  /**
   * Magasin de travail : celui de l'utilisateur ; un admin global peut le choisir ;
   * à défaut, l'unique magasin actif. null si ambigu (plusieurs magasins).
   */
  async resolveStore(userStoreId: string | undefined, requested?: string): Promise<string | null> {
    if (userStoreId) return userStoreId;
    if (requested) return requested;
    const { rows } = await db.query(`SELECT id FROM stores WHERE is_active = true ORDER BY created_at LIMIT 2`);
    return rows.length === 1 ? rows[0].id : null;
  },

  async listStores() {
    const { rows } = await db.query(`SELECT id, name FROM stores WHERE is_active = true ORDER BY name`);
    return rows;
  },

  /** Calcule la prévision de chaque produit pour chaque jour de [from, to]. */
  /**
   * opts.withMarkup = false : demande brute, sans majoration de production (la
   * fiche de besoin applique son propre % d'ajustement par catégorie).
   */
  async compute(storeId: string, from: string, to: string, opts: { productIds?: string[]; withMarkup?: boolean } = {}) {
    const histFrom = addDays(from, -HISTORY_DAYS);

    const [historyRes, eventsRes, overridesRes, markup] = await Promise.all([
      db.query(
        `SELECT product_id, business_date::text AS date, sold_qty::float AS sold, unsold_qty::float AS unsold
         FROM v_demand_daily
         WHERE store_id = $1 AND business_date >= $2::date AND business_date <= $3::date`,
        [storeId, histFrom, to],
      ),
      db.query(
        `SELECT id, store_id, category_id, date_start::text, date_end::text, kind, label, uplift_pct::float
         FROM calendar_events
         WHERE (store_id IS NULL OR store_id = $1) AND date_end >= $2::date AND date_start <= $3::date`,
        [storeId, histFrom, to],
      ),
      db.query(
        `SELECT product_id, forecast_date::text AS date, quantity, reason
         FROM demand_forecast_overrides
         WHERE store_id = $1 AND forecast_date BETWEEN $2::date AND $3::date`,
        [storeId, from, to],
      ),
      productionMarkupRepository.getEffectiveMap(),
    ]);

    const historyByProduct = new Map<string, DemandObservation[]>();
    for (const r of historyRes.rows) {
      const list = historyByProduct.get(r.product_id) ?? [];
      list.push({ date: r.date, sold: r.sold, unsold: r.unsold });
      historyByProduct.set(r.product_id, list);
    }
    // Un jour où le magasin a des ventes mais pas ce produit = 0 vendu, pas une
    // donnée manquante (les imports ne listent que les articles vendus). On ne
    // complète qu'à partir de la première vente connue du produit, pour ne pas
    // tirer vers zéro un produit nouvellement lancé.
    const openDays = [...new Set(historyRes.rows.map(r => r.date as string))].sort();
    for (const list of historyByProduct.values()) {
      const seen = new Set(list.map(h => h.date));
      const first = list.reduce((m, h) => (h.date < m ? h.date : m), list[0].date);
      for (const d of openDays) if (d > first && !seen.has(d)) list.push({ date: d, sold: 0, unsold: null });
    }

    const overrides = new Map<string, { quantity: number; reason: string | null }>();
    for (const r of overridesRes.rows) overrides.set(`${r.product_id}|${r.date}`, { quantity: r.quantity, reason: r.reason });

    // Produits retenus : vendus récemment (fenêtre de 8 semaines) ou avec saisie manuelle.
    const recentFrom = addDays(from, -HISTORY_DAYS);
    const ids = new Set<string>();
    for (const [pid, list] of historyByProduct) if (list.some(h => h.date >= recentFrom && h.sold > 0)) ids.add(pid);
    for (const r of overridesRes.rows) ids.add(r.product_id);
    for (const pid of opts.productIds ?? []) ids.add(pid);

    const { rows: products } = ids.size
      ? await db.query(
        `SELECT p.id AS product_id, p.name AS product_name, p.category_id, c.name AS category_name,
                COALESCE(p.price, 0)::float AS price
         FROM products p LEFT JOIN categories c ON c.id = p.category_id
         WHERE p.id = ANY($1::uuid[])
         ORDER BY c.display_order NULLS LAST, c.name, p.name`,
        [[...ids]],
      )
      : { rows: [] as ForecastProductRow[] };

    const events = eventsRes.rows as EventRow[];
    const dates = datesBetween(from, to);

    const rows = (products as ForecastProductRow[]).map(p => {
      const history = historyByProduct.get(p.product_id) ?? [];
      const productEvents = events.filter(e => e.category_id == null || e.category_id === p.category_id);
      const markupPct = opts.withMarkup === false ? 0
        : p.category_id != null && markup.overrides[p.category_id] != null
          ? markup.overrides[p.category_id]
          : markup.globalPercent;
      // Article vendu au poids (quantités décimales) : pas d'arrondi à l'unité.
      const integer = history.every(h => Number.isInteger(h.sold));
      const days: Record<string, ForecastResult & { override_reason: string | null; actual: number | null }> = {};
      for (const date of dates) {
        const ov = overrides.get(`${p.product_id}|${date}`);
        const result = forecastProduct(history, { targetDate: date, events: productEvents, markupPct, override: ov?.quantity ?? null, options: { integer } });
        const actual = history.find(h => h.date === date)?.sold ?? null;
        days[date] = { ...result, override_reason: ov?.reason ?? null, actual };
      }
      return { ...p, markup_pct: markupPct, days };
    });

    return { store_id: storeId, dates, events: events.filter(e => e.date_end >= from), rows };
  },

  /** Instantané « premier usage gagne » des prévisions qui ont guidé une décision. */
  async snapshot(storeId: string, date: string, usedFor: 'plan' | 'fiche' | 'manual', items: { product_id: string; result: ForecastResult }[]) {
    if (!items.length) return;
    const values: unknown[] = [];
    const tuples = items.map(({ product_id, result }) => {
      values.push(storeId, product_id, date, result.qty, result.base, result.method, usedFor);
      const b = values.length - 7;
      return `($${b + 1}::uuid, $${b + 2}::uuid, $${b + 3}::date, $${b + 4}, $${b + 5}, $${b + 6}, $${b + 7})`;
    });
    await db.query(
      `INSERT INTO demand_forecast_snapshots (store_id, product_id, forecast_date, forecast_qty, base_qty, method, used_for)
       VALUES ${tuples.join(', ')}
       ON CONFLICT (store_id, product_id, forecast_date) DO NOTHING`,
      values,
    );
  },

  async setOverride(p: { storeId: string; productId: string; date: string; quantity: number; reason?: string | null; userId: string }) {
    const { rows } = await db.query(
      `INSERT INTO demand_forecast_overrides (store_id, product_id, forecast_date, quantity, reason, set_by)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (store_id, product_id, forecast_date)
       DO UPDATE SET quantity = EXCLUDED.quantity, reason = EXCLUDED.reason, set_by = EXCLUDED.set_by, set_at = NOW()
       RETURNING *`,
      [p.storeId, p.productId, p.date, p.quantity, p.reason ?? null, p.userId],
    );
    return rows[0];
  },

  async deleteOverride(storeId: string, productId: string, date: string) {
    await db.query(
      `DELETE FROM demand_forecast_overrides WHERE store_id = $1 AND product_id = $2 AND forecast_date = $3`,
      [storeId, productId, date],
    );
  },

  // ─── Calendrier ───────────────────────────────────────────────────────

  async listEvents(storeId: string, from?: string) {
    const { rows } = await db.query(
      `SELECT e.id, e.store_id, e.date_start::text, e.date_end::text, e.kind, e.label,
              e.uplift_pct::float, e.category_id, c.name AS category_name
       FROM calendar_events e LEFT JOIN categories c ON c.id = e.category_id
       WHERE (e.store_id IS NULL OR e.store_id = $1)
         AND ($2::date IS NULL OR e.date_end >= $2::date)
       ORDER BY e.date_start`,
      [storeId, from ?? null],
    );
    return rows;
  },

  async saveEvent(e: {
    id?: string; storeId: string | null; date_start: string; date_end: string; kind: string;
    label: string; uplift_pct: number; category_id: number | null; userId: string;
  }) {
    if (e.id) {
      const { rows } = await db.query(
        `UPDATE calendar_events SET store_id = $2, date_start = $3, date_end = $4, kind = $5, label = $6,
                uplift_pct = $7, category_id = $8
         WHERE id = $1 RETURNING id`,
        [e.id, e.storeId, e.date_start, e.date_end, e.kind, e.label, e.uplift_pct, e.category_id],
      );
      return rows[0] ?? null;
    }
    const { rows } = await db.query(
      `INSERT INTO calendar_events (store_id, date_start, date_end, kind, label, uplift_pct, category_id, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
      [e.storeId, e.date_start, e.date_end, e.kind, e.label, e.uplift_pct, e.category_id, e.userId],
    );
    return rows[0];
  },

  async deleteEvent(id: string) {
    await db.query(`DELETE FROM calendar_events WHERE id = $1`, [id]);
  },

  // ─── Correspondance Loyverse → catalogue ──────────────────────────────

  /** Produits Loyverse sans correspondance, les plus vendus d'abord (impact sur la prévision). */
  async unmappedKeys() {
    const { rows } = await db.query(`
      SELECT rp.product_key, rp.product_name, rp.sku, rp.category,
             COALESCE(SUM(rl.vendu_qty), 0)::float AS sold_60d
      FROM recon_products rp
      LEFT JOIN recon_product_links l ON l.product_key = rp.product_key
      LEFT JOIN recon_lines rl ON rl.product_key = rp.product_key AND NOT rl.hidden
        AND rl.recon_day_id IN (SELECT id FROM recon_days WHERE business_date >= CURRENT_DATE - 60)
      WHERE l.product_key IS NULL
      GROUP BY rp.product_key, rp.product_name, rp.sku, rp.category
      ORDER BY sold_60d DESC, rp.product_name
    `);
    return rows;
  },

  async linkKey(productKey: string, productId: string | null, userId: string) {
    if (!productId) {
      await db.query(`DELETE FROM recon_product_links WHERE product_key = $1`, [productKey]);
      return;
    }
    await db.query(
      `INSERT INTO recon_product_links (product_key, product_id, matched_by, updated_by)
       VALUES ($1, $2, 'manual', $3)
       ON CONFLICT (product_key) DO UPDATE
         SET product_id = EXCLUDED.product_id, matched_by = 'manual', updated_by = EXCLUDED.updated_by, updated_at = NOW()`,
      [productKey, productId, userId],
    );
  },

  /** product_key → product_id pour les clés reliées (fiche de besoin). */
  async linkMap(): Promise<Map<string, string>> {
    const { rows } = await db.query(`SELECT product_key, product_id FROM recon_product_links`);
    return new Map(rows.map(r => [r.product_key as string, r.product_id as string]));
  },

  // ─── Précision ────────────────────────────────────────────────────────

  /** Prévision retenue (instantané) vs vendu réel, par produit et par catégorie. */
  async accuracy(storeId: string, from: string, to: string) {
    const { rows } = await db.query(
      `SELECT s.product_id, p.name AS product_name, c.name AS category_name,
              s.forecast_date::text AS date, s.forecast_qty::float AS forecast,
              COALESCE(d.sold_qty, 0)::float AS actual, d.unsold_qty::float AS unsold
       FROM demand_forecast_snapshots s
       JOIN products p ON p.id = s.product_id
       LEFT JOIN categories c ON c.id = p.category_id
       LEFT JOIN v_demand_daily d
         ON d.store_id = s.store_id AND d.product_id = s.product_id AND d.business_date = s.forecast_date
       WHERE s.store_id = $1 AND s.forecast_date BETWEEN $2::date AND $3::date
         AND s.forecast_date < CURRENT_DATE`,
      [storeId, from, to],
    );

    const group = (key: (r: typeof rows[number]) => string) => {
      const m = new Map<string, typeof rows>();
      for (const r of rows) { const k = key(r); m.set(k, [...(m.get(k) ?? []), r]); }
      return [...m.entries()].map(([k, list]) => ({
        key: k,
        days: list.length,
        forecast: list.reduce((s, r) => s + r.forecast, 0),
        actual: list.reduce((s, r) => s + r.actual, 0),
        mape: mape(list),
      })).sort((a, b) => b.actual - a.actual);
    };

    return {
      days: rows.length,
      mape: mape(rows),
      byCategory: group(r => r.category_name ?? 'Sans catégorie'),
      byProduct: group(r => r.product_name),
    };
  },
};
