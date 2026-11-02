import { useState, Fragment } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { X, LogOut, Loader2, Undo2, AlertTriangle } from 'lucide-react';
import ModalBackdrop from '../../components/ui/ModalBackdrop';
import { StatusBanner } from '../../components/ui/StatusBanner';
import { notify } from '../../components/ui/InlineNotification';
import { apiErrorMessage } from '../../api/errors';
import { fixedAssetsApi } from '../../api/fixed-assets.api';
import type { FixedAsset, DisposalInput, AssetTableAmounts } from '../../api/fixed-assets.api';
import EditionButtons from './EditionButtons';

/**
 * Sortie d'une immobilisation (mig 427) — cession ou mise au rebut — et
 * tableau des immobilisations de l'exercice (modèle liasse).
 */

const n = (v: number) => v.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtDate = (s: string) => s.slice(0, 10).split('-').reverse().join('/');
const today = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'Africa/Casablanca' });
const mono = { fontFamily: 'ui-monospace, monospace', fontVariantNumeric: 'tabular-nums' } as const;
const inputStyle = { width: '100%', padding: '6px 9px', border: '1px solid var(--theme-bg-separator)', borderRadius: 6, fontSize: '0.8125rem', background: 'var(--theme-bg-input)' };
const labelStyle = { fontSize: '0.75rem', color: 'var(--theme-text-muted)', display: 'block', marginBottom: 4 };

function Shell({ title, onClose, children, footer }: { title: string; onClose: () => void; children: React.ReactNode; footer: React.ReactNode }) {
  return (
    <ModalBackdrop onClose={onClose} className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="odoo-scope" role="dialog" onClick={e => e.stopPropagation()}
        style={{ width: '100%', maxWidth: 620, maxHeight: '92vh', overflowY: 'auto', borderRadius: 4, boxShadow: '0 10px 30px rgba(0,0,0,0.2)' }}>
        <div className="odoo-control-bar">
          <div className="odoo-breadcrumb"><span className="odoo-breadcrumb-current">{title}</span></div>
          <div style={{ flex: 1 }} />
          <button type="button" onClick={onClose} className="odoo-pager-btn" aria-label="Fermer"><X size={14} /></button>
        </div>
        <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>{children}</div>
        <div style={{ padding: '12px 16px', borderTop: '1px solid var(--theme-bg-separator)', display: 'flex', justifyContent: 'flex-end', gap: 8 }}>{footer}</div>
      </div>
    </ModalBackdrop>
  );
}

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
    <Shell title={`Sortie de l'immobilisation — ${asset.label}`} onClose={onClose} footer={<>
      <button type="button" onClick={onClose} className="odoo-btn-secondary">Annuler</button>
      <button type="button" onClick={() => save.mutate()} disabled={!valid || !d || save.isPending} className="odoo-btn-primary"
        style={{ display: 'inline-flex', alignItems: 'center', gap: 6, opacity: !valid || !d || save.isPending ? 0.5 : 1 }}>
        {save.isPending ? <Loader2 size={13} className="animate-spin" /> : <LogOut size={13} />} Comptabiliser la sortie
      </button>
    </>}>
      <div style={{ display: 'inline-flex', border: '1px solid var(--theme-bg-separator)', borderRadius: 4, overflow: 'hidden', alignSelf: 'flex-start' }}>
        {(['sale', 'scrap'] as const).map(k => (
          <button key={k} type="button" onClick={() => setKind(k)} className={kind === k ? 'odoo-btn-primary' : 'odoo-btn-secondary'} style={{ borderRadius: 0, border: 'none', fontSize: '0.75rem' }}>
            {k === 'sale' ? 'Cession (vente)' : 'Mise au rebut'}
          </button>
        ))}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 10 }}>
        <div><label style={labelStyle}>Date de sortie *</label><input type="date" value={date} onChange={e => setDate(e.target.value)} style={inputStyle} /></div>
        {kind === 'sale' && <>
          <div><label style={labelStyle}>Prix de cession HT *</label><input value={price} onChange={e => setPrice(e.target.value)} inputMode="decimal" placeholder="0,00" style={inputStyle} /></div>
          <div><label style={labelStyle}>TVA</label>
            <select value={vatRate} onChange={e => setVatRate(Number(e.target.value))} style={inputStyle}>
              {[20, 14, 10, 7, 0].map(r => <option key={r} value={r}>{r ? `${r} %` : 'Sans TVA'}</option>)}
            </select>
          </div>
          <div><label style={labelStyle}>Règlement</label>
            <select value={counterpart} onChange={e => setCounterpart(e.target.value as typeof counterpart)} style={inputStyle}>
              <option value="receivable">À encaisser (3481)</option>
              <option value="bank">Banque (5141)</option>
              <option value="cash">Caisse (5161)</option>
            </select>
          </div>
          <div style={{ gridColumn: 'span 2' }}><label style={labelStyle}>Acquéreur</label><input value={buyer} onChange={e => setBuyer(e.target.value)} style={inputStyle} /></div>
        </>}
        <div style={{ gridColumn: '1 / -1' }}><label style={labelStyle}>Motif / observation</label><input value={reason} onChange={e => setReason(e.target.value)} placeholder={kind === 'scrap' ? 'Hors service, irréparable…' : ''} style={inputStyle} /></div>
      </div>

      {pv.isError && <StatusBanner tone="danger" icon={AlertTriangle} title={apiErrorMessage(pv.error, 'Sortie impossible à cette date')} />}
      {d && (
        <div className="odoo-section" style={{ padding: 0 }}>
          <table className="odoo-table" style={{ margin: 0 }}>
            <tbody>
              <tr><td>Valeur brute</td><td style={{ ...mono, textAlign: 'right' }}>{n(d.cost)}</td></tr>
              <tr><td>Dotation complémentaire {d.months ? `(${d.months} mois jusqu'au mois de sortie)` : ''}</td><td style={{ ...mono, textAlign: 'right' }}>{n(d.complementary)}</td></tr>
              <tr><td>Amortissements cumulés à la sortie</td><td style={{ ...mono, textAlign: 'right' }}>{n(d.cumulated)}</td></tr>
              <tr><td style={{ fontWeight: 600 }}>Valeur nette comptable (VNC)</td><td style={{ ...mono, textAlign: 'right', fontWeight: 600 }}>{n(d.vnc)}</td></tr>
              {kind === 'sale' && <tr><td>Prix de cession HT{vatRate ? ` (+ TVA ${n(vat)})` : ''}</td><td style={{ ...mono, textAlign: 'right' }}>{n(d.price)}</td></tr>}
              <tr style={{ background: 'var(--theme-bg-secondary)' }}>
                <td style={{ fontWeight: 600 }}>{d.gain >= 0 ? 'Plus-value' : 'Moins-value'}</td>
                <td style={{ ...mono, textAlign: 'right', fontWeight: 600, color: d.gain >= 0 ? '#2e7d32' : '#c62828' }}>{n(d.gain)}</td>
              </tr>
            </tbody>
          </table>
          <p style={{ fontSize: '0.6875rem', color: 'var(--theme-text-muted)', padding: '8px 12px', margin: 0 }}>
            Écriture : amortissements cumulés et VNC (6513) au débit, valeur brute ({asset.asset_account_code}) au crédit
            {kind === 'sale' ? ' ; prix au débit du règlement, produit de cession (7513) et TVA au crédit.' : '.'}
          </p>
        </div>
      )}
    </Shell>
  );
}

export function CancelDisposalModal({ asset, onClose, onDone }: { asset: FixedAsset; onClose: () => void; onDone: () => void }) {
  const [reason, setReason] = useState('');
  const save = useMutation({
    mutationFn: () => fixedAssetsApi.cancelDisposal(asset.id, reason.trim()),
    onSuccess: () => { notify.success('Sortie annulée : écritures extournées'); onDone(); },
    onError: (e) => notify.error(apiErrorMessage(e, 'Annulation impossible')),
  });
  return (
    <Shell title={`Annuler la sortie — ${asset.label}`} onClose={onClose} footer={<>
      <button type="button" onClick={onClose} className="odoo-btn-secondary">Fermer</button>
      <button type="button" onClick={() => save.mutate()} disabled={reason.trim().length < 3 || save.isPending} className="odoo-btn-danger"
        style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><Undo2 size={13} /> Annuler la sortie</button>
    </>}>
      <p style={{ fontSize: '0.8125rem', margin: 0 }}>
        L'écriture de sortie{asset.disposal_date ? ` du ${fmtDate(asset.disposal_date)}` : ''} et la dotation complémentaire seront extournées ;
        l'immobilisation reprend son amortissement.
      </p>
      <div><label style={labelStyle}>Motif *</label><input value={reason} onChange={e => setReason(e.target.value)} style={inputStyle} autoFocus /></div>
    </Shell>
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
  const { data, isLoading } = useQuery({ queryKey: ['fixed-assets-table', year], queryFn: () => fixedAssetsApi.table(year) });
  return (
    <>
      <div className="odoo-search-panel" style={{ flexWrap: 'wrap', gap: 6 }}>
        <select value={year} onChange={e => setYear(Number(e.target.value))} className="odoo-search-input" style={{ minWidth: 100 }} aria-label="Exercice">
          {Array.from({ length: 6 }, (_, i) => new Date().getFullYear() - i).map(y => <option key={y} value={y}>Exercice {y}</option>)}
        </select>
        <div style={{ flex: 1 }} />
        <span style={{ fontSize: '0.75rem', color: 'var(--theme-text-muted)', alignSelf: 'center' }}>Tableau</span>
        <EditionButtons kind="immobilisations" params={{ endDate: `${year}-12-31` }} />
        <span style={{ fontSize: '0.75rem', color: 'var(--theme-text-muted)', alignSelf: 'center' }}>Cessions</span>
        <EditionButtons kind="cessions" params={{ endDate: `${year}-12-31` }} />
      </div>
      {isLoading || !data ? (
        <div style={{ display: 'flex', justifyContent: 'center', padding: '3rem' }}><Loader2 size={20} className="animate-spin" /></div>
      ) : (
        <>
          <div className="odoo-section" style={{ padding: 0, overflowX: 'auto' }}>
            <table className="odoo-table" style={{ margin: 0, minWidth: 980 }}>
              <thead><tr><th>Immobilisation</th>{COLS.map(c => <th key={c.key} style={{ textAlign: 'right', width: 100 }}>{c.label}</th>)}</tr></thead>
              <tbody>
                {data.groups.map(g => (
                  <Fragment key={g.account_code}>
                    <tr style={{ background: 'var(--theme-bg-secondary)' }}><td colSpan={COLS.length + 1} style={{ fontWeight: 600 }}>{g.account_code} {g.account_label}</td></tr>
                    {g.items.map(i => (
                      <tr key={i.id}>
                        <td style={{ fontSize: '0.8125rem' }}>{i.label} <span style={{ color: 'var(--theme-text-muted)', fontSize: '0.6875rem' }}>· {fmtDate(i.acquisition_date)}</span></td>
                        {COLS.map(c => <td key={c.key} style={{ ...mono, textAlign: 'right', fontSize: '0.8125rem' }}>{amt(i[c.key])}</td>)}
                      </tr>
                    ))}
                    <tr style={{ fontWeight: 600 }}><td>Total {g.account_code}</td>{COLS.map(c => <td key={c.key} style={{ ...mono, textAlign: 'right' }}>{amt(g.totals[c.key])}</td>)}</tr>
                  </Fragment>
                ))}
              </tbody>
              <tfoot>
                <tr style={{ background: 'var(--theme-bg-secondary)', fontWeight: 700 }}><td>Total</td>{COLS.map(c => <td key={c.key} style={{ ...mono, textAlign: 'right' }}>{amt(data.totals[c.key])}</td>)}</tr>
              </tfoot>
            </table>
          </div>
          <div className="odoo-section" style={{ padding: 0 }}>
            <div style={{ padding: '10px 14px', fontWeight: 600, fontSize: '0.8125rem', borderBottom: '1px solid var(--theme-bg-separator)' }}>
              Sorties de l'exercice {data.disposals.length ? `· ${data.gain_total >= 0 ? 'plus-value nette' : 'moins-value nette'} ${n(data.gain_total)} DH` : ''}
            </div>
            {data.disposals.length === 0 ? (
              <p style={{ padding: '1rem', margin: 0, fontSize: '0.8125rem', color: 'var(--theme-text-muted)' }}>Aucune cession ni mise au rebut sur l'exercice.</p>
            ) : (
              <table className="odoo-table" style={{ margin: 0 }}>
                <thead><tr><th>Immobilisation</th><th style={{ width: 90 }}>Date</th><th style={{ width: 110 }}>Nature</th><th style={{ textAlign: 'right' }}>Brut</th><th style={{ textAlign: 'right' }}>Amort.</th><th style={{ textAlign: 'right' }}>VNC</th><th style={{ textAlign: 'right' }}>Prix HT</th><th style={{ textAlign: 'right' }}>+/- value</th></tr></thead>
                <tbody>
                  {data.disposals.map(d => (
                    <tr key={d.id}>
                      <td>{d.label}</td><td style={{ fontSize: '0.75rem' }}>{fmtDate(d.date)}</td><td>{d.kind === 'sale' ? 'Cession' : 'Mise au rebut'}</td>
                      <td style={{ ...mono, textAlign: 'right' }}>{n(d.cost)}</td><td style={{ ...mono, textAlign: 'right' }}>{n(d.cumulated)}</td>
                      <td style={{ ...mono, textAlign: 'right' }}>{n(d.vnc)}</td><td style={{ ...mono, textAlign: 'right' }}>{amt(d.price)}</td>
                      <td style={{ ...mono, textAlign: 'right', fontWeight: 600, color: d.gain >= 0 ? '#2e7d32' : '#c62828' }}>{n(d.gain)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </>
      )}
    </>
  );
}
