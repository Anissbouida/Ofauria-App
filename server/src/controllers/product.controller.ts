import type { Response } from 'express';
import type { AuthRequest } from '../middleware/auth.middleware.js';
import { productRepository } from '../repositories/product.repository.js';
import { productLotRepository } from '../repositories/product-lot.repository.js';
import { pricingTierRepository } from '../repositories/product-pricing-tier.repository.js';
import { channelPricingRepository } from '../repositories/product-channel-pricing.repository.js';
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
  // ───── Paliers tarifaires (mig 171) ─────
  async listPricingTiers(req: AuthRequest, res: Response) {
    const tiers = await pricingTierRepository.listByProduct(req.params.id);
    res.json({ success: true, data: tiers });
  },

  async listChannelPricing(req: AuthRequest, res: Response) {
    const data = await channelPricingRepository.listByProduct(req.params.id);
    res.json({ success: true, data });
  },

  async replaceChannelPricing(req: AuthRequest, res: Response) {
    const body = req.body as { items?: Array<{ channel_id?: string; price_override?: number | null; price_per_kg_override?: number | null }> };
    const items = Array.isArray(body.items) ? body.items : [];
    const cleaned: Array<{ channel_id: string; price_override: number | null; price_per_kg_override: number | null }> = [];
    for (const it of items) {
      if (!it.channel_id) continue;
      const po = it.price_override !== undefined && it.price_override !== null && Number(it.price_override) > 0
        ? Number(it.price_override) : null;
      const ppko = it.price_per_kg_override !== undefined && it.price_per_kg_override !== null && Number(it.price_per_kg_override) > 0
        ? Number(it.price_per_kg_override) : null;
      if (po === null && ppko === null) continue; // skip lignes vides
      cleaned.push({ channel_id: it.channel_id, price_override: po, price_per_kg_override: ppko });
    }
    const result = await channelPricingRepository.replaceForProduct(req.params.id, cleaned);
    res.json({ success: true, data: result });
  },

  async replacePricingTiers(req: AuthRequest, res: Response) {
    const body = req.body as { tiers?: Array<{ min_grammes?: number; max_grammes?: number | null; prix_per_kg?: number; display_order?: number }> };
    const tiers = Array.isArray(body.tiers) ? body.tiers : [];
    // Validation minimale : chaque palier doit avoir min_grammes >= 0 et prix > 0
    const cleaned: Array<{ min_grammes: number; max_grammes: number | null; prix_per_kg: number; display_order: number }> = [];
    for (const t of tiers) {
      const min = Number(t.min_grammes);
      const max = t.max_grammes === null || t.max_grammes === undefined ? null : Number(t.max_grammes);
      const prix = Number(t.prix_per_kg);
      if (!isFinite(min) || min < 0) continue;
      if (max !== null && (!isFinite(max) || max <= min)) continue;
      if (!isFinite(prix) || prix <= 0) continue;
      cleaned.push({ min_grammes: min, max_grammes: max, prix_per_kg: prix, display_order: Number(t.display_order) || 0 });
    }
    const result = await pricingTierRepository.replaceForProduct(req.params.id, cleaned);
    res.json({ success: true, data: result });
  },

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

    // Cycle de vie (audit P1.1/P1.2) : le validator a coerce les types.
    // On applique la purge sur type=commande ici pour ne rien laisser fuir
    // en INSERT (les CHECKs mig 245 sont la ceinture DB).
    const saleType = (body.saleType as string) || 'jour';
    const isCommande = saleType === 'commande';
    const shelfLifeDays = isCommande ? null : (body.shelfLifeDays ?? null);
    const displayLifeHours = isCommande ? null : (body.displayLifeHours ?? null);
    const isReexposable = isCommande ? false : Boolean(body.isReexposable);
    const isRecyclable = isCommande ? false : Boolean(body.isRecyclable);
    // Normalise max_reexpositions : 1 quand reexposable & non renseigne, 0 sinon.
    // Cote UI on affichera 1 par defaut mais si l'admin envoie 0 via un
    // client tiers, on l'aligne pour ne pas violer la CHECK mig 245.
    const maxReexpositions = isReexposable
      ? Math.max(1, Number(body.maxReexpositions) || 1)
      : 0;

    const data = { ...body, slug: slugify(body.name) };
    const client = await db.getClient();
    try {
      await client.query('BEGIN');
      const productResult = await client.query(
        `INSERT INTO products (
           name, slug, category_id, description, price, cost_price,
           is_available, is_custom_orderable, preparation_time_min,
           responsible_user_id, sale_unit, price_per_kg,
           sale_type, shelf_life_days, display_life_hours,
           is_reexposable, is_recyclable, max_reexpositions
         )
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12,
                 $13, $14, $15, $16, $17, $18)
         RETURNING *`,
        [
          data.name, data.slug, data.categoryId, data.description || null,
          data.price, data.costPrice || null,
          data.isAvailable ?? true, data.isCustomOrderable ?? false,
          data.preparationTimeMin || null, data.responsibleUserId || null,
          data.saleUnit || 'unit', data.pricePerKg ?? null,
          saleType, shelfLifeDays, displayLifeHours,
          isReexposable, isRecyclable, maxReexpositions,
        ]
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
    const data: Record<string, unknown> = { ...rest };
    if (data.name) data.slug = slugify(data.name as string);

    // Cycle de vie (audit P1.1) : purge cote serveur quand saleType='commande'.
    // Le formulaire client le fait deja, mais on redouble : rien ne doit sortir
    // du controller avec des valeurs incoherentes vs la CHECK mig 245.
    if (data.saleType === 'commande') {
      data.shelfLifeDays = null;
      data.displayLifeHours = null;
      data.isReexposable = false;
      data.isRecyclable = false;
      data.maxReexpositions = 0;
      data.recycleIngredientId = null;
    }
    // Cohere max_reexpositions avec isReexposable si les deux sont dans le payload.
    if (data.isReexposable === true) {
      const m = Number(data.maxReexpositions);
      if (!isFinite(m) || m < 1) data.maxReexpositions = 1;
    }
    if (data.isReexposable === false && data.maxReexpositions !== undefined) {
      data.maxReexpositions = 0;
    }

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

  // ───── Suppression en masse ─────
  // Chaque produit est supprime individuellement : un produit reference par
  // des ventes/plans echoue (FK) sans bloquer les autres. On renvoie le detail.
  async bulkDelete(req: AuthRequest, res: Response) {
    const ids = req.body.ids as string[];
    let deleted = 0;
    const failed: Array<{ id: string; reason: string }> = [];
    for (const id of ids) {
      try {
        await productRepository.delete(id);
        deleted++;
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : '';
        failed.push({
          id,
          reason: msg.includes('introuvable')
            ? 'Produit introuvable'
            : (msg.includes('foreign key') || msg.includes('violates'))
              ? 'Utilise dans des commandes, ventes ou plans — desactivez-le plutot'
              : 'Erreur lors de la suppression',
        });
      }
    }
    res.json({ success: true, data: { deleted, failed } });
  },

  // ───── Import CSV (export Loyverse) ─────
  // Le client envoie des lignes normalisees { name, category, price, ... }.
  // Regles :
  //   - produit deja existant (nom, insensible casse/espaces) -> ignore
  //   - categorie inconnue -> creee a la volee (slug unique)
  //   - pas de recette liee : catalogue seul, la recette se rattache ensuite
  //     via le formulaire d'edition.
  async importProducts(req: AuthRequest, res: Response) {
    const items = req.body.items as Array<{
      name: string; category?: string | null; price: number;
      costPrice?: number | null; saleUnit?: 'unit' | 'weight'; isAvailable?: boolean;
    }>;

    const existingProducts = await db.query('SELECT LOWER(TRIM(name)) AS name, slug FROM products');
    const existingNames = new Set<string>(existingProducts.rows.map(r => r.name as string));
    const existingSlugs = new Set<string>(existingProducts.rows.map(r => r.slug as string));

    const catRows = await db.query('SELECT id, name, slug FROM categories');
    const catByName = new Map<string, number>(catRows.rows.map(r => [(r.name as string).trim().toLowerCase(), r.id as number]));
    const catSlugs = new Set<string>(catRows.rows.map(r => r.slug as string));

    const uniqueSlug = (base: string, taken: Set<string>) => {
      let slug = base || 'produit';
      let n = 2;
      while (taken.has(slug)) slug = `${base}-${n++}`;
      taken.add(slug);
      return slug;
    };

    let created = 0;
    let skipped = 0;
    const errors: Array<{ name: string; reason: string }> = [];

    for (const item of items) {
      const name = item.name.trim();
      const nameKey = name.toLowerCase();
      if (existingNames.has(nameKey)) { skipped++; continue; }

      try {
        // Categorie : resolue par nom, creee si absente.
        const catName = (item.category || '').trim() || 'Divers';
        let categoryId = catByName.get(catName.toLowerCase());
        if (!categoryId) {
          const catSlug = uniqueSlug(slugify(catName) || 'categorie', catSlugs);
          const ins = await db.query(
            'INSERT INTO categories (name, slug) VALUES ($1, $2) RETURNING id',
            [catName, catSlug]
          );
          categoryId = ins.rows[0].id as number;
          catByName.set(catName.toLowerCase(), categoryId);
        }

        const slug = uniqueSlug(slugify(name), existingSlugs);
        const isWeight = item.saleUnit === 'weight';
        await db.query(
          `INSERT INTO products (name, slug, category_id, price, cost_price, is_available, sale_unit, price_per_kg)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
          [
            name, slug, categoryId, item.price,
            item.costPrice && item.costPrice > 0 ? item.costPrice : null,
            item.isAvailable ?? true,
            isWeight ? 'weight' : 'unit',
            isWeight ? item.price : null,
          ]
        );
        existingNames.add(nameKey);
        created++;
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : 'Erreur inconnue';
        errors.push({ name, reason: msg });
      }
    }

    res.json({ success: true, data: { created, skipped, errors } });
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

  // ───── Destinations de recyclage (audit P1.3, mig 106+116) ─────
  // Multi-cibles avec yield_ratio (rendement produit -> ingredient).
  // Le POS et la page Invendus lisent ces destinations pour proposer la
  // conversion effective en stock ingredient lors du recyclage.
  async listRecycleDestinations(req: AuthRequest, res: Response) {
    const result = await db.query(
      `SELECT prd.id, prd.product_id, prd.ingredient_id, prd.label,
              prd.display_order, prd.is_active, prd.yield_ratio,
              i.name as ingredient_name, i.unit as ingredient_unit
       FROM product_recycle_destinations prd
       JOIN ingredients i ON i.id = prd.ingredient_id
       WHERE prd.product_id = $1
       ORDER BY prd.display_order ASC, prd.created_at ASC`,
      [req.params.id]
    );
    res.json({ success: true, data: result.rows });
  },

  async replaceRecycleDestinations(req: AuthRequest, res: Response) {
    const productId = req.params.id;
    const items = (req.body.destinations || []) as Array<{
      ingredientId: string;
      label?: string | null;
      displayOrder?: number;
      yieldRatio?: number;
      isActive?: boolean;
    }>;

    // Refuse le combo is_recyclable=true + destinations vide (audit P1.3) :
    // c'est ce toggle vide qu'on veut supprimer. Deux options :
    //   - destinations vide : on autorise si le produit est deja is_recyclable=false
    //     (l'admin fait le menage avant de decocher). Sinon on renvoie 400.
    //   - destinations non vide : on force is_recyclable=true.
    const productCheck = await db.query(
      `SELECT is_recyclable, recycle_ingredient_id FROM products WHERE id = $1`,
      [productId]
    );
    if (productCheck.rows.length === 0) {
      res.status(404).json({ success: false, error: { message: 'Produit introuvable' } });
      return;
    }

    // Deduplication cote serveur : la CHECK UNIQUE (product_id, ingredient_id)
    // ferait echouer l'INSERT sinon.
    const seen = new Set<string>();
    for (const it of items) {
      if (seen.has(it.ingredientId)) {
        res.status(400).json({
          success: false,
          error: { message: 'Doublon d\'ingredient dans les destinations de recyclage' },
        });
        return;
      }
      seen.add(it.ingredientId);
    }

    const client = await db.getClient();
    try {
      await client.query('BEGIN');
      // Verifie que tous les ingredients existent (evite ROLLBACK opaque sur FK).
      if (items.length > 0) {
        const ingredientIds = items.map(i => i.ingredientId);
        const check = await client.query(
          `SELECT id FROM ingredients WHERE id = ANY($1::uuid[])`,
          [ingredientIds]
        );
        if (check.rows.length !== ingredientIds.length) {
          await client.query('ROLLBACK');
          res.status(400).json({
            success: false,
            error: { message: 'Un ou plusieurs ingredients sont introuvables' },
          });
          return;
        }
      }

      // Remplacement complet (idempotent) : delete + insert.
      await client.query(`DELETE FROM product_recycle_destinations WHERE product_id = $1`, [productId]);
      for (let i = 0; i < items.length; i++) {
        const it = items[i];
        await client.query(
          `INSERT INTO product_recycle_destinations
             (product_id, ingredient_id, label, display_order, is_active, yield_ratio)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [
            productId,
            it.ingredientId,
            (it.label ?? null) === '' ? null : (it.label ?? null),
            it.displayOrder ?? i,
            it.isActive ?? true,
            it.yieldRatio ?? 1.0,
          ]
        );
      }

      // Synchronise is_recyclable + recycle_ingredient_id legacy sur le produit :
      //  - destinations vide -> is_recyclable=false, legacy=null
      //  - destinations non vide -> is_recyclable=true, legacy=1re destination
      //    (compat avec le code qui lit encore recycle_ingredient_id).
      if (items.length === 0) {
        await client.query(
          `UPDATE products
              SET is_recyclable = false,
                  recycle_ingredient_id = NULL,
                  updated_at = NOW()
            WHERE id = $1`,
          [productId]
        );
      } else {
        await client.query(
          `UPDATE products
              SET is_recyclable = true,
                  recycle_ingredient_id = $2,
                  updated_at = NOW()
            WHERE id = $1`,
          [productId, items[0].ingredientId]
        );
      }

      await client.query('COMMIT');
      const refreshed = await db.query(
        `SELECT prd.id, prd.product_id, prd.ingredient_id, prd.label,
                prd.display_order, prd.is_active, prd.yield_ratio,
                i.name as ingredient_name, i.unit as ingredient_unit
         FROM product_recycle_destinations prd
         JOIN ingredients i ON i.id = prd.ingredient_id
         WHERE prd.product_id = $1
         ORDER BY prd.display_order ASC, prd.created_at ASC`,
        [productId]
      );
      res.json({ success: true, data: refreshed.rows });
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
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
