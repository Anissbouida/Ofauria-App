import { db } from '../config/database.js';
import { applyContainerRule } from '../services/container-rule.js';
import { bonSortieRepository } from './bon-sortie.repository.js';
import { inventoryRepository } from './inventory.repository.js';
import { purchaseRequestRepository } from './purchase-request.repository.js';

type HttpError = Error & { statusCode: number; code?: string };
function httpError(statusCode: number, message: string, code?: string): HttpError {
  const e = new Error(message) as HttpError;
  e.statusCode = statusCode;
  if (code) e.code = code;
  return e;
}

/**
 * Écran Stock › « À commander » : un seul endroit pour TOUS les besoins d'achat
 * (remplace la Liste d'attente des Achats).
 *
 * Trois sources, fusionnées par ingrédient :
 *   - ruptures des bons de sortie actifs (urgent : la production attend) ;
 *   - demandes d'achat en attente (saisies par le magasinier, la production…) ;
 *   - stock sous le seuil minimum (anticipation).
 * On déduit ce qui est déjà en commande (reste à recevoir des BC ouverts) et on
 * propose un fournisseur (celui de la demande, sinon le dernier BC) et un prix.
 *
 * Les demandes d'achat restent la trace « qui a demandé quoi » et alimentent
 * l'indicateur « déjà commandé » des bons de sortie : la création de BC passe
 * toujours par elles (créées à la volée si besoin), elles ne sont simplement
 * plus un écran à part.
 */

type Need = {
  ingredient_id: string; ingredient_name: string; unit: string;
  rupture_qty: number; rupture_refs: string[];
  request_qty: number; request_ids: string[]; requesters: string[]; request_supplier_id: string | null;
  low_stock: { current: number; threshold: number; suggested: number } | null;
};

export const toOrderRepository = {
  async board(storeId?: string) {
    const [ruptures, alerts, requests] = await Promise.all([
      bonSortieRepository.findRuptureRequests(storeId ?? null),
      inventoryRepository.findAlerts(storeId),
      db.query(
        `SELECT pr.id, pr.ingredient_id, pr.quantity, pr.unit, pr.supplier_id, pr.reason, pr.note, pr.created_at,
                ing.name AS ingredient_name, ing.unit AS ingredient_unit,
                COALESCE(u.first_name || ' ' || u.last_name, u.email) AS requested_by_name
           FROM purchase_requests pr
           JOIN ingredients ing ON ing.id = pr.ingredient_id
           LEFT JOIN users u ON u.id = pr.requested_by
          WHERE pr.status = 'pending' AND ($1::uuid IS NULL OR pr.store_id = $1)
          ORDER BY pr.created_at`,
        [storeId ?? null]
      ),
    ]);

    const needs = new Map<string, Need>();
    const get = (id: string, name: string, unit: string) => {
      let n = needs.get(id);
      if (!n) {
        n = { ingredient_id: id, ingredient_name: name, unit, rupture_qty: 0, rupture_refs: [], request_qty: 0,
              request_ids: [], requesters: [], request_supplier_id: null, low_stock: null };
        needs.set(id, n);
      }
      return n;
    };
    for (const r of ruptures as Record<string, any>[]) {
      const n = get(r.ingredient_id, r.ingredient_name, r.unit || r.ingredient_unit || 'kg');
      n.rupture_qty += parseFloat(r.needed_quantity) || 0;
      if (r.bon_numero && !n.rupture_refs.includes(r.bon_numero)) n.rupture_refs.push(r.bon_numero);
    }
    for (const r of requests.rows) {
      const n = get(r.ingredient_id, r.ingredient_name, r.unit || r.ingredient_unit || 'kg');
      n.request_qty += parseFloat(r.quantity) || 0;
      n.request_ids.push(r.id);
      if (r.requested_by_name && !n.requesters.includes(r.requested_by_name)) n.requesters.push(r.requested_by_name);
      if (r.supplier_id && !n.request_supplier_id) n.request_supplier_id = r.supplier_id;
    }
    for (const a of alerts as Record<string, any>[]) {
      const n = get(a.ingredient_id, a.ingredient_name, a.unit || 'kg');
      const current = parseFloat(a.current_quantity) || 0;
      const threshold = parseFloat(a.minimum_threshold) || 0;
      // Ramène le stock à deux fois le seuil (au moins un seuil). Plusieurs zones : on garde le plus bas.
      const suggested = Math.max(threshold, threshold * 2 - current);
      if (!n.low_stock || current < n.low_stock.current) n.low_stock = { current, threshold, suggested };
    }
    const ids = [...needs.keys()];
    if (ids.length === 0) return { rows: [] };

    // Déjà en commande (reste à recevoir sur BC ouverts) + dernier fournisseur/prix connus.
    const extra = await db.query(
      `SELECT ing.id AS ingredient_id, ing.unit_cost,
              COALESCE(oo.on_order_qty, 0) AS on_order_qty, oo.on_order_refs,
              lp.supplier_id AS last_supplier_id, lp.supplier_name AS last_supplier_name,
              lp.unit_price AS last_price, lp.order_date AS last_order_date
         FROM ingredients ing
         LEFT JOIN LATERAL (
           SELECT SUM(GREATEST(poi.quantity_ordered - poi.qty_received_base - poi.qty_cancelled_base, 0)) AS on_order_qty,
                  array_agg(DISTINCT po.order_number) AS on_order_refs
             FROM purchase_order_items poi JOIN purchase_orders po ON po.id = poi.purchase_order_id
            WHERE poi.ingredient_id = ing.id
              AND po.status IN ('en_attente', 'envoye', 'livre_partiel')
              AND ($2::uuid IS NULL OR po.store_id = $2)
              AND poi.quantity_ordered - poi.qty_received_base - poi.qty_cancelled_base > 0
         ) oo ON true
         LEFT JOIN LATERAL (
           SELECT po.supplier_id, s.name AS supplier_name, poi.unit_price, po.order_date
             FROM purchase_order_items poi
             JOIN purchase_orders po ON po.id = poi.purchase_order_id
             JOIN suppliers s ON s.id = po.supplier_id AND s.is_active
            WHERE poi.ingredient_id = ing.id AND po.status NOT IN ('annule', 'non_livre')
            ORDER BY po.order_date DESC, po.created_at DESC
            LIMIT 1
         ) lp ON true
        WHERE ing.id = ANY($1::uuid[])`,
      [ids, storeId ?? null]
    );
    const extraById = new Map(extra.rows.map(r => [r.ingredient_id as string, r]));

    const rows = [...needs.values()].map(n => {
      const x = extraById.get(n.ingredient_id) ?? {};
      const onOrder = parseFloat(x.on_order_qty) || 0;
      // Besoin brut : le plus grand des trois (une demande vient souvent d'une rupture ou
      // d'un stock bas : les additionner compterait deux fois la même chose).
      const gross = Math.max(n.rupture_qty, n.request_qty, n.low_stock?.suggested ?? 0);
      // Les demandes en attente ne sont pas encore sur un BC : seul le reste des BC ouverts couvre.
      const suggested = Math.max(0, Math.round((gross - onOrder) * 1000) / 1000);
      const priority = n.rupture_qty > 0 ? 1 : n.request_qty > 0 ? 2 : 3;
      return {
        ...n,
        on_order_qty: onOrder,
        on_order_refs: (x.on_order_refs as string[] | null) ?? [],
        suggested_qty: suggested,
        // Rien à commander : besoin déjà couvert par les BC ouverts.
        covered: suggested <= 0,
        supplier_id: n.request_supplier_id ?? x.last_supplier_id ?? null,
        last_supplier_id: x.last_supplier_id ?? null,
        last_supplier_name: x.last_supplier_name ?? null,
        unit_price: x.last_price != null ? parseFloat(x.last_price) : (x.unit_cost != null ? parseFloat(x.unit_cost) : null),
        last_order_date: x.last_order_date ?? null,
        priority,
      };
    }).sort((a, b) => Number(a.covered) - Number(b.covered) || a.priority - b.priority || a.ingredient_name.localeCompare(b.ingredient_name, 'fr'));

    return { rows };
  },

  /**
   * Crée les BC (brouillons) depuis « À commander », en UNE transaction : pour chaque
   * ligne, les demandes en attente sont rattachées (ou une demande est créée pour le
   * besoin non demandé), le fournisseur leur est affecté, puis un BC par fournisseur.
   */
  async orderDirect(data: {
    lines: Array<{ ingredientId: string; quantity: number; supplierId: string; unit: string; requestIds: string[]; reason: string; note?: string }>;
    expectedDeliveryDate?: string;
    createdBy: string;
    storeId?: string;
  }) {
    const client = await db.getClient();
    try {
      await client.query('BEGIN');
      const bySupplier = new Map<string, { requestIds: string[]; overrides: Record<string, number> }>();
      for (const line of data.lines) {
        const locked = line.requestIds.length
          ? (await client.query(
              `SELECT id, quantity FROM purchase_requests
                WHERE id = ANY($1::uuid[]) AND ingredient_id = $2 AND status = 'pending'
                FOR UPDATE`,
              [line.requestIds, line.ingredientId])).rows
          : [];
        if (locked.length !== new Set(line.requestIds).size) {
          throw httpError(409, 'Une demande a été traitée entre-temps : rechargez la liste', 'TO_ORDER_STALE');
        }
        const requested = locked.reduce((s, r) => s + (parseFloat(r.quantity) || 0), 0);
        const ids = locked.map(r => r.id as string);
        const overrides: Record<string, number> = {};
        if (line.quantity > requested + 0.0005) {
          // Besoin non encore demandé (rupture, stock bas, quantité augmentée) : on crée la demande du complément.
          const { qty } = await applyContainerRule(client, line.ingredientId, line.quantity - requested);
          const ins = await client.query(
            `INSERT INTO purchase_requests (ingredient_id, supplier_id, quantity, unit, reason, note, requested_by, store_id)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
            [line.ingredientId, line.supplierId, qty, line.unit, line.reason, line.note ?? 'Créé depuis Stock › À commander', data.createdBy, data.storeId ?? null]
          );
          ids.push(ins.rows[0].id);
        } else if (line.quantity < requested - 0.0005 && requested > 0) {
          // Quantité réduite : on répartit au prorata sur les demandes rattachées.
          const ratio = line.quantity / requested;
          for (const r of locked) overrides[r.id] = Math.round((parseFloat(r.quantity) || 0) * ratio * 1000) / 1000;
        }
        await client.query(`UPDATE purchase_requests SET supplier_id = $1, updated_at = NOW() WHERE id = ANY($2::uuid[])`, [line.supplierId, ids]);
        const g = bySupplier.get(line.supplierId) ?? { requestIds: [], overrides: {} };
        g.requestIds.push(...ids);
        Object.assign(g.overrides, overrides);
        bySupplier.set(line.supplierId, g);
      }
      const orders: Record<string, any>[] = [];
      for (const [supplierId, g] of bySupplier) {
        orders.push(await purchaseRequestRepository._generatePurchaseOrderTx(client, {
          supplierId, requestIds: g.requestIds, quantityOverrides: g.overrides,
          expectedDeliveryDate: data.expectedDeliveryDate, createdBy: data.createdBy, storeId: data.storeId,
          notes: 'Créé depuis Stock › À commander',
        }));
      }
      await client.query('COMMIT');
      return { orders, requestIds: [...bySupplier.values()].flatMap(g => g.requestIds) };
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  },
};
