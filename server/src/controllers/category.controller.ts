import type { Request, Response } from 'express';
import { categoryRepository } from '../repositories/category.repository.js';

function slugify(text: string): string {
  return text.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
}

export const categoryController = {
  async list(_req: Request, res: Response) {
    const categories = await categoryRepository.findAll();
    res.json({ success: true, data: categories });
  },
  async create(req: Request, res: Response) {
    const { name, description, displayOrder } = req.body;
    const category = await categoryRepository.create({ name, slug: slugify(name), description, displayOrder });
    res.status(201).json({ success: true, data: category });
  },
  async update(req: Request, res: Response) {
    const data = { ...req.body };
    if (data.name) data.slug = slugify(data.name);
    const category = await categoryRepository.update(parseInt(req.params.id), data);
    res.json({ success: true, data: category });
  },
  async remove(req: Request, res: Response) {
    await categoryRepository.delete(parseInt(req.params.id));
    res.json({ success: true, data: null });
  },
};
