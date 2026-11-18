import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2, Recycle, Undo2 } from 'lucide-react';
import api from '../../api/client';
import { apiErrorMessage } from '../../api/errors';
import { notify } from '../../components/ui/InlineNotification';
import { StatusBanner } from '../../components/ui/StatusBanner';
import SearchSelect from '../../components/ui/SearchSelect';
import { useConfirm } from '../../components/ui/ConfirmDialog';

/**
 * Production › Désassemblage (M9, mig 589) : défaire des produits finis et remettre leurs
 * matières en stock (nomenclature × taux de récupération), en lots rattachés au lot d'origine.
 */
interface Candidate { id: string; lot_number: string; backroom: number; product_name: string }
interface Disassembly {
  id: string; numero: string; quantity: number; recovery_pct: number; created_at: string; notes: string | null;
  product_name: string; lot_number: string; created_by_name: string | null;
  lines: { ingredient: string; quantity: number; unit: string | null }[];
}

export default function DisassemblyPage() {
  const qc = useQueryClient();
  const confirm = useConfirm();
  const { data: candidates = [] } = useQuery({
    queryKey: ['disassembly-candidates'], queryFn: () => api.get('/production/disassembly/candidates').then(r => r.data.data as Candidate[]),
  });
  const { data: history = [], isLoading } = useQuery({
    queryKey: ['disassembly'], queryFn: () => api.get('/production/disassembly').then(r => r.data.data as Disassembly[]),
  });
  const [lotId, setLotId] = useState('');
  const [qty, setQty] = useState('1');
  const [recovery, setRecovery] = useState('100');
  const [notes, setNotes] = useState('');
  const lot = candidates.find(c => c.id === lotId);
  const n = (s: string) => Number(s.replace(',', '.'));

  const run = useMutation({
    mutationFn: () => api.post('/production/disassembly', {
      productLotId: lotId, quantity: n(qty), recoveryPct: n(recovery), notes: notes.trim() || null,
    }).then(r => r.data.data as { numero: string; lines: number }),
    onSuccess: (r) => {
      notify.success(`Désassemblage ${r.numero} : ${r.lines} matière(s) remise(s) en stock`);
      setLotId(''); setQty('1'); setNotes('');
      qc.invalidateQueries({ queryKey: ['disassembly'] });
      qc.invalidateQueries({ queryKey: ['disassembly-candidates'] });
    },
    onError: (e) => notify.error(apiErrorMessage(e)),
  });

  const valid = !!lot && n(qty) > 0 && n(qty) <= lot.backroom && n(recovery) > 0 && n(recovery) <= 100;
  const submit = async () => {
    if (!lot) return;
    const ok = await confirm(
      `${n(qty)} × ${lot.product_name} (lot ${lot.lot_number}) sortent du stock ; leurs matières reviennent en stock à ${n(recovery)} %. Cette opération ne s'annule pas.`,
      { title: 'Désassembler ?', confirmLabel: 'Désassembler' });
    if (ok) run.mutate();
  };

  return (
    <div className="odoo-scope" style={{ padding: '1rem', display: 'grid', gap: 14 }}>
      <StatusBanner tone="info" icon={Recycle} title="Désassemblage">
        Défaire des produits finis (retour client, défaut, reconditionnement) : les pièces sortent du lot en arrière-boutique
        et les matières de leur nomenclature reviennent en stock, au taux de récupération indiqué.
      </StatusBanner>

      <section className="odoo-card" style={{ padding: '1rem', display: 'grid', gap: 12 }} aria-label="Nouveau désassemblage">
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'flex-end' }}>
          <label className="block text-xs font-medium text-gray-500">Lot de produit fini
            <SearchSelect value={lotId} onChange={setLotId} width={340} size="md" ariaLabel="Lot de produit fini" placeholder="Choisir un lot"
              options={candidates.map(c => ({ id: c.id, label: c.product_name, sublabel: c.lot_number, detail: `${c.backroom} en stock` }))} />
          </label>
          <label className="block text-xs font-medium text-gray-500">Pièces
            <input className="input" inputMode="decimal" value={qty} onChange={e => setQty(e.target.value)} style={{ width: 90 }} aria-label="Pièces à désassembler" />
          </label>
          <label className="block text-xs font-medium text-gray-500">Récupération (%)
            <input className="input" inputMode="decimal" value={recovery} onChange={e => setRecovery(e.target.value)} style={{ width: 100 }} aria-label="Taux de récupération" />
          </label>
          <label className="block text-xs font-medium text-gray-500" style={{ flex: '1 1 200px' }}>Motif
            <input className="input" value={notes} maxLength={1000} onChange={e => setNotes(e.target.value)} placeholder="ex : retour client, défaut de finition" aria-label="Motif" />
          </label>
          <button type="button" className="odoo-btn-primary" disabled={!valid || run.isPending} onClick={submit}>
            {run.isPending ? <Loader2 size={14} className="animate-spin" /> : <Undo2 size={14} />} Désassembler
          </button>
        </div>
        {lot && n(qty) > lot.backroom && <p className="text-xs" style={{ color: '#b42318' }}>Seulement {lot.backroom} pièce(s) en arrière-boutique sur ce lot.</p>}
        {!candidates.length && <p className="text-xs text-gray-500">Aucun lot désassemblable : il faut des pièces en arrière-boutique et une nomenclature.</p>}
      </section>

      <section aria-label="Historique">
        <div className="odoo-section-header">Historique</div>
        {isLoading ? <Loader2 className="animate-spin" size={16} /> : history.length === 0 ? (
          <p className="text-xs text-gray-500" style={{ padding: '0.75rem 0' }}>Aucun désassemblage.</p>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table className="odoo-table">
              <thead><tr><th>Pièce</th><th>Date</th><th>Produit</th><th>Lot</th><th style={{ textAlign: 'right' }}>Pièces</th><th style={{ textAlign: 'right' }}>Récup.</th><th>Matières remises</th><th>Par</th></tr></thead>
              <tbody>
                {history.map(d => (
                  <tr key={d.id} title={d.notes ?? undefined}>
                    <td style={{ fontFamily: 'monospace' }}>{d.numero}</td>
                    <td>{new Date(d.created_at).toLocaleString('fr-FR')}</td>
                    <td>{d.product_name}</td>
                    <td style={{ fontFamily: 'monospace' }}>{d.lot_number}</td>
                    <td style={{ textAlign: 'right' }}>{d.quantity}</td>
                    <td style={{ textAlign: 'right' }}>{d.recovery_pct} %</td>
                    <td style={{ fontSize: '0.75rem' }}>{d.lines.map(l => `${l.ingredient} ${l.quantity} ${l.unit ?? ''}`).join(' · ')}</td>
                    <td>{d.created_by_name ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
