import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2, Save, Send, Truck } from 'lucide-react';
import api from '../../api/client';
import { suppliersApi } from '../../api/accounting.api';
import { apiErrorMessage } from '../../api/errors';
import { notify } from '../../components/ui/InlineNotification';
import { StatusTag } from '../../components/ui/StatusTag';
import SearchSelect from '../../components/ui/SearchSelect';
import { money } from '../../utils/money';

import { DataPanel, LoadingState, SectionHeader } from '../../components/ds';
import './production.css';
/**
 * Sous-traitance de l'ordre (M9, mig 584) : sous-traitant et prix de façon, bon d'envoi des
 * composants, puis réception par la déclaration habituelle (« Lancer / déclarer »).
 * Coût de façon = prix unitaire × quantité reçue, ajouté au coût de revient.
 */
interface SubcontractData {
  subcontractorId: string | null; subcontractorName: string | null; unitFee: number | null;
  status: 'to_ship' | 'shipped' | 'received'; receivedQuantity: number; receivedAt: string | null;
  fee: { amount: number };
  shipments: { id: string; numero: string; shipped_at: string; shipped_by_name: string | null; notes: string | null;
    lines: { label: string; quantity: number; unit: string | null }[] }[];
}

const STATUS = {
  to_ship: { label: 'À envoyer', tone: 'todo' },
  shipped: { label: 'Chez le sous-traitant', tone: 'progress' },
  received: { label: 'Reçu', tone: 'done' },
} as const;

export default function SubcontractPanel({ planId, planStatus, canEdit }: { planId: string; planStatus: string; canEdit: boolean }) {
  const qc = useQueryClient();
  const key = ['production', planId, 'subcontract'];
  const { data, isLoading } = useQuery({
    queryKey: key, queryFn: () => api.get(`/production/${planId}/subcontract`).then(r => r.data.data as SubcontractData | null),
  });
  const { data: suppliers = [] } = useQuery({ queryKey: ['suppliers', 'active'], queryFn: suppliersApi.listActive, enabled: canEdit });
  const [supplierId, setSupplierId] = useState('');
  const [fee, setFee] = useState('');
  useEffect(() => {
    if (!data) return;
    setSupplierId(data.subcontractorId ?? '');
    setFee(data.unitFee != null ? String(data.unitFee) : '');
  }, [data]);

  const refresh = () => { qc.invalidateQueries({ queryKey: ['production', planId] }); };
  const save = useMutation({
    mutationFn: () => api.put(`/production/${planId}/subcontract`, { supplierId, unitFee: fee.trim() ? Number(fee.replace(',', '.')) : null }),
    onSuccess: () => { refresh(); notify.success('Sous-traitance enregistrée'); },
    onError: (e) => notify.error(apiErrorMessage(e)),
  });
  const ship = useMutation({
    mutationFn: () => api.post(`/production/${planId}/subcontract/ship`, {}).then(r => r.data.data as { numero: string }),
    onSuccess: (r) => { refresh(); notify.success(`Bon d'envoi ${r.numero} créé`); },
    onError: (e) => notify.error(apiErrorMessage(e)),
  });

  if (isLoading) return <LoadingState bare />;
  if (!data) return null;
  const st = STATUS[data.status] ?? STATUS.to_ship;
  const locked = data.status === 'received' || ['completed', 'cancelled'].includes(planStatus);
  const canShip = canEdit && data.status === 'to_ship' && !!data.subcontractorId && ['confirmed', 'ready_to_produce', 'in_progress'].includes(planStatus);

  return (
    <div className="ds-panel pd-section">
      <div className="pd-section-head" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <Truck size={12} /> Sous-traitance <StatusTag tone={st.tone} label={st.label} />
      </div>
      <div style={{ padding: '0.75rem 1rem', display: 'grid', gap: 12 }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'flex-end' }}>
          <label className="block text-xs font-medium text-gray-500">Sous-traitant
            {canEdit && !locked
              ? <SearchSelect options={(suppliers as { id: string; name: string }[]).map(s => ({ id: s.id, label: s.name }))}
                  value={supplierId} onChange={setSupplierId} placeholder="Choisir le sous-traitant" width={260} ariaLabel="Sous-traitant" clearable={false} />
              : <div style={{ fontWeight: 500, color: 'var(--odoo-text)' }}>{data.subcontractorName ?? '—'}</div>}
          </label>
          <label className="block text-xs font-medium text-gray-500">Prix de façon par unité
            {canEdit && !locked
              ? <input className="input" inputMode="decimal" value={fee} onChange={e => setFee(e.target.value)} style={{ width: 120 }} aria-label="Prix de façon par unité" />
              : <div style={{ fontWeight: 500, color: 'var(--odoo-text)' }}>{data.unitFee != null ? money(data.unitFee) : '—'}</div>}
          </label>
          {canEdit && !locked && (
            <button type="button" className="odoo-btn-secondary" disabled={!supplierId || save.isPending} onClick={() => save.mutate()}>
              {save.isPending ? <Loader2 size={13} className="animate-spin" /> : <Save size={13} />} Enregistrer
            </button>
          )}
          {canShip && (
            <button type="button" className="odoo-btn-primary" disabled={ship.isPending} onClick={() => ship.mutate()}>
              {ship.isPending ? <Loader2 size={13} className="animate-spin" /> : <Send size={13} />} Envoyer les composants
            </button>
          )}
        </div>

        {data.status === 'to_ship' && (
          <p className="text-xs text-gray-500">
            Choisissez le sous-traitant, confirmez l'ordre puis envoyez les composants : le bon d'envoi reprend les besoins calculés.
            La réception se fait ensuite par la déclaration habituelle de l'ordre.
          </p>
        )}
        {data.status !== 'to_ship' && (
          <div className="text-sm" style={{ display: 'flex', gap: 24, flexWrap: 'wrap' }}>
            <span>Reçu : <strong>{data.receivedQuantity}</strong></span>
            <span>Coût de façon : <strong>{money(data.fee.amount)}</strong></span>
          </div>
        )}

        {data.shipments.map(s => (
          <div key={s.id}>
            <SectionHeader title={<span className="ds-ref">{s.numero}</span>}
              note={<>{new Date(s.shipped_at).toLocaleString('fr-FR')}{s.shipped_by_name && <> · par {s.shipped_by_name}</>}</>} />
            <DataPanel label={`Envoi ${s.numero}`}>
            <table className="odoo-table ds-dense">
              <thead><tr><th>Composant</th><th className="ds-num">Quantité envoyée</th></tr></thead>
              <tbody>
                {s.lines.length === 0 && <tr><td colSpan={2} style={{ color: 'var(--odoo-text-muted)' }}>Aucun composant calculé</td></tr>}
                {s.lines.map((l, i) => <tr key={i}><td className="ds-strong">{l.label}</td><td className="ds-num">{l.quantity} {l.unit ?? ''}</td></tr>)}
              </tbody>
            </table>
            </DataPanel>
          </div>
        ))}
      </div>
    </div>
  );
}
