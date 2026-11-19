import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { History } from 'lucide-react';
import api from '../../api/client';

/**
 * Onglet « Historique » d'une fiche (G6-07) : modifications champ par champ et suppression,
 * avec l'auteur, lues dans la piste d'audit générique. Repliable ; chargé à l'ouverture.
 * Réservé aux profils qui voient le journal d'audit (Paramètres › Journal).
 */
type Entry = { id: string; action: 'U' | 'D'; changed: Record<string, unknown>; at: string; origin: string | null; actor_name: string | null };
const show = (v: unknown) => (v === null || v === undefined ? '∅' : typeof v === 'object' ? JSON.stringify(v) : String(v));

export default function HistoryPanel({ table, id }: { table: string; id: string }) {
  const [open, setOpen] = useState(false);
  const { data = [], isLoading, isError } = useQuery({
    queryKey: ['audit-trail', table, id], enabled: open, retry: false,
    queryFn: () => api.get(`/settings/audit-trail/${table}/${id}`).then(r => r.data.data as Entry[]),
  });
  return (
    <div className="odoo-section" style={{ margin: '1rem' }}>
      <button type="button" className="odoo-section-header flex items-center gap-2" style={{ width: '100%', textAlign: 'left' }} onClick={() => setOpen(o => !o)} aria-expanded={open}>
        <History size={13} /> Historique {open ? '▲' : '▼'}
      </button>
      {open && (
        <div style={{ padding: '0.5rem 1rem', fontSize: '0.75rem' }}>
          {isLoading ? 'Chargement…' : isError ? <span className="text-gray-500">Historique non disponible pour votre profil.</span>
            : data.length === 0 ? <span className="text-gray-500">Aucune modification enregistrée depuis la mise en place de l'historique.</span> : (
            <table className="odoo-table">
              <thead><tr className="text-gray-500"><th className="text-left px-2 py-1">Quand</th><th className="text-left px-2">Qui</th><th className="text-left px-2">Modification</th></tr></thead>
              <tbody>{data.map(e => (
                <tr key={e.id} className="border-t border-gray-100" style={{ verticalAlign: 'top' }}>
                  <td className="px-2 py-1" style={{ whiteSpace: 'nowrap' }}>{new Date(e.at).toLocaleString('fr-FR')}</td>
                  <td className="px-2">{e.actor_name ?? 'Système'}{e.origin ? <div className="text-gray-500">{e.origin}</div> : null}</td>
                  <td className="px-2">
                    {e.action === 'D' ? <strong>Supprimé</strong> : Object.entries(e.changed).map(([k, v]) => {
                      const [a, b] = Array.isArray(v) ? v : [undefined, v];
                      return <div key={k}><code>{k}</code> : {show(a)} → <strong>{show(b)}</strong></div>;
                    })}
                  </td>
                </tr>
              ))}</tbody>
            </table>
          )}
        </div>
      )}
    </div>
  );
}
