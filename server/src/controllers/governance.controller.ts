import type { Response } from 'express';
import type { AuthRequest } from '../middleware/auth.middleware.js';
import { isCapability, isApprovalDocumentType } from '@ofauria/shared';
import { governanceRepository } from '../repositories/governance.repository.js';
import { roleRepository } from '../repositories/role.repository.js';
import { userRepository } from '../repositories/user.repository.js';
import { sodEnforcementMode, invalidateSodMode, invalidateSodCache, scanSodViolations } from '../services/governance.js';

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
  async limitsList(_req: AuthRequest, res: Response) {
    res.json({ success: true, data: await governanceRepository.listApprovalLimits() });
  },

  async limitsSet(req: AuthRequest, res: Response) {
    const b = req.body ?? {};
    const roleCode = String(b.roleCode ?? '');
    if (!(await roleRepository.find(roleCode))) { bad(res, 'Rôle inconnu'); return; }
    if (roleCode === 'admin') { bad(res, 'L\'administrateur approuve sans plafond'); return; }
    if (!isApprovalDocumentType(b.documentType)) { bad(res, 'Type de document invalide'); return; }
    const maxAmount = Number(b.maxAmount);
    if (!Number.isFinite(maxAmount) || maxAmount < 0) { bad(res, 'Montant invalide'); return; }
    const currency = typeof b.currency === 'string' && b.currency.length === 3 ? b.currency.toUpperCase() : 'MAD';
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
  async delegationsList(_req: AuthRequest, res: Response) {
    res.json({ success: true, data: await governanceRepository.listDelegations() });
  },

  async delegationsCreate(req: AuthRequest, res: Response) {
    const b = req.body ?? {};
    const fromUserId = String(b.fromUserId ?? ''); const toUserId = String(b.toUserId ?? '');
    const roleCode = String(b.roleCode ?? '');
    if (!fromUserId || !toUserId) { bad(res, 'Délégant et délégataire requis'); return; }
    if (fromUserId === toUserId) { bad(res, 'Le délégant et le délégataire doivent être différents'); return; }
    if (!(await userRepository.findById(fromUserId)) || !(await userRepository.findById(toUserId))) { bad(res, 'Utilisateur inconnu'); return; }
    if (!(await roleRepository.find(roleCode))) { bad(res, 'Rôle inconnu'); return; }
    const endsAt = String(b.endsAt ?? '');
    if (!endsAt || Number.isNaN(Date.parse(endsAt))) { bad(res, 'Date de fin requise'); return; }
    const startsAt = b.startsAt && !Number.isNaN(Date.parse(String(b.startsAt))) ? String(b.startsAt) : undefined;
    if (startsAt && Date.parse(endsAt) <= Date.parse(startsAt)) { bad(res, 'La fin doit suivre le début'); return; }
    const reason = typeof b.reason === 'string' ? b.reason.trim().slice(0, 500) || null : null;
    const row = await governanceRepository.createDelegation({ fromUserId, toUserId, roleCode, reason, startsAt, endsAt }, req.user?.userId);
    res.status(201).json({ success: true, data: row });
  },

  async delegationsRemove(req: AuthRequest, res: Response) {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) { bad(res, 'Identifiant invalide'); return; }
    await governanceRepository.removeDelegation(id, req.user?.userId);
    res.json({ success: true, data: null });
  },
};
