import type { Response } from 'express';
import type { AuthRequest } from '../middleware/auth.middleware.js';
import { isCapability, isApprovalDocumentType } from '@ofauria/shared';
import { governanceRepository } from '../repositories/governance.repository.js';
import { roleRepository } from '../repositories/role.repository.js';
import { userRepository } from '../repositories/user.repository.js';
import { sodEnforcementMode, invalidateSodMode, invalidateSodCache, scanSodViolations, evaluateRoleCodesSod } from '../services/governance.js';
import { setParameter } from '../services/module-parameters.service.js';
import { baseCurrencyCode } from '../services/currency.js';

/** Types de pièce dont le plafond est réellement lu (purchase-order.controller, envoi du BC). */
export const ENFORCED_LIMIT_TYPES: ReadonlySet<string> = new Set(['purchase_order']);
const DOC_SOD_MODES = ['off', 'warn', 'block', 'block_except_admin'] as const;

const bad = (res: Response, message: string, status = 400) =>
  res.status(status).json({ success: false, error: { message } });

function slug(label: string) {
  return label.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 40);
}

/** Gouvernance (mig 336) : séparation des tâches, plafonds d'approbation, délégations. Admin. */
export const governanceController = {
  // ─── Séparation des tâches ──────────────────────────────────────────
  async sodList(_req: AuthRequest, res: Response) {
    res.json({ success: true, data: await governanceRepository.listSodRules() });
  },

  async sodViolations(_req: AuthRequest, res: Response) {
    res.json({ success: true, data: await scanSodViolations() });
  },

  async sodMode(_req: AuthRequest, res: Response) {
    res.json({ success: true, data: { mode: await sodEnforcementMode() } });
  },

  async setSodMode(req: AuthRequest, res: Response) {
    const mode = String(req.body?.mode ?? '');
    if (!['off', 'log', 'enforce'].includes(mode)) { bad(res, 'Mode invalide'); return; }
    await governanceRepository.setSodMode(mode, req.user?.userId);
    invalidateSodMode();
    res.json({ success: true, data: { mode } });
  },

  async sodCreate(req: AuthRequest, res: Response) {
    const b = req.body ?? {};
    const label = typeof b.label === 'string' ? b.label.trim() : '';
    if (label.length < 2 || label.length > 120) { bad(res, 'Libellé requis (2 à 120 caractères)'); return; }
    const code = typeof b.code === 'string' && b.code ? b.code : slug(label);
    if (!/^[a-z][a-z0-9_]{1,39}$/.test(code)) { bad(res, 'Code invalide'); return; }
    const aModule = String(b.aModule ?? ''); const bModule = String(b.bModule ?? '');
    if (!aModule || !bModule) { bad(res, 'Modules A et B requis'); return; }
    if (!isCapability(b.aRight) || !isCapability(b.bRight)) { bad(res, 'Capacité A ou B invalide'); return; }
    const severity = b.severity === 'warning' ? 'warning' : 'critical';
    if (await governanceRepository.findSodRule(code)) { bad(res, `Le code « ${code} » existe déjà`, 409); return; }
    const description = typeof b.description === 'string' ? b.description.trim().slice(0, 500) || null : null;
    const rule = await governanceRepository.createSodRule(
      { code, label, description, aModule, aRight: b.aRight, bModule, bRight: b.bRight, severity }, req.user?.userId);
    invalidateSodCache();
    res.status(201).json({ success: true, data: rule });
  },

  async sodUpdate(req: AuthRequest, res: Response) {
    const rule = await governanceRepository.findSodRule(req.params.code);
    if (!rule) { bad(res, 'Règle inconnue', 404); return; }
    const b = req.body ?? {};
    const data: { label?: string; description?: string | null; severity?: string; isActive?: boolean } = {};
    if (b.label !== undefined) {
      const label = String(b.label).trim();
      if (label.length < 2 || label.length > 120) { bad(res, 'Libellé requis (2 à 120 caractères)'); return; }
      data.label = label;
    }
    if (b.description !== undefined) data.description = String(b.description ?? '').trim().slice(0, 500) || null;
    if (b.severity !== undefined) { if (!['warning', 'critical'].includes(String(b.severity))) { bad(res, 'Sévérité invalide'); return; } data.severity = String(b.severity); }
    if (b.isActive !== undefined) data.isActive = !!b.isActive;
    const updated = await governanceRepository.updateSodRule(rule.code, data, req.user?.userId);
    invalidateSodCache();
    res.json({ success: true, data: updated });
  },

  async sodRemove(req: AuthRequest, res: Response) {
    const rule = await governanceRepository.findSodRule(req.params.code);
    if (!rule) { bad(res, 'Règle inconnue', 404); return; }
    await governanceRepository.removeSodRule(rule.code, req.user?.userId);
    invalidateSodCache();
    res.json({ success: true, data: null });
  },

  // ─── Plafonds d'approbation ─────────────────────────────────────────
  /**
   * Plafonds reliés aux circuits (lot 5) : pour chaque plafond, les circuits d'approbation du même
   * type de pièce, et s'il est appliqué. Aujourd'hui seul le bon de commande lit son plafond (à
   * l'envoi, quand aucun circuit ne s'applique) : les autres types sont signalés « sans effet ».
   */
  async limitsList(_req: AuthRequest, res: Response) {
    const [rows, circuits] = await Promise.all([governanceRepository.listApprovalLimits(), governanceRepository.circuitsByDocType()]);
    res.json({
      success: true,
      data: rows.map(r => ({ ...r, enforced: ENFORCED_LIMIT_TYPES.has(r.document_type), circuits: circuits.get(r.document_type) ?? [] })),
      meta: { enforcedTypes: [...ENFORCED_LIMIT_TYPES], circuits: Object.fromEntries(circuits) },
    });
  },

  async limitsSet(req: AuthRequest, res: Response) {
    const b = req.body ?? {};
    const roleCode = String(b.roleCode ?? '');
    if (!(await roleRepository.find(roleCode))) { bad(res, 'Rôle inconnu'); return; }
    if (roleCode === 'admin') { bad(res, 'L\'administrateur approuve sans plafond'); return; }
    if (!isApprovalDocumentType(b.documentType)) { bad(res, 'Type de document invalide'); return; }
    // Un plafond qui ne serait lu nulle part donnerait une fausse assurance (lot 5).
    if (!ENFORCED_LIMIT_TYPES.has(b.documentType)) { bad(res, 'Ce type de pièce n\'applique pas encore de plafond : réglez son circuit d\'approbation'); return; }
    const maxAmount = Number(b.maxAmount);
    if (!Number.isFinite(maxAmount) || maxAmount < 0) { bad(res, 'Montant invalide'); return; }
    const currency = typeof b.currency === 'string' && b.currency.length === 3 ? b.currency.toUpperCase() : baseCurrencyCode();
    const row = await governanceRepository.setApprovalLimit(roleCode, b.documentType, maxAmount, currency, req.user?.userId);
    res.json({ success: true, data: row });
  },

  async limitsRemove(req: AuthRequest, res: Response) {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) { bad(res, 'Identifiant invalide'); return; }
    await governanceRepository.removeApprovalLimit(id, req.user?.userId);
    res.json({ success: true, data: null });
  },

  // ─── Délégations ────────────────────────────────────────────────────
  /** Délégations réunies (lot 5) : rôle complet et approbations seulement. `active` gardé pour la vue d'ensemble. */
  async delegationsList(_req: AuthRequest, res: Response) {
    const rows = await governanceRepository.listAllDelegations();
    res.json({ success: true, data: rows.map(d => ({ ...d, active: d.status === 'active' })) });
  },

  /**
   * Nouvelle délégation. kind « role » (défaut) : le délégataire cumule le rôle sur la période ;
   * un cumul interdit par la séparation des tâches est refusé en mode « Bloquer », signalé sinon.
   * kind « approvals » : seulement les approbations du délégant (dates, sans heure).
   */
  async delegationsCreate(req: AuthRequest, res: Response) {
    const b = req.body ?? {};
    const kind = b.kind === 'approvals' ? 'approvals' : 'role';
    const fromUserId = String(b.fromUserId ?? ''); const toUserId = String(b.toUserId ?? '');
    const roleCode = String(b.roleCode ?? '');
    if (!fromUserId || !toUserId) { bad(res, 'Délégant et délégataire requis'); return; }
    if (fromUserId === toUserId) { bad(res, 'Le délégant et le délégataire doivent être différents'); return; }
    const toUser = await userRepository.findById(toUserId);
    if (!(await userRepository.findById(fromUserId)) || !toUser) { bad(res, 'Utilisateur inconnu'); return; }
    if (!toUser.is_active) { bad(res, 'Le délégataire doit avoir un compte actif'); return; }
    if (kind === 'role' && !(await roleRepository.find(roleCode))) { bad(res, 'Rôle inconnu'); return; }
    const endsAt = String(b.endsAt ?? '');
    if (!endsAt || Number.isNaN(Date.parse(endsAt))) { bad(res, 'Date de fin requise'); return; }
    const startsAt = b.startsAt && !Number.isNaN(Date.parse(String(b.startsAt))) ? String(b.startsAt) : undefined;
    const reason = typeof b.reason === 'string' ? b.reason.trim().slice(0, 500) || null : null;
    if (kind === 'approvals') {
      if (startsAt && endsAt.slice(0, 10) < startsAt.slice(0, 10)) { bad(res, 'La fin doit suivre le début'); return; }
      const row = await governanceRepository.createApprovalDelegation(
        { fromUserId, toUserId, startsOn: startsAt?.slice(0, 10), endsOn: endsAt.slice(0, 10), reason }, req.user?.userId);
      res.status(201).json({ success: true, data: { ...row, kind } });
      return;
    }
    if (startsAt && Date.parse(endsAt) <= Date.parse(startsAt)) { bad(res, 'La fin doit suivre le début'); return; }
    // Séparation des tâches : rôles du délégataire + rôle délégué.
    const mode = await sodEnforcementMode();
    const violations = mode === 'off' ? [] : await evaluateRoleCodesSod([...new Set([...(await roleCodesOfUser(toUserId)), roleCode])]);
    if (mode === 'enforce' && violations.length) {
      bad(res, `Séparation des tâches : ${violations.map(v => v.label).join(', ')}`, 409);
      return;
    }
    const row = await governanceRepository.createDelegation({ fromUserId, toUserId, roleCode, reason, startsAt, endsAt }, req.user?.userId);
    res.status(201).json({ success: true, data: { ...row, kind }, warnings: violations.map(v => v.label) });
  },

  /** Prolonger ou raccourcir une délégation (lot 5). */
  async delegationsExtend(req: AuthRequest, res: Response) {
    const kind = req.params.kind === 'approvals' ? 'approvals' : req.params.kind === 'role' ? 'role' : null;
    if (!kind) { bad(res, 'Type de délégation inconnu'); return; }
    const endsAt = String(req.body?.endsAt ?? '');
    if (!endsAt || Number.isNaN(Date.parse(endsAt))) { bad(res, 'Date de fin requise'); return; }
    if (!(await governanceRepository.extendDelegation(kind, String(req.params.id), kind === 'approvals' ? endsAt.slice(0, 10) : endsAt, req.user?.userId))) {
      bad(res, 'Délégation introuvable, ou fin avant le début', 404); return;
    }
    res.json({ success: true, data: null });
  },

  async delegationsRemove(req: AuthRequest, res: Response) {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) { bad(res, 'Identifiant invalide'); return; }
    await governanceRepository.removeDelegation(id, req.user?.userId);
    res.json({ success: true, data: null });
  },

  async approvalDelegationRemove(req: AuthRequest, res: Response) {
    if (!/^[0-9a-f-]{36}$/i.test(String(req.params.id))) { bad(res, 'Identifiant invalide'); return; }
    await governanceRepository.removeApprovalDelegation(String(req.params.id), req.user?.userId);
    res.json({ success: true, data: null });
  },

  // ─── Séparation des tâches sur les pièces (mig 442, lot 5) ──────────
  async documentSod(_req: AuthRequest, res: Response) {
    res.json({ success: true, data: await governanceRepository.documentSod() });
  },

  async setDocumentSodMode(req: AuthRequest, res: Response) {
    const mode = String(req.body?.mode ?? '');
    if (!(DOC_SOD_MODES as readonly string[]).includes(mode)) { bad(res, 'Mode invalide'); return; }
    await setParameter('purchasing.sod_mode', { mode }, req.user!.userId);
    res.json({ success: true, data: { mode } });
  },

  async setDocumentSodRule(req: AuthRequest, res: Response) {
    if (typeof req.body?.isActive !== 'boolean') { bad(res, 'isActive attendu'); return; }
    if (!(await governanceRepository.setDocumentSodRule(String(req.params.code), req.body.isActive, req.user?.userId))) { bad(res, 'Règle inconnue', 404); return; }
    res.json({ success: true, data: null });
  },
};

const roleCodesOfUser = (userId: string) => governanceRepository.roleCodesOfUser(userId);
