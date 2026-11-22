import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Loader2, CheckCircle2, AlertTriangle, Info, XCircle } from 'lucide-react';
import { StatusBanner } from '../../components/ui/StatusBanner';
import { liasseApi } from '../../api/ledger.api';
import type { Liasse, LiasseModel, LiasseTable, LiasseKind } from '../../api/ledger.api';
import EditionButtons from './EditionButtons';
import LiasseEdiPanel from './LiasseEdiPanel';
import { DataPanel, KpiCard, KpiGrid, LoadingState, Tabs } from '../../components/ds';
import { AccHeaderActions } from './AccHeaderActions';

/**
 * Liasse fiscale (lot Bonus 14) : tableaux du modèle comptable CGNC (bilan
 * actif et passif, CPC, état des soldes de gestion) et passage au résultat
 * fiscal, exercice N et N−1, avec les contrôles de cohérence et les fichiers
 * EDI à déposer sur le portail de la DGI.
 */

const n = (v: number) => (Math.abs(v) < 0.005 ? '' : v.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
const mono = { fontFamily: 'ui-monospace, monospace', fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' } as const;
const num: React.CSSProperties = { textAlign: 'right', width: 130, whiteSpace: 'nowrap' };

type View = LiasseTable | 'edi';
const VIEWS: { key: View; label: string }[] = [
  { key: 'actif', label: 'Bilan actif' },
  { key: 'passif', label: 'Bilan passif' },
  { key: 'cpc', label: 'CPC' },
  { key: 'esg', label: 'Soldes de gestion' },
  { key: 'passage', label: 'Résultat fiscal' },
  { key: 'edi', label: 'Télédéclaration (EDI)' },
];

export default function LiasseTab() {
  const [year, setYear] = useState(new Date().getFullYear() - 1);
  const [model, setModel] = useState<LiasseModel>('normal');
  const [view, setView] = useState<View>('actif');
  const { data: l, isLoading, isFetching } = useQuery({ queryKey: ['liasse', year, model], queryFn: () => liasseApi.get(year, model) });
  const errors = l?.controls.filter(c => c.level === 'error') ?? [];
  const warnings = l?.controls.filter(c => c.level === 'warning') ?? [];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <AccHeaderActions>
        {view !== 'edi' && <EditionButtons kind="liasse" params={{ endDate: `${year}-12-31`, table: view, model }} disabled={!l} />}
      </AccHeaderActions>

      {l && (
        <>
        {l.status === 'final'
          ? <StatusBanner tone="success" icon={CheckCircle2} title={`Exercice ${year} clôturé`}>
              Les écritures sont scellées : la liasse est définitive.
            </StatusBanner>
          : <StatusBanner tone="info" icon={Info} title={`Liasse provisoire de l'exercice ${year}`}>
              Calculée depuis les écritures validées au 31/12/{year}. Elle devient définitive à la clôture de l'exercice (Comptabilité › Clôture).
            </StatusBanner>}
        {errors.length > 0 && (
          <StatusBanner tone="danger" icon={XCircle} title={`${errors.length} contrôle(s) bloquant(s)`}>
            <ul style={{ margin: '4px 0 0', paddingLeft: 18 }}>{errors.map((c, i) => <li key={i}>{c.message}</li>)}</ul>
          </StatusBanner>
        )}
        {warnings.filter(w => !w.message.startsWith('Exercice')).length > 0 && (
          <StatusBanner tone="warning" icon={AlertTriangle} title="Points à vérifier">
            <ul style={{ margin: '4px 0 0', paddingLeft: 18 }}>{warnings.filter(w => !w.message.startsWith('Exercice')).map((c, i) => <li key={i}>{c.message}</li>)}</ul>
          </StatusBanner>
        )}
        <KpiGrid>
          <Stat label="Total du bilan" value={l.totals.actif} sub={Math.abs(l.totals.actif - l.totals.passif) < 0.01 ? 'actif = passif' : `passif ${n(l.totals.passif)}`} />
          <Stat label="Chiffre d'affaires" value={l.totals.revenue} sub={l.suggested_model === 'simplifie' ? 'modèle simplifié possible (≤ 10 MDH)' : 'modèle normal'} />
          <Stat label="Résultat net" value={l.totals.result} sub={l.has_previous ? `${year - 1} : ${n(l.totals.previous_result) || '0,00'}` : 'pas d\'exercice précédent'} tone={l.totals.result < 0 ? 'neg' : undefined} />
          <Stat label="Résultat fiscal" value={l.passage.taxable_result} sub={`impôt dû ${n(l.passage.tax_due) || '0,00'}${l.passage.tax_status === 'booked' ? ' (comptabilisé)' : ''}`} tone={l.passage.taxable_result < 0 ? 'neg' : undefined} />
        </KpiGrid>
        </>
      )}

      <div className="prj-toolbar">
        <select value={year} onChange={e => setYear(Number(e.target.value))} className="ds-input sm" style={{ minWidth: 110, width: 'auto' }} aria-label="Exercice">
          {Array.from({ length: 6 }, (_, i) => new Date().getFullYear() - i).map(y => <option key={y} value={y}>Exercice {y}</option>)}
        </select>
        <select value={model} onChange={e => setModel(e.target.value as LiasseModel)} className="ds-input sm" style={{ minWidth: 170, width: 'auto' }} aria-label="Modèle">
          <option value="normal">Modèle normal</option>
          <option value="simplifie">Modèle simplifié</option>
        </select>
        {isFetching && !isLoading && <Loader2 size={14} className="animate-spin" aria-label="Actualisation" />}
      </div>
      {isLoading || !l ? <LoadingState /> : (
        <>
          <Tabs label="États de la liasse" value={view} onChange={setView} tabs={VIEWS.map(v => ({ key: v.key, label: v.label }))} />
          {view === 'actif' && <ActifTable l={l} />}
          {view === 'passif' && <AmountTable title="Passif" year={year} lines={l.passif} />}
          {view === 'cpc' && <AmountTable title="Compte de produits et charges (hors taxes)" year={year} lines={l.cpc} />}
          {view === 'esg' && (
            <>
              <AmountTable title="I. Tableau de formation des résultats (TFR)" year={year} lines={l.tfr} />
              <AmountTable title="II. Capacité d'autofinancement (CAF) — autofinancement" year={year} lines={l.caf} />
            </>
          )}
          {view === 'passage' && <Passage l={l} />}
          {view === 'edi' && <LiasseEdiPanel year={year} model={model} liasse={l} />}
        </>
      )}
    </div>
  );
}

function Stat({ label, value, sub, tone }: { label: string; value: number; sub: string; tone?: 'neg' }) {
  return (
    <KpiCard label={label} value={n(value) || '0,00'} sub={sub} tone={tone === 'neg' ? 'red' : undefined} />
  );
}

const rowStyle = (k: LiasseKind): React.CSSProperties =>
  k === 'total' ? { fontWeight: 700, background: 'var(--theme-bg-secondary)' }
    : k === 'subtotal' ? { fontWeight: 600, background: 'var(--theme-bg-secondary)' }
    : k === 'group' ? { fontWeight: 600 } : {};

function Accounts({ codes }: { codes: string[] }) {
  if (!codes.length) return null;
  return <span style={{ marginLeft: 6, fontSize: '0.6875rem', color: 'var(--theme-text-muted)', ...mono }}>{codes.join(' · ')}</span>;
}

function ActifTable({ l }: { l: Liasse }) {
  return (
    <DataPanel>
      <table className="odoo-table ds-dense">
        <thead>
          <tr>
            <th style={{ minWidth: 300 }}>Actif</th><th style={num}>Brut</th><th style={num}>Amort. et provisions</th>
            <th style={num}>Net {l.year}</th><th style={num}>Net {l.year - 1}</th>
          </tr>
        </thead>
        <tbody>
          {l.actif.map(x => (
            <tr key={x.id} style={rowStyle(x.kind)}>
              <td style={{ paddingLeft: x.kind === 'line' && l.model === 'normal' && /\d/.test(x.id) ? 22 : undefined }}>{x.label}<Accounts codes={x.accounts} /></td>
              <td className="ds-num">{n(x.gross)}</td>
              <td className="ds-num">{n(x.amort)}</td>
              <td className="ds-num">{n(x.net)}</td>
              <td className="ds-num" style={{ color: 'var(--theme-text-muted)' }}>{n(x.previous_net)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </DataPanel>
  );
}

function AmountTable({ title, year, lines }: { title: string; year: number; lines: Liasse['cpc'] }) {
  return (
    <DataPanel>
      <table className="odoo-table ds-dense">
        <thead>
          <tr><th>{title}</th><th className="ds-num" style={{ width: 160 }}>Exercice {year}</th><th className="ds-num" style={{ width: 160 }}>Exercice {year - 1}</th></tr>
        </thead>
        <tbody>
          {lines.map(x => (
            <tr key={x.id} style={rowStyle(x.kind)}>
              <td style={{ paddingLeft: x.kind === 'line' ? 22 : undefined }}>{x.label}<Accounts codes={x.accounts} /></td>
              <td className="ds-num" style={{ color: x.amount < 0 ? 'var(--ds-danger)' : undefined }}>{n(x.amount)}</td>
              <td className="ds-num" style={{ color: 'var(--theme-text-muted)' }}>{n(x.previous)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </DataPanel>
  );
}

function Passage({ l }: { l: Liasse }) {
  const p = l.passage;
  const sum = (xs: { amount: number }[]) => xs.reduce((s, x) => s + x.amount, 0);
  const row = (label: string, v: number | null, k: LiasseKind = 'line') => (
    <tr key={label} style={rowStyle(k)}>
      <td style={{ paddingLeft: k === 'line' ? 22 : undefined }}>{label}</td>
      <td className="ds-num" style={{ width: 180, color: v != null && v < 0 ? 'var(--ds-danger)' : undefined }}>{v == null ? '' : n(v) || '0,00'}</td>
    </tr>
  );
  return (
    <div className="odoo-section ds-panel" style={{ padding: 0 }}>
      <table className="odoo-table ds-dense">
        <thead><tr><th>Passage du résultat net comptable au résultat net fiscal</th><th className="ds-num">Montant</th></tr></thead>
        <tbody>
          {row(p.net_result >= 0 ? 'I. Résultat net comptable — bénéfice' : 'I. Résultat net comptable — perte', p.net_result, 'subtotal')}
          {row('II. Réintégrations fiscales', null, 'group')}
          {p.reintegrations.length ? p.reintegrations.map(x => row(x.label, x.amount)) : row('Aucune réintégration', null)}
          {row('Total des réintégrations', sum(p.reintegrations), 'subtotal')}
          {row('III. Déductions fiscales', null, 'group')}
          {p.deductions.length ? p.deductions.map(x => row(x.label, x.amount)) : row('Aucune déduction', null)}
          {row('Total des déductions', sum(p.deductions), 'subtotal')}
          {row(p.taxable_result >= 0 ? 'Résultat net fiscal — bénéfice (I + II − III)' : 'Résultat net fiscal — déficit (I + II − III)', p.taxable_result, 'total')}
          {row(`IS au taux de ${p.rate} %`, p.is_amount)}
          {row('Cotisation minimale', p.cm_amount)}
          {row('Impôt dû', p.tax_due, 'total')}
        </tbody>
      </table>
      <div style={{ padding: '8px 14px', fontSize: '0.75rem', color: 'var(--theme-text-muted)' }}>
        Les réintégrations et déductions se saisissent dans Comptabilité › Impôt sur les sociétés ; l'IS comptabilisé (6701) est réintégré d'office.
      </div>
    </div>
  );
}
