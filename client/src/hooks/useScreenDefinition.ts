import { useQuery } from '@tanstack/react-query';
import type { ScreenDefinition } from '@ofauria/shared';
import api from '../api/client';

/**
 * Définition d'écran résolue pour l'utilisateur (plan d'exécution multi-industries, étape 10,
 * pas 10b ; mig 646) : profil d'industrie → société → rôle. `null` tant qu'aucune définition
 * n'est publiée : l'écran s'affiche alors exactement comme écrit dans le code.
 * `preview` : applique aussi les brouillons (aperçu du configurateur).
 */
export function useScreenDefinition(screenKey: string, opts: { preview?: boolean } = {}): ScreenDefinition | null {
  const { data } = useQuery({
    queryKey: ['screen-definition', screenKey, !!opts.preview],
    queryFn: () => api.get(`/settings/screens/${screenKey}/resolved`, { params: opts.preview ? { preview: 1 } : {} })
      .then(r => (r.data.data ?? null) as ScreenDefinition | null),
    staleTime: 5 * 60_000,
    // Une définition absente ou refusée (droit) ne doit jamais empêcher l'écran de s'afficher.
    retry: false,
  });
  if (!data || !Object.keys(data).length) return null;
  return data;
}
