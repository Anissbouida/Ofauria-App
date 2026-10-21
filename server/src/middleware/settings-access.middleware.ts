import type { Response, NextFunction } from 'express';
import type { AuthRequest } from './auth.middleware.js';
import {
  DEFAULT_ROLE_MODULES, allowedSettingsSections, settingsSectionOfField,
  SETTINGS_SECTION_LABELS, type SettingsSection,
} from '@ofauria/shared';
import { permissionRepository } from '../repositories/permission.repository.js';
import type { ModuleAction } from './module.middleware.js';

/**
 * Droits effectifs d'un utilisateur sur le module Paramètres (même règle que
 * authorizeModule) et sections autorisées (null = toutes).
 */
async function settingsRights(user: NonNullable<AuthRequest['user']>): Promise<{
  can: Record<ModuleAction, boolean>; sections: SettingsSection[] | null;
}> {
  if (user.role === 'admin') {
    return { can: { view: true, create: true, edit: true, delete: true }, sections: null };
  }
  const perms = await permissionRepository.findByUserId(user.userId);
  if (perms.length > 0) {
    const p = perms.find(x => x.module === 'settings');
    if (!p) return { can: { view: false, create: false, edit: false, delete: false }, sections: null };
    return {
      can: { view: p.can_view, create: p.can_create, edit: p.can_edit, delete: p.can_delete },
      sections: allowedSettingsSections(p.config),
    };
  }
  const has = ((DEFAULT_ROLE_MODULES[user.role] || []) as string[]).includes('settings');
  return { can: { view: has, create: has, edit: has, delete: false }, sections: null };
}

function deny(res: Response, message = 'Accès interdit') {
  res.status(403).json({ success: false, error: { message } });
}

/**
 * Remplace authorize('admin') sur les routes de paramétrage : l'accès se
 * donne par le droit « Paramètres » de l'écran Utilisateurs, éventuellement
 * restreint à certaines sections.
 */
export function authorizeSettings(section: SettingsSection, action: ModuleAction = 'view') {
  return async (req: AuthRequest, res: Response, next: NextFunction) => {
    if (!req.user) {
      res.status(401).json({ success: false, error: { message: 'Non authentifié' } });
      return;
    }
    try {
      const { can, sections } = await settingsRights(req.user);
      if (!can[action]) { deny(res); return; }
      if (sections && !sections.includes(section)) {
        deny(res, `Accès interdit à la section « ${SETTINGS_SECTION_LABELS[section]} »`);
        return;
      }
      next();
    } catch (err) {
      next(err);
    }
  };
}

/**
 * PUT /settings : un seul endpoint porte des champs de plusieurs sections
 * (identité, ticket, thème, production). Chaque champ envoyé doit appartenir
 * à une section autorisée.
 */
export async function authorizeSettingsUpdate(req: AuthRequest, res: Response, next: NextFunction) {
  if (!req.user) {
    res.status(401).json({ success: false, error: { message: 'Non authentifié' } });
    return;
  }
  try {
    const { can, sections } = await settingsRights(req.user);
    if (!can.edit) { deny(res); return; }
    if (sections) {
      const body = (req.body ?? {}) as Record<string, unknown>;
      const refused = Object.keys(body)
        .filter(k => body[k] !== undefined)
        .map(settingsSectionOfField)
        .find(s => !sections.includes(s));
      if (refused) {
        deny(res, `Accès interdit à la section « ${SETTINGS_SECTION_LABELS[refused]} »`);
        return;
      }
    }
    next();
  } catch (err) {
    next(err);
  }
}
