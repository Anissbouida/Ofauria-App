import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import api from './client';

/** Champs personnalisés (mig 369). */
export type CfEntity = 'customer' | 'supplier' | 'ingredient' | 'packaging_item' | 'product' | 'order' | 'intervention' | 'project';
export type CfType = 'text' | 'number' | 'date' | 'select' | 'boolean';
export type CustomFieldDef = {
  id: string; entity: CfEntity; code: string; label: string; field_type: CfType; options: string[];
  required: boolean; show_in_list: boolean; help: string | null; display_order: number; is_active: boolean;
};
export type CfValues = Record<string, string | number | boolean | null | undefined>;

export const CF_TYPE_LABELS: Record<CfType, string> = { text: 'Texte', number: 'Nombre', date: 'Date', select: 'Liste de choix', boolean: 'Case à cocher' };

export const customFieldsApi = {
  defs: (entity?: CfEntity, all = false): Promise<{ data: CustomFieldDef[]; entities: { key: CfEntity; label: string }[] }> =>
    api.get('/custom-fields/defs', { params: { ...(entity ? { entity } : {}), ...(all ? { all: 'true' } : {}) } }).then(r => ({ data: r.data.data, entities: r.data.entities })),
  createDef: (data: { entity: CfEntity; label: string; fieldType: CfType; options?: string[]; required?: boolean; showInList?: boolean; help?: string | null; code?: string }) =>
    api.post('/custom-fields/defs', data).then(r => r.data.data as CustomFieldDef),
  updateDef: (id: string, data: Partial<{ label: string; options: string[]; required: boolean; showInList: boolean; help: string | null; displayOrder: number; isActive: boolean }>) =>
    api.put(`/custom-fields/defs/${id}`, data).then(r => r.data.data as CustomFieldDef),
  usage: (id: string) => api.get(`/custom-fields/defs/${id}/usage`).then(r => r.data.data as { filled: number }),
  values: (entity: CfEntity, id: string) => api.get(`/custom-fields/values/${entity}/${id}`).then(r => r.data.data as CfValues),
  save: (entity: CfEntity, id: string, values: CfValues) => api.put(`/custom-fields/values/${entity}/${id}`, { values }).then(r => r.data.data as CfValues),
};

/** Champs actifs d'un type de fiche (mis en cache : lus par chaque formulaire et liste). */
export function useCustomFieldDefs(entity: CfEntity) {
  const q = useQuery({ queryKey: ['custom-field-defs', entity], queryFn: () => customFieldsApi.defs(entity).then(r => r.data), staleTime: 60_000 });
  return { defs: q.data ?? [], isLoading: q.isLoading };
}

/** Valeur lisible : date JJ/MM/AAAA, case à cocher Oui / Non, nombre au format français. */
export function formatCfValue(def: CustomFieldDef, v: unknown): string {
  if (v === null || v === undefined || v === '') return '';
  if (def.field_type === 'boolean') return v ? 'Oui' : 'Non';
  if (def.field_type === 'date') { const s = String(v); return /^\d{4}-\d{2}-\d{2}/.test(s) ? `${s.slice(8, 10)}/${s.slice(5, 7)}/${s.slice(0, 4)}` : s; }
  if (def.field_type === 'number') return Number(v).toLocaleString('fr-FR', { maximumFractionDigits: 4 });
  return String(v);
}

/** Champs obligatoires non remplis (contrôle avant l'envoi du formulaire). */
export function missingRequired(defs: CustomFieldDef[], values: CfValues): string[] {
  return defs.filter(d => d.required && (values[d.code] === undefined || values[d.code] === null || values[d.code] === '')).map(d => d.label);
}

/**
 * État des champs personnalisés d'un formulaire de fiche : valeurs initiales de la fiche,
 * contrôle des obligatoires avant envoi, enregistrement après la fiche (id connu).
 */
export function useCustomFieldsForm(entity: CfEntity, initial?: unknown) {
  const { defs } = useCustomFieldDefs(entity);
  const [values, setValues] = useState<CfValues>(() => (initial && typeof initial === 'object' ? { ...(initial as CfValues) } : {}));
  return {
    defs, values, setValues,
    /** Libellés des champs obligatoires vides (liste vide = OK). */
    missing: () => missingRequired(defs, values),
    /** À appeler une fois la fiche enregistrée ; sans champ défini, ne fait rien. */
    save: async (id: string | null | undefined) => {
      if (!id || !defs.length) return;
      await customFieldsApi.save(entity, id, values);
    },
  };
}
