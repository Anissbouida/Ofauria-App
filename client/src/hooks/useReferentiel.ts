import { useQuery } from '@tanstack/react-query';
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
  metadata?: Record<string, unknown>;
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
  const raw = Array.isArray(data) ? data : (data as Record<string, unknown>)?.entries ?? [];
  const entries = (raw as RefEntry[]).filter(e => e.is_active !== false);
  const map = Object.fromEntries(entries.map(e => [e.code, e]));

  const getLabel = (code: string) => map[code]?.label || code;
  const getColor = (code: string) => map[code]?.color || undefined;

  return { entries, map, getLabel, getColor, isLoading };
}
