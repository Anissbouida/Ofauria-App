import { db, withTransaction } from '../config/database.js';

/**
 * M6-02 (mig 605) — stock d'un lot PRODUIT FINI par emplacement, sur le modèle des
 * matières (ingredient_lot_locations, mig 570).
 *
 * « Vers magasin » et « vers frigo » deviennent l'envoi d'une quantité du lot vers un
 * emplacement de l'établissement, tracé en mouvement entre emplacements
 * (stock_location_moves.product_lot_id ; origine NULL = sortie de production).
 * Aucun emplacement n'est créé ici : s'il manque, le message dit où le définir.
 */

export type Destination = 'magasin' | 'frigo';
// Étape 8 multi-industries : la destination est un RÔLE d'emplacement (vente, froid positif) ;
// l'emplacement par défaut du rôle dans l'établissement est choisi (MAGASIN / FRIGO pour Ofauria).
const DEST: Record<Destination, { role: string; label: string }> = {
  magasin: { role: 'vente', label: 'Vente (magasin, vitrine)' },
  frigo: { role: 'froid_positif', label: 'Froid positif (frigo)' },
};

export class LocationError extends Error {
  statusCode: number;
  constructor(message: string, statusCode = 400) { super(message); this.statusCode = statusCode; }
}

const round3 = (n: number) => Math.round(n * 1000) / 1000;

export const productLotLocationRepository = {
  /**
   * Emplacement de destination d'un établissement : celui choisi (actif, du même
   * établissement ou commun), sinon l'emplacement par défaut du rôle (vente / froid positif).
   */
  async resolveDestination(storeId: string, dest: Destination, locationId?: string | null) {
    if (locationId) {
      const r = await db.query(
        `SELECT id, code, name FROM stock_locations WHERE id = $1 AND is_active AND (store_id = $2 OR store_id IS NULL)`,
        [locationId, storeId]);
      if (!r.rows[0]) throw new LocationError('Emplacement de destination introuvable, inactif ou d\'un autre établissement.');
      return r.rows[0] as { id: string; code: string; name: string };
    }
    const r = await db.query(
      `SELECT id, code, name FROM stock_locations WHERE id = fn_store_location($1::uuid, $2::text)`, [storeId, DEST[dest].role]);
    if (!r.rows[0]) {
      throw new LocationError(
        `Aucun emplacement de rôle « ${DEST[dest].label} » pour cet établissement : créez-le dans Stock › Emplacements, ou choisissez un emplacement de destination.`,
        409);
    }
    return r.rows[0] as { id: string; code: string; name: string };
  },

  /**
   * Déplace `quantity` d'un lot : depuis un emplacement (`fromLocationId`) ou depuis la
   * production (NULL : part du lot pas encore rangée), vers un emplacement
   * (`toLocationId`) ou hors emplacement (NULL : correction d'une saisie).
   * Contrôles : la quantité disponible à l'origine ; Σ emplacements ≤ réserve + vitrine.
   */
  async move(data: {
    productLotId: string; fromLocationId: string | null; toLocationId: string | null;
    quantity: number; motif: string; userId: string | null;
  }) {
    const qty = round3(data.quantity);
    if (!(qty > 0)) throw new LocationError('La quantité à déplacer doit être positive.');
    if (data.fromLocationId === data.toLocationId) throw new LocationError('Origine et destination identiques.');
    return withTransaction(async () => {
      const lot = (await db.query(
        `SELECT id, store_id, lot_number, (backroom_qty + vitrine_qty)::float8 AS remaining
           FROM product_lots WHERE id = $1 FOR UPDATE`, [data.productLotId])).rows[0];
      if (!lot) throw new LocationError('Lot introuvable.', 404);
      if (data.toLocationId) {
        const ok = (await db.query(
          `SELECT 1 FROM stock_locations WHERE id = $1 AND is_active AND (store_id = $2 OR store_id IS NULL)`,
          [data.toLocationId, lot.store_id])).rows[0];
        if (!ok) throw new LocationError('Emplacement de destination introuvable, inactif ou d\'un autre établissement.');
      }
      const placed = (await db.query(
        `SELECT location_id, quantity::float8 AS quantity FROM product_lot_locations WHERE product_lot_id = $1`,
        [data.productLotId])).rows as { location_id: string; quantity: number }[];
      const total = placed.reduce((s, r) => s + r.quantity, 0);
      const available = data.fromLocationId
        ? placed.find(r => r.location_id === data.fromLocationId)?.quantity ?? 0
        : round3(lot.remaining - total);
      if (qty > available + 0.0005) {
        throw new LocationError(data.fromLocationId
          ? `Quantité insuffisante dans l'emplacement d'origine : ${available} disponible(s).`
          : `Quantité du lot ${lot.lot_number} non rangée insuffisante : ${Math.max(round3(available), 0)} disponible(s).`);
      }
      if (data.fromLocationId) {
        await db.query(
          `UPDATE product_lot_locations SET quantity = quantity - $3, updated_at = NOW()
            WHERE product_lot_id = $1 AND location_id = $2`, [data.productLotId, data.fromLocationId, qty]);
      }
      if (data.toLocationId) {
        await db.query(
          `INSERT INTO product_lot_locations (product_lot_id, location_id, quantity) VALUES ($1, $2, $3)
           ON CONFLICT (product_lot_id, location_id) DO UPDATE SET quantity = product_lot_locations.quantity + EXCLUDED.quantity, updated_at = NOW()`,
          [data.productLotId, data.toLocationId, qty]);
      }
      await db.query(
        `INSERT INTO stock_location_moves (product_lot_id, from_location_id, to_location_id, quantite, motif, moved_by)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [data.productLotId, data.fromLocationId, data.toLocationId, qty, data.motif, data.userId]);
      return this.lotLocations(data.productLotId);
    });
  },

  /** Répartition d'un lot : quantité par emplacement + part non rangée. */
  async lotLocations(productLotId: string) {
    const lot = (await db.query(
      `SELECT id, lot_number, store_id, (backroom_qty + vitrine_qty)::float8 AS remaining FROM product_lots WHERE id = $1`,
      [productLotId])).rows[0];
    if (!lot) return null;
    const locations = (await db.query(
      `SELECT pll.location_id, sl.code, sl.name, sl.type, pll.quantity::float8 AS quantity
         FROM product_lot_locations pll JOIN stock_locations sl ON sl.id = pll.location_id
        WHERE pll.product_lot_id = $1 AND pll.quantity > 0 ORDER BY sl.name`, [productLotId])).rows;
    const placed = round3(locations.reduce((s: number, r: { quantity: number }) => s + r.quantity, 0));
    return { productLotId, lotNumber: lot.lot_number as string, remaining: lot.remaining as number, placed,
      unplaced: Math.max(round3(lot.remaining - placed), 0), locations };
  },

  /** Mouvements entre emplacements d'un lot produit fini, du plus récent au plus ancien. */
  async lotMoves(productLotId: string) {
    return (await db.query(
      `SELECT m.id, m.quantite::float8 AS quantity, m.motif, m.moved_at,
              f.code AS from_code, f.name AS from_name, t.code AS to_code, t.name AS to_name
         FROM stock_location_moves m
         LEFT JOIN stock_locations f ON f.id = m.from_location_id
         LEFT JOIN stock_locations t ON t.id = m.to_location_id
        WHERE m.product_lot_id = $1 ORDER BY m.moved_at DESC, m.created_at DESC`, [productLotId])).rows;
  },

  /**
   * Déclaration au rendement : la quantité envoyée vers le magasin ou le frigo est
   * rangée dans l'emplacement correspondant. Le rendement est ressaisissable : seul
   * l'écart avec la saisie précédente est déplacé (hausse = sortie de production vers
   * l'emplacement ; baisse = retrait de l'emplacement, borné à ce qui y reste).
   * Ne bloque jamais le rendement : rend des avertissements.
   */
  async applyRendementDestinations(data: {
    planId: string; planItemId: string; productId: string | null; storeId: string | null; userId: string;
    deltas: { dest: Destination; delta: number; locationId?: string | null }[];
  }): Promise<{ moved: { dest: Destination; location: string; quantity: number }[]; warnings: string[] }> {
    const out = { moved: [] as { dest: Destination; location: string; quantity: number }[], warnings: [] as string[] };
    const todo = data.deltas.filter(d => Math.abs(d.delta) > 0.0005);
    if (!todo.length) return out;
    if (!data.productId) { out.warnings.push('Emplacements non mis à jour : cet article n\'a pas de produit fini (recette de base).'); return out; }
    if (!data.storeId) { out.warnings.push('Emplacements non mis à jour : établissement inconnu.'); return out; }
    const lot = (await db.query(
      `SELECT id FROM product_lots WHERE production_plan_id = $1 AND product_id = $2
        ORDER BY (plan_item_id = $3) DESC NULLS LAST, created_at DESC LIMIT 1`,
      [data.planId, data.productId, data.planItemId])).rows[0];
    if (!lot) { out.warnings.push('Emplacements non mis à jour : le lot de cette production n\'est pas encore créé (déclarez la production d\'abord).'); return out; }
    for (const d of todo) {
      try {
        const loc = await this.resolveDestination(data.storeId, d.dest, d.locationId);
        let qty = Math.abs(d.delta);
        if (d.delta < 0) {
          const here = ((await this.lotLocations(lot.id))?.locations ?? []).find((r: { location_id: string }) => r.location_id === loc.id)?.quantity ?? 0;
          qty = Math.min(qty, here);
          if (qty <= 0) continue;
          await this.move({ productLotId: lot.id, fromLocationId: loc.id, toLocationId: null, quantity: qty, motif: 'correction', userId: data.userId });
          out.moved.push({ dest: d.dest, location: loc.name, quantity: -qty });
        } else {
          const unplaced = (await this.lotLocations(lot.id))?.unplaced ?? 0;
          if (unplaced < qty) {
            out.warnings.push(`${loc.name} : ${qty} demandé(s), ${unplaced} disponible(s) dans le lot — seule la part disponible est rangée.`);
            qty = unplaced;
          }
          if (qty <= 0) continue;
          await this.move({ productLotId: lot.id, fromLocationId: null, toLocationId: loc.id, quantity: qty, motif: 'production', userId: data.userId });
          out.moved.push({ dest: d.dest, location: loc.name, quantity: qty });
        }
      } catch (err) {
        out.warnings.push(err instanceof Error ? err.message : String(err));
      }
    }
    return out;
  },

  /** Contrôle M6-02 : lots produits finis dont Σ emplacements dépasse réserve + vitrine. */
  async balanceMismatches() {
    return (await db.query(
      `SELECT product_lot_id, lot_remaining::float8, locations_total::float8 FROM v_product_lot_location_balance
        WHERE locations_total - lot_remaining > 0.0005`)).rows;
  },
};
