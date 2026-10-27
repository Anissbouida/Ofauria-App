import { db } from '../config/database.js';
import type { AppModule } from '@ofauria/shared';

/**
 * Champs personnalisés (mig 369). Définitions dans custom_field_defs, valeurs dans la
 * colonne JSONB custom_fields de chaque fiche (clé = code du champ).
 */
export const CF_ENTITIES = {
  customer:       { table: 'customers',                 module: 'customers',   label: 'Clients' },
  supplier:       { table: 'suppliers',                 module: 'purchasing',  label: 'Fournisseurs' },
  ingredient:     { table: 'ingredients',               module: 'stock',       label: 'Matières premières' },
  packaging_item: { table: 'packaging_items',           module: 'stock',       label: 'Consommables' },
  product:        { table: 'products',                  module: 'products',    label: 'Produits' },
  order:          { table: 'orders',                    module: 'orders',      label: 'Commandes' },
  intervention:   { table: 'maintenance_interventions', module: 'maintenance', label: 'Interventions' },
  project:        { table: 'projects',                  module: 'projects',    label: 'Projets' },
} as const satisfies Record<string, { table: string; module: AppModule; label: string }>;
export type CfEntity = keyof typeof CF_ENTITIES;
export const isCfEntity = (e: unknown): e is CfEntity => typeof e === 'string' && e in CF_ENTITIES;

export type FieldType = 'text' | 'number' | 'date' | 'select' | 'boolean';
export type FieldDef = {
  id: string; entity: CfEntity; code: string; label: string; field_type: FieldType; options: string[];
  required: boolean; show_in_list: boolean; help: string | null; display_order: number; is_active: boolean;
};

export async function listDefs(entity?: CfEntity | null, includeInactive = false): Promise<FieldDef[]> {
  const r = await db.query(
    `SELECT * FROM custom_field_defs WHERE ($1::text IS NULL OR entity = $1) AND ($2::boolean OR is_active)
      ORDER BY entity, display_order, label`, [entity ?? null, includeInactive]);
  return r.rows;
}

/** Code technique tiré du libellé : « N° d'immatriculation » → n_d_immatriculation. */
export function codeFromLabel(label: string): string {
  const c = label.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
  const withLetter = /^[a-z]/.test(c) ? c : `c_${c}`;
  return withLetter.slice(0, 40).replace(/_+$/, '') || 'champ';
}

/** Convertit une valeur saisie (formulaire ou import) selon le type ; '' / null = vide. */
export function coerce(def: FieldDef, raw: unknown): { value?: string | number | boolean | null; error?: string } {
  if (raw === null || raw === undefined || (typeof raw === 'string' && raw.trim() === '')) return { value: null };
  switch (def.field_type) {
    case 'number': {
      const n = typeof raw === 'number' ? raw : Number(String(raw).replace(/\s/g, '').replace(',', '.'));
      return Number.isFinite(n) ? { value: n } : { error: 'nombre attendu' };
    }
    case 'boolean': {
      if (typeof raw === 'boolean') return { value: raw };
      const s = String(raw).trim().toLowerCase();
      if (['oui', 'o', 'yes', 'y', '1', 'true', 'vrai', 'x'].includes(s)) return { value: true };
      if (['non', 'n', 'no', '0', 'false', 'faux'].includes(s)) return { value: false };
      return { error: 'oui ou non attendu' };
    }
    case 'date': {
      if (raw instanceof Date && !Number.isNaN(raw.getTime())) return { value: raw.toISOString().slice(0, 10) };
      const s = String(raw).trim();
      const fr = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
      const iso = fr ? `${fr[3]}-${fr[2].padStart(2, '0')}-${fr[1].padStart(2, '0')}` : s.slice(0, 10);
      const d = new Date(`${iso}T00:00:00Z`);
      return /^\d{4}-\d{2}-\d{2}$/.test(iso) && !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === iso ? { value: iso } : { error: 'date attendue (JJ/MM/AAAA)' };
    }
    case 'select': {
      const s = String(raw).trim();
      const hit = def.options.find(o => o.toLowerCase() === s.toLowerCase());
      return hit ? { value: hit } : { error: `valeur attendue : ${def.options.join(', ')}` };
    }
    default: {
      const s = String(raw).trim();
      return s.length > 500 ? { error: '500 caractères maximum' } : { value: s };
    }
  }
}

/**
 * Fusionne des valeurs saisies avec celles de la fiche et contrôle le résultat.
 * Les codes inconnus ou de champs désactivés sont ignorés (une valeur d'un champ
 * désactivé est conservée telle quelle).
 */
export function mergeValues(defs: FieldDef[], current: Record<string, unknown>, input: Record<string, unknown>) {
  const next: Record<string, unknown> = { ...current };
  const errors: Record<string, string> = {};
  for (const d of defs.filter(x => x.is_active)) {
    if (!(d.code in input)) continue;
    const r = coerce(d, input[d.code]);
    if (r.error) errors[d.code] = `${d.label} : ${r.error}`;
    else if (r.value === null) delete next[d.code];
    else next[d.code] = r.value;
  }
  for (const d of defs.filter(x => x.is_active && x.required)) {
    if (!errors[d.code] && (next[d.code] === undefined || next[d.code] === null || next[d.code] === '')) errors[d.code] = `${d.label} : obligatoire`;
  }
  return { values: next, errors };
}

export async function readValues(entity: CfEntity, id: string): Promise<Record<string, unknown> | null> {
  const r = await db.query(`SELECT custom_fields FROM ${CF_ENTITIES[entity].table} WHERE id = $1`, [id]);
  return r.rows[0] ? (r.rows[0].custom_fields ?? {}) : null;
}

export async function saveValues(entity: CfEntity, id: string, input: Record<string, unknown>) {
  const current = await readValues(entity, id);
  if (current === null) return { error: 'not_found' as const };
  const { values, errors } = mergeValues(await listDefs(entity, true), current, input);
  if (Object.keys(errors).length) return { error: 'invalid' as const, errors };
  await db.query(`UPDATE ${CF_ENTITIES[entity].table} SET custom_fields = $2::jsonb WHERE id = $1`, [id, JSON.stringify(values)]);
  return { data: values };
}
