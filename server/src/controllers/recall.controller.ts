import type { Response } from 'express';
import type { AuthRequest } from '../middleware/auth.middleware.js';
import { recallRepository } from '../repositories/recall.repository.js';

export const recallController = {
  /** GET /traceability/recall/ingredient-lot/:id — arbre d'impact d'un rappel. */
  async recallFromIngredientLot(req: AuthRequest, res: Response) {
    const result = await recallRepository.recallFromIngredientLot(req.params.id);
    if (!result) {
      res.status(404).json({ success: false, error: { message: 'Lot de matière première non trouvé' } });
      return;
    }
    res.json({ success: true, data: result });
  },
};
