import * as shared from '@ofauria/shared';
import {
  APP_MODULES, MODULE_VERBS, PERMISSIONS, DATA_SCOPE_LABELS, resolveModuleKeys,
  type AppModule, type BusinessVerb, type DataScope,
} from '@ofauria/shared';
import type { RolePermission } from '../../api/users.api';

/**
 * Niveaux d'accès d'un rôle (refonte Utilisateurs, lot 4). Un niveau par module règle d'un coup
 * les cases Voir / Créer / Modifier / Supprimer, les actions métier et les permissions détaillées
 * du module ; le détail reste ajustable ensuite.
 *   Lecture  : voir les écrans et les pièces
 *   Saisie   : + créer
 *   Gestion  : + modifier, annuler, actions métier courantes
 *   Complet  : + supprimer et tout le détail du module
 */
export type Level = 'none' | 'read' | 'entry' | 'manage' | 'full';
export const LEVELS: { key: Level; label: string; hint: string }[] = [
  { key: 'none', label: 'Aucun', hint: 'Module masqué' },
  { key: 'read', label: 'Lecture', hint: 'Voir les écrans et les pièces' },
  { key: 'entry', label: 'Saisie', hint: '+ créer et compléter' },
  { key: 'manage', label: 'Gestion', hint: '+ modifier, annuler, actions métier courantes' },
  { key: 'full', label: 'Complet', hint: '+ supprimer et tout le détail du module' },
];
const RANK: Record<Level, number> = { none: 0, read: 1, entry: 2, manage: 3, full: 4 };
export const levelLabel = (l: Level | 'custom') => (l === 'custom' ? 'Personnalisé' : LEVELS.find(x => x.key === l)!.label);

const LEGACY = (shared as unknown as { LEGACY_MODULE_KEYS?: ReadonlySet<string> }).LEGACY_MODULE_KEYS ?? new Set<string>();
/** Modules réglables dans un rôle : sans les anciennes clés (fusion Stock) ni Utilisateurs (lot 10). */
export const ROLE_MODULES = (Object.values(APP_MODULES) as AppModule[]).filter(m => !LEGACY.has(m) && m !== 'users');

/** Niveau déduit des cases ; « custom » si la combinaison ne correspond à aucun niveau. */
export function levelOf(p: Pick<RolePermission, 'canView' | 'canCreate' | 'canEdit' | 'canDelete'> | undefined): Level | 'custom' {
  if (!p?.canView) return 'none';
  const { canCreate: c, canEdit: e, canDelete: d } = p;
  if (!c && !e && !d) return 'read';
  if (c && !e && !d) return 'entry';
  if (c && e && !d) return 'manage';
  if (c && e && d) return 'full';
  return 'custom';
}

export const verbsOf = (mod: string) => (MODULE_VERBS[mod as AppModule] ?? []) as BusinessVerb[];

/** Droit d'un module mis au niveau choisi (la portée et la configuration sont gardées). */
export function applyLevel(p: RolePermission, level: Level): RolePermission {
  const r = RANK[level];
  return {
    ...p,
    canView: r >= 1, canCreate: r >= 2, canEdit: r >= 3, canDelete: r >= 4,
    verbs: r >= 3 ? verbsOf(p.module) : [],
  };
}

/* ── Permissions détaillées ── */
type Def = { module: string; label: string };
const DEFS = PERMISSIONS as Record<string, Def>;
export const ALL_KEYS = Object.keys(DEFS);

const READ = /^(view|list|read|preview|export|print|pdf|history|stats|search|download|summary|lookup|report|reports|dashboard|consult|journal|ledger|balance|aging|kpis?)$/;
const ENTRY = /^(create|add|new|draft|import|upload|attachment|attachments|submit|request|save|duplicate|copy|comment|comments|note|notes)$/;
const FULL = /^(delete|remove|purge|close|reopen|reverse|revert|unlock|lock|reset|settings|config|configure|bulk_delete|destroy)$/;

/** Niveau qui comprend une permission, lu sur sa dernière partie (« achats.bc.supprimer »). */
export function keyLevel(key: string): Exclude<Level, 'none'> {
  const last = key.split('.').pop() ?? '';
  if (READ.test(last) || last.endsWith('_view') || last.startsWith('view_')) return 'read';
  if (FULL.test(last) || last.startsWith('delete_')) return 'full';
  if (ENTRY.test(last) || last.startsWith('create_')) return 'entry';
  return 'manage';
}
export const keyInLevel = (key: string, level: Level | 'custom') =>
  level !== 'custom' && level !== 'none' && RANK[keyLevel(key)] <= RANK[level];

/** Permissions d'un module (clés du module et de ses alias). */
export function keysOfModule(mod: string): string[] {
  const mods = new Set(resolveModuleKeys(mod));
  return ALL_KEYS.filter(k => mods.has(DEFS[k].module));
}
export const keyLabel = (k: string) => DEFS[k]?.label ?? k;
/** Groupe d'affichage : partie avant « : » du libellé (« Bons de commande : créer »). */
export function keyGroup(k: string): { group: string; action: string } {
  const label = keyLabel(k);
  const i = label.indexOf(' : ');
  return i > 0 ? { group: label.slice(0, i), action: label.slice(i + 3) } : { group: label, action: label };
}

/** Clés d'un module remplacées par celles du niveau choisi ; les autres modules ne bougent pas. */
export function alignKeys(current: readonly string[], mod: string, level: Level): string[] {
  const own = new Set(keysOfModule(mod));
  const kept = current.filter(k => !own.has(k));
  return [...kept, ...[...own].filter(k => keyInLevel(k, level))];
}

/** Résumé d'un droit pour la comparaison : niveau, et portée si elle n'est pas « son établissement ». */
export function accessSummary(p: RolePermission | undefined): string | null {
  const l = levelOf(p);
  if (l === 'none') return null;
  const parts = [levelLabel(l)];
  const scope = (p?.scope ?? 'store') as DataScope;
  if (scope !== 'store') parts.push(DATA_SCOPE_LABELS[scope] ?? scope);
  const sections = Array.isArray(p?.config?.sections) ? (p!.config!.sections as unknown[]).length : 0;
  if (p?.module === 'settings' && sections) parts.push(`${sections} section${sections > 1 ? 's' : ''}`);
  return parts.join(' · ');
}

/** Droit d'un module dans une liste reçue du serveur (alias compris). */
export function permOf(list: readonly RolePermission[] | undefined, mod: string): RolePermission | undefined {
  if (!list) return undefined;
  const keys = resolveModuleKeys(mod);
  return list.find(p => p.module === mod) ?? list.find(p => keys.includes(p.module));
}

/** Origine d'un rôle : libellé et teinte de pastille. */
export const ORIGIN: Record<'system' | 'template' | 'custom', { label: string; tag: string }> = {
  system: { label: 'Système', tag: 'x' },
  template: { label: 'Modèle du secteur', tag: 'g' },
  custom: { label: 'Personnalisé', tag: 'b' },
};
