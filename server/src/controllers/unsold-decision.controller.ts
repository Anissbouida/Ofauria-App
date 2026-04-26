import type { Response } from 'express';
import type { AuthRequest } from '../middleware/auth.middleware.js';
import { unsoldDecisionRepository } from '../repositories/unsold-decision.repository.js';
import { cashRegisterRepository } from '../repositories/cash-register.repository.js';
import { getLocalNow } from '../utils/timezone.js';

export const unsoldDecisionController = {

  /** GET /unsold-decisions/suggestions — produits invendus avec suggestion auto.
   *  Accepte ?closeType=fin_journee|passation pour ajuster la fenetre d'analyse
   *  (fin_journee ignore les passations intermediaires). */
  async suggestions(req: AuthRequest, res: Response) {
    const storeId = req.user!.storeId;
    if (!storeId) {
      res.status(400).json({ success: false, error: { message: 'Aucun magasin associe a cet utilisateur' } });
      return;
    }
    const closeType = typeof req.query.closeType === 'string' ? req.query.closeType : undefined;
    const items = await unsoldDecisionRepository.getUnsoldWithSuggestions(storeId, closeType);
    res.json({ success: true, data: items });
  },

  /** POST /unsold-decisions — enregistrer les decisions invendus */
  async save(req: AuthRequest, res: Response) {
    const { sessionId, decisions, notes, closeType } = req.body;
    if (!decisions || !Array.isArray(decisions)) {
      res.status(400).json({ success: false, error: { message: 'Format de decisions invalide' } });
      return;
    }
    // Passation : on accepte une liste vide pour tracer "vitrine verifiee vide".
    // Fin de journee : exige au moins une decision (une fermeture sans audit n'a pas de sens).
    if (decisions.length === 0 && closeType !== 'passation') {
      res.status(400).json({ success: false, error: { message: 'Aucune decision a enregistrer' } });
      return;
    }
    const storeId = req.user!.storeId;
    if (!storeId) {
      res.status(400).json({ success: false, error: { message: 'Aucun magasin associe' } });
      return;
    }

    // Garde-fou : toute sauvegarde de decisions invendus doit etre rattachee a une session.
    // Evite les decisions orphelines creees depuis la page standalone UnsoldDecisionsPage.
    if (!sessionId) {
      res.status(400).json({
        success: false,
        error: { message: 'sessionId requis — les decisions doivent etre rattachees a une session de caisse (passation ou fin de journee)' },
      });
      return;
    }

    // Verifier que la session existe, appartient au store et est encore ouverte
    const session = await cashRegisterRepository.findById(sessionId);
    if (!session) {
      res.status(404).json({ success: false, error: { message: 'Session de caisse introuvable' } });
      return;
    }
    if (session.store_id && session.store_id !== storeId) {
      res.status(403).json({ success: false, error: { message: 'Session appartenant a un autre magasin' } });
      return;
    }
    if (session.status !== 'open') {
      res.status(400).json({
        success: false,
        error: { message: 'Session deja fermee — impossible d\'enregistrer de nouvelles decisions' },
      });
      return;
    }

    // Mode passation : l'UI POS masque la colonne "Decision", aucune decision reelle
    // n'est prise. On neutralise les destinations a 'reexpose' pour ne pas polluer
    // unsold_decisions avec des 'waste'/'recycle' fantomes. Defense en profondeur
    // contre d'autres clients qui enverraient la suggestion brute en passation.
    // (saveDecisions skip deja les effets de stock via isPassation guard.)
    if (closeType === 'passation') {
      for (const d of decisions as { finalDestination?: string; remainingQty?: number }[]) {
        if ((d.remainingQty ?? 0) > 0) d.finalDestination = 'reexpose';
      }
    }

    // Mode fin_journee : exiger les destinations explicites
    if (closeType === 'fin_journee') {
      const invalid = decisions.find((d: { finalDestination?: string; remainingQty?: number }) =>
        (d.remainingQty ?? 0) > 0 && !['reexpose', 'recycle', 'waste'].includes(d.finalDestination || '')
      );
      if (invalid) {
        res.status(400).json({
          success: false,
          error: { message: 'Chaque produit restant doit avoir une destination (reexpose, recycle ou waste) en mode fin_journee' },
        });
        return;
      }
    }

    const result = await unsoldDecisionRepository.saveDecisions({
      storeId,
      sessionId,
      decidedBy: req.user!.userId,
      closeType,
      decisions,
      notes,
    });
    res.json({ success: true, data: result });
  },

  /** GET /unsold-decisions — historique */
  async list(req: AuthRequest, res: Response) {
    const { dateFrom, dateTo, destination, productId, page = '1', limit = '50' } = req.query as Record<string, string>;
    const p = parseInt(page);
    const l = parseInt(limit);
    const storeId = req.user!.storeId;

    const result = await unsoldDecisionRepository.findAll({
      storeId: storeId || undefined,
      dateFrom,
      dateTo,
      destination,
      productId,
      limit: l,
      offset: (p - 1) * l,
    });
    res.json({ success: true, data: result.rows, total: result.total, page: p, limit: l });
  },

  /** GET /unsold-decisions/stats — tableau de bord */
  async stats(req: AuthRequest, res: Response) {
    const { month, year } = req.query as Record<string, string>;
    const now = getLocalNow();
    const m = month ? parseInt(month) : (now.getMonth() + 1);
    const y = year ? parseInt(year) : now.getFullYear();
    const storeId = req.user!.storeId;

    const stats = await unsoldDecisionRepository.stats({
      storeId: storeId || undefined,
      month: m,
      year: y,
    });
    res.json({ success: true, data: stats });
  },

  /** GET /unsold-decisions/session/:sessionId — decisions de la session */
  async bySession(req: AuthRequest, res: Response) {
    const { sessionId } = req.params;
    const decisions = await unsoldDecisionRepository.findBySession(sessionId);
    res.json({ success: true, data: decisions });
  },
};
