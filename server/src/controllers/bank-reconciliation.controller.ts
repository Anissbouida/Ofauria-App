import type { Response } from 'express';
import type { AuthRequest } from '../middleware/auth.middleware.js';
import { bankReconciliationRepository } from '../repositories/bank-reconciliation.repository.js';

export const bankReconciliationController = {
  /** GET /api/v1/bank-reconciliation/statements */
  async listStatements(req: AuthRequest, res: Response) {
    const rows = await bankReconciliationRepository.listStatements({ storeId: req.user!.storeId });
    res.json({ success: true, data: rows });
  },

  /**
   * POST /api/v1/bank-reconciliation/statements
   * Body : { label, accountCode, statementDate, openingBalance, closingBalance, lines: [...] }
   * Les lignes sont parsees cote front (CSV -> JSON).
   */
  async createStatement(req: AuthRequest, res: Response) {
    const b = req.body as Record<string, unknown>;
    if (!b.label || !b.accountCode || !b.statementDate || !Array.isArray(b.lines)) {
      res.status(400).json({ success: false, error: { message: 'label, accountCode, statementDate et lines requis' } });
      return;
    }
    const lines = (b.lines as Record<string, unknown>[]).map(l => ({
      operationDate: String(l.operationDate),
      label: l.label ? String(l.label) : undefined,
      reference: l.reference ? String(l.reference) : undefined,
      amount: Number(l.amount),
      direction: (l.direction === 'out' ? 'out' : 'in') as 'in' | 'out',
    }));
    try {
      const stmt = await bankReconciliationRepository.createStatement({
        label: String(b.label),
        accountCode: String(b.accountCode),
        statementDate: String(b.statementDate),
        openingBalance: Number(b.openingBalance) || 0,
        closingBalance: Number(b.closingBalance) || 0,
        storeId: req.user!.storeId,
        createdBy: req.user!.userId,
        lines,
      });
      res.status(201).json({ success: true, data: stmt });
    } catch (err) {
      res.status(400).json({ success: false, error: { message: err instanceof Error ? err.message : 'Erreur' } });
    }
  },

  /** GET /api/v1/bank-reconciliation/statements/:id */
  async getReconciliation(req: AuthRequest, res: Response) {
    const data = await bankReconciliationRepository.getReconciliation(req.params.id);
    if (!data) {
      res.status(404).json({ success: false, error: { message: 'Releve introuvable' } });
      return;
    }
    res.json({ success: true, data });
  },

  /** POST /api/v1/bank-reconciliation/statements/:id/auto-match */
  async autoMatch(req: AuthRequest, res: Response) {
    try {
      const result = await bankReconciliationRepository.autoMatch(req.params.id, req.user!.userId);
      res.json({ success: true, data: result });
    } catch (err) {
      res.status(400).json({ success: false, error: { message: err instanceof Error ? err.message : 'Erreur' } });
    }
  },

  /** POST /api/v1/bank-reconciliation/lines/:id/match  Body: { entryLineId } */
  async matchLine(req: AuthRequest, res: Response) {
    const { entryLineId } = req.body as { entryLineId?: string };
    if (!entryLineId) {
      res.status(400).json({ success: false, error: { message: 'entryLineId requis' } });
      return;
    }
    try {
      const result = await bankReconciliationRepository.matchLine(req.params.id, entryLineId, req.user!.userId);
      res.json({ success: true, data: result });
    } catch (err) {
      res.status(400).json({ success: false, error: { message: err instanceof Error ? err.message : 'Erreur' } });
    }
  },

  /** POST /api/v1/bank-reconciliation/lines/:id/unmatch */
  async unmatchLine(req: AuthRequest, res: Response) {
    try {
      const result = await bankReconciliationRepository.unmatchLine(req.params.id);
      res.json({ success: true, data: result });
    } catch (err) {
      res.status(400).json({ success: false, error: { message: err instanceof Error ? err.message : 'Erreur' } });
    }
  },

  /** DELETE /api/v1/bank-reconciliation/statements/:id */
  async deleteStatement(req: AuthRequest, res: Response) {
    await bankReconciliationRepository.deleteStatement(req.params.id);
    res.json({ success: true, data: null });
  },
};
