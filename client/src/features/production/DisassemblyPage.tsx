import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2, Recycle, Undo2 } from 'lucide-react';
import api from '../../api/client';
import { apiErrorMessage } from '../../api/errors';
import { notify } from '../../components/ui/InlineNotification';
import SalesPageShell from '../sales/SalesPageShell';
import { Alert, DataPanel, EmptyState, ErrorState, FormField, LoadingState, SectionHeader, TableFooter } from '../../components/ds';
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
  const { data: history = [], isLoading, isError, refetch } = useQuery({
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

  const tooMany = !!lot && n(qty) > lot.backroom;
  const badRecovery = recovery.trim() !== '' && !(n(recovery) > 0 && n(recovery) <= 100);

  return (
    <SalesPageShell icon={Recycle} parent="Production › Opérations" title="Désassemblage"
      summary="Défaire des produits finis : les pièces sortent du lot et les matières de leur nomenclature reviennent en stock.">

      {!candidates.length && (
        <Alert tone="info">Aucun lot désassemblable : il faut des pièces en arrière-boutique et une nomenclature.</Alert>
      )}

      <section className="ds-panel" style={{ padding: '16px 20px', display: 'grid', gap: 12, overflow: 'visible' }} aria-label="Nouveau désassemblage">
        <h2 className="ds-subhead">Nouveau désassemblage</h2>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'flex-start' }}>
          <FormField label="Lot de produit fini" required>
            <SearchSelect value={lotId} onChange={setLotId} width={340} size="md" ariaLabel="Lot de produit fini" placeholder="Choisir un lot"
              options={candidates.map(c => ({ id: c.id, label: c.product_name, sublabel: c.lot_number, detail: `${c.backroom} en stock` }))} />
          </FormField>
          <div style={{ width: 110 }}>
            <FormField label="Pièces" htmlFor="dis-qty" required
              error={tooMany ? `Seulement ${lot!.backroom} pièce(s) en arrière-boutique sur ce lot.` : undefined}>
              <input id="dis-qty" className="ds-input" inputMode="decimal" value={qty} onChange={e => setQty(e.target.value)} aria-invalid={tooMany || undefined} />
            </FormField>
          </div>
          <div style={{ width: 130 }}>
            <FormField label="Récupération (%)" htmlFor="dis-recovery" required
              error={badRecovery ? 'Entre 1 et 100.' : undefined}>
              <input id="dis-recovery" className="ds-input" inputMode="decimal" value={recovery} onChange={e => setRecovery(e.target.value)} aria-invalid={badRecovery || undefined} />
            </FormField>
          </div>
          <div style={{ flex: '1 1 200px' }}>
            <FormField label="Motif" htmlFor="dis-notes">
              <input id="dis-notes" className="ds-input" value={notes} maxLength={1000} onChange={e => setNotes(e.target.value)} placeholder="Ex. : retour client, défaut de finition" />
            </FormField>
          </div>
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
          <button type="button" className="odoo-btn-primary" disabled={!valid || run.isPending} aria-busy={run.isPending || undefined} onClick={submit}>
            {run.isPending ? <Loader2 size={14} className="animate-spin" aria-hidden="true" /> : <Undo2 size={14} aria-hidden="true" />} Désassembler
          </button>
        </div>
      </section>

      <section aria-label="Historique" style={{ display: 'grid', gap: 12 }}>
        <SectionHeader title="Historique" />
        {isLoading ? <LoadingState /> : isError ? <ErrorState onRetry={() => refetch()} /> : history.length === 0 ? (
          <EmptyState icon={Recycle} title="Aucun désassemblage" text="Les désassemblages enregistrés apparaîtront ici, avec les matières remises en stock." />
        ) : (
          <DataPanel label="Historique des désassemblages" footer={<TableFooter note={`${history.length} désassemblage${history.length > 1 ? 's' : ''}`} />}>
            <table className="odoo-table">
              <thead><tr><th>N° pièce</th><th>Date</th><th>Produit</th><th>Lot</th><th className="ds-num">Pièces</th><th className="ds-num">Récupération (%)</th><th>Matières remises</th><th>Par</th></tr></thead>
              <tbody>
                {history.map(d => (
                  <tr key={d.id} title={d.notes ?? undefined}>
                    <td><span className="ds-ref">{d.numero}</span></td>
                    <td>{new Date(d.created_at).toLocaleString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}</td>
                    <td className="ds-strong">{d.product_name}</td>
                    <td><span className="ds-ref">{d.lot_number}</span></td>
                    <td className="ds-num">{d.quantity}</td>
                    <td className="ds-num">{d.recovery_pct}</td>
                    <td style={{ fontSize: 13 }}>{d.lines.map(l => `${l.ingredient} ${l.quantity} ${l.unit ?? ''}`).join(' · ')}</td>
                    <td>{d.created_by_name ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </DataPanel>
        )}
      </section>
    </SalesPageShell>
  );
}
