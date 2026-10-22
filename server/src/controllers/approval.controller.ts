import type { Response } from 'express';
import type { AuthRequest } from '../middleware/auth.middleware.js';
import { approvalService, type ApprovalActor } from '../services/approval.service.js';

/** Boîte « À approuver », mes demandes, historique, décisions, délégations (lot 8). */

const actorOf = (req: AuthRequest): ApprovalActor => ({ userId: req.user!.userId, role: req.user!.role, storeId: req.user!.storeId ?? null });

export const approvalController = {
  async inbox(req: AuthRequest, res: Response) {
    res.json({ success: true, data: await approvalService.inbox(actorOf(req)) });
  },

  async count(req: AuthRequest, res: Response) {
    res.json({ success: true, data: { count: await approvalService.inboxCount(actorOf(req)) } });
  },

  async mine(req: AuthRequest, res: Response) {
    res.json({ success: true, data: await approvalService.mine(req.user!.userId) });
  },

  async list(req: AuthRequest, res: Response) {
    const q = req.query as Record<string, string | undefined>;
    const { rows, total } = await approvalService.list({
      status: q.status, docType: q.docType,
      limit: q.limit ? Number(q.limit) : undefined, offset: q.offset ? Number(q.offset) : undefined,
    });
    res.json({ success: true, data: rows, total });
  },

  async forDocument(req: AuthRequest, res: Response) {
    res.json({ success: true, data: await approvalService.forDocument(req.params.docType, req.params.docId) });
  },

  async byId(req: AuthRequest, res: Response) {
    const r = await approvalService.byId(req.params.id);
    if (!r) { res.status(404).json({ success: false, error: { message: 'Demande introuvable' } }); return; }
    res.json({ success: true, data: r });
  },

  async approve(req: AuthRequest, res: Response) {
    const reason = typeof req.body?.reason === 'string' ? req.body.reason : undefined;
    res.json({ success: true, data: await approvalService.decide(req.params.id, actorOf(req), 'approve', reason) });
  },

  async reject(req: AuthRequest, res: Response) {
    const reason = typeof req.body?.reason === 'string' ? req.body.reason : '';
    res.json({ success: true, data: await approvalService.decide(req.params.id, actorOf(req), 'reject', reason) });
  },

  async cancel(req: AuthRequest, res: Response) {
    const reason = typeof req.body?.reason === 'string' ? req.body.reason : undefined;
    res.json({ success: true, data: await approvalService.cancel(req.params.id, actorOf(req), reason) });
  },

  async delegates(req: AuthRequest, res: Response) {
    res.json({ success: true, data: await approvalService.delegates(actorOf(req)) });
  },

  async delegations(req: AuthRequest, res: Response) {
    res.json({ success: true, data: await approvalService.delegations(req.user!.userId) });
  },

  async addDelegation(req: AuthRequest, res: Response) {
    const b = req.body ?? {};
    res.status(201).json({ success: true, data: await approvalService.addDelegation(actorOf(req), { toUserId: b.toUserId, startsOn: b.startsOn, endsOn: b.endsOn }) });
  },

  async removeDelegation(req: AuthRequest, res: Response) {
    await approvalService.removeDelegation(actorOf(req), req.params.id);
    res.json({ success: true });
  },
};
