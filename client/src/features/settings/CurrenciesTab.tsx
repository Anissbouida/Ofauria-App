import { currencySymbol } from '../../utils/money';
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, History, Power } from 'lucide-react';
import { PageNote } from './SettingsPrimitives';
import { currenciesApi, type Currency } from '../../api/currencies.api';
import { usePermissions } from '../../context/PermissionsContext';
import { notify } from '../../components/ui/InlineNotification';
import { StatusTag } from '../../components/ui/StatusTag';
import { apiErrorMessage } from '../../api/errors';
import { RowMenu, type RowMenuItem } from '../../components/ui/RowMenu';
import { DataPanel, FormField, FormFooter, HeaderActions, LoadingState, SectionHeader } from '../../components/ds';

/**
 * Devises et taux de change (mig 363). Le dirham reste la devise de tenue : stock, coûts
 * et comptabilité. Une devise sert à négocier un achat ; la pièce fige le taux du jour.
 * Un taux est daté : on en ajoute un nouveau, les pièces passées gardent le leur.
 */
const d = (iso: string | null) => (iso ? new Date(`${iso.slice(0, 10)}T00:00:00`).toLocaleDateString('fr-FR') : '—');

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
      {!newCur && canCreate('settings') && (
        <HeaderActions>
          <button type="button" className="odoo-btn-primary" onClick={() => setNewCur({ code: '', label: '', symbol: '' })} style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}><Plus size={13} aria-hidden="true" /> Ajouter une devise</button>
        </HeaderActions>
      )}
      {newCur && (
        <section className="ds-panel" style={{ padding: '16px 18px', display: 'grid', gap: 12 }} aria-label="Nouvelle devise">
          <div style={{ display: 'grid', gap: 12, gridTemplateColumns: '120px minmax(0, 1fr) 120px' }}>
            <FormField label="Code ISO" htmlFor="cur-code" required hint="3 lettres">
              <input id="cur-code" className="ds-input" style={{ fontFamily: 'ui-monospace, monospace' }} maxLength={3} value={newCur.code} onChange={e => setNewCur({ ...newCur, code: e.target.value.toUpperCase() })} placeholder="CHF" />
            </FormField>
            <FormField label="Libellé" htmlFor="cur-label" required>
              <input id="cur-label" className="ds-input" maxLength={60} value={newCur.label} onChange={e => setNewCur({ ...newCur, label: e.target.value })} placeholder="Franc suisse" />
            </FormField>
            <FormField label="Symbole" htmlFor="cur-symbol">
              <input id="cur-symbol" className="ds-input" maxLength={8} value={newCur.symbol} onChange={e => setNewCur({ ...newCur, symbol: e.target.value })} />
            </FormField>
          </div>
          <FormFooter onCancel={() => setNewCur(null)} submitLabel="Ajouter" busy={create.isPending}
            disabled={!/^[A-Z]{3}$/.test(newCur.code) || newCur.label.trim().length < 2} onSubmit={() => create.mutate()} />
        </section>
      )}
      {isLoading ? <LoadingState /> : (
        <DataPanel label="Devises">
          <table className="odoo-table">
            <thead><tr><th>Code</th><th>Devise</th><th className="ds-num">Taux du jour ({currencySymbol()})</th><th>Depuis le</th><th>Source</th><th>Statut</th><th className="ds-actions"><span className="sr-only">Actions</span></th></tr></thead>
            <tbody>{currencies.map(c => {
              const canRate = canCreate('settings') && c.is_active;
              const items: RowMenuItem[] = [
                ...(canRate ? [{ label: historyFor === c.code ? "Masquer l'historique" : 'Historique', icon: History, onSelect: () => setHistoryFor(historyFor === c.code ? null : c.code) }] : []),
                ...(canEdit('settings') ? [{ label: c.is_active ? 'Désactiver' : 'Activer', icon: Power, onSelect: () => toggle.mutate(c), disabled: toggle.isPending }] : []),
              ];
              return (
                <tr key={c.code} style={{ opacity: c.is_active ? 1 : 0.55 }}>
                  <td className="ds-ref">{c.code}</td>
                  <td className="ds-strong">{c.label}{c.symbol ? ` (${c.symbol})` : ''}{c.is_base && <span className="odoo-tag odoo-tag-blue" style={{ marginLeft: 6 }}>devise de base</span>}</td>
                  <td className="ds-num">
                    {c.is_base ? '1' : c.rate ? <>1 {c.code} = <strong>{Number(c.rate).toLocaleString('fr-FR', { maximumFractionDigits: 6 })}</strong></> : <span style={{ color: 'var(--ds-warning)' }}>aucun taux</span>}
                  </td>
                  <td>{c.is_base ? '—' : d(c.rate_date)}</td>
                  <td style={{ color: 'var(--ds-muted)', fontSize: '0.8125rem' }}>{c.rate_source ?? ''}</td>
                  <td>{c.is_active ? <StatusTag tone="done" label="Active" /> : <StatusTag tone="cancelled" label="Inactive" />}</td>
                  <td className="ds-actions" style={{ whiteSpace: 'nowrap' }}>
                    {!c.is_base && (
                      <span style={{ display: 'inline-flex', gap: 4, alignItems: 'center' }}>
                        {canRate
                          ? <button type="button" className="odoo-btn-secondary ds-btn-sm" onClick={() => setRateFor({ code: c.code, rate: c.rate ? String(Number(c.rate)) : '', validOn: today, source: '' })}>Nouveau taux</button>
                          : <button type="button" className="odoo-btn-secondary ds-btn-sm" onClick={() => setHistoryFor(historyFor === c.code ? null : c.code)}>Historique</button>}
                        {items.length > 0 && <RowMenu label={`Actions sur ${c.code}`} items={items} />}
                      </span>
                    )}
                  </td>
                </tr>
              );
            })}</tbody>
          </table>
        </DataPanel>
      )}
      {rateFor && (
        <section className="ds-panel" style={{ padding: '16px 18px', display: 'grid', gap: 12 }} aria-labelledby="cur-rate-title">
          <SectionHeader title={<span id="cur-rate-title">Nouveau taux pour {rateFor.code}</span>} />
          <div style={{ display: 'grid', gap: 12, gridTemplateColumns: '200px 170px minmax(0, 1fr)' }}>
            <FormField label={`1 ${rateFor.code} = … ${currencySymbol()}`} htmlFor="cur-rate" required>
              <input id="cur-rate" type="number" min={0} step="0.000001" className="ds-input" value={rateFor.rate} onChange={e => setRateFor({ ...rateFor, rate: e.target.value })} autoFocus />
            </FormField>
            <FormField label="À partir du" htmlFor="cur-valid-on" required>
              <input id="cur-valid-on" type="date" className="ds-input" value={rateFor.validOn} onChange={e => setRateFor({ ...rateFor, validOn: e.target.value })} />
            </FormField>
            <FormField label="Source" htmlFor="cur-source">
              <input id="cur-source" className="ds-input" maxLength={80} value={rateFor.source} onChange={e => setRateFor({ ...rateFor, source: e.target.value })} placeholder="Bank Al-Maghrib, banque, facture…" />
            </FormField>
          </div>
          <FormFooter onCancel={() => setRateFor(null)} submitLabel="Enregistrer le taux" busy={addRate.isPending}
            disabled={!(Number(rateFor.rate) > 0) || !rateFor.validOn} onSubmit={() => addRate.mutate()} />
        </section>
      )}
      <Revaluation />
      {historyFor && (
        <div>
          <SectionHeader title={`Historique des taux ${historyFor}`} />
          {history.length === 0 ? <p style={{ fontSize: '0.8125rem', color: 'var(--ds-muted)' }}>Aucun taux saisi.</p> : (
            <DataPanel>
            <table className="odoo-table">
              <thead><tr><th>Date</th><th className="ds-num">1 {historyFor} = ({currencySymbol()})</th><th>Source</th><th>Saisi par</th></tr></thead>
              <tbody>{history.map(h => (
                <tr key={h.id}><td>{d(h.valid_on)}</td><td className="ds-num">{Number(h.rate).toLocaleString('fr-FR', { maximumFractionDigits: 6 })}</td><td style={{ color: 'var(--ds-muted)' }}>{h.source ?? ''}</td><td style={{ color: 'var(--ds-muted)' }}>{h.created_by_name ?? ''}</td></tr>
              ))}</tbody>
            </table>
            </DataPanel>
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
      <SectionHeader title="Écarts de change latents sur factures fournisseurs ouvertes">
        <label htmlFor="cur-reval-date" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: '0.8125rem', color: 'var(--ds-muted)' }}>au
          <input id="cur-reval-date" type="date" className="ds-input sm" style={{ width: 160 }} value={date} onChange={e => setDate(e.target.value)} /></label>
      </SectionHeader>
      <p style={{ fontSize: '0.8125rem', color: 'var(--ds-muted)', margin: 0 }}>
        Reste dû en devise revalorisé au taux de la date. Pour information : l'écart n'est comptabilisé qu'au règlement (6331 / 7331).
        {data.missingRates.length > 0 && <span style={{ color: 'var(--ds-warning)' }}> Taux manquant : {data.missingRates.join(', ')}.</span>}
      </p>
      {data.rows.length === 0 ? <p style={{ fontSize: '0.8125rem', color: 'var(--ds-muted)', margin: 0 }}>Aucune facture en devise à régler.</p> : (
        <DataPanel>
          <table className="odoo-table">
            <thead><tr><th>Facture</th><th>Fournisseur</th><th className="ds-num">Reste dû</th><th className="ds-num">Taux facture</th><th className="ds-num">Taux au {d(data.date)}</th><th className="ds-num">Écart latent ({currencySymbol()})</th></tr></thead>
            <tbody>{data.rows.map(r => (
              <tr key={r.id}>
                <td className="ds-ref">{r.supplier_invoice_number || r.invoice_number}<div style={{ fontSize: 12, color: 'var(--ds-muted)' }}>{d(r.invoice_date)}</div></td>
                <td>{r.supplier_name ?? '—'}</td>
                <td className="ds-num">{n2(r.foreign_remaining)} {String(r.currency_code).trim()}</td>
                <td className="ds-num">{Number(r.exchange_rate).toLocaleString('fr-FR', { maximumFractionDigits: 6 })}</td>
                <td className="ds-num">{r.current_rate != null ? Number(r.current_rate).toLocaleString('fr-FR', { maximumFractionDigits: 6 }) : '—'}</td>
                <td className="ds-num" style={{ fontWeight: 600, color: (r.latent ?? 0) > 0 ? 'var(--ds-danger)' : (r.latent ?? 0) < 0 ? 'var(--ds-success)' : undefined }}>
                  {r.latent == null ? '—' : `${r.latent > 0 ? 'perte ' : r.latent < 0 ? 'gain ' : ''}${n2(Math.abs(r.latent))}`}</td>
              </tr>
            ))}</tbody>
            <tfoot><tr><td colSpan={5} style={{ textAlign: 'right' }}>Pertes latentes / gains latents</td>
              <td className="ds-num" style={{ fontWeight: 700 }}><span style={{ color: 'var(--ds-danger)' }}>{n2(data.latentLoss)}</span> / <span style={{ color: 'var(--ds-success)' }}>{n2(data.latentGain)}</span></td></tr></tfoot>
          </table>
        </DataPanel>
      )}
    </section>
  );
}
