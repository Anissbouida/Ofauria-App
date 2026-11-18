import { db } from '../config/database.js';
import { PRODUCTION_SCREEN_KEYS, isMaskableScreenElement } from '@ofauria/shared';

/**
 * Écrans de fabrication (mig 591) : éléments masqués pour la société (orderTypeId null) ou pour
 * un type d'ordre. Le client applique « masqué société ∪ masqué pour le type de l'ordre » par-dessus
 * les règles du registre. Seuls les éléments masquables du catalogue sont acceptés.
 */
export class ScreenSettingError extends Error {
  statusCode = 400;
}

export const productionScreensRepository = {
  async list(): Promise<{ orderTypeId: string | null; key: string }[]> {
    return (await db.query(
      `SELECT order_type_id AS "orderTypeId", element_key AS key FROM production_screen_hidden ORDER BY element_key`)).rows;
  },

  async setHidden(orderTypeId: string | null, key: string, hidden: boolean, userId: string) {
    if (!PRODUCTION_SCREEN_KEYS.has(key)) throw new ScreenSettingError('Élément d\'écran inconnu');
    if (hidden && !isMaskableScreenElement(key)) throw new ScreenSettingError('Cet élément est indispensable au parcours : il ne se masque pas');
    if (orderTypeId) {
      const t = (await db.query(`SELECT 1 FROM production_order_types WHERE id = $1::uuid`, [orderTypeId])).rows[0];
      if (!t) throw new ScreenSettingError('Type d\'ordre inconnu');
    }
    if (hidden) {
      await db.query(
        `INSERT INTO production_screen_hidden (order_type_id, element_key, updated_by) VALUES ($1::uuid, $2::text, $3::uuid)
         ON CONFLICT (COALESCE(order_type_id, '00000000-0000-0000-0000-000000000000'::uuid), element_key) DO NOTHING`,
        [orderTypeId, key, userId]);
    } else {
      await db.query(
        `DELETE FROM production_screen_hidden WHERE element_key = $2::text
            AND COALESCE(order_type_id, '00000000-0000-0000-0000-000000000000'::uuid) = COALESCE($1::uuid, '00000000-0000-0000-0000-000000000000'::uuid)`,
        [orderTypeId, key]);
    }
    return this.list();
  },
};
