import { db } from '../config/database.js';

/**
 * Conversions propres à l'article (M3-02, mig 555) : « 1 source = facteur cible ».
 * Les lignes reprises (densité, contenant, poids par pièce) suivent leurs colonnes
 * d'origine sur la fiche ingrédient et ne s'éditent pas ici ; seules les lignes saisies
 * s'ajoutent, se modifient et se retirent.
 */
export type ItemKind = 'ingredient' | 'packaging' | 'product';

export const itemConversionsRepository = {
  async list(kind: ItemKind, itemId: string) {
    return (await db.query(
      `SELECT c.id, c.origin, c.factor::float8 AS factor, c.notes,
              fu.code AS from_unit, fu.label AS from_unit_label, ct.label AS from_container,
              tu.code AS to_unit, tu.label AS to_unit_label
         FROM item_unit_conversions c
         LEFT JOIN ref_entries fu ON fu.id = c.from_unit_id
         LEFT JOIN ref_entries ct ON ct.id = c.from_container_type_id
         JOIN ref_entries tu ON tu.id = c.to_unit_id
        WHERE c.item_kind = $1 AND c.item_id = $2
        ORDER BY c.origin, fu.code NULLS LAST, ct.label`, [kind, itemId])).rows;
  },

  async create(kind: ItemKind, itemId: string, data: { fromUnit: string; toUnit: string; factor: number; notes?: string | null }, userId: string) {
    const units = (await db.query(
      `SELECT code, id FROM ref_entries WHERE table_id = 'units' AND code = ANY($1::text[])`, [[data.fromUnit, data.toUnit]])).rows;
    const id = (code: string) => units.find(u => u.code === code)?.id;
    if (!id(data.fromUnit) || !id(data.toUnit)) throw new Error('Unité inconnue du référentiel');
    if (data.fromUnit === data.toUnit) throw new Error('Choisissez deux unités différentes');
    const r = await db.query(
      `INSERT INTO item_unit_conversions (item_kind, item_id, from_unit_id, to_unit_id, factor, origin, notes, updated_by)
       VALUES ($1, $2, $3, $4, $5, 'saisie', $6, $7) RETURNING id`,
      [kind, itemId, id(data.fromUnit), id(data.toUnit), data.factor, data.notes ?? null, userId]);
    return r.rows[0];
  },

  async update(kind: ItemKind, itemId: string, convId: string, data: { factor: number; notes?: string | null }, userId: string) {
    const r = await db.query(
      `UPDATE item_unit_conversions SET factor = $4, notes = $5, updated_by = $6, updated_at = now()
        WHERE id = $3 AND item_kind = $1 AND item_id = $2 AND origin = 'saisie' RETURNING id`,
      [kind, itemId, convId, data.factor, data.notes ?? null, userId]);
    if (!r.rows[0]) throw new Error('Conversion introuvable ou reprise d\'une colonne de la fiche (à modifier sur la fiche)');
    return r.rows[0];
  },

  async remove(kind: ItemKind, itemId: string, convId: string) {
    const r = await db.query(
      `DELETE FROM item_unit_conversions WHERE id = $3 AND item_kind = $1 AND item_id = $2 AND origin = 'saisie' RETURNING id`,
      [kind, itemId, convId]);
    if (!r.rows[0]) throw new Error('Conversion introuvable ou reprise d\'une colonne de la fiche (à modifier sur la fiche)');
    return { removed: true };
  },
};
