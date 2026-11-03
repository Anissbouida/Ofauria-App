import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2, Info, XCircle, CheckCircle2, ArrowRightLeft, Undo2 } from 'lucide-react';
import { consolidationApi, type Consolidation, type ConsolidationColumn } from '../../api/ledger.api';
import { storesApi } from '../../api/stores.api';
import { StatusBanner } from '../../components/ui/StatusBanner';
import { notify } from '../../components/ui/InlineNotification';
import { useConfirm } from '../../components/ui/ConfirmDialog';

/**
 * Consolidation multi-établissements (lot Bonus 17, mig 437) : bilan et CPC par
 * magasin, liaisons entre établissements (compte 1811) éliminées, total combiné
 * rapproché de la liasse de la société. Les transferts de caisse ou de stock
 * entre magasins passent par la liaison (une écriture de chaque côté).
 */

const n = (v: number) => v.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtDate = (s: string) => s.slice(0, 10).split('-').reverse().join('/');
const mono = { fontFamily: 'ui-monospace, monospace', fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' } as const;
const errMsg = (e: unknown) => (e as { response?: { data?: { error?: { message?: string } } } }).response?.data?.error?.message ?? (e instanceof Error ? e.message : 'Action impossible');

type Row = { label: string; get: (c: ConsolidationColumn) => number; strong?: boolean };
const SECTIONS: { title: string; rows: Row[] }[] = [
  { title: 'Bilan — actif (net)', rows: [
    { label: 'Immobilisations (A à E)', get: c => c.actif.T1 },
    { label: 'Stocks', get: c => c.actif.F },
    { label: 'Créances de l\'actif circulant', get: c => c.actif.G },
    { label: 'Titres, écarts de conversion', get: c => c.actif.H + c.actif.I },
    { label: 'Trésorerie — actif', get: c => c.actif.T3 },
    { label: 'Total actif', get: c => c.total_actif, strong: true },
  ] },
  { title: 'Bilan — passif', rows: [
    { label: 'Capitaux propres (dont résultat)', get: c => c.passif.K },
    { label: 'Capitaux propres assimilés, dettes de financement, provisions', get: c => c.passif.L + c.passif.M + c.passif.N + c.passif.O },
    { label: 'Dettes du passif circulant', get: c => c.passif.U2 },
    { label: 'Trésorerie — passif', get: c => c.passif.U3 },
    { label: 'Liaison avec les autres établissements (1811)', get: c => c.liaison },
    { label: 'Total passif', get: c => c.total_passif, strong: true },
  ] },
  { title: 'Compte de produits et charges', rows: [
    { label: 'Produits d\'exploitation', get: c => c.cpc.I },
    { label: 'Charges d\'exploitation', get: c => c.cpc.II },
    { label: 'Résultat d\'exploitation', get: c => c.cpc.III, strong: true },
    { label: 'Résultat financier', get: c => c.cpc.VI },
    { label: 'Résultat non courant', get: c => c.cpc.X },
    { label: 'Impôts sur les résultats', get: c => c.cpc.XII },
    { label: 'Résultat net', get: c => c.cpc.XIII, strong: true },
  ] },
];

export default function ConsolidationTab() {
  const [year, setYear] = useState(new Date().getFullYear());
  const years = Array.from({ length: 5 }, (_, i) => new Date().getFullYear() - 3 + i);
  const { data, isLoading } = useQuery({ queryKey: ['consolidation', year], queryFn: () => consolidationApi.get(year) });
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div className="odoo-search-panel" style={{ margin: 0 }}>
        <select value={year} onChange={e => setYear(Number(e.target.value))} className="odoo-search-input" aria-label="Exercice">
          {years.map(y => <option key={y} value={y}>Exercice {y}</option>)}
        </select>
      </div>
      <StatusBanner tone="info" icon={Info} title="Une société, plusieurs établissements">
        Chaque écriture porte son magasin (ou aucun : écritures communes du siège). Les flux entre magasins passent par le compte de liaison 1811, qui s'élimine dans le total combiné ; le combiné doit égaler la liasse de la société.
      </StatusBanner>
      {isLoading || !data ? <Loader2 size={18} className="animate-spin" /> : <Statements data={data} />}
      <Transfers year={year} transfers={data?.transfers ?? []} />
    </div>
  );
}

function Statements({ data }: { data: Consolidation }) {
  const errors = data.controls.filter(c => c.level === 'error');
  const cols = [...data.columns];
  return (
    <>
      {errors.length ? (
        <StatusBanner tone="danger" icon={XCircle} title={`${errors.length} anomalie(s) de consolidation`}>
          <ul style={{ margin: '4px 0 0', paddingLeft: 18 }}>{errors.map((e, i) => <li key={i}>{e.message}</li>)}</ul>
        </StatusBanner>
      ) : (
        <StatusBanner tone="success" icon={CheckCircle2} title="Consolidation cohérente">
          Liaisons soldées, chaque établissement équilibré, combiné égal à la liasse (actif {n(data.company.actif)}, résultat {n(data.company.result)}).
        </StatusBanner>
      )}
      <div style={{ overflowX: 'auto' }}>
        <table className="odoo-table" style={{ width: '100%' }}>
          <thead>
            <tr>
              <th style={{ minWidth: 260 }}>Rubrique</th>
              {cols.map(c => <th key={c.key} style={{ textAlign: 'right' }}>{c.label}</th>)}
              <th style={{ textAlign: 'right' }} title="Comptes de liaison entre établissements">Éliminations</th>
              <th style={{ textAlign: 'right' }}>Total combiné</th>
            </tr>
          </thead>
          <tbody>
            {SECTIONS.map(s => [
              <tr key={s.title}><td colSpan={cols.length + 3} style={{ background: 'var(--theme-bg-secondary)', fontWeight: 600, fontSize: '0.75rem' }}>{s.title}</td></tr>,
              ...s.rows.map(r => {
                const isLiaison = r.label.startsWith('Liaison');
                return (
                  <tr key={s.title + r.label} style={{ fontWeight: r.strong ? 700 : undefined }}>
                    <td>{r.label}</td>
                    {cols.map(c => <td key={c.key} style={{ ...mono, textAlign: 'right' }}>{n(r.get(c))}</td>)}
                    <td style={{ ...mono, textAlign: 'right', color: 'var(--theme-text-muted)' }}>{isLiaison ? n(data.eliminations.liaison) : ''}</td>
                    <td style={{ ...mono, textAlign: 'right', color: isLiaison && data.combined.liaison_residual ? '#c62828' : undefined }}>
                      {isLiaison ? n(data.combined.liaison_residual) : n(r.get(data.combined))}
                    </td>
                  </tr>
                );
              }),
            ])}
          </tbody>
        </table>
      </div>
    </>
  );
}

function Transfers({ year, transfers }: { year: number; transfers: Consolidation['transfers'] }) {
  const qc = useQueryClient();
  const confirm = useConfirm();
  const { data: stores = [] } = useQuery<{ id: string; name: string }[]>({ queryKey: ['stores'], queryFn: storesApi.list });
  const name = (id: string | null) => stores.find(s => s.id === id)?.name ?? '—';
  const [form, setForm] = useState({ date: new Date().toISOString().slice(0, 10), from: '', to: '', account: '5161', amount: '', label: '' });
  const save = useMutation({
    mutationFn: () => consolidationApi.transfer({
      date: form.date, fromStoreId: form.from, toStoreId: form.to, accountCode: form.account.trim(),
      amount: Number(form.amount.replace(/\s/g, '').replace(',', '.')), label: form.label,
    }),
    onSuccess: r => { notify.success(`Transfert comptabilisé (${r.entries.join(', ')})`); setForm(f => ({ ...f, amount: '', label: '' })); qc.invalidateQueries({ queryKey: ['consolidation'] }); },
    onError: e => notify.error(errMsg(e)),
  });
  const cancel = useMutation({
    mutationFn: (id: string) => consolidationApi.cancel(id, 'Annulation du transfert entre établissements'),
    onSuccess: () => { notify.success('Transfert annulé (écritures extournées)'); qc.invalidateQueries({ queryKey: ['consolidation'] }); },
    onError: e => notify.error(errMsg(e)),
  });
  const field = { display: 'flex', flexDirection: 'column', gap: 4, fontSize: '0.75rem', color: 'var(--theme-text-muted)' } as const;
  return (
    <div className="odoo-section" style={{ padding: 12, display: 'flex', flexDirection: 'column', gap: 10 }}>
      <strong style={{ fontSize: '0.8125rem', display: 'flex', alignItems: 'center', gap: 6 }}><ArrowRightLeft size={14} /> Transferts entre établissements</strong>
      {stores.length < 2 ? (
        <div style={{ fontSize: '0.8125rem', color: 'var(--theme-text-muted)' }}>Un seul établissement : les transferts deviennent possibles dès qu'un second magasin existe.</div>
      ) : (
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <label style={field}>Date<input type="date" value={form.date} onChange={e => setForm({ ...form, date: e.target.value })} className="odoo-search-input" /></label>
          <label style={field}>De
            <select value={form.from} onChange={e => setForm({ ...form, from: e.target.value })} className="odoo-search-input">
              <option value="">—</option>{stores.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </label>
          <label style={field}>Vers
            <select value={form.to} onChange={e => setForm({ ...form, to: e.target.value })} className="odoo-search-input">
              <option value="">—</option>{stores.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </label>
          <label style={field} title="Compte de stock (classe 3) ou de trésorerie (classe 5)">Compte
            <input value={form.account} onChange={e => setForm({ ...form, account: e.target.value })} className="odoo-search-input" style={{ width: 90 }} />
          </label>
          <label style={field}>Montant<input inputMode="decimal" value={form.amount} onChange={e => setForm({ ...form, amount: e.target.value })} className="odoo-search-input" style={{ width: 110 }} /></label>
          <label style={{ ...field, flex: 1, minWidth: 180 }}>Libellé<input value={form.label} onChange={e => setForm({ ...form, label: e.target.value })} className="odoo-search-input" maxLength={150} /></label>
          <button type="button" className="odoo-btn-primary" disabled={save.isPending || !form.from || !form.to || !form.amount} onClick={() => save.mutate()}>Comptabiliser</button>
        </div>
      )}
      {transfers.length > 0 && (
        <table className="odoo-table" style={{ width: '100%' }}>
          <thead><tr><th>Date</th><th>Libellé</th><th>De</th><th>Vers</th><th>Compte</th><th style={{ textAlign: 'right' }}>Montant</th><th>Écritures</th><th /></tr></thead>
          <tbody>
            {transfers.map(t => (
              <tr key={t.transfer_id} style={{ opacity: t.active ? 1 : 0.55 }}>
                <td style={mono}>{fmtDate(t.date)}</td>
                <td>{t.label}{!t.active && <span className="odoo-tag odoo-tag-red" style={{ marginLeft: 6 }}>Annulé</span>}</td>
                <td>{name(t.from_store_id)}</td><td>{name(t.to_store_id)}</td>
                <td style={mono}>{t.account_code}</td>
                <td style={{ ...mono, textAlign: 'right' }}>{n(t.amount)}</td>
                <td style={mono}>{t.entries}</td>
                <td>{t.active && (
                  <button type="button" className="odoo-btn-secondary" aria-label="Annuler le transfert" disabled={cancel.isPending}
                    onClick={async () => { if (await confirm('Annuler ce transfert ? Les deux écritures seront extournées.', { danger: true, confirmLabel: 'Annuler le transfert', cancelLabel: 'Garder' })) cancel.mutate(t.transfer_id); }}><Undo2 size={12} /></button>
                )}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {transfers.length === 0 && <div style={{ fontSize: '0.75rem', color: 'var(--theme-text-muted)' }}>Aucun transfert sur l'exercice {year}.</div>}
    </div>
  );
}
