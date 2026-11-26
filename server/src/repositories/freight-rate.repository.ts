import { db, withTransaction } from '../config/database.js';
import { computeFreightPrice } from '@ofauria/shared';

/**
 * Grilles tarifaires du transport (mig 714, feuille de route étape 3.4). Une grille par base
 * (poids, palettes, distance), générale ou propre à un client et à un trajet, avec ses tranches.
 */
export class FreightRateError extends Error {
  constructor(message: string, public statusCode = 400) { super(message); }
}

export type FreightGridInput = {
  name: string; customerId?: string | null; basis: string; originZone?: string | null; destinationZone?: string | null;
  minimumCharge?: number; tvaRate?: number; validFrom?: string | null; validTo?: string | null; isActive?: boolean;
  brackets: { upTo: number | null; unitPrice: number; flatPrice?: number }[];
};

const BASES = ['weight', 'pallet', 'distance'];

function check(g: FreightGridInput) {
  if (!g.name?.trim()) throw new FreightRateError('Nom de la grille obligatoire');
  if (!BASES.includes(g.basis)) throw new FreightRateError('Base attendue : poids, palettes ou distance');
  if (!g.brackets?.length) throw new FreightRateError('Au moins une tranche');
  const open = g.brackets.filter(b => b.upTo === null || b.upTo === undefined);
  if (open.length > 1) throw new FreightRateError('Une seule tranche « au-delà »');
  const bounds = g.brackets.filter(b => b.upTo !== null && b.upTo !== undefined).map(b => Number(b.upTo));
  if (bounds.some(b => !(b > 0))) throw new FreightRateError('Borne de tranche attendue positive');
  if (new Set(bounds).size !== bounds.length) throw new FreightRateError('Deux tranches ont la même borne');
  if (g.brackets.some(b => !(Number(b.unitPrice) >= 0) || !(Number(b.flatPrice ?? 0) >= 0))) throw new FreightRateError('Prix attendus positifs ou nuls');
  if (!(Number(g.minimumCharge ?? 0) >= 0)) throw new FreightRateError('Minimum de facturation attendu positif ou nul');
}

async function writeBrackets(gridId: string, brackets: FreightGridInput['brackets']) {
  await db.query(`DELETE FROM freight_rate_brackets WHERE grid_id = $1`, [gridId]);
  for (const b of brackets) {
    await db.query(`INSERT INTO freight_rate_brackets (grid_id, up_to, unit_price, flat_price) VALUES ($1, $2, $3, $4)`,
      [gridId, b.upTo ?? null, Number(b.unitPrice), Number(b.flatPrice ?? 0)]);
  }
}

export const freightRateRepository = {
  async list() {
    return (await db.query(
      `SELECT g.*, COALESCE(c.company_name, NULLIF(TRIM(CONCAT(c.first_name, ' ', c.last_name)), '')) AS customer_name,
              COALESCE((SELECT json_agg(json_build_object('id', b.id, 'upTo', b.up_to::float8, 'unitPrice', b.unit_price::float8, 'flatPrice', b.flat_price::float8)
                         ORDER BY b.up_to NULLS LAST) FROM freight_rate_brackets b WHERE b.grid_id = g.id), '[]') AS brackets
         FROM freight_rate_grids g LEFT JOIN customers c ON c.id = g.customer_id
        ORDER BY g.is_active DESC, g.name`)).rows;
  },

  async create(g: FreightGridInput, userId: string) {
    check(g);
    return withTransaction(async () => {
      const r = (await db.query(
        `INSERT INTO freight_rate_grids (name, customer_id, basis, origin_zone, destination_zone, minimum_charge, tva_rate, valid_from, valid_to, is_active, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING id`,
        [g.name.trim(), g.customerId || null, g.basis, g.originZone?.trim() || null, g.destinationZone?.trim() || null,
         Number(g.minimumCharge ?? 0), Number(g.tvaRate ?? 0), g.validFrom || null, g.validTo || null, g.isActive ?? true, userId])).rows[0];
      await writeBrackets(r.id, g.brackets);
      return r.id as string;
    });
  },

  async update(id: string, g: FreightGridInput) {
    check(g);
    return withTransaction(async () => {
      const r = await db.query(
        `UPDATE freight_rate_grids SET name = $2, customer_id = $3, basis = $4, origin_zone = $5, destination_zone = $6, minimum_charge = $7,
                tva_rate = $8, valid_from = $9, valid_to = $10, is_active = $11, updated_at = now() WHERE id = $1`,
        [id, g.name.trim(), g.customerId || null, g.basis, g.originZone?.trim() || null, g.destinationZone?.trim() || null,
         Number(g.minimumCharge ?? 0), Number(g.tvaRate ?? 0), g.validFrom || null, g.validTo || null, g.isActive ?? true]);
      if (!r.rowCount) throw new FreightRateError('Grille introuvable', 404);
      await writeBrackets(id, g.brackets);
    });
  },

  async remove(id: string) {
    const r = await db.query(`DELETE FROM freight_rate_grids WHERE id = $1`, [id]);
    if (!r.rowCount) throw new FreightRateError('Grille introuvable', 404);
  },

  /**
   * Prix d'une prestation : grille la plus précise valable à la date (client avant général,
   * trajet exact avant trajet libre), puis calcul par tranche.
   */
  async price(q: { basis: string; quantity: number; customerId?: string | null; originZone?: string | null; destinationZone?: string | null; date?: string | null }) {
    if (!BASES.includes(q.basis)) throw new FreightRateError('Base attendue : poids, palettes ou distance');
    if (!(Number(q.quantity) > 0)) throw new FreightRateError('Quantité attendue positive');
    const grid = (await db.query(
      `SELECT g.* FROM freight_rate_grids g
        WHERE g.is_active AND g.basis = $1
          AND (g.customer_id IS NULL OR g.customer_id = $2::uuid)
          AND (g.origin_zone IS NULL OR lower(g.origin_zone) = lower($3::text))
          AND (g.destination_zone IS NULL OR lower(g.destination_zone) = lower($4::text))
          AND (g.valid_from IS NULL OR g.valid_from <= COALESCE($5::date, CURRENT_DATE))
          AND (g.valid_to IS NULL OR g.valid_to >= COALESCE($5::date, CURRENT_DATE))
        ORDER BY (g.customer_id IS NOT NULL) DESC, (g.origin_zone IS NOT NULL)::int + (g.destination_zone IS NOT NULL)::int DESC, g.created_at DESC
        LIMIT 1`, [q.basis, q.customerId || null, q.originZone || null, q.destinationZone || null, q.date || null])).rows[0];
    if (!grid) throw new FreightRateError('Aucune grille ne couvre cette prestation', 404);
    const brackets = (await db.query(`SELECT up_to, unit_price, flat_price FROM freight_rate_brackets WHERE grid_id = $1`, [grid.id])).rows
      .map(b => ({ upTo: b.up_to === null ? null : Number(b.up_to), unitPrice: Number(b.unit_price), flatPrice: Number(b.flat_price) }));
    const r = computeFreightPrice(brackets, Number(q.quantity), Number(grid.minimum_charge));
    const tax = Math.round(r.amount * Number(grid.tva_rate)) / 100;
    return { gridId: grid.id, gridName: grid.name, ...r, taxAmount: tax, totalTtc: Math.round((r.amount + tax) * 100) / 100 };
  },
};
