import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Unlock, Inbox } from 'lucide-react';
import api from '../../api/client';
import { notify } from '../../components/ui/InlineNotification';
import { apiErrorMessage } from '../../api/errors';
import { StatusTag } from '../../components/ui/StatusTag';
import { Panel } from './KlUi';
import { EmptyState } from '../../components/ds';

/**
 * Lots à libérer (M7-04) : lots de produit fini retenus par le plan de contrôle. Ils sont
 * libérés automatiquement quand leurs inspections sont toutes conformes (politique
 * quality.auto_release) ; ici, libération manuelle avec motif.
 */
type Pending = { id: string; lot_number: string | null; produced_at: string; quantity: number; product_name: string; pending_inspections: number; failed_inspections: number };

export default function LotReleaseSection() {
  const qc = useQueryClient();
  const { data = [] } = useQuery({ queryKey: ['quality', 'lots-pending'], queryFn: () => api.get('/quality/lots/pending').then(r => r.data.data as Pending[]) });
  const [notes, setNotes] = useState<Record<string, string>>({});
  const release = useMutation({
    mutationFn: (id: string) => api.post(`/quality/lots/${id}/release`, { note: notes[id] }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['quality'] }); notify.success('Lot libéré'); },
    onError: (e) => notify.error(apiErrorMessage(e)),
  });
  return (
    <Panel title={<span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}><Unlock size={15} /> Lots en attente de libération</span>}>
      <table className="odoo-table">
        <thead><tr><th>Lot</th><th>Produit</th><th className="ds-num">Quantité</th><th>Inspections</th><th>Libération</th></tr></thead>
        <tbody>{data.length === 0 ? <tr><td colSpan={5}><EmptyState bare icon={Inbox} title="Aucun lot retenu" /></td></tr> : data.map(l => (
          <tr key={l.id}>
            <td><span className="ds-ref">{l.lot_number ?? '—'}</span><div style={{ fontSize: '0.75rem', color: 'var(--ds-muted)' }}>{new Date(l.produced_at).toLocaleDateString('fr-FR')}</div></td>
            <td style={{ fontWeight: 500 }}>{l.product_name}</td>
            <td className="ds-num">{l.quantity.toLocaleString('fr-FR')}</td>
            <td>
              <StatusTag tone={l.pending_inspections ? 'todo' : 'done'} label={l.pending_inspections ? `${l.pending_inspections} à faire` : 'faites'} />
              {l.failed_inspections ? <span style={{ marginLeft: 4 }}><StatusTag tone="blocked" label={`${l.failed_inspections} non conforme(s)`} /></span> : null}
            </td>
            <td>
              <span style={{ display: 'inline-flex', gap: 6 }}>
                <input className="ds-input" style={{ width: 200 }} placeholder="Motif de libération" aria-label={`Motif de libération du lot ${l.lot_number ?? ''}`}
                  value={notes[l.id] ?? ''} onChange={e => setNotes(n => ({ ...n, [l.id]: e.target.value }))} />
                <button type="button" className="odoo-btn-secondary" disabled={(notes[l.id] ?? '').trim().length < 3 || release.isPending} onClick={() => release.mutate(l.id)}>Libérer</button>
              </span>
            </td>
          </tr>
        ))}</tbody>
      </table>
    </Panel>
  );
}
