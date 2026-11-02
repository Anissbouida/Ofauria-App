import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Loader2, CheckCircle2, AlertTriangle, Info, XCircle } from 'lucide-react';
import { StatusBanner } from '../../components/ui/StatusBanner';
import { liasseApi } from '../../api/ledger.api';
import type { Liasse, LiasseModel, LiasseTable, LiasseKind } from '../../api/ledger.api';
import EditionButtons from './EditionButtons';
import LiasseEdiPanel from './LiasseEdiPanel';

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
      <div className="odoo-search-panel" style={{ flexWrap: 'wrap', gap: 6 }}>
        <select value={year} onChange={e => setYear(Number(e.target.value))} className="odoo-search-input" style={{ minWidth: 110 }} aria-label="Exercice">
          {Array.from({ length: 6 }, (_, i) => new Date().getFullYear() - i).map(y => <option key={y} value={y}>Exercice {y}</option>)}
        </select>
        <select value={model} onChange={e => setModel(e.target.value as LiasseModel)} className="odoo-search-input" style={{ minWidth: 170 }} aria-label="Modèle">
          <option value="normal">Modèle normal</option>
          <option value="simplifie">Modèle simplifié</option>
        </select>
        {isFetching && !isLoading && <Loader2 size={14} className="animate-spin" />}
        <div style={{ flex: 1 }} />
        {view !== 'edi' && <EditionButtons kind="liasse" params={{ endDate: `${year}-12-31`, table: view, model }} disabled={!l} />}
      </div>
      {isLoading || !l ? <div style={{ display: 'flex', justifyContent: 'center', padding: '3rem' }}><Loader2 size={20} className="animate-spin" /></div> : (
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
          <div className="odoo-stat-grid">
            <Stat label="Total du bilan" value={l.totals.actif} sub={Math.abs(l.totals.actif - l.totals.passif) < 0.01 ? 'actif = passif' : `passif ${n(l.totals.passif)}`} />
            <Stat label="Chiffre d'affaires" value={l.totals.revenue} sub={l.suggested_model === 'simplifie' ? 'modèle simplifié possible (≤ 10 MDH)' : 'modèle normal'} />
            <Stat label="Résultat net" value={l.totals.result} sub={l.has_previous ? `${year - 1} : ${n(l.totals.previous_result) || '0,00'}` : 'pas d\'exercice précédent'} tone={l.totals.result < 0 ? 'neg' : undefined} />
            <Stat label="Résultat fiscal" value={l.passage.taxable_result} sub={`impôt dû ${n(l.passage.tax_due) || '0,00'}${l.passage.tax_status === 'booked' ? ' (comptabilisé)' : ''}`} tone={l.passage.taxable_result < 0 ? 'neg' : undefined} />
          </div>
          <div className="odoo-tabs">
            {VIEWS.map(v => (
              <button key={v.key} type="button" onClick={() => setView(v.key)} className={`odoo-tab ${view === v.key ? 'active' : ''}`}>{v.label}</button>
            ))}
          </div>
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
    <div className="odoo-stat-card">
      <div className="odoo-stat-card-label">{label}</div>
      <div className="odoo-stat-card-value" style={{ color: tone === 'neg' ? '#c62828' : undefined }}>{n(value) || '0,00'}</div>
      <div className="odoo-stat-card-sub">{sub}</div>
    </div>
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
    <div className="odoo-section" style={{ padding: 0, overflowX: 'auto' }}>
      <table className="odoo-table" style={{ width: '100%' }}>
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
              <td style={{ ...mono, textAlign: 'right' }}>{n(x.gross)}</td>
              <td style={{ ...mono, textAlign: 'right' }}>{n(x.amort)}</td>
              <td style={{ ...mono, textAlign: 'right' }}>{n(x.net)}</td>
              <td style={{ ...mono, textAlign: 'right', color: 'var(--theme-text-muted)' }}>{n(x.previous_net)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function AmountTable({ title, year, lines }: { title: string; year: number; lines: Liasse['cpc'] }) {
  return (
    <div className="odoo-section" style={{ padding: 0, overflowX: 'auto' }}>
      <table className="odoo-table" style={{ width: '100%' }}>
        <thead>
          <tr><th>{title}</th><th style={{ textAlign: 'right', width: 160 }}>Exercice {year}</th><th style={{ textAlign: 'right', width: 160 }}>Exercice {year - 1}</th></tr>
        </thead>
        <tbody>
          {lines.map(x => (
            <tr key={x.id} style={rowStyle(x.kind)}>
              <td style={{ paddingLeft: x.kind === 'line' ? 22 : undefined }}>{x.label}<Accounts codes={x.accounts} /></td>
              <td style={{ ...mono, textAlign: 'right', color: x.amount < 0 ? '#c62828' : undefined }}>{n(x.amount)}</td>
              <td style={{ ...mono, textAlign: 'right', color: 'var(--theme-text-muted)' }}>{n(x.previous)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Passage({ l }: { l: Liasse }) {
  const p = l.passage;
  const sum = (xs: { amount: number }[]) => xs.reduce((s, x) => s + x.amount, 0);
  const row = (label: string, v: number | null, k: LiasseKind = 'line') => (
    <tr key={label} style={rowStyle(k)}>
      <td style={{ paddingLeft: k === 'line' ? 22 : undefined }}>{label}</td>
      <td style={{ ...mono, textAlign: 'right', width: 180, color: v != null && v < 0 ? '#c62828' : undefined }}>{v == null ? '' : n(v) || '0,00'}</td>
    </tr>
  );
  return (
    <div className="odoo-section" style={{ padding: 0 }}>
      <table className="odoo-table" style={{ width: '100%' }}>
        <thead><tr><th>Passage du résultat net comptable au résultat net fiscal</th><th style={{ textAlign: 'right' }}>Montant</th></tr></thead>
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
