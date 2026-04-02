import type { Response } from 'express';
import type { AuthRequest } from '../middleware/auth.middleware.js';
import { productRepository } from '../repositories/product.repository.js';

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
};
