import { db } from '../config/database.js';
import { bonSortieRepository } from './bon-sortie.repository.js';
import { inventoryRepository } from './inventory.repository.js';

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
 * Flux procure-to-pay (mig 456) : l'action unique de cet écran est « Créer la
 * demande d'achat » (pour tous les rôles). Le chemin « BC direct » est supprimé ;
 * la DA créée ici passe par l'approbation puis, une fois approuvée, devient un BC
 * depuis Achats › Demande d'achat. Cet écran ne crée donc QUE des DA.
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
            -- DA déjà en sourcing (AO vivant) : retirée du besoin pour ne pas être sourcée deux fois (mig 457).
            AND NOT EXISTS (SELECT 1 FROM rfq_requests rr JOIN rfqs r ON r.id = rr.rfq_id
                             WHERE rr.purchase_request_id = pr.id AND r.status IN ('draft', 'sent', 'quoted'))
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
              lp.unit_price AS last_price, lp.order_date AS last_order_date,
              ps.moq, ps.qty_per_container, ps.lead_time_days
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
         LEFT JOIN LATERAL (
           -- Paramètres du fournisseur préféré (L6) : quantité minimale de commande,
           -- conditionnement (multiple), délai de livraison — pour arrondir la suggestion.
           SELECT si.moq, si.qty_per_container, si.lead_time_days
             FROM supplier_items si
            WHERE si.purchasable_kind = 'ingredient' AND si.purchasable_id = ing.id
              AND si.is_preferred AND NOT si.is_blocked AND si.archived_at IS NULL
            LIMIT 1
         ) ps ON true
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
      const net = Math.max(0, Math.round((gross - onOrder) * 1000) / 1000);
      // Arrondi à la réalité d'achat (L6) : quantité minimale de commande (MOQ) du
      // fournisseur préféré, puis multiple du conditionnement (on ne commande pas un
      // demi-sac). N'inflate pas un besoin nul.
      const moq = parseFloat(x.moq) || 0;
      const perContainer = parseFloat(x.qty_per_container) || 0;
      let suggested = net;
      if (suggested > 0) {
        if (moq > 0) suggested = Math.max(suggested, moq);
        if (perContainer > 0) suggested = Math.ceil(suggested / perContainer) * perContainer;
        suggested = Math.round(suggested * 1000) / 1000;
      }
      const priority = n.rupture_qty > 0 ? 1 : n.request_qty > 0 ? 2 : 3;
      return {
        ...n,
        on_order_qty: onOrder,
        on_order_refs: (x.on_order_refs as string[] | null) ?? [],
        net_qty: net,
        suggested_qty: suggested,
        // Paramètres fournisseur appliqués à la suggestion (L6).
        moq,
        order_multiple: perContainer,
        lead_time_days: x.lead_time_days != null ? Number(x.lead_time_days) : null,
        rounded_up: suggested > net,
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
};
