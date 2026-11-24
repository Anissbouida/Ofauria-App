import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ChevronDown, ChevronRight, History } from 'lucide-react';
import api from '../../api/client';
import { EmptyState, ErrorState, LoadingState } from '../ds';
import '../../features/production/production.css';

/**
 * Onglet « Historique » d'une fiche (G6-07) : modifications champ par champ et suppression,
 * avec l'auteur, lues dans la piste d'audit générique. Repliable ; chargé à l'ouverture.
 * Réservé aux profils qui voient le journal d'audit (Paramètres › Journal).
 * Présentation (2026-11-24) : section du Design System, comme les versions et l'explosion
 * de la fiche technique (en-tête repliable, tableau dense, ancienne valeur barrée).
 */
type Entry = { id: string; action: 'U' | 'D'; changed: Record<string, unknown>; at: string; origin: string | null; actor_name: string | null };
const show = (v: unknown) => (v === null || v === undefined ? '∅' : typeof v === 'object' ? JSON.stringify(v) : String(v));
const when = (iso: string) => new Date(iso).toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
const muted = { color: 'var(--ds-muted)', fontSize: '0.78rem', fontWeight: 400 } as const;

export default function HistoryPanel({ table, id, defaultOpen = false }: { table: string; id: string; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  const { data = [], isLoading, isError, error } = useQuery({
    queryKey: ['audit-trail', table, id], enabled: open, retry: false,
    queryFn: () => api.get(`/settings/audit-trail/${table}/${id}`).then(r => r.data.data as Entry[]),
  });
  return (
    <div className="ds-panel pd-section" style={{ marginTop: 16 }}>
      <button type="button" aria-expanded={open} onClick={() => setOpen(o => !o)} className="pd-section-head"
        style={{ width: '100%', cursor: 'pointer', border: 'none', background: 'transparent', font: 'inherit', display: 'flex', alignItems: 'center', gap: 6 }}>
        {open ? <ChevronDown size={12} aria-hidden="true" /> : <ChevronRight size={12} aria-hidden="true" />}
        <History size={12} aria-hidden="true" /> Historique des modifications
        <span style={{ marginLeft: 8, ...muted }}>champ par champ, avec l'auteur</span>
        {open && data.length > 0 && <span style={{ marginLeft: 'auto', ...muted }}>{data.length} entrée{data.length > 1 ? 's' : ''}</span>}
      </button>
      {open && (
        <div style={{ padding: '0.5rem 16px 16px' }}>
          {isLoading ? <LoadingState bare label="Chargement de l'historique…" />
            : isError ? <ErrorState error={error} bare title="Historique non disponible" text="Votre profil ne donne pas accès à l'historique de cette fiche." />
            : data.length === 0 ? <EmptyState bare icon={History} title="Aucune modification enregistrée" text="Les changements de cette fiche s'afficheront ici." /> : (
            <div style={{ overflowX: 'auto' }}>
              <table className="odoo-table ds-dense">
                <thead><tr><th style={{ width: 140 }}>Date</th><th style={{ width: 170 }}>Auteur</th><th>Modification</th></tr></thead>
                <tbody>{data.map(e => (
                  <tr key={e.id} style={{ verticalAlign: 'top' }}>
                    <td style={{ whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }}>{when(e.at)}</td>
                    <td>
                      <span className="ds-strong">{e.actor_name ?? 'Système'}</span>
                      {e.origin ? <div style={{ fontSize: 12, color: 'var(--ds-muted)' }}>{e.origin}</div> : null}
                    </td>
                    <td>
                      {e.action === 'D' ? <span style={{ color: 'var(--ds-danger)', fontWeight: 600 }}>Supprimé</span> : (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                          {Object.entries(e.changed).map(([k, v]) => {
                            const [a, b] = Array.isArray(v) ? v : [undefined, v];
                            return (
                              <div key={k} style={{ fontSize: 13, overflowWrap: 'anywhere' }}>
                                <span style={{ color: 'var(--ds-muted)' }}>{k}</span>{' '}
                                <span style={{ color: 'var(--ds-muted)', textDecoration: 'line-through' }}>{show(a)}</span>
                                {' → '}<span className="ds-strong">{show(b)}</span>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
