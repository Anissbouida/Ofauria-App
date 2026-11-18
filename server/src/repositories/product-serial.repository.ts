import { db } from '../config/database.js';

/**
 * Numéros de série en fabrication (M9, mig 585).
 * Appelé par la déclaration de production (services/production-declaration.ts), dans sa
 * transaction : pour chaque lot fabriqué d'un article suivi par série, un numéro par pièce.
 * Numéros saisis par l'opérateur d'abord, puis « numéro de lot-0001… » pour le reste.
 */
export class SerialError extends Error {
  statusCode = 400;
}

/** Numéros à créer pour un lot (pure, testée sans base). */
export function planSerials(lotNumber: string, quantity: number, existing: string[], provided: string[] = []): string[] {
  if (!Number.isInteger(quantity) || quantity < 0) throw new SerialError(`Article suivi par numéro de série : quantité entière attendue (${quantity})`);
  const need = quantity - existing.length;
  if (need <= 0) return [];
  const clean = provided.map(s => s.trim()).filter(Boolean);
  const dup = clean.find((s, i) => clean.indexOf(s) !== i);
  if (dup) throw new SerialError(`Numéro de série en double : ${dup}`);
  if (clean.length > need) throw new SerialError(`${clean.length} numéros saisis pour ${need} pièce(s)`);
  const taken = new Set([...existing, ...clean]);
  const out = [...clean];
  for (let seq = 1; out.length < need; seq++) {
    const sn = `${lotNumber}-${String(seq).padStart(4, '0')}`;
    if (!taken.has(sn)) { out.push(sn); taken.add(sn); }
  }
  return out;
}

export const productSerialRepository = {
  /** Après la déclaration : complète les numéros des lots de l'ordre suivis par série. */
  async assignForPlan(planId: string, items: { planItemId: string; serials?: string[] }[], userId: string) {
    const provided = new Map(items.filter(i => i.serials?.length).map(i => [i.planItemId, i.serials!]));
    const lots = (await db.query(
      `SELECT pl.id, pl.lot_number, pl.product_id, pl.plan_item_id, pl.quantity_total::float8 AS qty, p.name AS product_name
         FROM product_lots pl JOIN products p ON p.id = pl.product_id AND p.tracking_mode = 'serial'
        WHERE pl.production_plan_id = $1::uuid ORDER BY pl.created_at`, [planId])).rows;
    let created = 0;
    for (const lot of lots) {
      const existing = (await db.query(`SELECT serial_number FROM product_serials WHERE product_lot_id = $1::uuid`, [lot.id])).rows.map(r => r.serial_number as string);
      const fromUser = lot.plan_item_id ? provided.get(lot.plan_item_id) ?? [] : [];
      const toCreate = planSerials(lot.lot_number, Number(lot.qty), existing, fromUser);
      if (!toCreate.length) continue;
      const clash = (await db.query(
        `SELECT serial_number FROM product_serials WHERE product_id = $1::uuid AND serial_number = ANY($2::text[]) LIMIT 1`,
        [lot.product_id, toCreate])).rows[0];
      if (clash) throw new SerialError(`Numéro de série déjà attribué pour « ${lot.product_name} » : ${clash.serial_number}`);
      await db.query(
        `INSERT INTO product_serials (product_id, serial_number, product_lot_id, plan_id, plan_item_id, created_by)
         SELECT $1::uuid, sn, $2::uuid, $3::uuid, $4::uuid, $5::uuid FROM unnest($6::text[]) AS sn`,
        [lot.product_id, lot.id, planId, lot.plan_item_id, userId, toCreate]);
      created += toCreate.length;
    }
    return { created };
  },

  async listForPlan(planId: string) {
    return (await db.query(
      `SELECT s.id, s.serial_number, s.status, s.created_at, p.name AS product_name, pl.lot_number
         FROM product_serials s JOIN products p ON p.id = s.product_id LEFT JOIN product_lots pl ON pl.id = s.product_lot_id
        WHERE s.plan_id = $1::uuid ORDER BY p.name, s.serial_number`, [planId])).rows;
  },

  /** Traçabilité d'un numéro : article, lot, ordre de fabrication, statut. */
  async lookup(serial: string) {
    return (await db.query(
      `SELECT s.id, s.serial_number, s.status, s.created_at, p.id AS product_id, p.name AS product_name,
              pl.lot_number, pl.produced_at, pp.id AS plan_id, pp.of_number
         FROM product_serials s JOIN products p ON p.id = s.product_id
         LEFT JOIN product_lots pl ON pl.id = s.product_lot_id
         LEFT JOIN production_plans pp ON pp.id = s.plan_id
        WHERE s.serial_number = $1::text ORDER BY s.created_at DESC LIMIT 20`, [serial.trim()])).rows;
  },
};
