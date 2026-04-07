import type { Response } from 'express';
import type { AuthRequest } from '../middleware/auth.middleware.js';
import { productRepository } from '../repositories/product.repository.js';
import { db } from '../config/database.js';
import { adjustProductStock } from '../repositories/product-stock.helper.js';

function slugify(text: string): string {
  return text.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
}

export const productController = {
  async list(req: AuthRequest, res: Response) {
    const { categoryId, search, isAvailable, page = '1', limit = '20' } = req.query as Record<string, string>;
    const p = parseInt(page); const l = parseInt(limit);
    const result = await productRepository.findAll({
      categoryId: categoryId ? parseInt(categoryId) : undefined,
      search, isAvailable: isAvailable !== undefined ? isAvailable === 'true' : undefined,
      limit: l, offset: (p - 1) * l,
      storeId: req.user!.storeId,
    });
    res.json({ success: true, data: result.rows, total: result.total, page: p, limit: l, totalPages: Math.ceil(result.total / l) });
  },
  async getById(req: AuthRequest, res: Response) {
    const product = await productRepository.findById(req.params.id);
    if (!product) { res.status(404).json({ success: false, error: { message: 'Produit non trouvé' } }); return; }
    res.json({ success: true, data: product });
  },
  async create(req: AuthRequest, res: Response) {
    const data = { ...req.body, slug: slugify(req.body.name) };
    const product = await productRepository.create(data);
    res.status(201).json({ success: true, data: product });
  },
  async update(req: AuthRequest, res: Response) {
    const data = { ...req.body };
    if (data.name) data.slug = slugify(data.name);
    const product = await productRepository.update(req.params.id, data);
    res.json({ success: true, data: product });
  },
  async remove(req: AuthRequest, res: Response) {
    await productRepository.delete(req.params.id);
    res.json({ success: true, data: null });
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
