import { useQuery } from '@tanstack/react-query';
import { usersApi } from '../api/users.api';
import { useAuth } from '../context/AuthContext';

/**
 * Droits par action de l'utilisateur connecté (clés de role_action_permissions, mig 547).
 * Sert à ne montrer que les boutons que l'utilisateur peut utiliser (scénario 1, constat 111) ;
 * le serveur reste juge (garde can()). Tant que les clés ne sont pas chargées, `can` rend
 * false : un bouton apparaît une fois les droits connus, il ne disparaît pas après coup.
 */
export function useActionPermissions() {
  const { user } = useAuth();
  const { data: keys, isLoading } = useQuery({
    queryKey: ['my-action-permissions', user?.id],
    queryFn: usersApi.myActionPermissions,
    enabled: !!user,
    staleTime: 60_000,
  });
  const set = new Set(keys ?? []);
  return { can: (key: string) => set.has(key), isLoading };
}
