import { db } from '../config/database.js';

/**
 * Versions des profils industriels (lot 14, mig 697) : lecture et comparaison.
 * Les versions sont créées par la base (déclencheurs) ; ce dépôt ne les écrit pas.
 */
type Content = Record<string, unknown> & { labels?: Record<string, string> };

const LIST_FIELDS: { key: string; label: string }[] = [
  { key: 'enabled_modules', label: 'Modules' }, { key: 'features', label: 'Capacités' },
  { key: 'add_modules', label: 'Modules ajoutés au parent' }, { key: 'remove_modules', label: 'Modules retirés du parent' },
  { key: 'add_features', label: 'Capacités ajoutées au parent' }, { key: 'remove_features', label: 'Capacités retirées du parent' },
];
const SCALAR_FIELDS: { key: string; label: string }[] = [
  { key: 'label', label: 'Libellé' }, { key: 'description', label: 'Description' }, { key: 'status', label: 'État' },
  { key: 'base_sector', label: 'Hérite de' }, { key: 'inherits', label: 'Héritage actif' }, { key: 'home_route', label: 'Accueil' },
  { key: 'family', label: 'Famille' },
];

export type VersionChange = { field: string; kind: 'list' | 'value' | 'label'; added?: string[]; removed?: string[]; before?: unknown; after?: unknown };

/** Différences entre deux contenus de profil (pur, testable). */
export function diffProfileContents(a: Content, b: Content): VersionChange[] {
  const out: VersionChange[] = [];
  const list = (v: unknown) => (Array.isArray(v) ? v.map(String) : []);
  for (const f of LIST_FIELDS) {
    const before = list(a[f.key]), after = list(b[f.key]);
    const added = after.filter(x => !before.includes(x)), removed = before.filter(x => !after.includes(x));
    if (added.length || removed.length) out.push({ field: f.label, kind: 'list', added, removed });
  }
  for (const f of SCALAR_FIELDS) {
    if (JSON.stringify(a[f.key] ?? null) !== JSON.stringify(b[f.key] ?? null)) out.push({ field: f.label, kind: 'value', before: a[f.key] ?? null, after: b[f.key] ?? null });
  }
  const la = a.labels ?? {}, lb = b.labels ?? {};
  for (const key of [...new Set([...Object.keys(la), ...Object.keys(lb)])].sort()) {
    if (la[key] !== lb[key]) out.push({ field: `Terme « ${key} »`, kind: 'label', before: la[key] ?? null, after: lb[key] ?? null });
  }
  return out;
}

export const sectorVersionRepository = {
  /** Profils avec leur version courante, nombre de spécialités et usage par la société. */
  async summary() {
    try {
      return (await db.query(`SELECT p.code, p.label, p.status, p.base_sector, p.inherits, p.is_custom, p.in_wizard,
          (SELECT max(version) FROM sector_pack_versions v WHERE v.sector_code = p.code) AS version,
          (SELECT max(created_at) FROM sector_pack_versions v WHERE v.sector_code = p.code) AS updated_at,
          (SELECT count(*)::int FROM sector_specializations s WHERE s.sector_pack = p.code) AS specialties,
          (p.code = (SELECT sector_pack FROM company_settings WHERE id = 1)) AS current
        FROM sector_packs p ORDER BY p.sort_order, p.label`)).rows;
    } catch (e) {
      if ((e as { code?: string }).code === '42P01') return [];
      throw e;
    }
  },

  async list(code: string) {
    return (await db.query(`SELECT v.version, v.created_at, v.content, concat_ws(' ', u.first_name, u.last_name) AS author
        FROM sector_pack_versions v LEFT JOIN users u ON u.id = v.created_by
       WHERE v.sector_code = $1 ORDER BY v.version DESC`, [code])).rows;
  },

  async compare(code: string, from: number, to: number) {
    const rows = (await db.query(`SELECT version, content FROM sector_pack_versions WHERE sector_code = $1 AND version = ANY($2::int[])`, [code, [from, to]])).rows;
    const a = rows.find(r => r.version === from)?.content, b = rows.find(r => r.version === to)?.content;
    if (!a || !b) return null;
    return { code, from, to, changes: diffProfileContents(a, b) };
  },
};
