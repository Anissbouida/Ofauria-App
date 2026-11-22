import { money, currencySymbol } from '../../utils/money';
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, Loader2 } from 'lucide-react';
import { PageNote } from './SettingsPrimitives';
import { currenciesApi, type Currency } from '../../api/currencies.api';
import { usePermissions } from '../../context/PermissionsContext';
import { notify } from '../../components/ui/InlineNotification';
import { StatusTag } from '../../components/ui/StatusTag';
import { apiErrorMessage } from '../../api/errors';

/**
 * Devises et taux de change (mig 363). Le dirham reste la devise de tenue : stock, coûts
 * et comptabilité. Une devise sert à négocier un achat ; la pièce fige le taux du jour.
 * Un taux est daté : on en ajoute un nouveau, les pièces passées gardent le leur.
 */
const d = (iso: string | null) => (iso ? new Date(`${iso.slice(0, 10)}T00:00:00`).toLocaleDateString('fr-FR') : '—');
const field: React.CSSProperties = { fontSize: 14, padding: '0 10px', minHeight: 36, border: '1px solid var(--ds-line)', borderRadius: 8, background: 'var(--ds-card)', color: 'var(--ds-ink)' };
const lab: React.CSSProperties = { display: 'grid', gap: 4, fontSize: '0.8125rem', color: 'var(--ds-muted)' };

export default function CurrenciesTab() {
  const qc = useQueryClient();
  const { canCreate, canEdit } = usePermissions();
  const today = new Date().toISOString().slice(0, 10);
  const { data: currencies = [], isLoading } = useQuery({ queryKey: ['currencies', 'all'], queryFn: () => currenciesApi.list({ all: true }) });
  const [rateFor, setRateFor] = useState<null | { code: string; rate: string; validOn: string; source: string }>(null);
  const [historyFor, setHistoryFor] = useState<string | null>(null);
  const [newCur, setNewCur] = useState<null | { code: string; label: string; symbol: string }>(null);
  const { data: history = [] } = useQuery({ queryKey: ['currency-rates', historyFor], queryFn: () => currenciesApi.rates(historyFor!), enabled: !!historyFor });
  const refresh = () => { qc.invalidateQueries({ queryKey: ['currencies'] }); qc.invalidateQueries({ queryKey: ['currency-rates'] }); };

  const addRate = useMutation({
    mutationFn: () => currenciesApi.addRate(rateFor!.code, { rate: Number(rateFor!.rate), validOn: rateFor!.validOn, source: rateFor!.source || null }),
    onSuccess: () => { refresh(); notify.success('Taux enregistré'); setRateFor(null); },
    onError: e => notify.error(apiErrorMessage(e)),
  });
  const create = useMutation({
    mutationFn: () => currenciesApi.create({ code: newCur!.code, label: newCur!.label, symbol: newCur!.symbol || null }),
    onSuccess: () => { refresh(); notify.success('Devise ajoutée'); setNewCur(null); },
    onError: e => notify.error(apiErrorMessage(e)),
  });
  const toggle = useMutation({
    mutationFn: (c: Currency) => currenciesApi.setActive(c.code, !c.is_active),
    onSuccess: refresh, onError: e => notify.error(apiErrorMessage(e)),
  });

  return (
    <div className="odoo-scope" style={{ display: 'grid', gap: 12 }}>
      <PageNote help={`Stock, coût matière et comptabilité restent en ${currencySymbol()}. Un bon de commande ou un devis fournisseur saisi dans une autre devise fige le taux du jour, et chaque ligne garde son prix d'origine. Un taux est daté : les pièces passées gardent le leur.`}>
        Taux = nombre de {currencySymbol()} pour 1 unité de la devise. La tenue reste en {currencySymbol()}.
      </PageNote>
      <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
        {!newCur && canCreate('settings') && (
          <button type="button" className="odoo-btn-secondary" onClick={() => setNewCur({ code: '', label: '', symbol: '' })} style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}><Plus size={13} /> Ajouter une devise</button>
        )}
      </div>
      {newCur && (
        <div className="prj-panel" style={{ padding: '16px 18px', display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <label style={{ ...lab, width: 100 }}>Code ISO<input style={{ ...field, fontFamily: 'ui-monospace, monospace' }} maxLength={3} value={newCur.code} onChange={e => setNewCur({ ...newCur, code: e.target.value.toUpperCase() })} placeholder="CHF" /></label>
          <label style={{ ...lab, flex: '1 1 200px' }}>Libellé<input style={field} maxLength={60} value={newCur.label} onChange={e => setNewCur({ ...newCur, label: e.target.value })} placeholder="Franc suisse" /></label>
          <label style={{ ...lab, width: 90 }}>Symbole<input style={field} maxLength={8} value={newCur.symbol} onChange={e => setNewCur({ ...newCur, symbol: e.target.value })} /></label>
          <button type="button" className="odoo-btn-secondary" onClick={() => setNewCur(null)}>Annuler</button>
          <button type="button" className="odoo-btn-primary" disabled={!/^[A-Z]{3}$/.test(newCur.code) || newCur.label.trim().length < 2 || create.isPending} onClick={() => create.mutate()}>Ajouter</button>
        </div>
      )}
      {isLoading ? <Loader2 className="animate-spin" size={16} /> : (
        <div className="prj-panel prj-scroll">
          <table className="odoo-table">
            <thead><tr><th>Code</th><th>Devise</th><th className="ds-num">Taux du jour</th><th>Depuis le</th><th>Source</th><th>Statut</th><th className="ds-actions"><span className="sr-only">Actions</span></th></tr></thead>
            <tbody>{currencies.map(c => (
              <tr key={c.code} style={{ opacity: c.is_active ? 1 : 0.55 }}>
                <td style={{ fontFamily: 'ui-monospace, monospace' }}>{c.code}</td>
                <td>{c.label}{c.symbol ? ` (${c.symbol})` : ''}{c.is_base && <span className="odoo-tag odoo-tag-blue" style={{ marginLeft: 6 }}>devise de base</span>}</td>
                <td className="ds-num" style={{ fontVariantNumeric: 'tabular-nums' }}>
                  {c.is_base ? '1' : c.rate ? <>1 {c.code} = <strong>{Number(c.rate).toLocaleString('fr-FR', { maximumFractionDigits: 6 })}</strong> {currencySymbol()}</> : <span style={{ color: 'var(--ds-warning)' }}>aucun taux</span>}
                </td>
                <td>{c.is_base ? '—' : d(c.rate_date)}</td>
                <td style={{ color: 'var(--ds-muted)', fontSize: '0.8125rem' }}>{c.rate_source ?? ''}</td>
                <td>{c.is_active ? <StatusTag tone="done" label="Active" /> : <StatusTag tone="cancelled" label="Inactive" />}</td>
                <td style={{ whiteSpace: 'nowrap', textAlign: 'right' }}>
                  {!c.is_base && <>
                    {canCreate('settings') && c.is_active && <button type="button" className="odoo-btn-primary" style={{ padding: '2px 8px' }} onClick={() => setRateFor({ code: c.code, rate: c.rate ? String(Number(c.rate)) : '', validOn: today, source: '' })}>Nouveau taux</button>}{' '}
                    <button type="button" className="odoo-btn-secondary" style={{ padding: '2px 8px' }} onClick={() => setHistoryFor(historyFor === c.code ? null : c.code)}>Historique</button>{' '}
                    {canEdit('settings') && <button type="button" className="odoo-btn-secondary" style={{ padding: '2px 8px' }} onClick={() => toggle.mutate(c)}>{c.is_active ? 'Désactiver' : 'Activer'}</button>}
                  </>}
                </td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      )}
      {rateFor && (
        <div className="prj-panel" style={{ padding: '16px 18px', display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <div style={{ fontWeight: 600, width: '100%' }}>Nouveau taux pour {rateFor.code}</div>
          <label style={{ ...lab, width: 200 }}>1 {rateFor.code} = … {currencySymbol()}<input type="number" min={0} step="0.000001" style={field} value={rateFor.rate} onChange={e => setRateFor({ ...rateFor, rate: e.target.value })} autoFocus /></label>
          <label style={{ ...lab, width: 170 }}>À partir du<input type="date" style={field} value={rateFor.validOn} onChange={e => setRateFor({ ...rateFor, validOn: e.target.value })} /></label>
          <label style={{ ...lab, flex: '1 1 220px' }}>Source<input style={field} maxLength={80} value={rateFor.source} onChange={e => setRateFor({ ...rateFor, source: e.target.value })} placeholder="Bank Al-Maghrib, banque, facture…" /></label>
          <button type="button" className="odoo-btn-secondary" onClick={() => setRateFor(null)}>Annuler</button>
          <button type="button" className="odoo-btn-primary" disabled={!(Number(rateFor.rate) > 0) || !rateFor.validOn || addRate.isPending} onClick={() => addRate.mutate()}>Enregistrer le taux</button>
        </div>
      )}
      <Revaluation />
      {historyFor && (
        <div>
          <div style={{ fontWeight: 600, fontSize: '0.875rem', margin: '4px 0 8px' }}>Historique des taux {historyFor}</div>
          {history.length === 0 ? <p style={{ fontSize: '0.8125rem', color: 'var(--ds-muted)' }}>Aucun taux saisi.</p> : (
            <table className="odoo-table">
              <thead><tr><th>Date</th><th className="ds-num">1 {historyFor} =</th><th>Source</th><th>Saisi par</th></tr></thead>
              <tbody>{history.map(h => (
                <tr key={h.id}><td>{d(h.valid_on)}</td><td className="ds-num">{Number(h.rate).toLocaleString('fr-FR', { maximumFractionDigits: 6 })} {currencySymbol()}</td><td style={{ color: 'var(--ds-muted)' }}>{h.source ?? ''}</td><td style={{ color: 'var(--ds-muted)' }}>{h.created_by_name ?? ''}</td></tr>
              ))}</tbody>
            </table>
          )}
        </div>
      )}
    </div>
  );
}

/** Écarts latents (mig 368) : dettes en devise réévaluées au taux d'une date, sans écriture. */
function Revaluation() {
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const { data } = useQuery({ queryKey: ['currency-revaluation', date], queryFn: () => currenciesApi.revaluation(date) });
  const n2 = (v: number | string | null | undefined) => Number(v ?? 0).toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  if (!data) return null;
  return (
    <section style={{ display: 'grid', gap: 8 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <div style={{ fontWeight: 600, fontSize: '0.875rem', flex: 1 }}>Écarts de change latents sur factures fournisseurs ouvertes</div>
        <label style={{ ...lab, display: 'flex', alignItems: 'center', gap: 6 }}>au <input type="date" style={{ ...field, width: 160 }} value={date} onChange={e => setDate(e.target.value)} /></label>
      </div>
      <p style={{ fontSize: '0.8125rem', color: 'var(--ds-muted)', margin: 0 }}>
        Reste dû en devise revalorisé au taux de la date. Pour information : l'écart n'est comptabilisé qu'au règlement (6331 / 7331).
        {data.missingRates.length > 0 && <span style={{ color: 'var(--ds-warning)' }}> Taux manquant : {data.missingRates.join(', ')}.</span>}
      </p>
      {data.rows.length === 0 ? <p style={{ fontSize: '0.8125rem', color: 'var(--ds-muted)', margin: 0 }}>Aucune facture en devise à régler.</p> : (
        <div className="prj-panel prj-scroll">
          <table className="odoo-table">
            <thead><tr><th>Facture</th><th>Fournisseur</th><th className="ds-num">Reste dû</th><th className="ds-num">Taux facture</th><th className="ds-num">Taux au {d(data.date)}</th><th className="ds-num">Écart latent</th></tr></thead>
            <tbody>{data.rows.map(r => (
              <tr key={r.id}>
                <td>{r.supplier_invoice_number || r.invoice_number}<div style={{ fontSize: 12, color: 'var(--ds-muted)' }}>{d(r.invoice_date)}</div></td>
                <td>{r.supplier_name ?? '—'}</td>
                <td className="ds-num">{n2(r.foreign_remaining)} {String(r.currency_code).trim()}</td>
                <td className="ds-num">{Number(r.exchange_rate).toLocaleString('fr-FR', { maximumFractionDigits: 6 })}</td>
                <td className="ds-num">{r.current_rate != null ? Number(r.current_rate).toLocaleString('fr-FR', { maximumFractionDigits: 6 }) : '—'}</td>
                <td className="ds-num" style={{ fontWeight: 600, color: (r.latent ?? 0) > 0 ? 'var(--ds-danger)' : (r.latent ?? 0) < 0 ? 'var(--ds-success)' : undefined }}>
                  {r.latent == null ? '—' : `${r.latent > 0 ? 'perte ' : r.latent < 0 ? 'gain ' : ''}${money(Math.abs(r.latent))}`}</td>
              </tr>
            ))}</tbody>
            <tfoot><tr><td colSpan={5} style={{ textAlign: 'right' }}>Pertes latentes / gains latents</td>
              <td className="ds-num" style={{ fontWeight: 700 }}><span style={{ color: 'var(--ds-danger)' }}>{n2(data.latentLoss)}</span> / <span style={{ color: 'var(--ds-success)' }}>{n2(data.latentGain)}</span> {currencySymbol()}</td></tr></tfoot>
          </table>
        </div>
      )}
    </section>
  );
}
