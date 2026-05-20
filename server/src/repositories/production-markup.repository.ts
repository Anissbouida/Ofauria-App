import { db } from '../config/database.js';

/**
 * Majoration appliquee aux quantites suggerees d'approvisionnement.
 * Un taux global (company_settings.production_markup_percent) avec, en option,
 * un override par categorie. Toute modification est tracee dans
 * production_markup_history (qui, quand, ancienne -> nouvelle valeur).
 */
export const productionMarkupRepository = {
  /** Taux global + TOUTES les categories (markupPercent = override, ou null si aucun). */
  async getConfig() {
    const globalRes = await db.query(
      `SELECT production_markup_percent FROM company_settings WHERE id = 1`
    );
    const globalPercent = parseFloat(globalRes.rows[0]?.production_markup_percent ?? '5');

    const catRes = await db.query(`
      SELECT c.id as category_id, c.name as category_name,
             cm.markup_percent, cm.updated_at,
             (u.first_name || ' ' || u.last_name) as updated_by_name
      FROM categories c
      LEFT JOIN category_production_markup cm ON cm.category_id = c.id
      LEFT JOIN users u ON u.id = cm.updated_by
      ORDER BY c.display_order, c.name
    `);

    return {
      globalPercent,
      categories: catRes.rows.map((r) => ({
        categoryId: r.category_id as number,
        categoryName: r.category_name as string,
        markupPercent: r.markup_percent != null ? parseFloat(r.markup_percent) : null,
        updatedAt: r.updated_at,
        updatedByName: r.updated_by_name as string | null,
      })),
    };
  },

  /** Applique un lot de changements (global + categories) ; chaque diff est trace. */
  async applyChanges(
    data: { globalPercent?: number; categories?: { categoryId: number; percent: number | null }[] },
    userId: string,
  ) {
    if (data.globalPercent !== undefined) {
      await this.setGlobal(data.globalPercent, userId);
    }
    for (const c of data.categories || []) {
      await this.setCategory(c.categoryId, c.percent, userId);
    }
  },

  /** Taux global + map categorie->override. Consomme par getRecommendations. */
  async getEffectiveMap(): Promise<{ globalPercent: number; overrides: Record<number, number> }> {
    const globalRes = await db.query(
      `SELECT production_markup_percent FROM company_settings WHERE id = 1`
    );
    const globalPercent = parseFloat(globalRes.rows[0]?.production_markup_percent ?? '5');
    const catRes = await db.query(`SELECT category_id, markup_percent FROM category_production_markup`);
    const overrides: Record<number, number> = {};
    for (const r of catRes.rows) overrides[r.category_id as number] = parseFloat(r.markup_percent);
    return { globalPercent, overrides };
  },

  /** Met a jour le taux global et trace le changement. */
  async setGlobal(percent: number, userId: string) {
    const cur = await db.query(`SELECT production_markup_percent FROM company_settings WHERE id = 1`);
    const old = cur.rows[0] != null ? parseFloat(cur.rows[0].production_markup_percent) : null;
    if (old === percent) return;
    await db.query(
      `UPDATE company_settings SET production_markup_percent = $1, updated_at = NOW() WHERE id = 1`,
      [percent]
    );
    await db.query(
      `INSERT INTO production_markup_history (scope, category_id, old_percent, new_percent, changed_by)
       VALUES ('global', NULL, $1, $2, $3)`,
      [old, percent, userId]
    );
  },

  /** Definit (percent) ou supprime (percent=null) l'override d'une categorie, et trace. */
  async setCategory(categoryId: number, percent: number | null, userId: string) {
    const cur = await db.query(
      `SELECT markup_percent FROM category_production_markup WHERE category_id = $1`,
      [categoryId]
    );
    const old = cur.rows[0] != null ? parseFloat(cur.rows[0].markup_percent) : null;

    if (percent === null) {
      if (old === null) return; // aucun override : rien a faire
      await db.query(`DELETE FROM category_production_markup WHERE category_id = $1`, [categoryId]);
    } else {
      if (old === percent) return;
      await db.query(
        `INSERT INTO category_production_markup (category_id, markup_percent, updated_by, updated_at)
         VALUES ($1, $2, $3, NOW())
         ON CONFLICT (category_id) DO UPDATE SET markup_percent = $2, updated_by = $3, updated_at = NOW()`,
        [categoryId, percent, userId]
      );
    }
    await db.query(
      `INSERT INTO production_markup_history (scope, category_id, old_percent, new_percent, changed_by)
       VALUES ('category', $1, $2, $3, $4)`,
      [categoryId, old, percent, userId]
    );
  },

  /** Historique recent des modifications de majoration. */
  async getHistory(limit = 50) {
    const res = await db.query(
      `SELECT h.scope, h.category_id, c.name as category_name,
              h.old_percent, h.new_percent, h.changed_at,
              (u.first_name || ' ' || u.last_name) as changed_by_name
       FROM production_markup_history h
       LEFT JOIN categories c ON c.id = h.category_id
       LEFT JOIN users u ON u.id = h.changed_by
       ORDER BY h.changed_at DESC
       LIMIT $1`,
      [limit]
    );
    return res.rows;
  },
};
