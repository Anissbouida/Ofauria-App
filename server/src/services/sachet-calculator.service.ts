import { db } from '../config/database.js';

export type CartItemInput = {
  productId: string;
  quantity: number;
};

export type SachetSuggestion = {
  suggested: number;
  breakdown: Array<{
    productId: string;
    categoryId: number | null;
    categoryName: string | null;
    quantity: number;
    ratio: number | null;
    needsSachet: boolean;
    weight: number;
  }>;
};

/**
 * Calcule le nombre de sachets a remettre pour un panier.
 *
 * Methode "ponderee" : chaque article compte pour 1 / ratio_categorie de sachet.
 * On arrondit la somme a l'entier INFERIEUR (Math.floor) : le ratio est un
 * seuil strict, on ne suggere un sachet que par tranche complete. Exemple avec
 * un ratio de 15 : 1 a 14 viennoiseries -> 0 sachet, 15 a 29 -> 1, 30 a 44 -> 2.
 * Conforme a l'objectif anti-gaspillage ; la vendeuse peut toujours augmenter
 * manuellement si le client le demande.
 *
 * - Si la categorie a needs_sachet = false (produits deja emballes), le produit
 *   est ignore (poids = 0).
 * - Si articles_per_sachet est NULL, on utilise le defaut global de
 *   company_settings.default_articles_per_sachet.
 * - Les produits sans categorie utilisent aussi le defaut global.
 * - Les produits vendus au poids comptent pour 1 article (le sachet contient
 *   un emballage, peu importe la quantite pesee).
 */
export async function computeSuggestedSachets(
  items: CartItemInput[]
): Promise<SachetSuggestion> {
  if (items.length === 0) return { suggested: 0, breakdown: [] };

  // Recupere le defaut global.
  const settingsRes = await db.query(
    'SELECT default_articles_per_sachet FROM company_settings WHERE id = 1'
  );
  const defaultRatio: number =
    settingsRes.rows[0]?.default_articles_per_sachet ?? 5;

  // Recupere les produits et leur categorie en un seul appel.
  const productIds = items.map((i) => i.productId);
  const prodRes = await db.query(
    `SELECT p.id, p.sale_unit, p.category_id, c.name AS category_name,
            c.articles_per_sachet, c.needs_sachet
       FROM products p
       LEFT JOIN categories c ON c.id = p.category_id
      WHERE p.id = ANY($1::uuid[])`,
    [productIds]
  );

  const byId = new Map<
    string,
    {
      sale_unit: string;
      category_id: number | null;
      category_name: string | null;
      articles_per_sachet: number | null;
      needs_sachet: boolean | null;
    }
  >();
  for (const row of prodRes.rows) byId.set(row.id, row);

  let totalWeight = 0;
  const breakdown: SachetSuggestion['breakdown'] = [];

  for (const item of items) {
    const p = byId.get(item.productId);
    if (!p) {
      // Produit inconnu : on l'ignore plutot que d'echouer (le checkout fera
      // sa propre validation, ce helper sert au calcul de suggestion).
      continue;
    }

    const needsSachet = p.needs_sachet ?? true;
    const ratio = p.articles_per_sachet ?? defaultRatio;

    let articleCount: number;
    if (p.sale_unit === 'weight') {
      // 1 produit pese = 1 emballage, peu importe le poids vendu.
      articleCount = item.quantity > 0 ? 1 : 0;
    } else {
      articleCount = item.quantity;
    }

    const weight = needsSachet ? articleCount / ratio : 0;
    totalWeight += weight;

    breakdown.push({
      productId: item.productId,
      categoryId: p.category_id,
      categoryName: p.category_name,
      quantity: item.quantity,
      ratio: needsSachet ? ratio : null,
      needsSachet,
      weight,
    });
  }

  return {
    suggested: Math.floor(totalWeight),
    breakdown,
  };
}
