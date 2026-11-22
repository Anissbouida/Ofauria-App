import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { History } from 'lucide-react';
import api from '../../api/client';
import { DataPanel, EmptyState, ErrorState, LoadingState } from '../ds';

/**
 * Onglet « Historique » d'une fiche (G6-07) : modifications champ par champ et suppression,
 * avec l'auteur, lues dans la piste d'audit générique. Repliable ; chargé à l'ouverture.
 * Réservé aux profils qui voient le journal d'audit (Paramètres › Journal).
 */
type Entry = { id: string; action: 'U' | 'D'; changed: Record<string, unknown>; at: string; origin: string | null; actor_name: string | null };
const show = (v: unknown) => (v === null || v === undefined ? '∅' : typeof v === 'object' ? JSON.stringify(v) : String(v));

export default function HistoryPanel({ table, id }: { table: string; id: string }) {
  const [open, setOpen] = useState(false);
  const { data = [], isLoading, isError, error } = useQuery({
    queryKey: ['audit-trail', table, id], enabled: open, retry: false,
    queryFn: () => api.get(`/settings/audit-trail/${table}/${id}`).then(r => r.data.data as Entry[]),
  });
  return (
    <div className="odoo-section" style={{ margin: '1rem' }}>
      <button type="button" className="odoo-section-header flex items-center gap-2" style={{ width: '100%', textAlign: 'left' }} onClick={() => setOpen(o => !o)} aria-expanded={open}>
        <History size={13} aria-hidden="true" /> Historique <span aria-hidden="true">{open ? '▲' : '▼'}</span>
      </button>
      {open && (
        <div style={{ padding: '8px 16px' }}>
          {isLoading ? <LoadingState bare label="Chargement de l'historique…" />
            : isError ? <ErrorState error={error} bare title="Historique non disponible" text="Votre profil ne donne pas accès à l'historique de cette fiche." />
            : data.length === 0 ? <EmptyState bare icon={History} title="Aucune modification enregistrée" text="Les changements de cette fiche s'afficheront ici." /> : (
            <DataPanel>
              <table className="odoo-table ds-dense">
                <thead><tr><th>Date</th><th>Auteur</th><th>Modification</th></tr></thead>
                <tbody>{data.map(e => (
                  <tr key={e.id} style={{ verticalAlign: 'top' }}>
                    <td style={{ whiteSpace: 'nowrap' }}>{new Date(e.at).toLocaleString('fr-FR')}</td>
                    <td>{e.actor_name ?? 'Système'}{e.origin ? <div style={{ fontSize: 12, color: 'var(--ds-muted)' }}>{e.origin}</div> : null}</td>
                    <td>
                      {e.action === 'D' ? <strong>Supprimé</strong> : Object.entries(e.changed).map(([k, v]) => {
                        const [a, b] = Array.isArray(v) ? v : [undefined, v];
                        return <div key={k}><code>{k}</code> : {show(a)} → <strong>{show(b)}</strong></div>;
                      })}
                    </td>
                  </tr>
                ))}</tbody>
              </table>
            </DataPanel>
          )}
        </div>
      )}
    </div>
  );
}
