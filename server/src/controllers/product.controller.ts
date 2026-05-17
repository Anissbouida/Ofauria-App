import type { Response } from 'express';
import type { AuthRequest } from '../middleware/auth.middleware.js';
import { productRepository } from '../repositories/product.repository.js';
import { productLotRepository } from '../repositories/product-lot.repository.js';
import { db } from '../config/database.js';
import { adjustProductStock } from '../repositories/product-stock.helper.js';

// Phase B — debounce le lazy trigger d'auto-expire pour ne pas le rejouer
// a chaque requete (cout : 1 query par lot expire). On laisse passer toutes
// les 60 secondes par store. En memoire process — multi-instances : c'est
// idempotent donc on tolere une concurrence rare.
const lastAutoExpire: Map<string, number> = new Map();
const AUTO_EXPIRE_DEBOUNCE_MS = 60_000;
async function maybeAutoExpire(storeId: string | null | undefined) {
  if (!storeId) return;
  const last = lastAutoExpire.get(storeId) ?? 0;
  const now = Date.now();
  if (now - last < AUTO_EXPIRE_DEBOUNCE_MS) return;
  lastAutoExpire.set(storeId, now);
  try {
    await productLotRepository.autoExpireDueLots();
  } catch (err) {
    console.error('[autoExpireDueLots] erreur silencieuse :', err);
    // On ne bloque pas la requete utilisateur si le job echoue
  }
}

function slugify(text: string): string {
  return text.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
}

export const productController = {
  async topSelling(req: AuthRequest, res: Response) {
    const { limit = '20', days = '30' } = req.query as Record<string, string>;
    const data = await productRepository.findTopSelling({
      storeId: req.user!.storeId,
      limit: Math.min(parseInt(limit) || 20, 100),
      days: Math.min(parseInt(days) || 30, 365),
    });
    res.json({ success: true, data });
  },

  async list(req: AuthRequest, res: Response) {
    const { categoryId, search, isAvailable, page = '1', limit = '20', strictStore } = req.query as Record<string, string>;
    const p = parseInt(page); const l = parseInt(limit);

    // strictStore mode (used by POS): refuse to fall back to global stock when
    // the user has no storeId. Guarantees the list's stock_quantity column is
    // always the vitrine qty (product_store_stock), never products.stock_quantity.
    if (strictStore === 'true' && !req.user!.storeId) {
      res.status(400).json({ success: false, error: { message: 'Utilisateur non rattache a un magasin — stock vitrine indisponible' } });
      return;
    }

    // Phase B — Lazy auto-expire : debounced 60s par store, garantit que
    // les lots dont la DLV ou DDE est passee sont auto-marques avant
    // qu'ils n'apparaissent dans la liste POS comme vendables.
    await maybeAutoExpire(req.user!.storeId);

    const result = await productRepository.findAll({
      categoryId: categoryId ? parseInt(categoryId) : undefined,
      search, isAvailable: isAvailable !== undefined ? isAvailable === 'true' : undefined,
      limit: l, offset: (p - 1) * l,
      storeId: req.user!.storeId,
      // In strictStore (POS) mode, expose vitrine_quantity as stock_quantity so
      // the cashier only sees what's actually on display and sellable.
      useVitrine: strictStore === 'true',
    });
    res.json({ success: true, data: result.rows, total: result.total, page: p, limit: l, totalPages: Math.ceil(result.total / l) });
  },
  // Phase D — debug/audit : retourne pour un produit les 2 deadlines + le min
  // (effective). Utilise par les outils admin pour diagnostiquer pourquoi un
  // produit est bloque a la vente.
  async effectiveDeadline(req: AuthRequest, res: Response) {
    const productId = req.params.id;
    const storeId = req.user!.storeId;
    if (!storeId) {
      res.status(400).json({ success: false, error: { message: 'Aucun store rattache a l\'utilisateur' } });
      return;
    }
    const result = await db.query(
      `SELECT
         pl.id as lot_id, pl.lot_number,
         pl.expires_at as dlv,
         pl.display_expires_at as dde,
         pl.vitrine_qty, pl.backroom_qty, pl.status,
         LEAST(
           COALESCE(pl.expires_at::timestamptz, 'infinity'::timestamptz),
           COALESCE(pl.display_expires_at, 'infinity'::timestamptz)
         ) as effective_deadline,
         (
           (pl.expires_at IS NULL OR pl.expires_at > CURRENT_DATE)
           AND (pl.display_expires_at IS NULL OR pl.display_expires_at > NOW())
         ) as saleable
       FROM product_lots pl
       WHERE pl.product_id = $1 AND pl.store_id = $2 AND pl.status = 'active'
         AND (pl.vitrine_qty + pl.backroom_qty) > 0
       ORDER BY effective_deadline ASC`,
      [productId, storeId]
    );
    res.json({
      success: true,
      data: {
        productId,
        storeId,
        lots: result.rows,
        soonest_deadline: result.rows[0]?.effective_deadline ?? null,
        has_saleable_lot: result.rows.some(r => r.saleable),
      },
    });
  },

  async getById(req: AuthRequest, res: Response) {
    const product = await productRepository.findById(req.params.id);
    if (!product) { res.status(404).json({ success: false, error: { message: 'Produit non trouvé' } }); return; }
    res.json({ success: true, data: product });
  },
  async create(req: AuthRequest, res: Response) {
    const { recipeId, ...body } = req.body;

    // Recipe is mandatory for new products
    if (!recipeId) {
      res.status(400).json({ success: false, error: { message: 'Une recette est obligatoire pour creer un produit. Veuillez d\'abord creer la recette dans le module Recettes.' } });
      return;
    }

    // Verify recipe exists and is not already linked to another product
    const recipeCheck = await db.query('SELECT id, product_id, name FROM recipes WHERE id = $1', [recipeId]);
    if (recipeCheck.rows.length === 0) {
      res.status(400).json({ success: false, error: { message: 'La recette selectionnee n\'existe pas.' } });
      return;
    }
    if (recipeCheck.rows[0].product_id) {
      res.status(400).json({ success: false, error: { message: `Cette recette est deja liee a un autre produit.` } });
      return;
    }

    const data = { ...body, slug: slugify(body.name) };
    const client = await db.getClient();
    try {
      await client.query('BEGIN');
      const productResult = await client.query(
        `INSERT INTO products (name, slug, category_id, description, price, cost_price, is_available, is_custom_orderable, preparation_time_min, responsible_user_id, sale_unit, price_per_kg)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12) RETURNING *`,
        [data.name, data.slug, data.categoryId, data.description || null, data.price,
         data.costPrice || null, data.isAvailable ?? true, data.isCustomOrderable ?? false,
         data.preparationTimeMin || null, data.responsibleUserId || null,
         data.saleUnit || 'unit', data.pricePerKg ?? null]
      );
      const product = productResult.rows[0];

      // Link the recipe to the newly created product
      await client.query('UPDATE recipes SET product_id = $1 WHERE id = $2', [product.id, recipeId]);

      await client.query('COMMIT');
      res.status(201).json({ success: true, data: product });
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  },
  async update(req: AuthRequest, res: Response) {
    // Extrait recipeId du payload : le lien produit<->recette est stocke dans la table recipes
    // (colonne recipes.product_id), pas dans la table products. Le mapping de productRepository.update
    // n'inclut donc pas recipeId et le droppait silencieusement avant ce fix.
    const { recipeId, ...rest } = req.body;
    const data = { ...rest };
    if (data.name) data.slug = slugify(data.name);

    const productId = req.params.id;

    // Si recipeId est fourni (y compris chaine vide/null pour detacher), on ajuste le lien.
    // Cas :
    //   - recipeId = '<id>' : delier l'ancienne recette du produit, puis lier la nouvelle
    //   - recipeId = '' ou null : detacher toute recette du produit
    //   - recipeId === undefined : le champ n'est pas dans le payload -> on ne touche pas au lien
    if (recipeId !== undefined) {
      const client = await db.getClient();
      try {
        await client.query('BEGIN');

        if (recipeId) {
          const recipeCheck = await client.query('SELECT id, product_id FROM recipes WHERE id = $1', [recipeId]);
          if (recipeCheck.rows.length === 0) {
            await client.query('ROLLBACK');
            res.status(400).json({ success: false, error: { message: 'La recette selectionnee n\'existe pas.' } });
            return;
          }
          const existingProductId = recipeCheck.rows[0].product_id;
          if (existingProductId && existingProductId !== productId) {
            await client.query('ROLLBACK');
            res.status(400).json({ success: false, error: { message: 'Cette recette est deja liee a un autre produit.' } });
            return;
          }
          // Detacher la recette actuellement liee a ce produit (s'il y en a une differente)
          await client.query('UPDATE recipes SET product_id = NULL WHERE product_id = $1 AND id <> $2', [productId, recipeId]);
          // Lier la nouvelle recette
          await client.query('UPDATE recipes SET product_id = $1 WHERE id = $2', [productId, recipeId]);
        } else {
          // Detacher toute recette liee
          await client.query('UPDATE recipes SET product_id = NULL WHERE product_id = $1', [productId]);
        }

        await client.query('COMMIT');
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      } finally {
        client.release();
      }
    }

    const product = await productRepository.update(productId, data);
    res.json({ success: true, data: product });
  },
  async remove(req: AuthRequest, res: Response) {
    try {
      await productRepository.delete(req.params.id);
      res.json({ success: true, data: null });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : '';
      if (msg.includes('foreign key') || msg.includes('violates')) {
        res.status(409).json({ success: false, error: { message: 'Ce produit est utilise dans des commandes, ventes ou plans de production. Desactivez-le plutot.' } });
      } else {
        throw err;
      }
    }
  },
  async toggleAvailability(req: AuthRequest, res: Response) {
    const product = await productRepository.toggleAvailability(req.params.id);
    res.json({ success: true, data: product });
  },
  async uploadImage(req: AuthRequest, res: Response) {
    if (!req.file) { res.status(400).json({ success: false, error: { message: 'Aucune image fournie' } }); return; }
    const imageUrl = `/uploads/${req.file.filename}`;
    const product = await productRepository.update(req.params.id, { imageUrl });
    res.json({ success: true, data: product });
  },

  async adjustStock(req: AuthRequest, res: Response) {
    const { quantity, type = 'adjustment', note } = req.body;
    if (quantity === undefined || quantity === null) {
      res.status(400).json({ success: false, error: { message: 'Quantite requise' } });
      return;
    }

    const product = await productRepository.findById(req.params.id);
    if (!product) { res.status(404).json({ success: false, error: { message: 'Produit non trouve' } }); return; }

    const change = parseFloat(quantity);
    const client = await db.getClient();
    try {
      await client.query('BEGIN');
      const stockAfter = await adjustProductStock(client, req.params.id, change, req.user!.storeId);

      await client.query(
        `INSERT INTO product_stock_transactions (product_id, type, quantity_change, stock_after, note, performed_by, store_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [req.params.id, type, change, stockAfter, note || `Ajustement manuel`, req.user!.userId, req.user!.storeId || null]
      );
      await client.query('COMMIT');

      res.json({ success: true, data: { stockQuantity: stockAfter } });
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  },

  async stockHistory(req: AuthRequest, res: Response) {
    const { page = '1', limit = '30' } = req.query as Record<string, string>;
    const p = parseInt(page); const l = parseInt(limit);

    const countResult = await db.query(
      `SELECT COUNT(*) FROM product_stock_transactions WHERE product_id = $1`,
      [req.params.id]
    );
    const total = parseInt(countResult.rows[0].count);

    const result = await db.query(
      `SELECT pst.*, u.first_name, u.last_name
       FROM product_stock_transactions pst
       LEFT JOIN users u ON u.id = pst.performed_by
       WHERE pst.product_id = $1
       ORDER BY pst.created_at DESC
       LIMIT $2 OFFSET $3`,
      [req.params.id, l, (p - 1) * l]
    );

    res.json({ success: true, data: result.rows, total, page: p, limit: l });
  },

  async lowStock(req: AuthRequest, res: Response) {
    const storeId = req.user!.storeId;
    let result;
    if (storeId) {
      result = await db.query(
        `SELECT p.id, p.name, pss.stock_quantity, pss.stock_min_threshold, p.image_url,
                c.name as category_name
         FROM products p
         JOIN product_store_stock pss ON pss.product_id = p.id AND pss.store_id = $1
         LEFT JOIN categories c ON c.id = p.category_id
         WHERE p.is_available = true
           AND pss.stock_quantity <= pss.stock_min_threshold
           AND pss.stock_min_threshold > 0
         ORDER BY (pss.stock_quantity - pss.stock_min_threshold) ASC`,
        [storeId]
      );
    } else {
      result = await db.query(
        `SELECT p.id, p.name, p.stock_quantity, p.stock_min_threshold, p.image_url,
                c.name as category_name
         FROM products p
         LEFT JOIN categories c ON c.id = p.category_id
         WHERE p.is_available = true
           AND p.stock_quantity <= p.stock_min_threshold
           AND p.stock_min_threshold > 0
         ORDER BY (p.stock_quantity - p.stock_min_threshold) ASC`
      );
    }
    res.json({ success: true, data: result.rows });
  },
};
