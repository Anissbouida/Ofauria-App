import { useState, useEffect, Fragment } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { format } from 'date-fns';
import { fr } from 'date-fns/locale';
import { Lock, Target, Plus, Power, ChevronRight, ChevronDown, Split, Eraser, CheckCircle2, Trash2 } from 'lucide-react';
import { costCentersApi, analyticApi, type CostCenter, type AnalyticBalance } from '../../api/cost-centers.api';
import { notify } from '../../components/ui/InlineNotification';
import SearchSelect from '../../components/ui/SearchSelect';
import { apiErrorMessage } from '../../api/errors';
import { StatusBanner } from '../../components/ui/StatusBanner';
import { useAuth } from '../../context/AuthContext';
import EditionButtons from './EditionButtons';
import { currencySymbol } from '../../utils/money';
import { LoadingState, DataPanel, Tabs, Toolbar, SearchBar, EmptyState, ErrorState, SectionHeader, HeaderActions, DateRangeField, Modal, FormSection, FormField, FormFooter } from '../../components/ds';
import { StatusTag } from '../../components/ui/StatusTag';

/**
 * Comptabilité analytique (mig 386 / 428) : axes et sections, ventilation des
 * lignes de charges et de produits (section, clé de répartition), balance
 * analytique rapprochée du CPC, affectation des factures à un centre.
 */

const money = (v: number) => `${v.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const day = (d: string) => format(new Date(d.slice(0, 10) + 'T00:00:00'), 'dd/MM/yyyy', { locale: fr });
const muted = 'var(--ds-muted)';

/** Axe courant + période, partagés par les vues. */
function useAxisAndPeriod() {
  const { data: axes = [] } = useQuery({ queryKey: ['analytic', 'axes'], queryFn: analyticApi.axes });
  const [axisId, setAxisId] = useState('');
  useEffect(() => { if (!axisId && axes.length) setAxisId(axes.find(a => a.code === 'ACT')?.id ?? axes[0].id); }, [axes, axisId]);
  const now = new Date();
  const [from, setFrom] = useState(`${now.getFullYear()}-01-01`);
  const [to, setTo] = useState(now.toISOString().slice(0, 10));
  const controls = (
    <>
      <select value={axisId} onChange={e => setAxisId(e.target.value)} className="ds-input sm" style={{ width: 'auto' }} aria-label="Axe analytique">{axes.filter(a => a.is_active).map(a => <option key={a.id} value={a.id}>{a.code} — {a.name}</option>)}</select>
      <DateRangeField from={from} to={to} onFrom={setFrom} onTo={setTo} />
    </>
  );
  return { axisId, from, to, controls };
}

export default function CostCentersTab() {
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin' || user?.role === 'manager';
  const [view, setView] = useState<'report' | 'ventilation' | 'assign' | 'manage'>('report');
  if (!isAdmin) return <EmptyState icon={Lock} title="Réservé à l'administration" />;
  const tabs: [typeof view, string][] = [['report', 'Résultat'], ['ventilation', 'Ventilation'], ['assign', 'Factures'], ['manage', 'Paramétrage']];
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <Tabs label="Comptabilité analytique" value={view} onChange={setView} tabs={tabs.map(([k, l]) => ({ key: k, label: l }))} />
      {view === 'report' ? <Report /> : view === 'ventilation' ? <Ventilation /> : view === 'assign' ? <Assign /> : <Manage />}
    </div>
  );
}

/* ─── Résultat : balance analytique ─── */
function Report() {
  const { axisId, from, to, controls } = useAxisAndPeriod();
  const [open, setOpen] = useState<string | null>(null);
  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['analytic', 'balance', axisId, from, to],
    queryFn: () => analyticApi.balance({ axisId, from, to }),
    enabled: !!axisId,
  });
  const row = (key: string, title: string, b: AnalyticBalance['unventilated'], muted = false) => (
    <Fragment key={key}>
      <tr onClick={() => setOpen(open === key ? null : key)} style={{ cursor: 'pointer', ...(muted ? { color: 'var(--ds-muted)' } : {}) }}>
        <td className="ds-strong">{open === key ? <ChevronDown size={12} aria-hidden="true" /> : <ChevronRight size={12} aria-hidden="true" />} {title}</td>
        <td className="ds-num" style={{ color: 'var(--ds-success)' }}>{b.produits ? money(b.produits) : '—'}</td>
        <td className="ds-num" style={{ color: 'var(--ds-danger)' }}>{b.charges ? money(b.charges) : '—'}</td>
        <td className="ds-num ds-strong" style={{ color: b.result >= 0 ? 'var(--ds-success)' : 'var(--ds-danger)' }}>{money(b.result)}</td>
      </tr>
      {open === key && b.accounts.map(a => (
        <tr key={`${key}-${a.code}`} style={{ background: 'var(--ds-bg)' }}>
          <td style={{ paddingLeft: 28 }}><span className="ds-ref">{a.code}</span> {a.label}</td>
          <td className="ds-num">{a.produits ? money(a.produits) : ''}</td>
          <td className="ds-num">{a.charges ? money(a.charges) : ''}</td>
          <td />
        </tr>
      ))}
    </Fragment>
  );
  return (
    <>
      <HeaderActions>
        <EditionButtons kind="analytique" params={{ startDate: from, endDate: to, axis: axisId }} disabled={!axisId} />
      </HeaderActions>
      <Toolbar>{controls}</Toolbar>
      {isError ? <ErrorState error={error} onRetry={() => refetch()} /> : isLoading || !data ? <LoadingState /> : (
        <>
          {data.ventilated_rate < 100 && (
            <StatusBanner tone="info" icon={Split} title={`${data.ventilated_rate} % des charges et produits ventilés`}>
              La ligne « Non ventilé » ferme l'écart avec le CPC. Ventilez les lignes restantes dans l'onglet Ventilation, ou affectez un centre aux factures.
            </StatusBanner>
          )}
          <DataPanel label="Balance analytique">
            <table className="odoo-table ds-dense">
              <thead><tr><th>Section</th><th className="ds-num">Produits ({currencySymbol()})</th><th className="ds-num">Charges ({currencySymbol()})</th><th className="ds-num">Résultat ({currencySymbol()})</th></tr></thead>
              <tbody>
                {data.sections.map(s => row(s.id, `${s.code} — ${s.name}`, s))}
                {(data.unventilated.produits !== 0 || data.unventilated.charges !== 0) && row('none', 'Non ventilé', data.unventilated, true)}
              </tbody>
              <tfoot>
                <tr>
                  <td>Total (= CPC)</td>
                  <td className="ds-num">{money(data.totals.produits)}</td>
                  <td className="ds-num">{money(data.totals.charges)}</td>
                  <td className="ds-num">{money(data.totals.result)}</td>
                </tr>
              </tfoot>
            </table>
          </DataPanel>
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
  const { data: lines = [], isLoading, isError, error, refetch } = useQuery({
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
      <Toolbar>
        <SearchBar value={search} onChange={setSearch} placeholder="Compte, libellé, n° d'écriture" label="Rechercher une ligne" />
        {controls}
        <select value={status} onChange={e => setStatus(e.target.value as typeof status)} className="ds-input sm" style={{ width: 'auto' }} aria-label="Lignes"><option value="open">À ventiler</option><option value="done">Ventilées</option><option value="all">Toutes</option></select>
        <select value={accountClass} onChange={e => setAccountClass(e.target.value as typeof accountClass)} className="ds-input sm" style={{ width: 'auto' }} aria-label="Classe de compte"><option value="">Charges et produits</option><option value="6">Charges (6)</option><option value="7">Produits (7)</option></select>
      </Toolbar>
      <div className="ds-bulk" role="status" style={{ borderRadius: 12, border: 0 }}>
        <strong>{selected.size} ligne{selected.size > 1 ? 's' : ''} sélectionnée{selected.size > 1 ? 's' : ''}</strong><span className="ds-num">· {money(selTotal)} {currencySymbol()}</span>
        <span className="ds-grow" />
        <select value={target} onChange={e => setTarget(e.target.value)} className="ds-input sm" style={{ minWidth: 220 }} aria-label="Section ou clé">
          <option value="">Ventiler sur…</option>
          <optgroup label="Section (100 %)">{sections.map(c => <option key={c.id} value={`c:${c.id}`}>{c.code} — {c.name}</option>)}</optgroup>
          {keys.length > 0 && <optgroup label="Clé de répartition">{keys.map(k => <option key={k.id} value={`k:${k.id}`}>{k.name} ({k.lines.map(l => `${l.code} ${Number(l.percent)} %`).join(' / ')})</option>)}</optgroup>}
        </select>
        <button type="button" className="odoo-btn-primary ds-btn-sm" disabled={!selected.size || !target || apply.isPending} onClick={() => apply.mutate()}><Split size={13} /> Ventiler</button>
        {status !== 'open' && <button type="button" className="odoo-btn-secondary ds-btn-sm" disabled={!selected.size || clear.isPending} onClick={() => clear.mutate()}><Eraser size={13} /> Retirer</button>}
      </div>
      {sections.length === 0 && <StatusBanner tone="warning" icon={Target} title="Aucune section sur cet axe">Créez des sections dans l'onglet Paramétrage (ex. Boulangerie, Pâtisserie, Traiteur).</StatusBanner>}
      {isError ? <ErrorState error={error} onRetry={() => refetch()} /> : (
      <DataPanel label="Lignes à ventiler">
        <table className="odoo-table ds-dense">
          <thead><tr>
            <th style={{ width: 30 }}><input type="checkbox" checked={all} onChange={() => setSelected(all ? new Set() : new Set(lines.slice(0, 200).map(l => l.id)))} aria-label="Tout sélectionner" /></th>
            <th>Date</th><th>Écriture</th><th>Compte</th><th>Libellé</th><th className="ds-num">Montant ({currencySymbol()})</th><th>Ventilation</th>
          </tr></thead>
          <tbody>
            {isLoading && <tr><td colSpan={7}><LoadingState bare /></td></tr>}
            {!isLoading && lines.length === 0 && <tr><td colSpan={7}><EmptyState bare icon={Split} title={status === 'open' ? 'Tout est ventilé sur la période.' : 'Aucune ligne.'} /></td></tr>}
            {lines.map(l => {
              const credit = Number(l.credit) > 0;
              return (
                <tr key={l.id} onClick={() => toggle(l.id)} className={selected.has(l.id) ? 'ds-selected' : undefined} style={{ cursor: 'pointer' }}>
                  <td onClick={e => e.stopPropagation()}><input type="checkbox" checked={selected.has(l.id)} onChange={() => toggle(l.id)} aria-label={`Sélectionner ${l.entry_number}`} /></td>
                  <td style={{ whiteSpace: 'nowrap' }}>{day(l.entry_date)}</td>
                  <td className="ds-ref">{l.entry_number}</td>
                  <td><span className="ds-ref">{l.account_code}</span> {l.account_label}</td>
                  <td>{l.label}</td>
                  <td className="ds-num" style={{ color: credit ? 'var(--ds-success)' : undefined }}>{money(amountOf(l))}{credit ? ' C' : ' D'}</td>
                  <td style={{ fontSize: 12 }}>
                    {l.ventilation.map(v => <span key={v.cost_center_id} className={`odoo-tag ${v.source === 'invoice' ? 'odoo-tag-blue' : 'odoo-tag-green'}`} style={{ marginRight: 4 }} title={v.source === 'invoice' ? 'Depuis la facture' : v.source === 'key' ? 'Clé de répartition' : 'Saisie'}>{v.code} {money(Number(v.amount))}</span>)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </DataPanel>
      )}
      {lines.length >= 1000 && <p style={{ fontSize: 12, color: muted }}>1 000 lignes affichées au plus : resserrez la période ou la recherche.</p>}
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
  const { data: invoices = [], isLoading, isError, error, refetch } = useQuery({
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
      <Toolbar>
        <select value={kind} onChange={e => setKind(e.target.value as '' | 'received' | 'emitted')} className="ds-input sm" style={{ width: 'auto' }} aria-label="Type de facture">
          <option value="">Toutes les factures</option>
          <option value="received">Factures fournisseurs (charges)</option>
          <option value="emitted">Factures émises (produits)</option>
        </select>
        <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 13 }}>
          <input type="checkbox" checked={onlyUnassigned} onChange={e => setOnlyUnassigned(e.target.checked)} style={{ accentColor: 'var(--ds-accent)' }} /> Non affectées seulement
        </label>
      </Toolbar>
      {isError ? <ErrorState error={error} onRetry={() => refetch()} /> : (
      <DataPanel label="Factures et centres de coût">
        <table className="odoo-table ds-dense">
          <thead><tr><th>Date</th><th>Facture</th><th>Type</th><th>Tiers</th><th className="ds-num">HT ({currencySymbol()})</th><th>Centre de coût</th></tr></thead>
          <tbody>
            {isLoading && <tr><td colSpan={6}><LoadingState bare /></td></tr>}
            {!isLoading && invoices.length === 0 && <tr><td colSpan={6}><EmptyState bare icon={Target} title="Aucune facture." /></td></tr>}
            {invoices.map(i => (
              <tr key={i.id}>
                <td style={{ whiteSpace: 'nowrap' }}>{day(i.invoice_date)}</td>
                <td className="ds-ref">{i.invoice_number}</td>
                <td><StatusTag tone={i.invoice_type === 'received' ? 'todo' : 'progress'} label={i.invoice_type === 'received' ? 'Charge' : 'Produit'} /></td>
                <td className="ds-strong">{i.party || '—'}</td>
                <td className="ds-num">{money(i.amount)}</td>
                <td>
                  <SearchSelect value={i.cost_center_id != null ? String(i.cost_center_id) : ''} onChange={id => assign.mutate({ invoiceId: i.id, costCenterId: id || null })}
                    placeholder="— Non affecté —" width={190} ariaLabel="Centre de coût"
                    options={activeCenters.map(c => ({ id: String(c.id), label: `${c.axis_code} · ${c.code} — ${c.name}` }))} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </DataPanel>
      )}
    </>
  );
}

/* ─── Paramétrage : axes, sections, clés ─── */
function Manage() {
  const qc = useQueryClient();
  const { data: axes = [] } = useQuery({ queryKey: ['analytic', 'axes'], queryFn: analyticApi.axes });
  const { data: centers = [], isLoading, isError, error, refetch } = useQuery({ queryKey: ['cost-centers', 'list'], queryFn: costCentersApi.list });
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
      <HeaderActions>
        <button type="button" className="odoo-btn-secondary" onClick={() => setForm('axis')}><Plus size={14} aria-hidden="true" /> Nouvel axe</button>
        <button type="button" className="odoo-btn-secondary" onClick={() => setForm('key')} disabled={sections.filter(s => s.is_active).length < 2}><Plus size={14} aria-hidden="true" /> Nouvelle clé</button>
        <button type="button" className="odoo-btn-primary" onClick={() => setForm('section')} disabled={!axisId}><Plus size={14} aria-hidden="true" /> Nouvelle section</button>
      </HeaderActions>
      <Toolbar>
        <select value={axisId} onChange={e => setAxisId(e.target.value)} className="ds-input sm" style={{ width: 'auto' }} aria-label="Axe analytique">{axes.map(a => <option key={a.id} value={a.id}>{a.code} — {a.name}</option>)}</select>
      </Toolbar>
      {isError ? <ErrorState error={error} onRetry={() => refetch()} /> : (
      <DataPanel label="Sections analytiques">
        <table className="odoo-table ds-dense">
          <thead><tr><th>Section</th><th>Nom</th><th className="ds-num">Factures</th><th>État</th><th className="ds-actions"><span className="ds-sr-only">Actions</span></th></tr></thead>
          <tbody>
            {isLoading && <tr><td colSpan={5}><LoadingState bare /></td></tr>}
            {!isLoading && sections.length === 0 && <tr><td colSpan={5}><EmptyState bare icon={Target} title="Aucune section" text="Créez-en (ex. Boulangerie, Pâtisserie, Traiteur)." /></td></tr>}
            {sections.map((c: CostCenter) => (
              <tr key={c.id}>
                <td className="ds-ref">{c.code}</td>
                <td className="ds-strong">{c.name}</td>
                <td className="ds-num">{c.invoices_count}</td>
                <td><StatusTag tone={c.is_active ? 'done' : 'draft'} label={c.is_active ? 'Active' : 'Inactive'} /></td>
                <td className="ds-actions">
                  <button type="button" className="ds-icon-btn" onClick={() => toggle.mutate({ id: c.id, active: !c.is_active })} title={c.is_active ? 'Désactiver' : 'Activer'} aria-label={c.is_active ? 'Désactiver' : 'Activer'}><Power size={12} /></button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </DataPanel>
      )}
      <SectionHeader title="Clés de répartition" note={keys.length ? `${keys.length} clé${keys.length > 1 ? 's' : ''}` : undefined} />
      {keys.length === 0 ? <EmptyState icon={Split} title="Aucune clé de répartition" text="Une clé répartit une charge commune (loyer, électricité) entre plusieurs sections." /> : (
        <DataPanel label="Clés de répartition">
        <table className="odoo-table ds-dense">
          <thead><tr><th>Clé</th><th>Répartition</th><th className="ds-actions"><span className="ds-sr-only">Actions</span></th></tr></thead>
          <tbody>
            {keys.map(k => (
              <tr key={k.id}>
                <td className="ds-strong">{k.name}</td>
                <td>{k.lines.map(l => `${l.code} ${Number(l.percent)} %`).join(' · ')}</td>
                <td className="ds-actions"><button type="button" className="ds-icon-btn" onClick={() => delKey.mutate(k.id)} title="Supprimer la clé" aria-label="Supprimer la clé"><Trash2 size={14} /></button></td>
              </tr>
            ))}
          </tbody>
        </table>
        </DataPanel>
      )}
      {form === 'section' && <SectionForm axisId={axisId} onClose={() => setForm(null)} onSaved={done} />}
      {form === 'axis' && <AxisForm onClose={() => setForm(null)} onSaved={done} />}
      {form === 'key' && <KeyForm axisId={axisId} sections={sections.filter(s => s.is_active)} onClose={() => setForm(null)} onSaved={done} />}
    </>
  );
}

function SectionForm({ axisId, onClose, onSaved }: { axisId: string; onClose: () => void; onSaved: () => void }) {
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const save = useMutation({
    mutationFn: () => costCentersApi.create({ code: code.trim(), name: name.trim(), axisId }),
    onSuccess: () => { notify.success('Section créée'); onSaved(); },
    onError: e => notify.error(apiErrorMessage(e)),
  });
  return (
    <Modal title="Nouvelle section" onClose={onClose} width={480} locked={save.isPending}
      footer={<FormFooter onCancel={onClose} onSubmit={() => save.mutate()} busy={save.isPending} disabled={!code.trim() || !name.trim()} submitLabel="Créer" />}>
      <FormSection title="Section analytique">
        <div className="ds-form-grid" style={{ gridTemplateColumns: '140px minmax(0, 1fr)' }}>
          <FormField label="Code" htmlFor="cc-code" required>
            <input id="cc-code" type="text" value={code} onChange={e => setCode(e.target.value)} placeholder="Ex. BOUL" className="ds-input" />
          </FormField>
          <FormField label="Nom" htmlFor="cc-name" required>
            <input id="cc-name" type="text" value={name} onChange={e => setName(e.target.value)} placeholder="Ex. Boulangerie" className="ds-input" />
          </FormField>
        </div>
      </FormSection>
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
    <Modal title="Nouvel axe analytique" onClose={onClose} width={480} locked={save.isPending}
      footer={<FormFooter onCancel={onClose} onSubmit={() => save.mutate()} busy={save.isPending} disabled={!code.trim() || !name.trim()} submitLabel="Créer" />}>
      <FormSection title="Axe analytique">
        <div className="ds-form-grid" style={{ gridTemplateColumns: '140px minmax(0, 1fr)' }}>
          <FormField label="Code" htmlFor="axis-code" required>
            <input id="axis-code" type="text" value={code} onChange={e => setCode(e.target.value)} placeholder="Ex. MAG" className="ds-input" />
          </FormField>
          <FormField label="Nom" htmlFor="axis-name" required>
            <input id="axis-name" type="text" value={name} onChange={e => setName(e.target.value)} placeholder="Ex. Points de vente" className="ds-input" />
          </FormField>
        </div>
      </FormSection>
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
  const touched = lines.length > 0;
  return (
    <Modal title="Nouvelle clé de répartition" onClose={onClose} width={520} locked={save.isPending}
      footer={<FormFooter onCancel={onClose} onSubmit={() => save.mutate()} busy={save.isPending} disabled={!name.trim() || total !== 100 || lines.length < 2} submitLabel="Créer" />}>
      <FormSection title="Clé">
        <FormField label="Nom" htmlFor="key-name" required>
          <input id="key-name" type="text" value={name} onChange={e => setName(e.target.value)} placeholder="Ex. Loyer" className="ds-input" />
        </FormField>
      </FormSection>
      <FormSection title="Répartition">
        <DataPanel label="Répartition par section">
          <table className="odoo-table ds-dense">
            <thead><tr><th>Section</th><th className="ds-num" style={{ width: 120 }}>Part (%)</th></tr></thead>
            <tbody>
              {sections.map(s => (
                <tr key={s.id}>
                  <td><span className="ds-ref">{s.code}</span> {s.name}</td>
                  <td className="ds-num">
                    <input value={pct[s.id] ?? ''} onChange={e => setPct({ ...pct, [s.id]: e.target.value })} inputMode="decimal" placeholder="0" className="ds-input sm" style={{ width: 90, textAlign: 'right' }} aria-label={`Pourcentage ${s.code}`} />
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr><td>Total</td><td className="ds-num" style={{ color: total === 100 ? 'var(--ds-success)' : 'var(--ds-danger)' }}>{total} %</td></tr>
            </tfoot>
          </table>
        </DataPanel>
        {touched && (total !== 100 || lines.length < 2) && (
          <div className="ds-field error"><span className="ds-field-hint" role="alert">
            {lines.length < 2 ? 'Répartissez sur deux sections au moins.' : `Le total doit faire 100 % (actuellement ${total} %).`}
          </span></div>
        )}
      </FormSection>
    </Modal>
  );
}
