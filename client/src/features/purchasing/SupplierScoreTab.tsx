import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Award, Camera, Loader2, X, TrendingUp, TrendingDown, Minus } from 'lucide-react';
import { format } from 'date-fns';
import { fr } from 'date-fns/locale';
import { supplierScoreApi, CRITERIA, STANDING_LABELS, STANDING_TAG, type ScoreRow, type Standing } from '../../api/supplier-score.api';
import { apiErrorMessage } from '../../api/errors';
import { notify } from '../../components/ui/InlineNotification';
import ModalBackdrop from '../../components/ui/ModalBackdrop';
import { Toolbar, DataPanel, TableFooter, EmptyState, NoResultState, LoadingState, SectionHeader } from '../../components/ds';
import { PurHeaderActions } from './PurHeaderActions';
import { currencySymbol } from '../../utils/money';
import { useConfirm } from '../../components/ui/ConfirmDialog';
import { StagePipeline, type StageDef } from '../../components/purchasing/ProcessBoard';

/**
 * Achats › Rapports › Évaluation des fournisseurs (mig 362) : note 0-100 par
 * fournisseur sur une période, calculée depuis les BC, réceptions, contrôles et
 * factures ; détail des faits ; instantané pour figer la période.
 */
const n1 = (v: number | string | null | undefined) => (v == null ? '—' : Number(v).toLocaleString('fr-FR', { maximumFractionDigits: 1 }));
const dm = (v: string) => format(new Date(v), 'd MMM yyyy', { locale: fr });
const STAGES: Array<StageDef & { key: Standing }> = [
  { key: 'A', label: 'A · Excellents', hint: 'à privilégier', icon: Award },
  { key: 'B', label: 'B · Bons', hint: 'fiables', icon: Award },
  { key: 'C', label: 'C · À surveiller', hint: 'écarts répétés', icon: Award },
  { key: 'D', label: 'D · Problématiques', hint: 'à revoir', icon: Award },
  { key: 'new', label: 'Trop récents', hint: 'pas assez de BC', icon: Award },
];

function ScoreBar({ value }: { value: number | null }) {
  if (value == null) return <span style={{ color: 'var(--ds-muted)' }}>—</span>;
  const color = value >= 85 ? 'var(--ds-success)' : value >= 70 ? 'var(--ds-accent)' : value >= 50 ? 'var(--ds-warning)' : 'var(--ds-danger)';
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 110 }}>
      <div style={{ flex: 1, height: 6, borderRadius: 3, background: 'var(--ds-sep)' }}><div style={{ width: `${Math.min(100, value)}%`, height: '100%', borderRadius: 3, background: color }} /></div>
      <span className="ds-strong" style={{ minWidth: 34, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{n1(value)}</span>
    </div>
  );
}

function Trend({ r }: { r: ScoreRow }) {
  if (r.previous_score == null || r.score == null) return <span style={{ color: 'var(--ds-muted)' }}>—</span>;
  const d = r.score - r.previous_score;
  const Icon = d > 2 ? TrendingUp : d < -2 ? TrendingDown : Minus;
  return <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, color: d > 2 ? 'var(--ds-success)' : d < -2 ? 'var(--ds-danger)' : 'var(--ds-muted)', fontSize: 13 }} title={`Instantané au ${dm(r.previous_period_to!)} : ${n1(r.previous_score)}`}><Icon size={13} aria-hidden="true" /> {d > 0 ? '+' : ''}{n1(d)}</span>;
}

export default function SupplierScoreTab() {
  const qc = useQueryClient();
  const confirm = useConfirm();
  const [from, setFrom] = useState(''); const [to, setTo] = useState('');
  const [standing, setStanding] = useState<Standing | ''>('');
  const [openId, setOpenId] = useState<string | null>(null);
  const params: Record<string, string> = {}; if (from) params.from = from; if (to) params.to = to;
  const { data, isLoading } = useQuery({ queryKey: ['supplier-scores', params], queryFn: () => supplierScoreApi.board(params) });
  const snapshot = useMutation({
    mutationFn: () => supplierScoreApi.snapshot(params),
    onSuccess: r => { qc.invalidateQueries({ queryKey: ['supplier-scores'] }); notify.success(`${r.count} note(s) figée(s) pour la période du ${dm(r.from)} au ${dm(r.to)}`); },
    onError: e => notify.error(apiErrorMessage(e)),
  });
  const rows = (data?.rows ?? []).filter(r => !standing || r.standing === standing);
  const w = data?.weights;
  const dateInput: React.CSSProperties = { width: 150 };
  return (
    <>
      <PurHeaderActions>
        <button type="button" className="odoo-btn-secondary" disabled={snapshot.isPending || !data?.rows.length} onClick={async () => { if (await confirm('Figer les notes de cette période ? Elles serviront de référence pour l\'évolution.')) snapshot.mutate(); }}>
          {snapshot.isPending ? <Loader2 size={13} className="animate-spin" aria-hidden="true" /> : <Camera size={13} aria-hidden="true" />} Figer la période
        </button>
      </PurHeaderActions>
      {data && (
        <>
          <StagePipeline title="Classement" summary={`${data.counts.A + data.counts.B} fournisseurs fiables · ${data.counts.C + data.counts.D} à surveiller`}
            stages={STAGES} stats={Object.fromEntries(STAGES.map(s => [s.key, { count: data.counts[s.key], sub: '' }]))}
            isActive={k => standing === k} onPick={k => setStanding(standing === k ? '' : (k as Standing))} />
        </>
      )}
      <Toolbar>
        <label style={{ display: 'inline-flex', alignItems: 'center', gap: 8, fontSize: 13, color: 'var(--ds-body)' }}>Période du
          <input className="ds-input sm" style={dateInput} type="date" value={from} onChange={e => setFrom(e.target.value)} aria-label="Début de la période" />
        </label>
        <label style={{ display: 'inline-flex', alignItems: 'center', gap: 8, fontSize: 13, color: 'var(--ds-body)' }}>au
          <input className="ds-input sm" style={dateInput} type="date" value={to} onChange={e => setTo(e.target.value)} aria-label="Fin de la période" />
        </label>
        {(from || to) && <button type="button" className="ds-btn-ghost ds-btn-sm" onClick={() => { setFrom(''); setTo(''); }}><X size={13} aria-hidden="true" /> Effacer</button>}
      </Toolbar>
      {isLoading || !data ? <LoadingState /> : rows.length === 0 ? (
        standing
          ? <NoResultState onReset={() => setStanding('')} text="Aucun fournisseur dans cette classe sur la période." />
          : <EmptyState icon={Award} title="Aucun fournisseur à noter sur cette période" text="La note se calcule à partir des bons de commande, réceptions et factures de la période. Élargissez la période." />
      ) : (
        <DataPanel label="Notes des fournisseurs"
          footer={<TableFooter note={`${rows.length} fournisseur${rows.length > 1 ? 's' : ''} · période du ${dm(data.from)} au ${dm(data.to)}${w ? ` · poids : délais ${w.on_time}, complétude ${w.fill_rate}, conformité ${w.quality}, prix ${w.price}, litiges ${w.disputes} · noté à partir de ${w.min_orders} BC` : ''}`} />}>
          <table className="odoo-table">
            <thead><tr><th>Fournisseur</th><th>Note</th><th>Classe</th><th>Évolution</th><th className="ds-num">BC</th>{CRITERIA.map(c => <th key={c.key} className="ds-num" title={c.hint}>{c.label} (%)</th>)}<th className="ds-actions"><span className="sr-only">Actions</span></th></tr></thead>
            <tbody>{rows.map(r => (
              <tr key={r.supplier_id} onClick={() => setOpenId(r.supplier_id)} style={{ cursor: 'pointer' }}>
                <td className="ds-strong">{r.supplier_name}</td>
                <td><ScoreBar value={r.score} /></td>
                <td><span className={`odoo-tag ${STANDING_TAG[r.standing]}`}>{r.standing === 'new' ? 'récent' : r.standing}</span></td>
                <td><Trend r={r} /></td>
                <td className="ds-num">{r.orders}</td>
                {CRITERIA.map(c => {
                  const m = r[c.key] as { rate: number | null; total?: number };
                  const v = c.key === 'disputes' ? r.parts.disputes : m.rate;
                  return <td key={c.key} className="ds-num" style={{ color: v == null ? 'var(--ds-muted)' : v < 70 ? 'var(--ds-danger)' : undefined }} title={m.total != null ? `${m.total} observation(s)` : ''}>{v == null ? '—' : n1(v)}</td>;
                })}
                <td className="ds-actions" onClick={e => e.stopPropagation()}>
                  <button type="button" className="odoo-btn-secondary ds-btn-sm" onClick={() => setOpenId(r.supplier_id)}>Détail</button>
                </td>
              </tr>
            ))}</tbody>
          </table>
        </DataPanel>
      )}
      {openId && <SupplierScoreDrawer supplierId={openId} params={params} onClose={() => setOpenId(null)} />}
    </>
  );
}

function SupplierScoreDrawer({ supplierId, params, onClose }: { supplierId: string; params: Record<string, string>; onClose: () => void }) {
  const { data, isLoading } = useQuery({ queryKey: ['supplier-score', supplierId, params], queryFn: () => supplierScoreApi.detail(supplierId, params) });
  const m = data?.metrics; const s = data?.score;
  const section = (title: string, children: React.ReactNode) => <div style={{ display: 'grid', gap: 8 }}><SectionHeader title={title} />{children}</div>;
  const none = (t: string) => <p style={{ fontSize: 14, color: 'var(--ds-muted)', margin: 0 }}>{t}</p>;
  return (
    <ModalBackdrop onClose={onClose} className="fixed inset-0 z-50 flex justify-end bg-black/30">
      <div className="odoo-scope" onClick={e => e.stopPropagation()} style={{ width: 'min(820px, 100%)', height: '100%', overflowY: 'auto', background: 'var(--theme-bg-card)', boxShadow: '-6px 0 24px rgba(0,0,0,0.15)' }}>
        <div className="odoo-control-bar" style={{ position: 'sticky', top: 0, zIndex: 1 }}>
          <div className="odoo-breadcrumb"><Award size={14} aria-hidden="true" style={{ color: 'var(--ds-accent)' }} /><span className="odoo-breadcrumb-current">{m?.supplier_name ?? 'Fournisseur'}</span>
            {s && <span className={`odoo-tag ${STANDING_TAG[s.standing]}`} style={{ marginLeft: 8 }}>{STANDING_LABELS[s.standing]}{s.score != null ? ` · ${n1(s.score)}` : ''}</span>}</div>
          <div style={{ flex: 1 }} />
          <button type="button" className="odoo-btn-secondary" onClick={onClose} aria-label="Fermer"><X size={14} /></button>
        </div>
        {isLoading || !data ? <LoadingState bare /> : !m ? (
          <div style={{ padding: 20 }}>{none('Aucun bon de commande sur la période.')}</div>
        ) : (
          <div style={{ padding: '16px 20px', display: 'grid', gap: 16 }}>
            <div style={{ fontSize: 13, color: 'var(--ds-muted)' }}>Période du {format(new Date(data.from), 'dd MMMM yyyy', { locale: fr })} au {format(new Date(data.to), 'dd MMMM yyyy', { locale: fr })} · {m.orders} bon(s) de commande</div>
            <table className="odoo-table ds-dense">
              <thead><tr><th>Critère</th><th className="ds-num">Observations</th><th className="ds-num">Taux</th><th className="ds-num">Poids</th><th>Détail</th></tr></thead>
              <tbody>
                <tr><td>Délais tenus</td><td className="ds-num">{m.on_time.ok}/{m.on_time.total}</td><td className="ds-num">{m.on_time.rate == null ? '—' : `${n1(m.on_time.rate)} %`}</td><td className="ds-num">{data.weights.on_time}</td><td style={{ color: 'var(--ds-muted)' }}>{m.on_time.avg_late_days != null ? `retard moyen ${n1(m.on_time.avg_late_days)} j` : ''}</td></tr>
                <tr><td>Livraisons complètes</td><td className="ds-num">{m.fill_rate.ok}/{m.fill_rate.total}</td><td className="ds-num">{m.fill_rate.rate == null ? '—' : `${n1(m.fill_rate.rate)} %`}</td><td className="ds-num">{data.weights.fill_rate}</td><td /></tr>
                <tr><td>Conformité à réception</td><td className="ds-num">{m.quality.ok}/{m.quality.total}</td><td className="ds-num">{m.quality.rate == null ? '—' : `${n1(m.quality.rate)} %`}</td><td className="ds-num">{data.weights.quality}</td><td style={{ color: 'var(--ds-muted)' }}>{m.quality.total === 0 ? 'aucun contrôle saisi' : ''}</td></tr>
                <tr><td>Prix stables</td><td className="ds-num">{m.price.ok}/{m.price.total}</td><td className="ds-num">{m.price.rate == null ? '—' : `${n1(m.price.rate)} %`}</td><td className="ds-num">{data.weights.price}</td><td style={{ color: 'var(--ds-muted)' }}>{m.price.avg_increase_pct != null ? `hausse moyenne ${n1(m.price.avg_increase_pct)} %` : ''}</td></tr>
                <tr><td>Sans litige</td><td className="ds-num">{m.disputes.disputed}/{m.disputes.total}</td><td className="ds-num">{s?.parts.disputes == null ? '—' : `${n1(s.parts.disputes)} %`}</td><td className="ds-num">{data.weights.disputes}</td><td style={{ color: 'var(--ds-muted)' }}>{m.disputes.disputed ? `${m.disputes.disputed} facture(s) bloquée(s) ou en litige` : ''}</td></tr>
              </tbody>
            </table>
            {section('BC livrés en retard', data.facts.late.length === 0 ? none('Aucun.') : (
              <table className="odoo-table ds-dense"><thead><tr><th>BC</th><th>Attendu</th><th>Reçu</th><th className="ds-num">Retard (j)</th></tr></thead>
                <tbody>{data.facts.late.map(x => <tr key={x.order_number}><td className="ds-ref">{x.order_number}</td><td>{dm(x.expected_delivery_date)}</td><td>{dm(x.first_reception)}</td><td className="ds-num" style={{ color: 'var(--ds-danger)' }}>{x.late_days}</td></tr>)}</tbody></table>
            ))}
            {section('Réceptions non conformes', data.facts.nonconform.length === 0 ? none('Aucune.') : (
              <table className="odoo-table ds-dense"><thead><tr><th>Réception</th><th>Date</th><th>Points en défaut</th><th>Note</th></tr></thead>
                <tbody>{data.facts.nonconform.map(x => <tr key={x.voucher_number}><td className="ds-ref">{x.voucher_number}</td><td>{dm(x.reception_date)}</td>
                  <td>{[x.temperature_ok === false && 'température', x.visual_ok === false && 'aspect', x.packaging_ok === false && 'emballage', x.labels_ok === false && 'étiquetage'].filter(Boolean).join(', ') || '—'}</td><td style={{ color: 'var(--ds-muted)' }}>{x.notes || ''}</td></tr>)}</tbody></table>
            ))}
            {section('Hausses de prix à la réception', data.facts.increases.length === 0 ? none('Aucune.') : (
              <table className="odoo-table ds-dense"><thead><tr><th>Réception</th><th>Article</th><th className="ds-num">Prix commandé ({currencySymbol()})</th><th className="ds-num">Prix reçu ({currencySymbol()})</th><th className="ds-num">Hausse</th></tr></thead>
                <tbody>{data.facts.increases.map((x, i) => <tr key={i}><td className="ds-ref">{x.voucher_number}</td><td>{x.label}</td><td className="ds-num">{Number(x.po_unit_price).toFixed(4)}</td><td className="ds-num">{Number(x.unit_price).toFixed(4)}</td><td className="ds-num" style={{ color: 'var(--ds-danger)' }}>+{x.increase_pct} %</td></tr>)}</tbody></table>
            ))}
            {section('Factures en litige ou bloquées', data.facts.disputed.length === 0 ? none('Aucune.') : (
              <table className="odoo-table ds-dense"><thead><tr><th>Facture</th><th>Date</th><th className="ds-num">Montant ({currencySymbol()})</th><th>Blocage</th></tr></thead>
                <tbody>{data.facts.disputed.map(x => <tr key={x.invoice_number}><td className="ds-ref">{x.invoice_number}</td><td>{dm(x.invoice_date)}</td><td className="ds-num">{Number(x.total_amount).toFixed(2)}</td><td>{x.holds || x.status}</td></tr>)}</tbody></table>
            ))}
            {section('Historique des notes figées', data.history.length === 0 ? none('Aucun instantané. « Figer la période » en crée un.') : (
              <table className="odoo-table ds-dense"><thead><tr><th>Période</th><th>Note</th><th>Classe</th><th>Figée le</th><th>Commentaire</th></tr></thead>
                <tbody>{data.history.map(h => <tr key={h.id}><td>{dm(h.period_from)} → {dm(h.period_to)}</td><td><ScoreBar value={h.score == null ? null : Number(h.score)} /></td><td><span className={`odoo-tag ${STANDING_TAG[h.standing]}`}>{h.standing}</span></td><td>{dm(h.computed_at)}</td><td style={{ color: 'var(--ds-muted)' }}>{h.note || ''}</td></tr>)}</tbody></table>
            ))}
          </div>
        )}
      </div>
    </ModalBackdrop>
  );
}

