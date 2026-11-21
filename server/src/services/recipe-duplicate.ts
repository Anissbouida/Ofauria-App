import { db } from '../config/database.js';

/**
 * Dupliquer une fiche entière (scénario 1, constat 109).
 *
 * Copie la fiche (paramètres, étapes, catégorie, frais), ses formats actifs et leur
 * composition. Ne copie pas : le produit lié (un produit n'a qu'une fiche), l'attribution
 * des formats à un produit de caisse, les versions, sorties et substituts. La copie est
 * indépendante de l'original.
 *
 * Les colonnes copiées sont lues dans le catalogue : une colonne ajoutée plus tard suit
 * d'elle-même ; seules les colonnes d'identité, de lien et d'horodatage sont exclues.
 */

const SKIP: Record<string, Set<string>> = {
  recipes: new Set(['id', 'name', 'product_id', 'alternative_for_product_id', 'usage',
    'created_at', 'updated_at', 'archived_at', 'archived_by', 'category_id']),
  recipe_formats: new Set(['id', 'recipe_id', 'product_id', 'created_at', 'updated_at', 'updated_by']),
  recipe_format_components: new Set(['id', 'format_id', 'created_at', 'updated_at', 'updated_by']),
};

type Queryable = { query: (sql: string, params?: unknown[]) => Promise<{ rows: Record<string, unknown>[] }> };

const columnCache = new Map<string, string[]>();
async function columns(client: Queryable, table: string): Promise<string[]> {
  if (!columnCache.has(table)) {
    const rows = (await client.query(
      `SELECT column_name FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = $1 AND is_generated = 'NEVER'
        ORDER BY ordinal_position`, [table])).rows;
    columnCache.set(table, rows.map(r => r.column_name as string).filter(c => !SKIP[table].has(c)));
  }
  return columnCache.get(table)!;
}

const q = (c: string) => `"${c.replace(/"/g, '""')}"`;

export class RecipeDuplicateError extends Error {
  constructor(message: string, public statusCode = 400) { super(message); }
}

/** Duplique la fiche ; rend l'id de la copie. `categoryId` undefined = catégorie de l'original. */
export async function duplicateRecipe(sourceId: string, name: string, categoryId: string | null | undefined, userId: string | null): Promise<string> {
  const label = name.trim();
  if (!label) throw new RecipeDuplicateError('Le nom de la copie est requis.');
  const client = await db.getClient();
  try {
    await client.query('BEGIN');
    const src = (await client.query(`SELECT id, category_id FROM recipes WHERE id = $1`, [sourceId])).rows[0];
    if (!src) throw new RecipeDuplicateError('Fiche introuvable.', 404);

    const rc = await columns(client, 'recipes');
    const newId = (await client.query(
      `INSERT INTO recipes (name, category_id, ${rc.map(q).join(', ')})
       SELECT $2, $3, ${rc.map(q).join(', ')} FROM recipes WHERE id = $1 RETURNING id`,
      [sourceId, label, categoryId === undefined ? src.category_id : categoryId])).rows[0].id as string;

    const fc = await columns(client, 'recipe_formats');
    const cc = await columns(client, 'recipe_format_components');
    const formats = (await client.query(
      `SELECT id FROM recipe_formats WHERE recipe_id = $1 AND is_active ORDER BY ordre, created_at`, [sourceId])).rows;
    for (const f of formats) {
      const nf = (await client.query(
        `INSERT INTO recipe_formats (recipe_id, updated_by, ${fc.map(q).join(', ')})
         SELECT $2, $3, ${fc.map(q).join(', ')} FROM recipe_formats WHERE id = $1 RETURNING id`,
        [f.id, newId, userId])).rows[0].id;
      await client.query(
        `INSERT INTO recipe_format_components (format_id, updated_by, ${cc.map(q).join(', ')})
         SELECT $2, $3, ${cc.map(q).join(', ')} FROM recipe_format_components WHERE format_id = $1`,
        [f.id, nf, userId]);
    }
    await client.query('COMMIT');
    return newId;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}
