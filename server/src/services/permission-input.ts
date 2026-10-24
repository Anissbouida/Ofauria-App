import { APP_MODULES, isBusinessVerb, isDataScope } from '@ofauria/shared';

/**
 * Normalisation des droits reçus de l'écran des permissions (rôles ou
 * utilisateurs), partagée par role.controller et user.controller.
 *
 * Deux dimensions au-delà du CRUD sont rangées dans `config` :
 *  - verbs : verbes métier accordés (approuver, valider…) ;
 *  - scope : portée des données ('own' | 'store' | 'all').
 * Elles sont acceptées soit au niveau de la ligne (p.verbs, p.scope), soit déjà
 * dans p.config, et toujours écrites dans config pour circuler jusqu'au client.
 */

export interface NormalizedPermission {
  module: string;
  canView: boolean;
  canCreate: boolean;
  canEdit: boolean;
  canDelete: boolean;
  config: Record<string, unknown>;
}

const MODULES = new Set<string>(Object.values(APP_MODULES));

export function normalizePermissions(raw: unknown): NormalizedPermission[] | string {
  if (!Array.isArray(raw)) return 'Liste de droits attendue';
  const out: NormalizedPermission[] = [];
  for (const p of raw as Record<string, unknown>[]) {
    if (typeof p?.module !== 'string' || !MODULES.has(p.module)) return `Module inconnu : ${String(p?.module)}`;
    const base = (p.config && typeof p.config === 'object') ? { ...(p.config as Record<string, unknown>) } : {};
    const verbsRaw = Array.isArray(p.verbs) ? p.verbs : (Array.isArray(base.verbs) ? base.verbs : []);
    const verbs = (verbsRaw as unknown[]).filter(isBusinessVerb);
    const scope = isDataScope(p.scope) ? p.scope : (isDataScope(base.scope) ? base.scope : undefined);
    delete base.verbs; delete base.scope;
    const config: Record<string, unknown> = { ...base, ...(verbs.length ? { verbs } : {}), ...(scope ? { scope } : {}) };
    const v = !!p.canView;
    out.push({
      module: p.module,
      // Créer / modifier / supprimer impliquent voir.
      canView: v || !!p.canCreate || !!p.canEdit || !!p.canDelete,
      canCreate: !!p.canCreate, canEdit: !!p.canEdit, canDelete: !!p.canDelete,
      config,
    });
  }
  return out.filter(p => p.canView);
}

/** Vue d'un droit pour le client : CRUD + verbes + portée extraits de config. */
export function permissionView(row: {
  module: string; can_view: boolean; can_create: boolean; can_edit: boolean; can_delete: boolean; config: Record<string, unknown> | null;
}) {
  const cfg = (row.config ?? {}) as Record<string, unknown>;
  return {
    module: row.module,
    canView: row.can_view, canCreate: row.can_create, canEdit: row.can_edit, canDelete: row.can_delete,
    config: cfg,
    verbs: Array.isArray(cfg.verbs) ? cfg.verbs : [],
    scope: isDataScope(cfg.scope) ? cfg.scope : 'store',
  };
}
