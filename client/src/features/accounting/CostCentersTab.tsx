import { useState, useEffect, Fragment } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { format } from 'date-fns';
import { fr } from 'date-fns/locale';
import { Target, Loader2, Plus, Power, X, ChevronRight, ChevronDown, Split, Eraser, CheckCircle2, Trash2 } from 'lucide-react';
import { costCentersApi, analyticApi, type CostCenter, type AnalyticBalance } from '../../api/cost-centers.api';
import { notify } from '../../components/ui/InlineNotification';
import { apiErrorMessage } from '../../api/errors';
import { StatusBanner } from '../../components/ui/StatusBanner';
import { useAuth } from '../../context/AuthContext';
import EditionButtons from './EditionButtons';

/**
 * Comptabilité analytique (mig 386 / 428) : axes et sections, ventilation des
 * lignes de charges et de produits (section, clé de répartition), balance
 * analytique rapprochée du CPC, affectation des factures à un centre.
 */

const money = (v: number) => `${v.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const day = (d: string) => format(new Date(d.slice(0, 10) + 'T00:00:00'), 'dd/MM/yyyy', { locale: fr });
const inp: React.CSSProperties = { padding: '0.4rem 0.6rem', border: '1px solid var(--odoo-border)', borderRadius: 4, background: 'var(--odoo-bg)', color: 'inherit', font: 'inherit' };
const mono = { fontFamily: 'ui-monospace, monospace', fontVariantNumeric: 'tabular-nums' } as const;
const lbl: React.CSSProperties = { display: 'flex', flexDirection: 'column', gap: 2, fontSize: '0.75rem', color: 'var(--theme-text-muted)' };

/** Axe courant + période, partagés par les vues. */
function useAxisAndPeriod() {
  const { data: axes = [] } = useQuery({ queryKey: ['analytic', 'axes'], queryFn: analyticApi.axes });
  const [axisId, setAxisId] = useState('');
  useEffect(() => { if (!axisId && axes.length) setAxisId(axes.find(a => a.code === 'ACT')?.id ?? axes[0].id); }, [axes, axisId]);
  const now = new Date();
  const [from, setFrom] = useState(`${now.getFullYear()}-01-01`);
  const [to, setTo] = useState(now.toISOString().slice(0, 10));
  const controls = (
    <div style={{ display: 'flex', gap: 12, alignItems: 'flex-end', flexWrap: 'wrap' }}>
      <label style={lbl}>Axe<select value={axisId} onChange={e => setAxisId(e.target.value)} style={inp}>{axes.filter(a => a.is_active).map(a => <option key={a.id} value={a.id}>{a.code} — {a.name}</option>)}</select></label>
      <label style={lbl}>Du<input type="date" value={from} onChange={e => setFrom(e.target.value)} style={inp} /></label>
      <label style={lbl}>Au<input type="date" value={to} onChange={e => setTo(e.target.value)} style={inp} /></label>
    </div>
  );
  return { axisId, from, to, controls };
}

export default function CostCentersTab() {
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin' || user?.role === 'manager';
  const [view, setView] = useState<'report' | 'ventilation' | 'assign' | 'manage'>('report');
  if (!isAdmin) return <div style={{ padding: '3rem', textAlign: 'center', color: 'var(--theme-text-muted)' }}>Réservé à l'administration.</div>;
  const tabs: [typeof view, string][] = [['report', 'Résultat'], ['ventilation', 'Ventilation'], ['assign', 'Factures'], ['manage', 'Paramétrage']];
  return (
    <div style={{ padding: '1rem', display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {tabs.map(([k, l]) => <button key={k} className={view === k ? 'odoo-btn-primary' : 'odoo-btn-secondary'} onClick={() => setView(k)}>{l}</button>)}
      </div>
      {view === 'report' ? <Report /> : view === 'ventilation' ? <Ventilation /> : view === 'assign' ? <Assign /> : <Manage />}
    </div>
  );
}

/* ─── Résultat : balance analytique ─── */
function Report() {
  const { axisId, from, to, controls } = useAxisAndPeriod();
  const [open, setOpen] = useState<string | null>(null);
  const { data, isLoading } = useQuery({
    queryKey: ['analytic', 'balance', axisId, from, to],
    queryFn: () => analyticApi.balance({ axisId, from, to }),
    enabled: !!axisId,
  });
  const row = (key: string, title: string, b: AnalyticBalance['unventilated'], muted = false) => (
    <Fragment key={key}>
      <tr onClick={() => setOpen(open === key ? null : key)} style={{ cursor: 'pointer', ...(muted ? { color: 'var(--theme-text-muted)', fontStyle: 'italic' } : {}) }}>
        <td>{open === key ? <ChevronDown size={12} /> : <ChevronRight size={12} />} {title}</td>
        <td style={{ ...mono, textAlign: 'right', color: '#15803d' }}>{b.produits ? money(b.produits) : '—'}</td>
        <td style={{ ...mono, textAlign: 'right', color: '#dc2626' }}>{b.charges ? money(b.charges) : '—'}</td>
        <td style={{ ...mono, textAlign: 'right', fontWeight: 600, color: b.result >= 0 ? '#15803d' : '#dc2626' }}>{money(b.result)}</td>
      </tr>
      {open === key && b.accounts.map(a => (
        <tr key={`${key}-${a.code}`} style={{ background: 'var(--theme-bg-tertiary)', fontSize: '0.8125rem' }}>
          <td style={{ paddingLeft: 28 }}><span style={mono}>{a.code}</span> {a.label}</td>
          <td style={{ ...mono, textAlign: 'right' }}>{a.produits ? money(a.produits) : ''}</td>
          <td style={{ ...mono, textAlign: 'right' }}>{a.charges ? money(a.charges) : ''}</td>
          <td />
        </tr>
      ))}
    </Fragment>
  );
  return (
    <>
      <div style={{ display: 'flex', gap: 12, alignItems: 'flex-end', flexWrap: 'wrap', justifyContent: 'space-between' }}>
        {controls}
        <EditionButtons kind="analytique" params={{ startDate: from, endDate: to, axis: axisId }} disabled={!axisId} />
      </div>
      {isLoading || !data ? <div style={{ textAlign: 'center', padding: 32 }}><Loader2 size={18} className="animate-spin" style={{ display: 'inline' }} /></div> : (
        <>
          {data.ventilated_rate < 100 && (
            <StatusBanner tone="info" icon={Split} title={`${data.ventilated_rate} % des charges et produits ventilés`}>
              La ligne « Non ventilé » ferme l'écart avec le CPC. Ventilez les lignes restantes dans l'onglet Ventilation, ou affectez un centre aux factures.
            </StatusBanner>
          )}
          <div style={{ overflowX: 'auto' }}>
            <table className="odoo-table">
              <thead><tr><th>Section</th><th style={{ textAlign: 'right' }}>Produits</th><th style={{ textAlign: 'right' }}>Charges</th><th style={{ textAlign: 'right' }}>Résultat</th></tr></thead>
              <tbody>
                {data.sections.map(s => row(s.id, `${s.code} — ${s.name}`, s))}
                {(data.unventilated.produits !== 0 || data.unventilated.charges !== 0) && row('none', 'Non ventilé', data.unventilated, true)}
              </tbody>
              <tfoot>
                <tr style={{ fontWeight: 700, borderTop: '2px solid var(--odoo-border)' }}>
                  <td>Total (= CPC)</td>
                  <td style={{ ...mono, textAlign: 'right' }}>{money(data.totals.produits)}</td>
                  <td style={{ ...mono, textAlign: 'right' }}>{money(data.totals.charges)}</td>
                  <td style={{ ...mono, textAlign: 'right' }}>{money(data.totals.result)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        </>
      )}
    </>
  );
}

/* ─── Ventilation des lignes ─── */
function Ventilation() {
  const qc = useQueryClient();
  const { axisId, from, to, controls } = useAxisAndPeriod();
  const [status, setStatus] = useState<'open' | 'done' | 'all'>('open');
  const [accountClass, setAccountClass] = useState<'' | '6' | '7'>('');
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [target, setTarget] = useState('');      // 'c:<section>' ou 'k:<clé>'
  const { data: centers = [] } = useQuery({ queryKey: ['cost-centers', 'list'], queryFn: costCentersApi.list });
  const { data: keys = [] } = useQuery({ queryKey: ['analytic', 'keys', axisId], queryFn: () => analyticApi.keys(axisId), enabled: !!axisId });
  const { data: lines = [], isLoading } = useQuery({
    queryKey: ['analytic', 'lines', axisId, from, to, status, accountClass, search],
    queryFn: () => analyticApi.lines({ axisId, from, to, status, search: search || undefined, accountClass: accountClass ? (Number(accountClass) as 6 | 7) : undefined }),
    enabled: !!axisId,
  });
  useEffect(() => setSelected(new Set()), [axisId, from, to, status, accountClass, search]);
  const sections = centers.filter(c => c.axis_id === axisId && c.is_active);
  const refresh = () => { setSelected(new Set()); qc.invalidateQueries({ queryKey: ['analytic'] }); };
  const apply = useMutation({
    mutationFn: () => analyticApi.ventilate({
      lineIds: [...selected], axisId,
      costCenterId: target.startsWith('c:') ? target.slice(2) : null, keyId: target.startsWith('k:') ? target.slice(2) : null,
    }),
    onSuccess: r => { notify.success(`${r.lines} ligne(s) ventilée(s)`); refresh(); },
    onError: e => notify.error(apiErrorMessage(e, 'Ventilation impossible')),
  });
  const clear = useMutation({
    mutationFn: () => analyticApi.clear({ lineIds: [...selected], axisId }),
    onSuccess: r => { notify.success(`${r.removed} ventilation(s) retirée(s)`); refresh(); },
    onError: e => notify.error(apiErrorMessage(e)),
  });
  const amountOf = (l: { debit: string; credit: string }) => Number(l.debit) || Number(l.credit);
  const all = lines.length > 0 && lines.slice(0, 200).every(l => selected.has(l.id));
  const toggle = (id: string) => setSelected(prev => { const n = new Set(prev); if (n.has(id)) n.delete(id); else if (n.size < 200) n.add(id); return n; });
  const selTotal = lines.filter(l => selected.has(l.id)).reduce((s, l) => s + amountOf(l), 0);
  return (
    <>
      <div style={{ display: 'flex', gap: 12, alignItems: 'flex-end', flexWrap: 'wrap' }}>
        {controls}
        <label style={lbl}>Lignes<select value={status} onChange={e => setStatus(e.target.value as typeof status)} style={inp}><option value="open">À ventiler</option><option value="done">Ventilées</option><option value="all">Toutes</option></select></label>
        <label style={lbl}>Classe<select value={accountClass} onChange={e => setAccountClass(e.target.value as typeof accountClass)} style={inp}><option value="">Charges et produits</option><option value="6">Charges (6)</option><option value="7">Produits (7)</option></select></label>
        <label style={{ ...lbl, flex: '1 1 160px' }}>Recherche<input value={search} onChange={e => setSearch(e.target.value)} placeholder="Compte, libellé, n° d'écriture" style={inp} /></label>
      </div>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', padding: '8px 12px', background: 'var(--theme-bg-secondary)', borderRadius: 4, fontSize: '0.8125rem' }}>
        <strong>{selected.size} ligne(s)</strong><span style={mono}>{money(selTotal)} DH</span>
        <span style={{ flex: 1 }} />
        <select value={target} onChange={e => setTarget(e.target.value)} style={{ ...inp, minWidth: 220 }} aria-label="Section ou clé">
          <option value="">Ventiler sur…</option>
          <optgroup label="Section (100 %)">{sections.map(c => <option key={c.id} value={`c:${c.id}`}>{c.code} — {c.name}</option>)}</optgroup>
          {keys.length > 0 && <optgroup label="Clé de répartition">{keys.map(k => <option key={k.id} value={`k:${k.id}`}>{k.name} ({k.lines.map(l => `${l.code} ${Number(l.percent)} %`).join(' / ')})</option>)}</optgroup>}
        </select>
        <button className="odoo-btn-primary" disabled={!selected.size || !target || apply.isPending} onClick={() => apply.mutate()} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><Split size={13} /> Ventiler</button>
        {status !== 'open' && <button className="odoo-btn-secondary" disabled={!selected.size || clear.isPending} onClick={() => clear.mutate()} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><Eraser size={13} /> Retirer</button>}
      </div>
      {sections.length === 0 && <StatusBanner tone="warning" icon={Target} title="Aucune section sur cet axe">Créez des sections dans l'onglet Paramétrage (ex. Boulangerie, Pâtisserie, Traiteur).</StatusBanner>}
      <div style={{ overflowX: 'auto' }}>
        <table className="odoo-table">
          <thead><tr>
            <th style={{ width: 30 }}><input type="checkbox" checked={all} onChange={() => setSelected(all ? new Set() : new Set(lines.slice(0, 200).map(l => l.id)))} aria-label="Tout sélectionner" /></th>
            <th>Date</th><th>Écriture</th><th>Compte</th><th>Libellé</th><th style={{ textAlign: 'right' }}>Montant</th><th>Ventilation</th>
          </tr></thead>
          <tbody>
            {isLoading && <tr><td colSpan={7} style={{ textAlign: 'center', padding: 24 }}><Loader2 size={16} className="animate-spin" style={{ display: 'inline' }} /></td></tr>}
            {!isLoading && lines.length === 0 && <tr><td colSpan={7} style={{ textAlign: 'center', padding: 24, color: 'var(--theme-text-muted)' }}>{status === 'open' ? 'Tout est ventilé sur la période.' : 'Aucune ligne.'}</td></tr>}
            {lines.map(l => {
              const credit = Number(l.credit) > 0;
              return (
                <tr key={l.id} onClick={() => toggle(l.id)} style={{ cursor: 'pointer', background: selected.has(l.id) ? 'var(--odoo-bg-alt)' : undefined }}>
                  <td onClick={e => e.stopPropagation()}><input type="checkbox" checked={selected.has(l.id)} onChange={() => toggle(l.id)} aria-label={`Sélectionner ${l.entry_number}`} /></td>
                  <td style={{ fontSize: '0.75rem', whiteSpace: 'nowrap' }}>{day(l.entry_date)}</td>
                  <td style={{ ...mono, fontSize: '0.75rem', color: '#185fa5' }}>{l.entry_number}</td>
                  <td style={{ fontSize: '0.8125rem' }}><span style={mono}>{l.account_code}</span> {l.account_label}</td>
                  <td style={{ fontSize: '0.8125rem' }}>{l.label}</td>
                  <td style={{ ...mono, textAlign: 'right', color: credit ? '#15803d' : undefined }}>{money(amountOf(l))}{credit ? ' C' : ' D'}</td>
                  <td style={{ fontSize: '0.75rem' }}>
                    {l.ventilation.map(v => <span key={v.cost_center_id} className={`odoo-tag ${v.source === 'invoice' ? 'odoo-tag-blue' : 'odoo-tag-green'}`} style={{ marginRight: 4 }} title={v.source === 'invoice' ? 'Depuis la facture' : v.source === 'key' ? 'Clé de répartition' : 'Saisie'}>{v.code} {money(Number(v.amount))}</span>)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {lines.length >= 1000 && <p style={{ fontSize: '0.75rem', color: 'var(--theme-text-muted)' }}>1 000 lignes affichées au plus : resserrez la période ou la recherche.</p>}
    </>
  );
}

/* ─── Factures : centre par facture (ventile ses écritures) ─── */
function Assign() {
  const qc = useQueryClient();
  const [kind, setKind] = useState<'' | 'received' | 'emitted'>('');
  const [onlyUnassigned, setOnlyUnassigned] = useState(true);
  const { data: centers = [] } = useQuery({ queryKey: ['cost-centers', 'list'], queryFn: costCentersApi.list });
  const activeCenters = centers.filter(c => c.is_active);
  const { data: invoices = [], isLoading } = useQuery({
    queryKey: ['cost-centers', 'invoices', kind, onlyUnassigned],
    queryFn: () => costCentersApi.invoices({ kind: kind || undefined, onlyUnassigned }),
  });
  const assign = useMutation({
    mutationFn: ({ invoiceId, costCenterId }: { invoiceId: string; costCenterId: string | null }) => costCentersApi.assign(invoiceId, costCenterId),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['cost-centers'] }); qc.invalidateQueries({ queryKey: ['analytic'] }); },
    onError: e => notify.error(apiErrorMessage(e)),
  });
  return (
    <>
      <StatusBanner tone="info" icon={CheckCircle2} title="Le centre d'une facture ventile ses écritures">
        Les lignes de charges ou de produits de la facture sont ventilées sur le centre choisi, et suivent ses changements. Une ventilation saisie à la main n'est pas écrasée.
      </StatusBanner>
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
        <select value={kind} onChange={e => setKind(e.target.value as '' | 'received' | 'emitted')} style={inp}>
          <option value="">Toutes les factures</option>
          <option value="received">Factures fournisseurs (charges)</option>
          <option value="emitted">Factures émises (produits)</option>
        </select>
        <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: '0.85rem' }}>
          <input type="checkbox" checked={onlyUnassigned} onChange={e => setOnlyUnassigned(e.target.checked)} style={{ accentColor: 'var(--theme-accent)' }} /> Non affectées seulement
        </label>
      </div>
      <div style={{ overflowX: 'auto' }}>
        <table className="odoo-table">
          <thead><tr><th>Date</th><th>Facture</th><th>Type</th><th>Tiers</th><th style={{ textAlign: 'right' }}>HT</th><th>Centre de coût</th></tr></thead>
          <tbody>
            {isLoading && <tr><td colSpan={6} style={{ textAlign: 'center', padding: 24 }}><Loader2 size={16} className="animate-spin" style={{ display: 'inline' }} /></td></tr>}
            {!isLoading && invoices.length === 0 && <tr><td colSpan={6} style={{ textAlign: 'center', padding: 24, color: 'var(--theme-text-muted)' }}>Aucune facture.</td></tr>}
            {invoices.map(i => (
              <tr key={i.id}>
                <td style={{ whiteSpace: 'nowrap' }}>{day(i.invoice_date)}</td>
                <td style={{ ...mono, fontSize: '0.82rem' }}>{i.invoice_number}</td>
                <td><span className={`odoo-tag ${i.invoice_type === 'received' ? 'odoo-tag-orange' : 'odoo-tag-blue'}`}>{i.invoice_type === 'received' ? 'Charge' : 'Produit'}</span></td>
                <td style={{ fontSize: '0.85rem' }}>{i.party || '—'}</td>
                <td style={{ ...mono, textAlign: 'right' }}>{money(i.amount)}</td>
                <td>
                  <select value={i.cost_center_id ?? ''} onChange={e => assign.mutate({ invoiceId: i.id, costCenterId: e.target.value || null })} style={{ ...inp, minWidth: 150 }}>
                    <option value="">— Non affecté —</option>
                    {activeCenters.map(c => <option key={c.id} value={c.id}>{c.axis_code} · {c.code} — {c.name}</option>)}
                  </select>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

/* ─── Paramétrage : axes, sections, clés ─── */
function Manage() {
  const qc = useQueryClient();
  const { data: axes = [] } = useQuery({ queryKey: ['analytic', 'axes'], queryFn: analyticApi.axes });
  const { data: centers = [], isLoading } = useQuery({ queryKey: ['cost-centers', 'list'], queryFn: costCentersApi.list });
  const [axisId, setAxisId] = useState('');
  useEffect(() => { if (!axisId && axes.length) setAxisId(axes[0].id); }, [axes, axisId]);
  const { data: keys = [] } = useQuery({ queryKey: ['analytic', 'keys', axisId], queryFn: () => analyticApi.keys(axisId), enabled: !!axisId });
  const [form, setForm] = useState<'section' | 'axis' | 'key' | null>(null);
  const toggle = useMutation({
    mutationFn: ({ id, active }: { id: string; active: boolean }) => costCentersApi.setActive(id, active),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['cost-centers'] }),
    onError: e => notify.error(apiErrorMessage(e)),
  });
  const delKey = useMutation({
    mutationFn: (id: string) => analyticApi.deleteKey(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['analytic', 'keys'] }),
  });
  const sections = centers.filter(c => c.axis_id === axisId);
  const done = () => { setForm(null); qc.invalidateQueries({ queryKey: ['cost-centers'] }); qc.invalidateQueries({ queryKey: ['analytic'] }); };
  return (
    <>
      <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end', flexWrap: 'wrap' }}>
        <label style={lbl}>Axe<select value={axisId} onChange={e => setAxisId(e.target.value)} style={inp}>{axes.map(a => <option key={a.id} value={a.id}>{a.code} — {a.name}</option>)}</select></label>
        <button className="odoo-btn-secondary" onClick={() => setForm('axis')}><Plus size={14} /> Nouvel axe</button>
        <span style={{ flex: 1 }} />
        <button className="odoo-btn-primary" onClick={() => setForm('section')} disabled={!axisId}><Plus size={14} /> Nouvelle section</button>
        <button className="odoo-btn-secondary" onClick={() => setForm('key')} disabled={sections.filter(s => s.is_active).length < 2}><Plus size={14} /> Nouvelle clé</button>
      </div>
      <div style={{ overflowX: 'auto' }}>
        <table className="odoo-table">
          <thead><tr><th>Section</th><th>Nom</th><th style={{ textAlign: 'right' }}>Factures</th><th>État</th><th /></tr></thead>
          <tbody>
            {isLoading && <tr><td colSpan={5} style={{ textAlign: 'center', padding: 24 }}><Loader2 size={16} className="animate-spin" style={{ display: 'inline' }} /></td></tr>}
            {!isLoading && sections.length === 0 && <tr><td colSpan={5} style={{ textAlign: 'center', padding: 24, color: 'var(--theme-text-muted)' }}>Aucune section. Créez-en (ex. Boulangerie, Pâtisserie, Traiteur).</td></tr>}
            {sections.map((c: CostCenter) => (
              <tr key={c.id}>
                <td style={{ ...mono, fontWeight: 600 }}>{c.code}</td>
                <td>{c.name}</td>
                <td style={{ textAlign: 'right' }}>{c.invoices_count}</td>
                <td><span className={`odoo-tag ${c.is_active ? 'odoo-tag-green' : 'odoo-tag-grey'}`}>{c.is_active ? 'Active' : 'Inactive'}</span></td>
                <td style={{ textAlign: 'right' }}>
                  <button className="odoo-btn-secondary" style={{ padding: '0.2rem 0.5rem', fontSize: '0.75rem' }} onClick={() => toggle.mutate({ id: c.id, active: !c.is_active })} title={c.is_active ? 'Désactiver' : 'Activer'}><Power size={12} /></button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <h4 style={{ margin: 0, fontSize: '0.875rem' }}>Clés de répartition</h4>
      {keys.length === 0 ? <p style={{ margin: 0, fontSize: '0.8125rem', color: 'var(--theme-text-muted)' }}>Aucune clé. Une clé répartit une charge commune (loyer, électricité) entre plusieurs sections.</p> : (
        <table className="odoo-table">
          <tbody>
            {keys.map(k => (
              <tr key={k.id}>
                <td style={{ fontWeight: 500 }}>{k.name}</td>
                <td style={{ fontSize: '0.8125rem' }}>{k.lines.map(l => `${l.code} ${Number(l.percent)} %`).join(' · ')}</td>
                <td style={{ textAlign: 'right' }}><button className="odoo-btn-secondary" style={{ padding: '0.2rem 0.5rem' }} onClick={() => delKey.mutate(k.id)} title="Supprimer la clé"><Trash2 size={12} /></button></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {form === 'section' && <SectionForm axisId={axisId} onClose={() => setForm(null)} onSaved={done} />}
      {form === 'axis' && <AxisForm onClose={() => setForm(null)} onSaved={done} />}
      {form === 'key' && <KeyForm axisId={axisId} sections={sections.filter(s => s.is_active)} onClose={() => setForm(null)} onSaved={done} />}
    </>
  );
}

function Modal({ title, onClose, children, footer }: { title: string; onClose: () => void; children: React.ReactNode; footer: React.ReactNode }) {
  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div className="odoo-scope" role="dialog" onClick={e => e.stopPropagation()} style={{ background: 'var(--odoo-bg)', borderRadius: 8, width: 'min(460px, 96vw)', display: 'flex', flexDirection: 'column' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 16px', borderBottom: '1px solid var(--odoo-border)' }}>
          <span style={{ fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: 8 }}><Target size={16} /> {title}</span>
          <button type="button" onClick={onClose} className="odoo-pager-btn" aria-label="Fermer"><X size={14} /></button>
        </div>
        <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>{children}</div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, padding: '10px 16px', borderTop: '1px solid var(--odoo-border)' }}>{footer}</div>
      </div>
    </div>
  );
}
const field = (label: string, value: string, set: (v: string) => void, placeholder: string) => (
  <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: '0.8rem' }}><span style={{ color: 'var(--theme-text-muted)' }}>{label}</span><input type="text" value={value} onChange={e => set(e.target.value)} placeholder={placeholder} style={{ ...inp, width: '100%' }} /></label>
);

function SectionForm({ axisId, onClose, onSaved }: { axisId: string; onClose: () => void; onSaved: () => void }) {
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const save = useMutation({
    mutationFn: () => costCentersApi.create({ code: code.trim(), name: name.trim(), axisId }),
    onSuccess: () => { notify.success('Section créée'); onSaved(); },
    onError: e => notify.error(apiErrorMessage(e)),
  });
  return (
    <Modal title="Nouvelle section" onClose={onClose} footer={<>
      <button type="button" className="odoo-btn-secondary" onClick={onClose}>Annuler</button>
      <button type="button" className="odoo-btn-primary" disabled={!code.trim() || !name.trim() || save.isPending} onClick={() => save.mutate()}>Créer</button>
    </>}>
      {field('Code', code, setCode, 'Ex. BOUL')}
      {field('Nom', name, setName, 'Ex. Boulangerie')}
    </Modal>
  );
}

function AxisForm({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const save = useMutation({
    mutationFn: () => analyticApi.createAxis({ code: code.trim(), name: name.trim() }),
    onSuccess: () => { notify.success('Axe créé'); onSaved(); },
    onError: e => notify.error(apiErrorMessage(e)),
  });
  return (
    <Modal title="Nouvel axe analytique" onClose={onClose} footer={<>
      <button type="button" className="odoo-btn-secondary" onClick={onClose}>Annuler</button>
      <button type="button" className="odoo-btn-primary" disabled={!code.trim() || !name.trim() || save.isPending} onClick={() => save.mutate()}>Créer</button>
    </>}>
      {field('Code', code, setCode, 'Ex. MAG')}
      {field('Nom', name, setName, 'Ex. Points de vente')}
    </Modal>
  );
}

function KeyForm({ axisId, sections, onClose, onSaved }: { axisId: string; sections: CostCenter[]; onClose: () => void; onSaved: () => void }) {
  const [name, setName] = useState('');
  const [pct, setPct] = useState<Record<string, string>>({});
  const lines = sections.map(s => ({ costCenterId: s.id, percent: Number((pct[s.id] ?? '').replace(',', '.')) || 0 })).filter(l => l.percent > 0);
  const total = Math.round(lines.reduce((s, l) => s + l.percent, 0) * 10000) / 10000;
  const save = useMutation({
    mutationFn: () => analyticApi.createKey({ axisId, name: name.trim(), lines }),
    onSuccess: () => { notify.success('Clé créée'); onSaved(); },
    onError: e => notify.error(apiErrorMessage(e)),
  });
  return (
    <Modal title="Nouvelle clé de répartition" onClose={onClose} footer={<>
      <span style={{ marginRight: 'auto', fontSize: '0.8125rem', color: total === 100 ? '#15803d' : '#dc2626', alignSelf: 'center' }}>Total {total} %</span>
      <button type="button" className="odoo-btn-secondary" onClick={onClose}>Annuler</button>
      <button type="button" className="odoo-btn-primary" disabled={!name.trim() || total !== 100 || lines.length < 2 || save.isPending} onClick={() => save.mutate()}>Créer</button>
    </>}>
      {field('Nom', name, setName, 'Ex. Loyer')}
      {sections.map(s => (
        <label key={s.id} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: '0.8125rem' }}>
          <span style={{ flex: 1 }}><span style={mono}>{s.code}</span> {s.name}</span>
          <input value={pct[s.id] ?? ''} onChange={e => setPct({ ...pct, [s.id]: e.target.value })} inputMode="decimal" placeholder="0" style={{ ...inp, width: 80, textAlign: 'right' }} aria-label={`Pourcentage ${s.code}`} /> %
        </label>
      ))}
    </Modal>
  );
}
