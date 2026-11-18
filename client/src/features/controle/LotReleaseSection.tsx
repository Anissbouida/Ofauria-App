import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Unlock } from 'lucide-react';
import api from '../../api/client';
import { notify } from '../../components/ui/InlineNotification';
import { apiErrorMessage } from '../../api/errors';

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
    <div className="odoo-section">
      <div className="odoo-section-header flex items-center gap-2"><Unlock size={13} /> Lots en attente de libération</div>
      <table className="w-full text-xs">
        <thead><tr className="text-gray-500"><th className="text-left px-3 py-1">Lot</th><th className="text-left px-2">Produit</th><th className="text-right px-2">Quantité</th><th className="text-left px-2">Inspections</th><th className="text-left px-2">Libération</th></tr></thead>
        <tbody>{data.length === 0 ? <tr><td colSpan={5} className="px-3 py-2 text-gray-500">Aucun lot retenu.</td></tr> : data.map(l => (
          <tr key={l.id} className="border-t border-gray-100">
            <td className="px-3 py-1.5">{l.lot_number ?? '—'}<div className="text-gray-500">{new Date(l.produced_at).toLocaleDateString('fr-FR')}</div></td>
            <td className="px-2">{l.product_name}</td>
            <td className="text-right px-2">{l.quantity.toLocaleString('fr-FR')}</td>
            <td className="px-2">{l.pending_inspections ? `${l.pending_inspections} à faire` : 'faites'}{l.failed_inspections ? ` · ${l.failed_inspections} non conforme(s)` : ''}</td>
            <td className="px-2">
              <span style={{ display: 'inline-flex', gap: 6 }}>
                <input className="input" style={{ width: 200, padding: '1px 6px' }} placeholder="Motif de libération" aria-label={`Motif de libération du lot ${l.lot_number ?? ''}`}
                  value={notes[l.id] ?? ''} onChange={e => setNotes(n => ({ ...n, [l.id]: e.target.value }))} />
                <button type="button" className="odoo-btn-secondary" disabled={(notes[l.id] ?? '').trim().length < 3 || release.isPending} onClick={() => release.mutate(l.id)}>Libérer</button>
              </span>
            </td>
          </tr>
        ))}</tbody>
      </table>
    </div>
  );
}
