import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Truck, Plus, Trash2, Calculator } from 'lucide-react';
import { StatusTag } from '../../components/ui/StatusTag';
import { notify } from '../../components/ui/InlineNotification';
import { apiErrorMessage } from '../../api/errors';
import { useConfirm } from '../../components/ui/ConfirmDialog';
import { RowMenu } from '../../components/ui/RowMenu';
import { freightRatesApi, type FreightGrid, type FreightGridInput } from '../../api/progress-billings.api';
import SalesPageShell from './SalesPageShell';
import { TableFooter, EmptyState, LoadingState, ErrorState, DataPanel, Modal, FormField, FormSection, FormFooter } from '../../components/ds';

/**
 * Ventes › Paramétrage › Grilles tarifaires du transport (mig 714 ; maquette
 * « Ventes-Transport-Demande »). Une grille par base (poids, palettes, distance), générale ou
 * propre à un client et à un trajet ; le simulateur applique la règle du serveur.
 */
const BASIS: Record<string, { label: string; unit: string }> = {
  weight: { label: 'Poids', unit: 'kg' }, pallet: { label: 'Palettes', unit: 'palettes' }, distance: { label: 'Distance', unit: 'km' },
};
const n2 = (v: number | string | null | undefined) => Number(v ?? 0).toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
type Draft = { id?: string; name: string; basis: string; originZone: string; destinationZone: string; minimumCharge: string; tvaRate: string; isActive: boolean;
  brackets: { upTo: string; unitPrice: string; flatPrice: string }[] };
const EMPTY: Draft = { name: '', basis: 'weight', originZone: '', destinationZone: '', minimumCharge: '0', tvaRate: '0', isActive: true,
  brackets: [{ upTo: '', unitPrice: '', flatPrice: '0' }] };

const fromGrid = (g: FreightGrid): Draft => ({ id: g.id, name: g.name, basis: g.basis, originZone: g.origin_zone ?? '', destinationZone: g.destination_zone ?? '',
  minimumCharge: String(Number(g.minimum_charge)), tvaRate: String(Number(g.tva_rate)), isActive: g.is_active,
  brackets: g.brackets.map(b => ({ upTo: b.upTo === null ? '' : String(b.upTo), unitPrice: String(b.unitPrice), flatPrice: String(b.flatPrice) })) });
const toInput = (d: Draft): FreightGridInput => ({ name: d.name, basis: d.basis, originZone: d.originZone || null, destinationZone: d.destinationZone || null,
  minimumCharge: Number(d.minimumCharge) || 0, tvaRate: Number(d.tvaRate) || 0, isActive: d.isActive,
  brackets: d.brackets.map(b => ({ upTo: b.upTo === '' ? null : Number(b.upTo), unitPrice: Number(b.unitPrice) || 0, flatPrice: Number(b.flatPrice) || 0 })) });

export default function FreightRatesPage() {
  const qc = useQueryClient();
  const confirm = useConfirm();
  const { data: grids = [], isLoading, isError, error, refetch } = useQuery({ queryKey: ['freight-rates'], queryFn: freightRatesApi.list });
  const [draft, setDraft] = useState<Draft | null>(null);
  const [sim, setSim] = useState({ basis: 'weight', quantity: '', originZone: '', destinationZone: '' });
  const refresh = () => qc.invalidateQueries({ queryKey: ['freight-rates'] });
  const onError = (e: unknown) => notify.error(apiErrorMessage(e));
  const save = useMutation({
    mutationFn: (d: Draft) => d.id ? freightRatesApi.update(d.id, toInput(d)) : freightRatesApi.create(toInput(d)),
    onSuccess: () => { setDraft(null); refresh(); notify.success('Grille enregistrée'); }, onError,
  });
  const remove = useMutation({ mutationFn: (id: string) => freightRatesApi.remove(id), onSuccess: refresh, onError });
  const price = useMutation({
    mutationFn: () => freightRatesApi.price({ basis: sim.basis, quantity: Number(sim.quantity), originZone: sim.originZone || null, destinationZone: sim.destinationZone || null }),
    onError,
  });

  return (
    <SalesPageShell icon={Truck} title="Grilles tarifaires du transport" parent="Ventes" list
      summary={`${grids.filter(g => g.is_active).length} grille${grids.length > 1 ? 's' : ''} active${grids.length > 1 ? 's' : ''}`}
      actions={<button type="button" className="odoo-btn-primary" onClick={() => setDraft({ ...EMPTY, brackets: [...EMPTY.brackets] })}><Plus size={14} /> Nouvelle grille</button>}>
      <p className="prj-note">La tranche qui contient la quantité donne le prix unitaire (plus un forfait éventuel) ; le minimum de facturation s'applique en dernier. Une grille propre à un client ou à un trajet l'emporte sur la grille générale.</p>

      <DataPanel label="Simulateur de prix">
        <div style={{ display: 'flex', gap: 12, padding: '12px 20px', alignItems: 'end', flexWrap: 'wrap' }}>
          <FormField label="Base" htmlFor="fr-sb">
            <select id="fr-sb" className="ds-input" value={sim.basis} onChange={e => setSim({ ...sim, basis: e.target.value })}>
              {Object.entries(BASIS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
            </select>
          </FormField>
          <FormField label={`Quantité (${BASIS[sim.basis].unit})`} htmlFor="fr-sq"><input id="fr-sq" className="ds-input" type="number" min={0} value={sim.quantity} onChange={e => setSim({ ...sim, quantity: e.target.value })} /></FormField>
          <FormField label="Départ" htmlFor="fr-so"><input id="fr-so" className="ds-input" value={sim.originZone} onChange={e => setSim({ ...sim, originZone: e.target.value })} /></FormField>
          <FormField label="Arrivée" htmlFor="fr-sd"><input id="fr-sd" className="ds-input" value={sim.destinationZone} onChange={e => setSim({ ...sim, destinationZone: e.target.value })} /></FormField>
          <button type="button" className="odoo-btn-secondary" disabled={!(Number(sim.quantity) > 0) || price.isPending} onClick={() => price.mutate()}><Calculator size={14} /> Calculer</button>
          {price.data && <span className="ds-strong" role="status">{price.data.gridName} : {n2(price.data.amount)} HT{price.data.minimumApplied ? ' (minimum)' : ''} · {n2(price.data.totalTtc)} TTC</span>}
        </div>
      </DataPanel>

      {isLoading ? <LoadingState label="Chargement des grilles…" /> : isError ? <ErrorState error={error} onRetry={() => refetch()} /> : !grids.length ? (
        <EmptyState icon={Truck} title="Aucune grille" text="Une grille donne le prix d'une prestation par tranches de poids, de palettes ou de distance." />
      ) : (
        <DataPanel label="Grilles" footer={<TableFooter note={`${grids.length} grille${grids.length > 1 ? 's' : ''}`} />}>
          <table className="odoo-table">
            <thead><tr><th>Grille</th><th>Base</th><th>Trajet</th><th>Client</th><th>Tranches</th><th className="ds-num">Minimum</th><th>État</th><th className="ds-actions">Actions</th></tr></thead>
            <tbody>
              {grids.map(g => (
                <tr key={g.id} onClick={() => setDraft(fromGrid(g))} style={{ cursor: 'pointer' }}>
                  <td className="ds-strong">{g.name}</td>
                  <td>{BASIS[g.basis]?.label}</td>
                  <td>{g.origin_zone || 'Toutes zones'} → {g.destination_zone || 'toutes zones'}</td>
                  <td>{g.customer_name ?? 'Générale'}</td>
                  <td>{g.brackets.map(b => `${b.upTo === null ? 'au-delà' : `≤ ${b.upTo}`} : ${n2(b.unitPrice)}`).join(' · ')}</td>
                  <td className="ds-num">{n2(g.minimum_charge)}</td>
                  <td>{g.is_active ? <StatusTag tone="done" label="Active" /> : <StatusTag tone="cancelled" label="Inactive" />}</td>
                  <td className="ds-actions" onClick={e => e.stopPropagation()}>
                    <RowMenu items={[{ label: 'Supprimer', icon: Trash2, danger: true, onSelect: async () => {
                      if (await confirm(`Supprimer la grille « ${g.name} » ?`, { title: 'Supprimer la grille', confirmLabel: 'Supprimer', danger: true })) remove.mutate(g.id);
                    } }]} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </DataPanel>
      )}

      {draft && (
        <Modal title={draft.id ? `Grille « ${draft.name} »` : 'Nouvelle grille'} onClose={() => setDraft(null)} width={680} locked={save.isPending}
          footer={<FormFooter onCancel={() => setDraft(null)} onSubmit={() => save.mutate(draft)} submitLabel="Enregistrer" disabled={!draft.name.trim() || !draft.brackets.length} busy={save.isPending} />}>
          <FormSection title="Grille">
            <div className="ds-form-grid">
              <FormField label="Nom" htmlFor="fr-n" required><input id="fr-n" className="ds-input" value={draft.name} onChange={e => setDraft({ ...draft, name: e.target.value })} /></FormField>
              <FormField label="Base" htmlFor="fr-b">
                <select id="fr-b" className="ds-input" value={draft.basis} onChange={e => setDraft({ ...draft, basis: e.target.value })}>
                  {Object.entries(BASIS).map(([k, v]) => <option key={k} value={k}>{v.label} ({v.unit})</option>)}
                </select>
              </FormField>
              <FormField label="Zone de départ" htmlFor="fr-o"><input id="fr-o" className="ds-input" placeholder="Toutes zones" value={draft.originZone} onChange={e => setDraft({ ...draft, originZone: e.target.value })} /></FormField>
              <FormField label="Zone d'arrivée" htmlFor="fr-d"><input id="fr-d" className="ds-input" placeholder="Toutes zones" value={draft.destinationZone} onChange={e => setDraft({ ...draft, destinationZone: e.target.value })} /></FormField>
              <FormField label="Minimum de facturation (HT)" htmlFor="fr-m"><input id="fr-m" className="ds-input" type="number" min={0} value={draft.minimumCharge} onChange={e => setDraft({ ...draft, minimumCharge: e.target.value })} /></FormField>
              <FormField label="TVA (%)" htmlFor="fr-t"><input id="fr-t" className="ds-input" type="number" min={0} max={100} value={draft.tvaRate} onChange={e => setDraft({ ...draft, tvaRate: e.target.value })} /></FormField>
            </div>
            <label style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 8 }}>
              <input type="checkbox" checked={draft.isActive} onChange={e => setDraft({ ...draft, isActive: e.target.checked })} /> Grille active
            </label>
          </FormSection>
          <FormSection title={`Tranches (${BASIS[draft.basis].unit})`}>
            <table className="odoo-table">
              <thead><tr><th>Jusqu'à (vide = au-delà)</th><th>Prix unitaire</th><th>Forfait</th><th /></tr></thead>
              <tbody>
                {draft.brackets.map((b, i) => (
                  <tr key={i}>
                    {(['upTo', 'unitPrice', 'flatPrice'] as const).map(k => (
                      <td key={k}><input className="ds-input sm" type="number" min={0} aria-label={`${k} tranche ${i + 1}`} value={b[k]}
                        onChange={e => setDraft({ ...draft, brackets: draft.brackets.map((x, j) => j === i ? { ...x, [k]: e.target.value } : x) })} /></td>
                    ))}
                    <td><button type="button" className="odoo-btn-secondary ds-btn-sm" aria-label={`Retirer la tranche ${i + 1}`}
                      onClick={() => setDraft({ ...draft, brackets: draft.brackets.filter((_, j) => j !== i) })}><Trash2 size={13} /></button></td>
                  </tr>
                ))}
              </tbody>
            </table>
            <button type="button" className="odoo-btn-secondary ds-btn-sm" style={{ marginTop: 8 }} onClick={() => setDraft({ ...draft, brackets: [...draft.brackets, { upTo: '', unitPrice: '', flatPrice: '0' }] })}><Plus size={13} /> Ajouter une tranche</button>
          </FormSection>
        </Modal>
      )}
    </SalesPageShell>
  );
}
