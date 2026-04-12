import type { Response } from 'express';
import type { AuthRequest } from '../middleware/auth.middleware.js';
import { productPipelineRepository } from '../repositories/product-pipeline.repository.js';
import { notificationRepository } from '../repositories/notification.repository.js';

export const productPipelineController = {
  /** GET /product-pipeline */
  async list(req: AuthRequest, res: Response) {
    const { status, stage, search, responsibleUserId, limit, offset } = req.query;
    const result = await productPipelineRepository.findAll({
      status: status as string,
      stage: stage as string,
      search: search as string,
      responsibleUserId: responsibleUserId as string,
      limit: limit ? parseInt(limit as string) : 50,
      offset: offset ? parseInt(offset as string) : 0,
    });
    res.json({ success: true, data: result });
  },

  /** GET /product-pipeline/stats */
  async stats(_req: AuthRequest, res: Response) {
    const stats = await productPipelineRepository.getStats();
    res.json({ success: true, data: stats });
  },

  /** GET /product-pipeline/:id */
  async getById(req: AuthRequest, res: Response) {
    const id = req.params.id as string;
    const pipeline = await productPipelineRepository.findById(id);
    if (!pipeline) {
      res.status(404).json({ success: false, error: { message: 'Pipeline introuvable' } });
      return;
    }
    res.json({ success: true, data: pipeline });
  },

  /** GET /product-pipeline/:id/history */
  async getHistory(req: AuthRequest, res: Response) {
    const id = req.params.id as string;
    const history = await productPipelineRepository.findHistory(id);
    res.json({ success: true, data: history });
  },

  /** POST /product-pipeline */
  async create(req: AuthRequest, res: Response) {
    const { name, description, categoryId, responsibleUserId, targetDate } = req.body;
    if (!name) {
      res.status(400).json({ success: false, error: { message: 'Le nom est requis' } });
      return;
    }

    const pipeline = await productPipelineRepository.create({
      name,
      description,
      categoryId,
      responsibleUserId,
      targetDate,
      createdBy: req.user!.userId,
    });

    // Notify responsible user
    if (responsibleUserId) {
      await notificationRepository.create({
        targetRole: 'all',
        targetUserId: responsibleUserId,
        type: 'pipeline_created',
        title: 'Nouveau pipeline produit',
        message: `Un nouveau pipeline a été créé pour "${name}"`,
        referenceType: 'product_pipeline',
        referenceId: pipeline.id,
        createdBy: req.user!.userId,
      });
    }

    res.status(201).json({ success: true, data: pipeline });
  },

  /** PUT /product-pipeline/:id/stage-data */
  async updateStageData(req: AuthRequest, res: Response) {
    const id = req.params.id as string;
    const { stage, ...data } = req.body;

    if (!stage) {
      res.status(400).json({ success: false, error: { message: 'L\'étape est requise' } });
      return;
    }

    try {
      const pipeline = await productPipelineRepository.updateStageData(id, stage, data, req.user!.userId);
      res.json({ success: true, data: pipeline });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Erreur lors de la mise à jour';
      res.status(400).json({ success: false, error: { message } });
    }
  },

  /** POST /product-pipeline/:id/advance */
  async advanceStage(req: AuthRequest, res: Response) {
    const id = req.params.id as string;

    try {
      const pipeline = await productPipelineRepository.advanceStage(id, req.user!.userId);

      // Notify for stages that need attention
      const stageNotifications: Record<string, { role: string; title: string; message: string }> = {
        admin_validation: {
          role: 'admin',
          title: 'Pipeline en attente de validation',
          message: `Le pipeline "${pipeline.name}" est prêt pour la validation finale`,
        },
        catalog_integration: {
          role: 'admin',
          title: 'Pipeline approuvé — intégration catalogue',
          message: `Le pipeline "${pipeline.name}" a été approuvé et est prêt pour l'intégration au catalogue`,
        },
      };

      const notification = stageNotifications[pipeline.current_stage];
      if (notification) {
        await notificationRepository.create({
          targetRole: notification.role,
          type: `pipeline_${pipeline.current_stage}`,
          title: notification.title,
          message: notification.message,
          referenceType: 'product_pipeline',
          referenceId: pipeline.id,
          createdBy: req.user!.userId,
        });
      }

      res.json({ success: true, data: pipeline });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Erreur lors de l\'avancement';
      res.status(400).json({ success: false, error: { message } });
    }
  },

  /** POST /product-pipeline/:id/admin-decision */
  async adminDecision(req: AuthRequest, res: Response) {
    const id = req.params.id as string;
    const { decision, comments } = req.body;

    if (!decision || !['approved', 'rejected', 'revision_requested'].includes(decision)) {
      res.status(400).json({ success: false, error: { message: 'Décision invalide' } });
      return;
    }

    try {
      const pipeline = await productPipelineRepository.adminDecision(id, decision, comments || '', req.user!.userId);

      // Notify responsible user of the decision
      if (pipeline.responsible_user_id) {
        const decisionLabels: Record<string, string> = {
          approved: 'approuvé',
          rejected: 'rejeté',
          revision_requested: 'renvoyé pour révision',
        };
        await notificationRepository.create({
          targetRole: 'all',
          targetUserId: pipeline.responsible_user_id,
          type: `pipeline_${decision}`,
          title: `Pipeline ${decisionLabels[decision]}`,
          message: `Le pipeline "${pipeline.name}" a été ${decisionLabels[decision]}${comments ? ': ' + comments : ''}`,
          referenceType: 'product_pipeline',
          referenceId: pipeline.id,
          createdBy: req.user!.userId,
        });
      }

      res.json({ success: true, data: pipeline });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Erreur lors de la décision';
      res.status(400).json({ success: false, error: { message } });
    }
  },

  /** POST /product-pipeline/:id/integrate */
  async integrateCatalog(req: AuthRequest, res: Response) {
    const id = req.params.id as string;

    try {
      const pipeline = await productPipelineRepository.integrateCatalog(id, req.user!.userId);

      // Notify all about new product
      await notificationRepository.create({
        targetRole: 'all',
        type: 'pipeline_integrated',
        title: 'Nouveau produit au catalogue',
        message: `"${pipeline.name}" a été ajouté au catalogue officiel`,
        referenceType: 'product_pipeline',
        referenceId: pipeline.id,
        createdBy: req.user!.userId,
      });

      res.json({ success: true, data: pipeline });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Erreur lors de l\'intégration';
      res.status(400).json({ success: false, error: { message } });
    }
  },

  /** POST /product-pipeline/:id/cancel */
  async cancel(req: AuthRequest, res: Response) {
    const id = req.params.id as string;
    const { reason } = req.body;

    try {
      const pipeline = await productPipelineRepository.cancel(id, reason || '', req.user!.userId);
      res.json({ success: true, data: pipeline });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Erreur lors de l\'annulation';
      res.status(400).json({ success: false, error: { message } });
    }
  },
};
