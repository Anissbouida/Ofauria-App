import { useQuery } from '@tanstack/react-query';
import { authApi } from '../../api/auth.api';
import { useAuth } from '../../context/AuthContext';

/**
 * Administration déléguée (lot 10) : hors administrateur, on ne rattache un compte qu'à ses propres
 * établissements et on n'attribue pas un rôle de base Administrateur (le serveur le vérifie aussi).
 */
export function useDelegatedChoices() {
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';
  const { data } = useQuery({ queryKey: ['my-stores', user?.id], queryFn: authApi.myStores, enabled: !!user && !isAdmin, staleTime: 60_000 });
  const mine = new Set((data?.stores ?? []).map(s => s.id));
  return {
    isAdmin,
    stores: <T extends { id: string }>(list: T[]) => (isAdmin ? list : list.filter(s => mine.has(s.id))),
    roles: <T extends { base_role: string }>(list: T[]) => (isAdmin ? list : list.filter(r => r.base_role !== 'admin')),
  };
}

/**
 * Établissements d'un compte (refonte Utilisateurs, lot 7, mig 707) : cases à cocher et un
 * établissement par défaut, celui de la connexion. La portée « Son établissement » se lit sur
 * l'établissement actif, que la personne choisit parmi ceux-ci dans la barre du haut.
 */
export function StoresField({ stores, ids, defaultId, onChange, idPrefix = 'st' }: {
  stores: { id: string; name: string }[];
  ids: string[];
  defaultId: string;
  onChange: (ids: string[], defaultId: string) => void;
  idPrefix?: string;
}) {
  const toggle = (id: string) => {
    if (ids.includes(id)) {
      const next = ids.filter(x => x !== id);
      onChange(next, defaultId === id ? next[0] ?? '' : defaultId);
    } else {
      const next = [...ids, id];
      onChange(next, defaultId || id);
    }
  };
  if (!stores.length) return <span style={{ color: 'var(--ds-muted)', fontSize: 14 }}>Aucun établissement enregistré</span>;
  return (
    <div role="group" aria-label="Établissements" style={{ display: 'grid', gap: 6 }}>
      {stores.map(s => {
        const on = ids.includes(s.id);
        return (
          <div key={s.id} style={{ display: 'flex', alignItems: 'center', gap: 12, minHeight: 28 }}>
            <label htmlFor={`${idPrefix}-${s.id}`} style={{ display: 'inline-flex', alignItems: 'center', gap: 8, fontSize: 14, flex: 1, minWidth: 0 }}>
              <input id={`${idPrefix}-${s.id}`} type="checkbox" checked={on} onChange={() => toggle(s.id)} />
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.name}</span>
            </label>
            <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 13, color: on ? 'var(--ds-ink)' : 'var(--ds-muted)' }}>
              <input type="radio" name={`${idPrefix}-default`} disabled={!on} checked={on && defaultId === s.id}
                onChange={() => onChange(ids, s.id)} aria-label={`${s.name} par défaut`} />
              par défaut
            </label>
          </div>
        );
      })}
    </div>
  );
}
