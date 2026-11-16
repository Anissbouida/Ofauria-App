/**
 * Sorties de stock supérieures au disponible (G0-18).
 *
 * Avant : `GREATEST(stock - sortie, 0)` ramenait le stock à zéro et le manque
 * disparaissait. `applyStockOut` applique la politique `stock.negative_policy` du
 * type d'article : « bloquer » refuse la sortie (409), « autoriser et tracer » la
 * laisse passer et enregistre le manque dans `stock_anomalies`.
 *
 * L'appelant garde sa propre mise à jour du stock (toujours bornée à zéro) : il
 * fournit la quantité demandée et le disponible lu sous verrou, dans SA transaction.
 * En mode bloquant l'erreur levée annule donc toute l'opération.
 */
import type { PoolClient } from 'pg';
import { db } from '../config/database.js';
import { getParameter } from './module-parameters.service.js';
import { createNotification } from '../utils/notify.js';

export type StockItemKind = 'ingredient' | 'product' | 'packaging' | 'semi_finished';
export type NegativePolicy = 'allow_trace' | 'block';
/** Client de transaction, ou `db` (qui suit la transaction ambiante). */
type Queryable = PoolClient | typeof db;

const r3 = (n: number) => Math.round(n * 1000) / 1000;
const fail = (message: string, statusCode = 409) => Object.assign(new Error(message), { statusCode });

export async function negativeStockPolicy(kind: StockItemKind): Promise<NegativePolicy> {
  const v = await getParameter<Partial<Record<StockItemKind, string>>>('stock.negative_policy');
  return v?.[kind] === 'block' ? 'block' : 'allow_trace';
}

export interface StockOut {
  kind: StockItemKind;
  itemId: string;
  lotId?: string | null;
  storeId?: string | null;
  /** Quantité à sortir (positive) et disponible avant la sortie, dans l'unité de stock de l'article. */
  requested: number;
  available: number;
  /** Document à l'origine de la sortie : type libre (production, livraison, perte…) et identifiant. */
  origin: { type: string; id?: string | null };
  userId?: string | null;
  label?: string | null;
  /** Sortie qui ne peut pas être refusée (mise au rebut d'un lot périmé…) : toujours tracée. */
  neverBlock?: boolean;
}

/**
 * Applique la politique à une sortie. Retourne la quantité réellement sortie et le manque.
 * Sans manque : aucun effet. Avec manque : erreur 409 en mode bloquant, anomalie sinon.
 */
export async function applyStockOut(client: Queryable, out: StockOut): Promise<{ applied: number; shortfall: number }> {
  const requested = r3(Math.max(0, out.requested));
  const available = r3(Math.max(0, out.available));
  const shortfall = r3(requested - available);
  if (shortfall <= 0) return { applied: requested, shortfall: 0 };

  if (!out.neverBlock && await negativeStockPolicy(out.kind) === 'block') {
    throw fail(`Stock insuffisant${out.label ? ` — ${out.label}` : ''} : ${requested} demandé, ${available} disponible (manque ${shortfall}). Sortie refusée.`);
  }
  await client.query(
    `INSERT INTO stock_anomalies (item_kind, item_id, lot_id, store_id, requested_qty, available_qty, shortfall_qty,
                                  origin_type, origin_id, label, created_by)
     VALUES ($1, $2, $3, $4, $5::numeric, $6::numeric, $7::numeric, $8, $9, $10, $11)`,
    [out.kind, out.itemId, out.lotId ?? null, out.storeId ?? null, requested, available, shortfall,
     out.origin.type, out.origin.id ?? null, out.label ?? null, out.userId ?? null]);
  // Le responsable de stock est prévenu ; une notification en échec ne bloque jamais la sortie.
  void createNotification({
    targetRole: 'magasinier', storeId: out.storeId ?? undefined, type: 'stock_anomaly',
    title: 'Sortie supérieure au stock',
    message: `${out.label ?? 'Article'} : ${requested} demandé, ${available} disponible, manque ${shortfall}. À régulariser dans Stock › Anomalies.`,
    referenceType: 'stock_anomaly', createdBy: out.userId ?? undefined,
  });
  return { applied: available, shortfall };
}

export const stockAnomalyRepository = {
  async list(params: { status?: 'open' | 'resolved'; storeId?: string | null }) {
    const r = await db.query(
      `SELECT a.id, a.item_kind, a.item_id, a.lot_id, a.store_id, a.requested_qty::float8 AS requested_qty,
              a.available_qty::float8 AS available_qty, a.shortfall_qty::float8 AS shortfall_qty,
              a.origin_type, a.origin_id, a.label, a.created_at, a.status, a.resolved_at, a.resolution_note,
              COALESCE(i.name, p.name, pk.name, r.name, a.label) AS item_name,
              COALESCE(i.unit, pk.unit, '') AS unit,
              s.name AS store_name,
              NULLIF(TRIM(CONCAT(u.first_name, ' ', u.last_name)), '') AS created_by_name,
              NULLIF(TRIM(CONCAT(ru.first_name, ' ', ru.last_name)), '') AS resolved_by_name
         FROM stock_anomalies a
         LEFT JOIN ingredients i ON a.item_kind = 'ingredient' AND i.id = a.item_id
         LEFT JOIN products p ON a.item_kind IN ('product', 'semi_finished') AND p.id = a.item_id
         LEFT JOIN recipes r ON a.item_kind = 'semi_finished' AND r.id = a.item_id
         LEFT JOIN packaging_items pk ON a.item_kind = 'packaging' AND pk.id = a.item_id
         LEFT JOIN stores s ON s.id = a.store_id
         LEFT JOIN users u ON u.id = a.created_by
         LEFT JOIN users ru ON ru.id = a.resolved_by
        WHERE ($1::text IS NULL OR a.status = $1)
          AND ($2::uuid IS NULL OR a.store_id IS NULL OR a.store_id = $2)
        ORDER BY a.created_at DESC LIMIT 500`,
      [params.status ?? null, params.storeId ?? null]);
    return r.rows;
  },

  /** Clôt une anomalie avec le motif de régularisation (ajustement, inventaire, erreur de saisie…). */
  async resolve(id: string, note: string, userId: string) {
    const r = await db.query(
      `UPDATE stock_anomalies SET status = 'resolved', resolved_by = $3, resolved_at = now(), resolution_note = $2
        WHERE id = $1 AND status = 'open' RETURNING id`, [id, note, userId]);
    if (!r.rows[0]) throw fail('Anomalie introuvable ou déjà traitée', 404);
    return r.rows[0];
  },
};
