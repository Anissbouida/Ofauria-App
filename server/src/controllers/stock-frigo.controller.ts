import { Request, Response } from 'express';
import { stockFrigoRepository } from '../repositories/stock-frigo.repository.js';
import { addSurplusSchema, consumeSchema, recordLossSchema, adjustSchema } from '../validators/stock-frigo.validator.js';

export const stockFrigoController = {

  async list(req: Request, res: Response) {
    const storeId = (req.query.storeId as string) || (req as any).user?.storeId;
    if (!storeId) return res.status(400).json({ error: 'storeId requis' });
    const includeExpired = req.query.includeExpired === 'true';
    const data = await stockFrigoRepository.findByStore(storeId, includeExpired);
    res.json({ data });
  },

  async summary(req: Request, res: Response) {
    const storeId = (req.query.storeId as string) || (req as any).user?.storeId;
    if (!storeId) return res.status(400).json({ error: 'storeId requis' });
    const data = await stockFrigoRepository.getSummary(storeId);
    res.json({ data });
  },

  async baseRecipes(req: Request, res: Response) {
    const storeId = (req.query.storeId as string) || (req as any).user?.storeId;
    if (!storeId) return res.status(400).json({ error: 'storeId requis' });
    const data = await stockFrigoRepository.getBaseRecipesStock(storeId);
    res.json({ data });
  },

  async recipeLineage(req: Request, res: Response) {
    const recipeId = req.params.recipeId as string;
    const storeId = (req.query.storeId as string) || (req as any).user?.storeId;
    if (!storeId) return res.status(400).json({ error: 'storeId requis' });
    const data = await stockFrigoRepository.getRecipeLineage(recipeId, storeId);
    res.json({ data });
  },

  async available(req: Request, res: Response) {
    const productId = req.params.productId as string;
    const storeId = (req.query.storeId as string) || (req as any).user?.storeId;
    if (!storeId) return res.status(400).json({ error: 'storeId requis' });
    const quantity = await stockFrigoRepository.getAvailableForProduct(productId, storeId);
    res.json({ data: { productId, storeId, quantity } });
  },

  async addSurplus(req: Request, res: Response) {
    const parsed = addSurplusSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.issues.map(i => i.message).join(', ') });
    const storeId = req.body.storeId || (req as any).user?.storeId;
    if (!storeId) return res.status(400).json({ error: 'storeId requis' });
    const data = await stockFrigoRepository.addSurplus({
      ...parsed.data,
      storeId,
      performedBy: (req as any).user.id,
    });
    res.status(201).json({ data });
  },

  async consume(req: Request, res: Response) {
    const parsed = consumeSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.issues.map(i => i.message).join(', ') });
    const storeId = req.body.storeId || (req as any).user?.storeId;
    if (!storeId) return res.status(400).json({ error: 'storeId requis' });
    const result = await stockFrigoRepository.consumeFEFO(
      parsed.data.productId, storeId, parsed.data.quantity,
      (req as any).user.id, parsed.data.referenceId, parsed.data.referenceType
    );
    res.json({ data: result });
  },

  async recordLoss(req: Request, res: Response) {
    const id = req.params.id as string;
    const parsed = recordLossSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.issues.map(i => i.message).join(', ') });
    await stockFrigoRepository.recordLoss(id, parsed.data.quantity, parsed.data.type, (req as any).user.id, parsed.data.notes);
    res.json({ message: 'Perte enregistree' });
  },

  async adjust(req: Request, res: Response) {
    const id = req.params.id as string;
    const parsed = adjustSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.issues.map(i => i.message).join(', ') });
    await stockFrigoRepository.adjust(id, parsed.data.quantity, (req as any).user.id, parsed.data.notes);
    res.json({ message: 'Quantite ajustee' });
  },

  async transactions(req: Request, res: Response) {
    const id = req.params.id as string;
    const data = await stockFrigoRepository.getTransactions(id);
    res.json({ data });
  },
};
