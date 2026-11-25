import type { Response } from 'express';
import type { AuthRequest } from '../middleware/auth.middleware.js';
import { roleRepository } from '../repositories/role.repository.js';
import { invalidateEnforcementMode, invalidateRolesCache } from '../services/access-rights.js';
import { normalizePermissions, permissionView } from '../services/permission-input.js';
import { PERMISSIONS } from '@ofauria/shared';
import { permissionsOfRole, permissionsOfUser, setRolePermissions } from '../services/permissions.js';
import { roleProfile } from '../services/role-profile.js';
import { createRoleFromTemplate, roleTemplates } from '../services/wizard/role-templates.js';
import { db, withTransaction } from '../config/database.js';
import { sectorRepository } from '../repositories/sector.repository.js';

const DEFS = PERMISSIONS as Record<string, unknown>;
/** Page d'accueil d'un rôle : route interne, « / » = accueil général (null). */
function homeRouteOf(v: unknown): string | null | 'invalid' {
  if (v === null || v === '' || v === '/') return null;
  const s = String(v).trim();
  return /^\/[a-z0-9/_-]*$/.test(s) && s.length <= 80 ? s : 'invalid';
}

/**
 * Rôle de base valide : tout rôle système actif, sauf l'administrateur (mig 637 : le contrôle
 * en base accepte déjà n'importe quel rôle système ; la liste figée de huit rôles de
 * boulangerie est abandonnée).
 */
async function isValidBaseRole(code: string): Promise<boolean> {
  if (!code || code === 'admin') return false;
  const r = await roleRepository.find(code) as { is_system?: boolean; is_active?: boolean } | null;
  return !!r?.is_system && r.is_active !== false;
}

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

  /** Modèles du secteur proposés à la création d'un rôle (lot 4) : du secteur actif (ou communs),
   *  dont les modules requis sont actifs, et pas encore créés. */
  async templates(_req: AuthRequest, res: Response) {
    const [all, act] = await Promise.all([roleTemplates(), sectorRepository.activation()]);
    let lineage: string[] = [];
    try { lineage = (await db.query(`SELECT fn_active_sector_lineage() AS l`)).rows[0]?.l ?? []; } catch { /* mig 698 absente */ }
    const modules = new Set<string>([...act.modules] as string[]);
    const data = all
      .filter(t => !t.exists && (!t.sector_code || lineage.includes(t.sector_code)) && t.requires_modules.every(m => modules.has(m)))
      .map(t => ({ code: t.code, label: t.label, description: t.description, baseRole: t.base_role, sectorCode: t.sector_code, homeRoute: t.home_route }));
    res.json({ success: true, data });
  },

  /** Fiche d'un rôle (lot 4) : membres, délégations, contrôles, rattachements, permissions détaillées. */
  async profile(req: AuthRequest, res: Response) {
    const role = await roleRepository.find(req.params.code);
    if (!role) { bad(res, 'Rôle inconnu', 404); return; }
    res.json({ success: true, data: await roleProfile(role) });
  },

  async create(req: AuthRequest, res: Response) {
    const label = typeof req.body?.label === 'string' ? req.body.label.trim() : '';
    if (label.length < 2 || label.length > 60) { bad(res, 'Libellé requis (2 à 60 caractères)'); return; }
    // Lot 4 : depuis un modèle du secteur — le code du rôle est celui du modèle.
    const templateCode = typeof req.body?.template === 'string' ? req.body.template : '';
    if (templateCode) {
      const t = (await roleTemplates()).find(x => x.code === templateCode);
      if (!t) { bad(res, 'Modèle inconnu'); return; }
      if (await roleRepository.find(t.code)) { bad(res, `Le rôle du modèle « ${t.label} » existe déjà`, 409); return; }
      const modules = [...(await sectorRepository.activation()).modules] as string[];
      await withTransaction(async () => {
        await createRoleFromTemplate(t, modules, req.user?.userId ?? null, label);
      });
      invalidateRolesCache();
      res.status(201).json({ success: true, data: await roleRepository.find(t.code) });
      return;
    }
    const code = typeof req.body?.code === 'string' && req.body.code ? req.body.code : slug(label);
    if (!/^[a-z][a-z0-9_]{1,29}$/.test(code)) { bad(res, 'Code invalide : lettres minuscules, chiffres et _'); return; }
    const baseRole = String(req.body?.baseRole ?? '');
    if (!(await isValidBaseRole(baseRole))) { bad(res, 'Rôle de base invalide : choisissez un rôle système actif (administrateur exclu)'); return; }
    if (await roleRepository.find(code)) { bad(res, `Le code « ${code} » existe déjà`, 409); return; }
    const empty = req.body?.empty === true;
    const copyFrom = empty ? null : (typeof req.body?.copyFrom === 'string' && req.body.copyFrom ? req.body.copyFrom : baseRole);
    if (copyFrom === 'admin') { bad(res, 'Les droits de l\'administrateur ne se copient pas'); return; }
    if (copyFrom && !(await roleRepository.find(copyFrom))) { bad(res, 'Rôle à copier inconnu'); return; }
    const description = typeof req.body?.description === 'string' ? req.body.description.trim().slice(0, 500) || null : null;
    const role = await roleRepository.create({ code, label, description, baseRole, copyFrom }, req.user?.userId);
    invalidateRolesCache();
    res.status(201).json({ success: true, data: role });
  },

  async update(req: AuthRequest, res: Response) {
    const role = await roleRepository.find(req.params.code);
    if (!role) { bad(res, 'Rôle inconnu', 404); return; }
    const data: { label?: string; description?: string | null; baseRole?: string; isActive?: boolean; homeRoute?: string | null } = {};
    if (req.body?.homeRoute !== undefined) {
      const home = homeRouteOf(req.body.homeRoute);
      if (home === 'invalid') { bad(res, 'Page d\'accueil invalide'); return; }
      data.homeRoute = home;
    }
    if (req.body?.label !== undefined) {
      const label = String(req.body.label).trim();
      if (label.length < 2 || label.length > 60) { bad(res, 'Libellé requis (2 à 60 caractères)'); return; }
      data.label = label;
    }
    if (req.body?.description !== undefined) data.description = String(req.body.description ?? '').trim().slice(0, 500) || null;
    if (!role.is_system) {
      if (req.body?.baseRole !== undefined) {
        if (!(await isValidBaseRole(String(req.body.baseRole)))) { bad(res, 'Rôle de base invalide : choisissez un rôle système actif (administrateur exclu)'); return; }
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
    // Comptes désactivés compris : ils gardent leur rôle (clé étrangère users.role) et
    // la suppression échouerait en base.
    const row = (await roleRepository.list()).find((r: Record<string, unknown>) => r.code === role.code);
    const active = Number(row?.user_count ?? 0), inactive = Number(row?.inactive_user_count ?? 0);
    if (active + inactive > 0) {
      bad(res, `Rôle encore attribué à ${active + inactive} compte(s)${inactive ? ` dont ${inactive} désactivé(s)` : ''} : retirez-le de ces comptes ou désactivez le rôle`, 409);
      return;
    }
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
    // Lot 4 : permissions détaillées enregistrées en même temps que les niveaux d'accès.
    const keys = Array.isArray(req.body?.keys) ? [...new Set((req.body.keys as unknown[]).map(String))] : null;
    if (keys) {
      const unknown = keys.filter(k => !DEFS[k]);
      if (unknown.length) { bad(res, `Permission(s) inconnue(s) : ${unknown.slice(0, 5).join(', ')}`); return; }
    }
    await roleRepository.setPermissions(role.code, perms, req.user?.userId);
    if (keys) await setRolePermissions(role.code, keys, req.user!.userId);
    const rows = await roleRepository.permissions(role.code);
    res.json({ success: true, data: rows.map((p) => permissionView(p as Parameters<typeof permissionView>[0])) });
  },

  // ─── Permissions par action (M2-07) ───
  /** Référentiel des clés et clés détenues par chaque rôle (matrice rôle × permission). */
  async actionMatrix(_req: AuthRequest, res: Response) {
    const roles = await roleRepository.list();
    const byRole: Record<string, string[]> = {};
    for (const r of roles as { code: string }[]) byRole[r.code] = await permissionsOfRole(r.code);
    const keys = Object.entries(PERMISSIONS as Record<string, { module: string; label: string }>)
      .map(([key, d]) => ({ key, module: d.module, label: d.label }));
    res.json({ success: true, data: { keys, byRole } });
  },
  /** Remplace les clés d'un rôle. Le rôle administrateur n'est pas modifiable (verrou anti-blocage). */
  async setActionPermissions(req: AuthRequest, res: Response) {
    const code = req.params.code as string;
    if (code === 'admin') {
      res.status(400).json({ success: false, error: { message: 'Le rôle administrateur garde toutes ses permissions.' } });
      return;
    }
    try {
      res.json({ success: true, data: await setRolePermissions(code, req.body.keys as string[], req.user!.userId) });
    } catch (err) {
      res.status(400).json({ success: false, error: { message: err instanceof Error ? err.message : 'Erreur' } });
    }
  },
  /** Ce que peut faire un utilisateur : ses clés effectives (rôles, délégations, exceptions). */
  async userActionPermissions(req: AuthRequest, res: Response) {
    res.json({ success: true, data: { keys: await permissionsOfUser(req.params.id as string) } });
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
