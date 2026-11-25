import { useCallback, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ROLE_LABELS } from '@ofauria/shared';
import { referentielApi } from '../api/referentiel.api';

export interface RefEntry {
  id: string;
  code: string;
  label: string;
  color?: string;
  icon?: string;
  description?: string;
  display_order: number;
  is_active: boolean;
  metadata?: Record<string, any>;
}

/**
 * Hook to fetch reference table entries.
 * Returns { entries, map, getLabel, getColor, isLoading }
 */
export function useReferentiel(tableId: string, enabled = true) {
  const { data, isLoading } = useQuery({
    queryKey: ['ref', tableId],
    queryFn: () => referentielApi.entries(tableId),
    enabled,
    staleTime: 5 * 60 * 1000, // cache 5 min
  });

  // API returns either { table, entries } or a plain array depending on endpoint
  // Mémoïsé sur `data` : `map` reste stable entre deux rendus (dépendance de useMemo/useCallback).
  const { entries, map } = useMemo(() => {
    const raw = Array.isArray(data) ? data : (data as Record<string, any>)?.entries ?? [];
    const list = (raw as RefEntry[]).filter(e => e.is_active !== false);
    return { entries: list, map: Object.fromEntries(list.map(e => [e.code, e])) as Record<string, RefEntry> };
  }, [data]);

  const getLabel = (code: string) => map[code]?.label || code;
  const getColor = (code: string) => map[code]?.color || undefined;

  return { entries, map, getLabel, getColor, isLoading };
}

/**
 * Libellé de la FONCTION d'un employé (employees.role) : référentiel `employee_roles` d'abord
 * (liste propre à l'entreprise et à son secteur), puis libellés historiques, puis le code brut.
 * Ne pas utiliser pour un rôle d'accès utilisateur (users.role).
 */
export function useEmployeeRoleLabel() {
  const { map } = useReferentiel('employee_roles');
  return useCallback((code?: string | null) =>
    !code ? '' : map[code]?.label || ROLE_LABELS[code as keyof typeof ROLE_LABELS] || code, [map]);
}

/**
 * Unités ajoutées au référentiel `units` (mig 515) en plus de `fixed`, la liste
 * historique de l'écran. Lecture ouverte (GET /params/units/active).
 */
export function useExtraUnits(fixed: readonly string[]) {
  const { data = [] } = useQuery({ queryKey: ['units-active'], queryFn: referentielApi.activeUnits, staleTime: 5 * 60 * 1000 });
  return data.filter(u => !fixed.includes(u.code));
}
