import { useQuery } from '@tanstack/react-query';
import { productionApi } from '../../api/production.api';

/**
 * Politiques de production (M1-03 / M1-04) : les seuils et valeurs par défaut des écrans ne
 * sont plus écrits dans le code, ils viennent du serveur, résolus pour le contexte donné
 * (atelier, établissement). Tant que la réponse n'est pas arrivée, `num` rend null et
 * l'écran reste neutre : aucune valeur de repli n'est recopiée ici.
 */
export function useProductionPolicies(ctx: { workshop?: string | null; store?: string | null } = {}) {
  const workshop = ctx.workshop ?? undefined;
  const store = ctx.store ?? undefined;
  const { data } = useQuery({
    queryKey: ['production-policies', store ?? '', workshop ?? ''],
    queryFn: () => productionApi.listPolicies({ workshop, store }),
    staleTime: 5 * 60_000,
  });
  const raw = (key: string, field: string): unknown => data?.policies.find(p => p.key === key)?.effective.value[field];
  return {
    ready: Boolean(data),
    /** Valeur numérique effective, ou null tant que les politiques ne sont pas chargées. */
    num: (key: string, field: string): number | null => {
      const v = raw(key, field);
      const n = typeof v === 'number' ? v : Number(v);
      return v === undefined || v === null || !Number.isFinite(n) ? null : n;
    },
    text: (key: string, field: string): string | null => {
      const v = raw(key, field);
      return typeof v === 'string' ? v : null;
    },
  };
}

export type YieldLevel = 'good' | 'warn' | 'bad' | 'unknown';

/**
 * Niveau d'un rendement : bon à partir de la cible, critique sous le seuil d'alerte, à
 * surveiller entre les deux. Sans cible connue : « unknown » (affichage neutre).
 */
export function yieldLevel(pct: number, target: number | null | undefined, alert?: number | null): YieldLevel {
  if (target === null || target === undefined || !Number.isFinite(target)) return 'unknown';
  if (pct >= target) return 'good';
  if (alert !== null && alert !== undefined && pct < alert) return 'bad';
  return 'warn';
}

/** Classes de texte et de pastille par niveau (palette des écrans de production). */
export const YIELD_TEXT: Record<YieldLevel, string> = {
  good: 'text-emerald-600', warn: 'text-amber-600', bad: 'text-red-600', unknown: 'text-gray-600',
};
export const YIELD_PILL: Record<YieldLevel, string> = {
  good: 'bg-emerald-50 text-emerald-700', warn: 'bg-amber-50 text-amber-700', bad: 'bg-red-50 text-red-700', unknown: 'bg-gray-100 text-gray-600',
};

/** Équipe d'une heure donnée : « Matin » avant la coupure, « Après-midi » ensuite. */
export function shiftOf(date: Date, cutoffHour: number | null): string {
  if (cutoffHour === null) return '';
  return date.getHours() < cutoffHour ? 'Matin' : 'Apres-midi';
}
