import { db } from '../config/database.js';
import { setAuditUser } from '../utils/audit-context.js';
import { nextDocumentNumber } from '../utils/document-number.js';
import { adjustProductStock } from './product-stock.helper.js';
import { collectIngredientNeedsForUnits } from './recipe-composition.helper.js';

/**
 * Désassemblage (M9, mig 589) : défaire N pièces d'un lot de produit fini et remettre en stock
 * les matières de sa nomenclature, au taux de récupération saisi.
 *  - lot de produit fini : backroom_qty − N, recycled_qty + N (invariant du lot conservé) ;
 *  - stock produit : − N, mouvement « adjustment » rattaché à la pièce DSA ;
 *  - par matière : un lot créé en économat (source_product_lot_id = lot d'origine) — le
 *    déclencheur trg_inventory_sync_lots recalcule l'inventaire — et un mouvement « adjustment ».
 * Une seule transaction : tout passe ou rien.
 */
export class DisassemblyError extends Error {
  statusCode = 400;
}

const r4 = (v: number) => Math.round(v * 10000) / 10000;

export const disassemblyRepository = {
  async disassemble(input: { productLotId: string; quantity: number; recoveryPct?: number; notes?: string | null }, userId: string) {
    const recovery = input.recoveryPct ?? 100;
    if (!(input.quantity > 0)) throw new DisassemblyError('Quantité à désassembler invalide');
    if (!(recovery > 0 && recovery <= 100)) throw new DisassemblyError('Taux de récupération entre 0 et 100 %');
    const client = await db.getClient();
    try {
      await client.query('BEGIN');
      await setAuditUser(client, userId);
      const lot = (await client.query(
        `SELECT pl.id, pl.product_id, pl.store_id, pl.lot_number, pl.backroom_qty::float8 AS backroom, pl.expires_at, p.name AS product_name
           FROM product_lots pl JOIN products p ON p.id = pl.product_id WHERE pl.id = $1::uuid FOR UPDATE OF pl`, [input.productLotId])).rows[0];
      if (!lot) throw new DisassemblyError('Lot introuvable');
      if (lot.backroom < input.quantity) throw new DisassemblyError(`Seulement ${lot.backroom} pièce(s) en arrière-boutique sur le lot ${lot.lot_number}`);
      const recipe = (await client.query(
        `SELECT id FROM recipes WHERE product_id = $1::uuid AND archived_at IS NULL LIMIT 1`, [lot.product_id])).rows[0];
      if (!recipe) throw new DisassemblyError(`« ${lot.product_name} » n'a pas de nomenclature : rien à remettre en stock`);

      const needs = new Map<string, number>();
      await collectIngredientNeedsForUnits(client, recipe.id, input.quantity, (id, q) => needs.set(id, (needs.get(id) ?? 0) + q));
      const lines = [...needs.entries()].map(([id, q]) => [id, r4(q * recovery / 100)] as const).filter(([, q]) => q > 0);
      if (!lines.length) throw new DisassemblyError('La nomenclature ne contient aucune matière à remettre en stock');

      const numero = await nextDocumentNumber(client, 'disassembly');
      const order = (await client.query(
        `INSERT INTO disassembly_orders (numero, product_id, product_lot_id, quantity, recovery_pct, store_id, notes, created_by)
         VALUES ($1::text, $2::uuid, $3::uuid, $4::numeric, $5::numeric, $6::uuid, $7::text, $8::uuid) RETURNING id`,
        [numero, lot.product_id, lot.id, input.quantity, recovery, lot.store_id, input.notes?.trim() || null, userId])).rows[0];

      // Produit fini : sortie de l'arrière-boutique, comptée comme remise en matière (recycled_qty).
      await client.query(
        `UPDATE product_lots SET backroom_qty = backroom_qty - $2::numeric, recycled_qty = recycled_qty + $2::numeric WHERE id = $1::uuid`,
        [lot.id, input.quantity]);
      const stockAfter = await adjustProductStock(client, lot.product_id, -input.quantity, lot.store_id,
        { origin: { type: 'disassembly', id: order.id }, userId, label: lot.product_name });
      await client.query(
        `INSERT INTO product_stock_transactions (product_id, type, quantity_change, stock_after, note, reference_id, performed_by, store_id)
         VALUES ($1, 'adjustment', $2, $3, $4, $5, $6, $7)`,
        [lot.product_id, -input.quantity, stockAfter, `Désassemblage ${numero} (lot ${lot.lot_number})`, order.id, userId, lot.store_id]);

      // Matières : un lot par matière, rattaché au lot d'origine.
      for (const [ingredientId, qty] of lines) {
        const ing = (await client.query(`SELECT unit_cost FROM ingredients WHERE id = $1`, [ingredientId])).rows[0];
        const unitCost = ing?.unit_cost != null ? Number(ing.unit_cost) : null;
        const ingLot = (await client.query(
          `INSERT INTO ingredient_lots (ingredient_id, lot_number, supplier_lot_number, quantity_received, quantity_remaining,
                                        economat_quantity, pesage_quantity, unit_cost, manufactured_date, expiration_date,
                                        received_at, store_id, status, notes, source_product_lot_id)
           VALUES ($1, $2, $3, $4, $4, $4, 0, $5, CURRENT_DATE, $6, CURRENT_DATE, $7, 'active', $8, $9) RETURNING id`,
          [ingredientId, `${numero}-${ingredientId.slice(0, 6)}`.slice(0, 50), lot.lot_number, qty, unitCost,
           lot.expires_at ?? null, lot.store_id, `Désassemblage ${numero} : ${input.quantity} × ${lot.product_name} (${recovery} %)`, lot.id])).rows[0];
        await client.query(
          `INSERT INTO inventory_transactions (ingredient_id, type, quantity_change, note, performed_by, store_id, ingredient_lot_id)
           VALUES ($1, 'adjustment', $2, $3, $4, $5, $6)`,
          [ingredientId, qty, `Désassemblage ${numero}`, userId, lot.store_id, ingLot.id]);
        await client.query(
          `INSERT INTO disassembly_lines (disassembly_id, ingredient_id, quantity, unit_cost, ingredient_lot_id) VALUES ($1, $2, $3, $4, $5)`,
          [order.id, ingredientId, qty, unitCost, ingLot.id]);
      }
      await client.query('COMMIT');
      return { id: order.id as string, numero, lines: lines.length };
    } catch (err) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw err;
    } finally {
      client.release();
    }
  },

  /** Lots de produits finis qu'on peut désassembler : pièces en arrière-boutique et nomenclature. */
  async candidates(storeId?: string | null) {
    return (await db.query(
      `SELECT pl.id, pl.lot_number, pl.backroom_qty::float8 AS backroom, p.id AS product_id, p.name AS product_name
         FROM product_lots pl JOIN products p ON p.id = pl.product_id
        WHERE pl.backroom_qty > 0 AND pl.status = 'active' AND ($1::uuid IS NULL OR pl.store_id = $1::uuid)
          AND EXISTS (SELECT 1 FROM recipes r WHERE r.product_id = p.id AND r.archived_at IS NULL)
        ORDER BY p.name, pl.produced_at DESC LIMIT 300`, [storeId ?? null])).rows;
  },

  async list(storeId?: string | null) {
    return (await db.query(
      `SELECT d.id, d.numero, d.quantity::float8 AS quantity, d.recovery_pct::float8 AS recovery_pct, d.created_at, d.notes,
              p.name AS product_name, pl.lot_number, NULLIF(concat_ws(' ', u.first_name, u.last_name), '') AS created_by_name,
              COALESCE((SELECT json_agg(json_build_object('ingredient', i.name, 'quantity', l.quantity::float8, 'unit', i.unit) ORDER BY i.name)
                          FROM disassembly_lines l JOIN ingredients i ON i.id = l.ingredient_id WHERE l.disassembly_id = d.id), '[]') AS lines
         FROM disassembly_orders d JOIN products p ON p.id = d.product_id JOIN product_lots pl ON pl.id = d.product_lot_id
         LEFT JOIN users u ON u.id = d.created_by
        WHERE ($1::uuid IS NULL OR d.store_id = $1::uuid) ORDER BY d.created_at DESC LIMIT 100`, [storeId ?? null])).rows;
  },
};
