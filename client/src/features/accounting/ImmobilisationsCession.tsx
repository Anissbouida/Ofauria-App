import { useState, Fragment } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { Undo2, AlertTriangle } from 'lucide-react';
import { StatusBanner } from '../../components/ui/StatusBanner';
import { notify } from '../../components/ui/InlineNotification';
import { apiErrorMessage } from '../../api/errors';
import { fixedAssetsApi } from '../../api/fixed-assets.api';
import type { FixedAsset, DisposalInput, AssetTableAmounts } from '../../api/fixed-assets.api';
import EditionButtons from './EditionButtons';
import { currencySymbol } from '../../utils/money';
import { DataPanel, LoadingState, ErrorState, EmptyState, SectionHeader, HeaderActions, Modal, FormSection, FormField, FormFooter, Segmented, Toolbar } from '../../components/ds';

/**
 * Sortie d'une immobilisation (mig 427) — cession ou mise au rebut — et
 * tableau des immobilisations de l'exercice (modèle liasse).
 */

const n = (v: number) => v.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtDate = (s: string) => s.slice(0, 10).split('-').reverse().join('/');
const today = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'Africa/Casablanca' });
export function DisposalModal({ asset, onClose, onDone }: { asset: FixedAsset; onClose: () => void; onDone: () => void }) {
  const [kind, setKind] = useState<'sale' | 'scrap'>('sale');
  const [date, setDate] = useState(today());
  const [price, setPrice] = useState('');
  const [vatRate, setVatRate] = useState(20);
  const [counterpart, setCounterpart] = useState<'receivable' | 'bank' | 'cash'>('receivable');
  const [buyer, setBuyer] = useState('');
  const [reason, setReason] = useState('');
  const priceNum = Number(price.replace(/\s/g, '').replace(',', '.')) || 0;
  const body: DisposalInput = kind === 'sale'
    ? { date, kind, price: priceNum, vatRate, counterpart, buyer: buyer || null, reason: reason || null }
    : { date, kind, reason: reason || null };
  const valid = /^\d{4}-\d{2}-\d{2}$/.test(date) && (kind === 'scrap' || priceNum > 0);

  const pv = useQuery({
    queryKey: ['disposal-preview', asset.id, JSON.stringify(body)],
    queryFn: () => fixedAssetsApi.previewDisposal(asset.id, body),
    enabled: /^\d{4}-\d{2}-\d{2}$/.test(date),
    retry: false,
  });
  const save = useMutation({
    mutationFn: () => fixedAssetsApi.dispose(asset.id, body),
    onSuccess: (r) => { notify.success(`${kind === 'sale' ? 'Cession' : 'Mise au rebut'} comptabilisée (${r.entry_number})`); onDone(); },
    onError: (e) => notify.error(apiErrorMessage(e, 'Sortie impossible')),
  });
  const d = pv.data;
  const vat = Math.round(priceNum * vatRate) / 100;

  return (
    <Modal title={`Sortie de l'immobilisation — ${asset.label}`} onClose={onClose} width={620} locked={save.isPending}
      footer={<FormFooter onCancel={onClose} onSubmit={() => save.mutate()} busy={save.isPending} disabled={!valid || !d} submitLabel="Comptabiliser la sortie" />}>
      <Segmented label="Nature de la sortie" value={kind} onChange={setKind}
        options={[{ key: 'sale', label: 'Cession (vente)' }, { key: 'scrap', label: 'Mise au rebut' }]} />
      <FormSection title="Sortie">
        <div className="ds-form-grid">
          <FormField label="Date de sortie" htmlFor="disp-date" required>
            <input id="disp-date" type="date" className="ds-input" value={date} onChange={e => setDate(e.target.value)} />
          </FormField>
          {kind === 'sale' && <>
            <FormField label={`Prix de cession HT (${currencySymbol()})`} htmlFor="disp-price" required>
              <input id="disp-price" className="ds-input" value={price} onChange={e => setPrice(e.target.value)} inputMode="decimal" placeholder="0,00" />
            </FormField>
            <FormField label="TVA" htmlFor="disp-vat">
              <select id="disp-vat" className="ds-input" value={vatRate} onChange={e => setVatRate(Number(e.target.value))}>
                {[20, 14, 10, 7, 0].map(r => <option key={r} value={r}>{r ? `${r} %` : 'Sans TVA'}</option>)}
              </select>
            </FormField>
            <FormField label="Règlement" htmlFor="disp-counterpart">
              <select id="disp-counterpart" className="ds-input" value={counterpart} onChange={e => setCounterpart(e.target.value as typeof counterpart)}>
                <option value="receivable">À encaisser (3481)</option>
                <option value="bank">Banque (5141)</option>
                <option value="cash">Caisse (5161)</option>
              </select>
            </FormField>
          </>}
        </div>
        {kind === 'sale' && (
          <FormField label="Acquéreur" htmlFor="disp-buyer">
            <input id="disp-buyer" className="ds-input" value={buyer} onChange={e => setBuyer(e.target.value)} />
          </FormField>
        )}
        <FormField label="Motif / observation" htmlFor="disp-reason">
          <input id="disp-reason" className="ds-input" value={reason} onChange={e => setReason(e.target.value)} placeholder={kind === 'scrap' ? 'Hors service, irréparable…' : ''} />
        </FormField>
      </FormSection>

      {pv.isError && <StatusBanner tone="danger" icon={AlertTriangle} title={apiErrorMessage(pv.error, 'Sortie impossible à cette date')} />}
      {d && (
        <FormSection title="Calcul de la sortie">
          <DataPanel label="Calcul de la sortie">
            <table className="odoo-table ds-dense">
              <thead><tr><th>Élément</th><th className="ds-num">Montant ({currencySymbol()})</th></tr></thead>
              <tbody>
                <tr><td>Valeur brute</td><td className="ds-num">{n(d.cost)}</td></tr>
                <tr><td>Dotation complémentaire {d.months ? `(${d.months} mois jusqu'au mois de sortie)` : ''}</td><td className="ds-num">{n(d.complementary)}</td></tr>
                <tr><td>Amortissements cumulés à la sortie</td><td className="ds-num">{n(d.cumulated)}</td></tr>
                <tr><td className="ds-strong">Valeur nette comptable (VNC)</td><td className="ds-num ds-strong">{n(d.vnc)}</td></tr>
                {kind === 'sale' && <tr><td>Prix de cession HT{vatRate ? ` (+ TVA ${n(vat)})` : ''}</td><td className="ds-num">{n(d.price)}</td></tr>}
              </tbody>
              <tfoot>
                <tr>
                  <td>{d.gain >= 0 ? 'Plus-value' : 'Moins-value'}</td>
                  <td className="ds-num" style={{ color: d.gain >= 0 ? 'var(--ds-success)' : 'var(--ds-danger)' }}>{n(d.gain)}</td>
                </tr>
              </tfoot>
            </table>
          </DataPanel>
          <p style={{ fontSize: 12, color: 'var(--ds-muted)', margin: 0 }}>
            Écriture : amortissements cumulés et VNC (6513) au débit, valeur brute ({asset.asset_account_code}) au crédit
            {kind === 'sale' ? ' ; prix au débit du règlement, produit de cession (7513) et TVA au crédit.' : '.'}
          </p>
        </FormSection>
      )}
    </Modal>
  );
}

export function CancelDisposalModal({ asset, onClose, onDone }: { asset: FixedAsset; onClose: () => void; onDone: () => void }) {
  const [reason, setReason] = useState('');
  const save = useMutation({
    mutationFn: () => fixedAssetsApi.cancelDisposal(asset.id, reason.trim()),
    onSuccess: () => { notify.success('Sortie annulée : écritures extournées'); onDone(); },
    onError: (e) => notify.error(apiErrorMessage(e, 'Annulation impossible')),
  });
  const invalid = reason.trim().length < 3;
  return (
    <Modal title={`Annuler la sortie — ${asset.label}`} onClose={onClose} width={560} locked={save.isPending}
      footer={
        <div className="ds-form-foot">
          <span className="ds-grow" />
          <button type="button" onClick={onClose} className="odoo-btn-secondary" disabled={save.isPending}>Fermer</button>
          <button type="button" onClick={() => save.mutate()} disabled={invalid || save.isPending} className="ds-btn-danger solid"><Undo2 size={13} /> Annuler la sortie</button>
        </div>
      }>
      <p style={{ fontSize: 14, margin: 0 }}>
        L'écriture de sortie{asset.disposal_date ? ` du ${fmtDate(asset.disposal_date)}` : ''} et la dotation complémentaire seront extournées ;
        l'immobilisation reprend son amortissement.
      </p>
      <FormField label="Motif" htmlFor="cancel-disp-reason" required hint="3 caractères au moins.">
        <input id="cancel-disp-reason" className="ds-input" value={reason} onChange={e => setReason(e.target.value)} autoFocus />
      </FormField>
    </Modal>
  );
}

const COLS: { key: keyof AssetTableAmounts; label: string }[] = [
  { key: 'gross_start', label: 'Brut début' }, { key: 'acquisitions', label: 'Acquisitions' }, { key: 'disposals', label: 'Sorties' },
  { key: 'gross_end', label: 'Brut fin' }, { key: 'dep_start', label: 'Amort. début' }, { key: 'dep_year', label: 'Dotations' },
  { key: 'dep_out', label: 'Amort. sorties' }, { key: 'dep_end', label: 'Amort. fin' }, { key: 'vnc_end', label: 'VNC fin' },
];
const amt = (v: number) => (Math.abs(v) < 0.005 ? '' : n(v));

export function AssetsTableView() {
  const [year, setYear] = useState(new Date().getFullYear());
  const { data, isLoading, isError, error, refetch } = useQuery({ queryKey: ['fixed-assets-table', year], queryFn: () => fixedAssetsApi.table(year) });
  const cur = currencySymbol();
  return (
    <>
      <HeaderActions>
        <EditionButtons kind="immobilisations" params={{ endDate: `${year}-12-31` }} />
        <EditionButtons kind="cessions" params={{ endDate: `${year}-12-31` }} />
      </HeaderActions>

      <Toolbar>
        <select value={year} onChange={e => setYear(Number(e.target.value))} className="ds-input sm" style={{ minWidth: 100, width: 'auto' }} aria-label="Exercice">
          {Array.from({ length: 6 }, (_, i) => new Date().getFullYear() - i).map(y => <option key={y} value={y}>Exercice {y}</option>)}
        </select>
      </Toolbar>
      {isError ? (
        <ErrorState error={error} onRetry={() => refetch()} />
      ) : isLoading || !data ? (
        <LoadingState />
      ) : (
        <>
          <DataPanel label="Tableau des immobilisations">
            <table className="odoo-table ds-dense" style={{ minWidth: 980 }}>
              <thead><tr><th>Immobilisation</th>{COLS.map(c => <th className="ds-num" key={c.key} style={{ width: 100 }}>{c.label} ({cur})</th>)}</tr></thead>
              <tbody>
                {data.groups.map(g => (
                  <Fragment key={g.account_code}>
                    <tr className="ds-group"><td colSpan={COLS.length + 1}><span className="ds-ref">{g.account_code}</span> {g.account_label}</td></tr>
                    {g.items.map(i => (
                      <tr key={i.id}>
                        <td>{i.label} <span style={{ color: 'var(--ds-muted)', fontSize: 11 }}>· {fmtDate(i.acquisition_date)}</span></td>
                        {COLS.map(c => <td className="ds-num" key={c.key}>{amt(i[c.key])}</td>)}
                      </tr>
                    ))}
                    <tr><td className="ds-strong">Total {g.account_code}</td>{COLS.map(c => <td className="ds-num ds-strong" key={c.key}>{amt(g.totals[c.key])}</td>)}</tr>
                  </Fragment>
                ))}
              </tbody>
              <tfoot>
                <tr><td>Total</td>{COLS.map(c => <td className="ds-num" key={c.key}>{amt(data.totals[c.key])}</td>)}</tr>
              </tfoot>
            </table>
          </DataPanel>
          <SectionHeader title="Sorties de l'exercice"
            note={data.disposals.length ? `${data.gain_total >= 0 ? 'Plus-value nette' : 'Moins-value nette'} ${n(data.gain_total)} ${cur}` : undefined} />
          <DataPanel label="Sorties de l'exercice">
            {data.disposals.length === 0 ? (
              <EmptyState bare icon={Undo2} title="Aucune sortie" text="Aucune cession ni mise au rebut sur l'exercice." />
            ) : (
              <table className="odoo-table ds-dense">
                <thead><tr><th>Immobilisation</th><th style={{ width: 90 }}>Date</th><th style={{ width: 110 }}>Nature</th><th className="ds-num">Brut ({cur})</th><th className="ds-num">Amort. ({cur})</th><th className="ds-num">VNC ({cur})</th><th className="ds-num">Prix HT ({cur})</th><th className="ds-num">+/- value ({cur})</th></tr></thead>
                <tbody>
                  {data.disposals.map(d => (
                    <tr key={d.id}>
                      <td className="ds-strong">{d.label}</td><td>{fmtDate(d.date)}</td><td>{d.kind === 'sale' ? 'Cession' : 'Mise au rebut'}</td>
                      <td className="ds-num">{n(d.cost)}</td><td className="ds-num">{n(d.cumulated)}</td>
                      <td className="ds-num">{n(d.vnc)}</td><td className="ds-num">{amt(d.price)}</td>
                      <td className="ds-num ds-strong" style={{ color: d.gain >= 0 ? 'var(--ds-success)' : 'var(--ds-danger)' }}>{n(d.gain)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr><td colSpan={7}>Résultat net des sorties</td><td className="ds-num" style={{ color: data.gain_total >= 0 ? 'var(--ds-success)' : 'var(--ds-danger)' }}>{n(data.gain_total)}</td></tr>
                </tfoot>
              </table>
            )}
          </DataPanel>
        </>
      )}
    </>
  );
}
