import type { Response } from 'express';
import type { AuthRequest } from '../middleware/auth.middleware.js';
import { productionCoutRepository } from '../repositories/production-cout.repository.js';
import { createEquipementSchema, updateEquipementSchema, recordTempsTravailSchema, recordEquipementUsageSchema } from '../validators/production-cout.validator.js';

export const productionCoutController = {

  // ═══ Equipements CRUD ═══

  async listEquipements(req: AuthRequest, res: Response) {
    const storeId = (req.query.storeId as string) || req.user!.storeId;
    const data = await productionCoutRepository.listEquipements(storeId);
    res.json({ success: true, data });
  },

  async getEquipement(req: AuthRequest, res: Response) {
    const data = await productionCoutRepository.getEquipement(req.params.id as string);
    if (!data) { res.status(404).json({ success: false, error: { message: 'Equipement non trouve' } }); return; }
    res.json({ success: true, data });
  },

  async createEquipement(req: AuthRequest, res: Response) {
    const parsed = createEquipementSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ success: false, error: { message: parsed.error.issues.map(i => i.message).join(', ') } });
      return;
    }
    const data = await productionCoutRepository.createEquipement(parsed.data);
    res.status(201).json({ success: true, data });
  },

  async updateEquipement(req: AuthRequest, res: Response) {
    const parsed = updateEquipementSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ success: false, error: { message: parsed.error.issues.map(i => i.message).join(', ') } });
      return;
    }
    const data = await productionCoutRepository.updateEquipement(req.params.id as string, parsed.data);
    if (!data) { res.status(404).json({ success: false, error: { message: 'Equipement non trouve' } }); return; }
    res.json({ success: true, data });
  },

  // ═══ Temps de travail ═══

  async recordTempsTravail(req: AuthRequest, res: Response) {
    const parsed = recordTempsTravailSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ success: false, error: { message: parsed.error.issues.map(i => i.message).join(', ') } });
      return;
    }
    const planId = req.params.planId as string;
    const data = await productionCoutRepository.recordTempsTravail({
      planId,
      planItemId: parsed.data.plan_item_id,
      employeeId: parsed.data.employee_id,
      debut: parsed.data.debut,
      fin: parsed.data.fin,
      dureeMinutes: parsed.data.duree_minutes,
      notes: parsed.data.notes,
    });
    res.status(201).json({ success: true, data });
  },

  async getTempsTravail(req: AuthRequest, res: Response) {
    const data = await productionCoutRepository.getTempsTravail(req.params.planId as string);
    res.json({ success: true, data });
  },

  // ═══ Equipement usage ═══

  async recordEquipementUsage(req: AuthRequest, res: Response) {
    const parsed = recordEquipementUsageSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ success: false, error: { message: parsed.error.issues.map(i => i.message).join(', ') } });
      return;
    }
    const planId = req.params.planId as string;
    const data = await productionCoutRepository.recordEquipementUsage({
      planId,
      equipementId: parsed.data.equipement_id,
      debut: parsed.data.debut,
      fin: parsed.data.fin,
      dureeMinutes: parsed.data.duree_minutes,
      notes: parsed.data.notes,
    });
    res.status(201).json({ success: true, data });
  },

  async getEquipementUsage(req: AuthRequest, res: Response) {
    const data = await productionCoutRepository.getEquipementUsage(req.params.planId as string);
    res.json({ success: true, data });
  },

  // ═══ Cost calculation ═══

  async calculateCost(req: AuthRequest, res: Response) {
    const data = await productionCoutRepository.calculateAndSave(req.params.planId as string, req.user!.userId);
    res.json({ success: true, data });
  },

  async getCost(req: AuthRequest, res: Response) {
    const data = await productionCoutRepository.findByPlan(req.params.planId as string);
    if (!data) { res.status(404).json({ success: false, error: { message: 'Cout non calcule pour ce plan' } }); return; }
    res.json({ success: true, data });
  },

  // ═══ Dashboard ═══

  async costStats(req: AuthRequest, res: Response) {
    const storeId = (req.query.storeId as string) || req.user!.storeId!;
    const data = await productionCoutRepository.getStats(
      storeId, req.query.dateFrom as string | undefined, req.query.dateTo as string | undefined
    );
    res.json({ success: true, data });
  },

  async costByDay(req: AuthRequest, res: Response) {
    const storeId = (req.query.storeId as string) || req.user!.storeId!;
    const dateFrom = req.query.dateFrom as string | undefined;
    const dateTo = req.query.dateTo as string | undefined;
    if (!dateFrom || !dateTo) {
      res.status(400).json({ success: false, error: { message: 'dateFrom et dateTo requis' } });
      return;
    }
    const data = await productionCoutRepository.getByDay(storeId, dateFrom, dateTo);
    res.json({ success: true, data });
  },
};
