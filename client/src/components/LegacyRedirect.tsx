import { Navigate, useLocation, useParams } from 'react-router-dom';

/**
 * Redirection des anciennes URL (Économat /inventory, Pesage /warehouse) vers le
 * module Stock, en conservant :id et la query string. Les onglets historiques sont
 * traduits vers les onglets du module Stock ; les autres parametres (?bon=, ?ingredient=)
 * passent tels quels.
 */
const TAB_MAP: Record<string, Record<string, string>> = {
  inventory: { transfers: 'bons', ruptures: 'commander', consumption: 'analyse', consumables: 'consumables' },
  warehouse: { active: 'bons', history: 'bons', pesage: 'stock' },
};
const VIEW_MAP: Record<string, Record<string, string>> = {
  inventory: { transfers: 'transfers' },
  warehouse: { history: 'history', pesage: 'entame' },
};

export default function LegacyRedirect({ from, to }: { from: 'inventory' | 'warehouse'; to: string }) {
  const params = useParams();
  const { search } = useLocation();
  const qs = new URLSearchParams(search);
  const oldTab = qs.get('tab');
  if (oldTab) {
    const newTab = TAB_MAP[from][oldTab];
    if (newTab) qs.set('tab', newTab); else qs.delete('tab');
    const view = VIEW_MAP[from][oldTab];
    if (view) qs.set(from === 'warehouse' && oldTab === 'pesage' ? 'zone' : 'view', view);
  } else if (from === 'warehouse') {
    qs.set('tab', 'bons');
  }
  const path = to.replace(/:(\w+)/g, (_, k) => params[k] ?? '');
  const q = qs.toString();
  return <Navigate to={q ? `${path}?${q}` : path} replace />;
}
