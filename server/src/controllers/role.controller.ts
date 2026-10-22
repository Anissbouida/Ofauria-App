import type { Response } from 'express';
import type { AuthRequest } from '../middleware/auth.middleware.js';
import { roleRepository } from '../repositories/role.repository.js';
import { invalidateEnforcementMode, invalidateRolesCache } from '../services/access-rights.js';
import { normalizePermissions, permissionView } from '../services/permission-input.js';

const BASE_ROLES = ['manager', 'cashier', 'saleswoman', 'baker', 'pastry_chef', 'viennoiserie', 'beldi_sale', 'magasinier'];

const bad = (res: Response, message: string, status = 400) =>
  res.status(status).json({ success: false, error: { message } });

/** Code technique tiré du libellé : « Responsable boutique » → responsable_boutique. */
function slug(label: string) {
  return label.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 30);
}

/** Rôles et droits par rôle (Utilisateurs › Rôles, mig 330). Réservé à l'administrateur. */
export const roleController = {
  async list(_req: AuthRequest, res: Response) {
    res.json({ success: true, data: await roleRepository.list() });
  },

  async permissions(req: AuthRequest, res: Response) {
    if (!(await roleRepository.find(req.params.code))) { bad(res, 'Rôle inconnu', 404); return; }
    const rows = await roleRepository.permissions(req.params.code);
    res.json({
      success: true,
      data: rows.map((p) => permissionView(p as Parameters<typeof permissionView>[0])),
    });
  },

  async create(req: AuthRequest, res: Response) {
    const label = typeof req.body?.label === 'string' ? req.body.label.trim() : '';
    if (label.length < 2 || label.length > 60) { bad(res, 'Libellé requis (2 à 60 caractères)'); return; }
    const code = typeof req.body?.code === 'string' && req.body.code ? req.body.code : slug(label);
    if (!/^[a-z][a-z0-9_]{1,29}$/.test(code)) { bad(res, 'Code invalide : lettres minuscules, chiffres et _'); return; }
    const baseRole = String(req.body?.baseRole ?? '');
    if (!BASE_ROLES.includes(baseRole)) { bad(res, 'Rôle de base invalide (administrateur exclu)'); return; }
    if (await roleRepository.find(code)) { bad(res, `Le code « ${code} » existe déjà`, 409); return; }
    const copyFrom = typeof req.body?.copyFrom === 'string' && req.body.copyFrom ? req.body.copyFrom : baseRole;
    if (!(await roleRepository.find(copyFrom))) { bad(res, 'Rôle à copier inconnu'); return; }
    const description = typeof req.body?.description === 'string' ? req.body.description.trim().slice(0, 500) || null : null;
    const role = await roleRepository.create({ code, label, description, baseRole, copyFrom }, req.user?.userId);
    invalidateRolesCache();
    res.status(201).json({ success: true, data: role });
  },

  async update(req: AuthRequest, res: Response) {
    const role = await roleRepository.find(req.params.code);
    if (!role) { bad(res, 'Rôle inconnu', 404); return; }
    const data: { label?: string; description?: string | null; baseRole?: string; isActive?: boolean } = {};
    if (req.body?.label !== undefined) {
      const label = String(req.body.label).trim();
      if (label.length < 2 || label.length > 60) { bad(res, 'Libellé requis (2 à 60 caractères)'); return; }
      data.label = label;
    }
    if (req.body?.description !== undefined) data.description = String(req.body.description ?? '').trim().slice(0, 500) || null;
    if (!role.is_system) {
      if (req.body?.baseRole !== undefined) {
        if (!BASE_ROLES.includes(String(req.body.baseRole))) { bad(res, 'Rôle de base invalide'); return; }
        data.baseRole = String(req.body.baseRole);
      }
      if (req.body?.isActive !== undefined) data.isActive = !!req.body.isActive;
    } else if (req.body?.baseRole !== undefined || req.body?.isActive !== undefined) {
      bad(res, 'Un rôle système ne change ni de rôle de base ni de statut'); return;
    }
    const updated = await roleRepository.update(role.code, data, req.user?.userId);
    // Le role de base est porte par le jeton : les sessions ouvertes sont invalidees.
    if (data.baseRole !== undefined && data.baseRole !== role.base_role) await roleRepository.revokeSessions(role.code);
    invalidateRolesCache();
    res.json({ success: true, data: updated });
  },

  async remove(req: AuthRequest, res: Response) {
    const role = await roleRepository.find(req.params.code);
    if (!role) { bad(res, 'Rôle inconnu', 404); return; }
    if (role.is_system) { bad(res, 'Un rôle système ne se supprime pas'); return; }
    const used = (await roleRepository.list()).find((r: Record<string, unknown>) => r.code === role.code)?.user_count ?? 0;
    if (used > 0) { bad(res, `Rôle attribué à ${used} utilisateur(s) : désactivez-le ou changez leur rôle`, 409); return; }
    await roleRepository.remove(role.code, req.user?.userId);
    invalidateRolesCache();
    res.json({ success: true, data: null });
  },

  async setPermissions(req: AuthRequest, res: Response) {
    const role = await roleRepository.find(req.params.code);
    if (!role) { bad(res, 'Rôle inconnu', 404); return; }
    if (role.code === 'admin') { bad(res, 'L\'administrateur a tous les droits'); return; }
    const perms = normalizePermissions(req.body?.permissions);
    if (typeof perms === 'string') { bad(res, perms); return; }
    await roleRepository.setPermissions(role.code, perms, req.user?.userId);
    const rows = await roleRepository.permissions(role.code);
    res.json({ success: true, data: rows.map((p) => permissionView(p as Parameters<typeof permissionView>[0])) });
  },

  async security(_req: AuthRequest, res: Response) {
    const [mode, denials] = await Promise.all([roleRepository.securityMode(), roleRepository.denials(14)]);
    res.json({ success: true, data: { mode, denials } });
  },

  async setSecurityMode(req: AuthRequest, res: Response) {
    const mode = String(req.body?.mode ?? '');
    if (!['off', 'log', 'enforce'].includes(mode)) { bad(res, 'Mode invalide'); return; }
    await roleRepository.setSecurityMode(mode, req.user?.userId);
    invalidateEnforcementMode();
    res.json({ success: true, data: { mode } });
  },
};
