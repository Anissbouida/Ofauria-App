import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Award, Camera, Loader2, X, TrendingUp, TrendingDown, Minus, Info } from 'lucide-react';
import { format } from 'date-fns';
import { fr } from 'date-fns/locale';
import { supplierScoreApi, CRITERIA, STANDING_LABELS, STANDING_TAG, type ScoreRow, type Standing } from '../../api/supplier-score.api';
import { apiErrorMessage } from '../../api/errors';
import { notify } from '../../components/ui/InlineNotification';
import ModalBackdrop from '../../components/ui/ModalBackdrop';
import { StatusBanner } from '../../components/ui/StatusBanner';
import { useConfirm } from '../../components/ui/ConfirmDialog';
import { StagePipeline, type StageDef } from '../../components/purchasing/ProcessBoard';

/**
 * Achats › Rapports › Évaluation des fournisseurs (mig 362) : note 0-100 par
 * fournisseur sur une période, calculée depuis les BC, réceptions, contrôles et
 * factures ; détail des faits ; instantané pour figer la période.
 */
const n1 = (v: number | string | null | undefined) => (v == null ? '—' : Number(v).toLocaleString('fr-FR', { maximumFractionDigits: 1 }));
const STAGES: Array<StageDef & { key: Standing }> = [
  { key: 'A', label: 'A · Excellents', hint: 'à privilégier', icon: Award },
  { key: 'B', label: 'B · Bons', hint: 'fiables', icon: Award },
  { key: 'C', label: 'C · À surveiller', hint: 'écarts répétés', icon: Award },
  { key: 'D', label: 'D · Problématiques', hint: 'à revoir', icon: Award },
  { key: 'new', label: 'Trop récents', hint: 'pas assez de BC', icon: Award },
];

function ScoreBar({ value }: { value: number | null }) {
  if (value == null) return <span style={{ color: 'var(--theme-text-muted)' }}>—</span>;
  const color = value >= 85 ? '#28a745' : value >= 70 ? '#0d6efd' : value >= 50 ? '#d9822b' : '#dc3545';
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 110 }}>
      <div style={{ flex: 1, height: 6, borderRadius: 3, background: 'var(--odoo-border)' }}><div style={{ width: `${Math.min(100, value)}%`, height: '100%', borderRadius: 3, background: color }} /></div>
      <span style={{ fontSize: '0.8125rem', fontWeight: 600, minWidth: 34, textAlign: 'right' }}>{n1(value)}</span>
    </div>
  );
}

function Trend({ r }: { r: ScoreRow }) {
  if (r.previous_score == null || r.score == null) return <span style={{ color: 'var(--theme-text-muted)' }}>—</span>;
  const d = r.score - r.previous_score;
  const Icon = d > 2 ? TrendingUp : d < -2 ? TrendingDown : Minus;
  return <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, color: d > 2 ? '#28a745' : d < -2 ? '#dc3545' : 'var(--theme-text-muted)', fontSize: '0.8125rem' }} title={`Instantané au ${format(new Date(r.previous_period_to!), 'dd/MM/yyyy')} : ${n1(r.previous_score)}`}><Icon size={13} /> {d > 0 ? '+' : ''}{n1(d)}</span>;
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
    onSuccess: r => { qc.invalidateQueries({ queryKey: ['supplier-scores'] }); notify.success(`${r.count} note(s) figée(s) pour la période du ${format(new Date(r.from), 'dd/MM/yyyy')} au ${format(new Date(r.to), 'dd/MM/yyyy')}`); },
    onError: e => notify.error(apiErrorMessage(e)),
  });
  const rows = (data?.rows ?? []).filter(r => !standing || r.standing === standing);
  const w = data?.weights;
  return (
    <>
      <StatusBanner tone="info" icon={Info} title="Une note calculée, pas une opinion">
        Délais tenus, livraisons complètes, conformité à réception, prix stables, absence de litige : chaque critère est un taux lu dans les BC, réceptions et factures de la période. {w ? `Poids : délais ${w.on_time}, complétude ${w.fill_rate}, conformité ${w.quality}, prix ${w.price}, litiges ${w.disputes} ; un fournisseur est noté à partir de ${w.min_orders} BC.` : ''} Les poids se règlent dans Paramètres › Achats.
      </StatusBanner>
      <div className="odoo-search-panel" style={{ margin: 0, flexWrap: 'wrap', rowGap: 8 }}>
        <span style={{ fontSize: '0.8125rem', color: 'var(--theme-text-muted)' }}>Période</span>
        <input className="input" type="date" value={from} onChange={e => setFrom(e.target.value)} />
        <span style={{ color: 'var(--theme-text-muted)' }}>→</span>
        <input className="input" type="date" value={to} onChange={e => setTo(e.target.value)} />
        {data && <span style={{ fontSize: '0.8125rem', color: 'var(--theme-text-muted)' }}>du {format(new Date(data.from), 'dd/MM/yyyy')} au {format(new Date(data.to), 'dd/MM/yyyy')} · {data.rows.length} fournisseur(s)</span>}
        <div style={{ flex: 1 }} />
        <button className="odoo-btn-secondary" disabled={snapshot.isPending || !data?.rows.length} onClick={async () => { if (await confirm('Figer les notes de cette période ? Elles serviront de référence pour l\'évolution.')) snapshot.mutate(); }}>
          {snapshot.isPending ? <Loader2 size={13} className="animate-spin" /> : <Camera size={13} />} Figer la période
        </button>
      </div>
      {isLoading || !data ? <div style={{ display: 'flex', justifyContent: 'center', padding: '3rem' }}><Loader2 size={28} className="animate-spin" style={{ color: 'var(--theme-accent)' }} /></div> : (
        <>
          <StagePipeline title="Classement" summary={`${data.counts.A + data.counts.B} fournisseurs fiables · ${data.counts.C + data.counts.D} à surveiller`}
            stages={STAGES} stats={Object.fromEntries(STAGES.map(s => [s.key, { count: data.counts[s.key], sub: '' }]))}
            isActive={k => standing === k} onPick={k => setStanding(standing === k ? '' : (k as Standing))} />
          {rows.length === 0 ? <StatusBanner tone="info" icon={Award} title="Aucun fournisseur sur cette sélection">Élargissez la période ou retirez le filtre.</StatusBanner> : (
            <div style={{ overflowX: 'auto' }}>
              <table className="odoo-table">
                <thead><tr><th>Fournisseur</th><th>Note</th><th>Classe</th><th>Évolution</th><th style={{ textAlign: 'right' }}>BC</th>{CRITERIA.map(c => <th key={c.key} style={{ textAlign: 'right' }} title={c.hint}>{c.label}</th>)}</tr></thead>
                <tbody>{rows.map(r => (
                  <tr key={r.supplier_id} onClick={() => setOpenId(r.supplier_id)} style={{ cursor: 'pointer' }}>
                    <td><strong>{r.supplier_name}</strong></td>
                    <td><ScoreBar value={r.score} /></td>
                    <td><span className={`odoo-tag ${STANDING_TAG[r.standing]}`}>{r.standing === 'new' ? 'récent' : r.standing}</span></td>
                    <td><Trend r={r} /></td>
                    <td style={{ textAlign: 'right' }}>{r.orders}</td>
                    {CRITERIA.map(c => {
                      const m = r[c.key] as { rate: number | null; total?: number };
                      const v = c.key === 'disputes' ? r.parts.disputes : m.rate;
                      return <td key={c.key} style={{ textAlign: 'right', color: v == null ? 'var(--theme-text-muted)' : v < 70 ? '#dc3545' : undefined }} title={m.total != null ? `${m.total} observation(s)` : ''}>{v == null ? '—' : `${n1(v)} %`}</td>;
                    })}
                  </tr>
                ))}</tbody>
              </table>
            </div>
          )}
        </>
      )}
      {openId && <SupplierScoreDrawer supplierId={openId} params={params} onClose={() => setOpenId(null)} />}
    </>
  );
}

function SupplierScoreDrawer({ supplierId, params, onClose }: { supplierId: string; params: Record<string, string>; onClose: () => void }) {
  const { data, isLoading } = useQuery({ queryKey: ['supplier-score', supplierId, params], queryFn: () => supplierScoreApi.detail(supplierId, params) });
  const m = data?.metrics; const s = data?.score;
  const section = (title: string, children: React.ReactNode) => <div><div className="odoo-section-header" style={{ border: 'none', paddingLeft: 0 }}>{title}</div>{children}</div>;
  const none = (t: string) => <p style={{ fontSize: '0.8125rem', color: 'var(--theme-text-muted)', margin: 0 }}>{t}</p>;
  return (
    <ModalBackdrop onClose={onClose} className="fixed inset-0 z-50 flex justify-end bg-black/30">
      <div className="odoo-scope" onClick={e => e.stopPropagation()} style={{ width: 'min(820px, 100%)', height: '100%', overflowY: 'auto', background: 'var(--theme-bg-card)', boxShadow: '-6px 0 24px rgba(0,0,0,0.15)' }}>
        <div className="odoo-control-bar" style={{ position: 'sticky', top: 0, zIndex: 1 }}>
          <div className="odoo-breadcrumb"><Award size={14} style={{ color: 'var(--theme-accent)' }} /><span className="odoo-breadcrumb-current">{m?.supplier_name ?? 'Fournisseur'}</span>
            {s && <span className={`odoo-tag ${STANDING_TAG[s.standing]}`} style={{ marginLeft: 8 }}>{STANDING_LABELS[s.standing]}{s.score != null ? ` · ${n1(s.score)}` : ''}</span>}</div>
          <div style={{ flex: 1 }} />
          <button type="button" className="odoo-btn-secondary" onClick={onClose} aria-label="Fermer"><X size={14} /></button>
        </div>
        {isLoading || !data ? <div style={{ display: 'flex', justifyContent: 'center', padding: '3rem' }}><Loader2 size={28} className="animate-spin" /></div> : !m ? (
          <div style={{ padding: 20 }}>{none('Aucun bon de commande sur la période.')}</div>
        ) : (
          <div style={{ padding: '16px 20px', display: 'grid', gap: 16 }}>
            <div style={{ fontSize: '0.8125rem', color: 'var(--theme-text-muted)' }}>Période du {format(new Date(data.from), 'dd MMMM yyyy', { locale: fr })} au {format(new Date(data.to), 'dd MMMM yyyy', { locale: fr })} · {m.orders} bon(s) de commande</div>
            <table className="odoo-table">
              <thead><tr><th>Critère</th><th style={{ textAlign: 'right' }}>Observations</th><th style={{ textAlign: 'right' }}>Taux</th><th style={{ textAlign: 'right' }}>Poids</th><th>Détail</th></tr></thead>
              <tbody>
                <tr><td>Délais tenus</td><td style={{ textAlign: 'right' }}>{m.on_time.ok}/{m.on_time.total}</td><td style={{ textAlign: 'right' }}>{m.on_time.rate == null ? '—' : `${n1(m.on_time.rate)} %`}</td><td style={{ textAlign: 'right' }}>{data.weights.on_time}</td><td style={{ color: 'var(--theme-text-muted)' }}>{m.on_time.avg_late_days != null ? `retard moyen ${n1(m.on_time.avg_late_days)} j` : ''}</td></tr>
                <tr><td>Livraisons complètes</td><td style={{ textAlign: 'right' }}>{m.fill_rate.ok}/{m.fill_rate.total}</td><td style={{ textAlign: 'right' }}>{m.fill_rate.rate == null ? '—' : `${n1(m.fill_rate.rate)} %`}</td><td style={{ textAlign: 'right' }}>{data.weights.fill_rate}</td><td /></tr>
                <tr><td>Conformité à réception</td><td style={{ textAlign: 'right' }}>{m.quality.ok}/{m.quality.total}</td><td style={{ textAlign: 'right' }}>{m.quality.rate == null ? '—' : `${n1(m.quality.rate)} %`}</td><td style={{ textAlign: 'right' }}>{data.weights.quality}</td><td style={{ color: 'var(--theme-text-muted)' }}>{m.quality.total === 0 ? 'aucun contrôle saisi' : ''}</td></tr>
                <tr><td>Prix stables</td><td style={{ textAlign: 'right' }}>{m.price.ok}/{m.price.total}</td><td style={{ textAlign: 'right' }}>{m.price.rate == null ? '—' : `${n1(m.price.rate)} %`}</td><td style={{ textAlign: 'right' }}>{data.weights.price}</td><td style={{ color: 'var(--theme-text-muted)' }}>{m.price.avg_increase_pct != null ? `hausse moyenne ${n1(m.price.avg_increase_pct)} %` : ''}</td></tr>
                <tr><td>Sans litige</td><td style={{ textAlign: 'right' }}>{m.disputes.disputed}/{m.disputes.total}</td><td style={{ textAlign: 'right' }}>{s?.parts.disputes == null ? '—' : `${n1(s.parts.disputes)} %`}</td><td style={{ textAlign: 'right' }}>{data.weights.disputes}</td><td style={{ color: 'var(--theme-text-muted)' }}>{m.disputes.disputed ? `${m.disputes.disputed} facture(s) bloquée(s) ou en litige` : ''}</td></tr>
              </tbody>
            </table>
            {section('BC livrés en retard', data.facts.late.length === 0 ? none('Aucun.') : (
              <table className="odoo-table"><thead><tr><th>BC</th><th>Attendu</th><th>Reçu</th><th style={{ textAlign: 'right' }}>Retard</th></tr></thead>
                <tbody>{data.facts.late.map(x => <tr key={x.order_number}><td className="font-mono">{x.order_number}</td><td>{format(new Date(x.expected_delivery_date), 'dd/MM/yyyy')}</td><td>{format(new Date(x.first_reception), 'dd/MM/yyyy')}</td><td style={{ textAlign: 'right', color: '#dc3545' }}>{x.late_days} j</td></tr>)}</tbody></table>
            ))}
            {section('Réceptions non conformes', data.facts.nonconform.length === 0 ? none('Aucune.') : (
              <table className="odoo-table"><thead><tr><th>Réception</th><th>Date</th><th>Points en défaut</th><th>Note</th></tr></thead>
                <tbody>{data.facts.nonconform.map(x => <tr key={x.voucher_number}><td className="font-mono">{x.voucher_number}</td><td>{format(new Date(x.reception_date), 'dd/MM/yyyy')}</td>
                  <td>{[x.temperature_ok === false && 'température', x.visual_ok === false && 'aspect', x.packaging_ok === false && 'emballage', x.labels_ok === false && 'étiquetage'].filter(Boolean).join(', ') || '—'}</td><td style={{ color: 'var(--theme-text-muted)' }}>{x.notes || ''}</td></tr>)}</tbody></table>
            ))}
            {section('Hausses de prix à la réception', data.facts.increases.length === 0 ? none('Aucune.') : (
              <table className="odoo-table"><thead><tr><th>Réception</th><th>Article</th><th style={{ textAlign: 'right' }}>Prix BC</th><th style={{ textAlign: 'right' }}>Prix reçu</th><th style={{ textAlign: 'right' }}>Hausse</th></tr></thead>
                <tbody>{data.facts.increases.map((x, i) => <tr key={i}><td className="font-mono">{x.voucher_number}</td><td>{x.label}</td><td style={{ textAlign: 'right' }}>{Number(x.po_unit_price).toFixed(4)}</td><td style={{ textAlign: 'right' }}>{Number(x.unit_price).toFixed(4)}</td><td style={{ textAlign: 'right', color: '#dc3545' }}>+{x.increase_pct} %</td></tr>)}</tbody></table>
            ))}
            {section('Factures en litige ou bloquées', data.facts.disputed.length === 0 ? none('Aucune.') : (
              <table className="odoo-table"><thead><tr><th>Facture</th><th>Date</th><th style={{ textAlign: 'right' }}>Montant</th><th>Blocage</th></tr></thead>
                <tbody>{data.facts.disputed.map(x => <tr key={x.invoice_number}><td className="font-mono">{x.invoice_number}</td><td>{format(new Date(x.invoice_date), 'dd/MM/yyyy')}</td><td style={{ textAlign: 'right' }}>{Number(x.total_amount).toFixed(2)}</td><td>{x.holds || x.status}</td></tr>)}</tbody></table>
            ))}
            {section('Historique des notes figées', data.history.length === 0 ? none('Aucun instantané. « Figer la période » en crée un.') : (
              <table className="odoo-table"><thead><tr><th>Période</th><th>Note</th><th>Classe</th><th>Figée le</th><th>Note</th></tr></thead>
                <tbody>{data.history.map(h => <tr key={h.id}><td>{format(new Date(h.period_from), 'dd/MM/yy')} → {format(new Date(h.period_to), 'dd/MM/yy')}</td><td><ScoreBar value={h.score == null ? null : Number(h.score)} /></td><td><span className={`odoo-tag ${STANDING_TAG[h.standing]}`}>{h.standing}</span></td><td>{format(new Date(h.computed_at), 'dd/MM/yyyy')}</td><td style={{ color: 'var(--theme-text-muted)' }}>{h.note || ''}</td></tr>)}</tbody></table>
            ))}
          </div>
        )}
      </div>
    </ModalBackdrop>
  );
}

