import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Loader2, CheckCircle2, XCircle, X, Trash2, Ship, AlertTriangle } from 'lucide-react';
import { format } from 'date-fns';
import {
  landedCostApi, LANDED_STATUS_LABELS, METHOD_LABELS, type AllocationMethod, type ChargeInput, type LandedCostStatus,
} from '../../api/landed-cost.api';
import { expenseCategoriesApi } from '../../api/accounting.api';
import { apiErrorMessage } from '../../api/errors';
import { notify } from '../../components/ui/InlineNotification';
import { RowMenu } from '../../components/ui/RowMenu';
import SearchSelect from '../../components/ui/SearchSelect';
import { StatusBanner } from '../../components/ui/StatusBanner';
import { StatusTag, type StatusTone } from '../../components/ui/StatusTag';
import { useConfirm } from '../../components/ui/ConfirmDialog';
import { PAGE_SIZE } from '../../components/purchasing/ProcessBoard';
import {
  Alert, Toolbar, SearchBar, DataPanel, TableFooter, EmptyState, NoResultState, LoadingState, SectionHeader, ErrorState,
  Modal, Drawer, FormField, FormFooter, FormSection,
} from '../../components/ds';
import { FilterChips } from '../sales/ListTemplate';
import { PurHeaderActions } from './PurHeaderActions';
import { usePurLayout, LayoutSwitch, SplitView, KanbanView, PaneHead, PaneState, pdate, pmoney, KANBAN_ALL } from './PurLayouts';
import { money, currencySymbol } from '../../utils/money';

/**
 * Achats › Frais d'approche (mig 361) : transport, douane, assurance répartis sur les
 * lignes d'une réception, puis appliqués au coût du lot et au coût standard (CMUP).
 */
const n2 = (v: string | number | null | undefined) => Number(v ?? 0).toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const n4 = (v: string | number | null | undefined) => Number(v ?? 0).toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 4 });
const STATUS_TONE: Record<LandedCostStatus, StatusTone> = { draft: 'draft', applied: 'done', cancelled: 'cancelled' };

export default function LandedCostTab() {
  const [status, setStatus] = useState<LandedCostStatus | ''>('');
  const [searchInput, setSearchInput] = useState(''); const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [creating, setCreating] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  // Style Apple (2026-11) : Colonnes / Liste / Kanban.
  const [layout, setLayout] = usePurLayout();
  const [activeId, setActiveId] = useState<string | null>(null);
  useEffect(() => { const t = setTimeout(() => setSearch(searchInput.trim()), 300); return () => clearTimeout(t); }, [searchInput]);
  useEffect(() => { setPage(1); }, [status, search]);
  // Kanban : tous les bons en une page.
  const params: Record<string, string> = layout === 'kanban' ? { page: '1', pageSize: String(KANBAN_ALL) } : { page: String(page), pageSize: String(PAGE_SIZE) };
  if (status) params.status = status; if (search) params.search = search;
  const { data, isLoading, error, refetch } = useQuery({ queryKey: ['landed-costs', params], queryFn: () => landedCostApi.list(params) });
  const hasFilters = !!(status || search);
  const resetFilters = () => { setStatus(''); setSearchInput(''); setSearch(''); };
  const countNote = data ? `${data.total} bon${data.total > 1 ? 's' : ''} de frais · ${money(data.appliedTotal)} appliqués` : '';
  return (
    <>
      <PurHeaderActions>
        <button type="button" className="odoo-btn-primary" onClick={() => setCreating(true)}><Plus size={14} aria-hidden="true" /> Nouveaux frais</button>
      </PurHeaderActions>
      <FilterChips label="Filtrer par statut" value={status} onChange={k => setStatus(k as LandedCostStatus | '')} chips={[
        { key: '', label: 'Tous' },
        ...Object.entries(LANDED_STATUS_LABELS).map(([k, v]) => ({ key: k, label: v })),
      ]} />
      <Toolbar>
        <SearchBar value={searchInput} onChange={setSearchInput} placeholder="N°, réception, BC, fournisseur…" label="Rechercher des frais d'approche" />
        {hasFilters && <button type="button" className="ds-btn-ghost ds-btn-sm" onClick={resetFilters}><X size={13} aria-hidden="true" /> Effacer</button>}
        <LayoutSwitch value={layout} onChange={setLayout} />
      </Toolbar>
      {isLoading ? <LoadingState /> : error && !data ? <ErrorState error={error} onRetry={() => { void refetch(); }} /> : !data?.rows.length ? (
        hasFilters
          ? <NoResultState onReset={resetFilters} text="Aucun bon de frais ne correspond aux filtres." />
          : <EmptyState icon={Ship} title="Aucun frais d'approche"
              text="Rattachez une facture de transport ou de douane à une réception : les frais sont répartis sur les lignes reçues et ajoutés au coût du lot et au coût standard. La comptabilité n'est pas modifiée."
              action={<button type="button" className="odoo-btn-primary ds-btn-sm" onClick={() => setCreating(true)}><Plus size={13} aria-hidden="true" /> Nouveaux frais</button>} />
      ) : layout === 'split' ? (
        <>
          <SplitView items={data.rows} getId={v => v.id} activeId={activeId} onPick={setActiveId} label="Frais d'approche"
            row={v => ({
              title: v.supplier_name || '—', when: pdate(v.reception_date, 'd MMM'),
              l2: <><span className="sal-num">{v.number}</span> · <b>{pmoney(v.total_amount)}</b></>,
              l3: <><StatusTag tone={STATUS_TONE[v.status] ?? 'draft'} label={LANDED_STATUS_LABELS[v.status]} /> {v.reception_number}{v.order_number ? ` · ${v.order_number}` : ''}</>,
              dot: '',
            })}
            pane={v => <LandedCostPane id={v.id} onFull={() => setOpenId(v.id)} />} />
          <TableFooter page={page} pageSize={PAGE_SIZE} total={data.total} onPage={setPage} note={`${money(data.appliedTotal)} appliqués`} />
        </>
      ) : layout === 'kanban' ? (
        <>
          <KanbanView items={data.rows} getId={v => v.id} onOpen={v => setOpenId(v.id)} empty="Aucun bon"
            sum={cards => pmoney(cards.reduce((a, v) => a + Number(v.total_amount || 0), 0))}
            lanes={[
              { key: 'draft', label: 'Brouillons', tone: 'grey', match: v => v.status === 'draft' },
              { key: 'applied', label: 'Appliqués', tone: 'green', match: v => v.status === 'applied' },
              { key: 'cancelled', label: 'Annulés', tone: 'grey', match: v => v.status === 'cancelled' },
            ]}
            card={v => ({ num: v.number, title: v.supplier_name || '—', meta: `${v.reception_number} · ${METHOD_LABELS[v.allocation_method]}`, amount: pmoney(v.total_amount) })} />
          <TableFooter note={data.total > data.rows.length ? `${data.rows.length} bons affichés sur ${data.total}` : countNote} />
        </>
      ) : (
        <DataPanel label="Frais d'approche"
          footer={<TableFooter page={page} pageSize={PAGE_SIZE} total={data.total} onPage={setPage} note={`bons de frais · ${money(data.appliedTotal)} appliqués`} />}>
          <table className="odoo-table">
            <thead><tr>
              <th>N°</th><th>Réception</th><th>Fournisseur</th><th>Répartition</th>
              <th className="ds-num">Lignes</th><th className="ds-num">Montant ({currencySymbol()})</th>
              <th>Statut</th><th>Appliqué</th><th className="ds-actions"><span className="sr-only">Actions</span></th>
            </tr></thead>
            <tbody>{data.rows.map(v => (
              <tr key={v.id} onClick={() => setOpenId(v.id)} style={{ cursor: 'pointer' }}>
                <td className="ds-ref" style={{ whiteSpace: 'nowrap' }}>{v.number}</td>
                <td style={{ whiteSpace: 'nowrap' }}>
                  <span className="ds-ref" style={{ fontWeight: 400 }}>{v.reception_number}</span>
                  <div style={{ color: 'var(--ds-muted)', fontSize: 12 }}>{pdate(v.reception_date)}{v.order_number ? ` · ${v.order_number}` : ''}</div>
                </td>
                <td className="ds-strong">{v.supplier_name || '—'}</td>
                <td>{METHOD_LABELS[v.allocation_method]}</td>
                <td className="ds-num">{v.line_count}</td>
                <td className="ds-num ds-strong">{n2(v.total_amount)}</td>
                <td><StatusTag tone={STATUS_TONE[v.status] ?? 'draft'} label={LANDED_STATUS_LABELS[v.status]} /></td>
                <td style={{ whiteSpace: 'nowrap' }}>{v.applied_at ? <>{pdate(v.applied_at)}{v.applied_by_name ? <div style={{ color: 'var(--ds-muted)', fontSize: 12 }}>{v.applied_by_name}</div> : null}</> : '—'}</td>
                <td className="ds-actions" onClick={e => e.stopPropagation()}>
                  <button type="button" className="odoo-btn-secondary ds-btn-sm" onClick={() => setOpenId(v.id)}>Ouvrir</button>
                </td>
              </tr>
            ))}</tbody>
          </table>
        </DataPanel>
      )}
      {creating && <LandedCostFormModal onClose={() => setCreating(false)} onSaved={id => setOpenId(id)} />}
      {openId && <LandedCostDrawer id={openId} onClose={() => setOpenId(null)} />}
    </>
  );
}

function Loading() { return <LoadingState bare />; }

/* ═══════════════════ Création : réception, frais, aperçu de la répartition ═══════════════════ */
type DraftCharge = ChargeInput & { key: number };

function LandedCostFormModal({ onClose, onSaved }: { onClose: () => void; onSaved?: (id: string) => void }) {
  const qc = useQueryClient();
  const [receptionId, setReceptionId] = useState('');
  const [method, setMethod] = useState<AllocationMethod>('value');
  const [charges, setCharges] = useState<DraftCharge[]>([{ key: 1, label: 'Transport', amount: 0, categoryId: null }]);
  const [notes, setNotes] = useState('');
  const { data: receptions = [] } = useQuery({ queryKey: ['landed-receptions'], queryFn: () => landedCostApi.receptions() });
  const { data: categories = [] } = useQuery({ queryKey: ['expense-categories', 'all'], queryFn: () => expenseCategoriesApi.list(true) });
  const total = useMemo(() => Math.round(charges.reduce((s, c) => s + (Number(c.amount) || 0), 0) * 100) / 100, [charges]);
  const { data: preview = [], isFetching } = useQuery({
    queryKey: ['landed-preview', receptionId, total, method], queryFn: () => landedCostApi.preview(receptionId, total, method), enabled: !!receptionId,
  });
  const weightGaps = method === 'weight' ? preview.filter(l => l.weight_kg == null) : [];
  const options = receptions.map(r => ({ id: r.id, label: `${r.voucher_number} · ${r.supplier_name ?? '—'}`, sublabel: `${format(new Date(r.reception_date), 'dd/MM/yyyy')} · ${r.line_count} ligne(s) · ${money(r.total_value)}${Number(r.landed_applied) > 0 ? ` · frais déjà appliqués ${n2(r.landed_applied)}` : ''}`, detail: r.order_number ?? undefined }));
  const save = useMutation({
    mutationFn: () => landedCostApi.create({ receptionVoucherId: receptionId, method, notes: notes.trim() || null, charges: charges.map(({ key: _k, ...c }) => ({ ...c, amount: Number(c.amount), label: c.label.trim() })) }),
    onSuccess: v => { qc.invalidateQueries({ queryKey: ['landed-costs'] }); notify.success(`Frais ${v.number} enregistrés en brouillon`); onSaved?.(v.id); onClose(); },
    onError: e => notify.error(apiErrorMessage(e)),
  });
  const can = !!receptionId && charges.length > 0 && charges.every(c => c.label.trim() && Number(c.amount)) && total !== 0 && preview.length > 0 && !save.isPending;
  const upd = (key: number, p: Partial<DraftCharge>) => setCharges(cs => cs.map(c => c.key === key ? { ...c, ...p } : c));

  return (
    <Modal title="Nouveaux frais d'approche" width={900} onClose={onClose} locked={save.isPending}
      footer={<FormFooter onCancel={onClose} onSubmit={() => { if (can) save.mutate(); }} busy={save.isPending} disabled={!can} submitLabel="Enregistrer en brouillon" />}>
      <div className="ds-form-grid">
        <FormField label="Réception concernée" required>
          <SearchSelect options={options} value={receptionId} onChange={setReceptionId} placeholder="Choisir un bon de réception" width="100%" ariaLabel="Réception concernée" />
        </FormField>
        <FormField label="Répartition" htmlFor="lc-method" required>
          <select id="lc-method" className="ds-input" value={method} onChange={e => setMethod(e.target.value as AllocationMethod)}>
            {Object.entries(METHOD_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </FormField>
      </div>

      <FormSection title={<>Frais<span className="ds-req" aria-hidden="true"> *</span></>}>
        <DataPanel label="Frais">
          <table className="odoo-table ds-dense">
            <thead><tr><th>Libellé</th><th style={{ width: 240 }}>Catégorie de charge</th><th className="ds-num" style={{ width: 160 }}>Montant HT ({currencySymbol()})</th><th className="ds-actions" style={{ width: 40 }}><span className="sr-only">Actions</span></th></tr></thead>
            <tbody>{charges.map(c => (
              <tr key={c.key}>
                <td><input className="ds-input sm" aria-label="Libellé du frais" aria-invalid={!c.label.trim() || undefined} value={c.label} onChange={e => upd(c.key, { label: e.target.value })} placeholder="Transport, douane, assurance…" /></td>
                <td>
                  <SearchSelect value={c.categoryId != null ? String(c.categoryId) : ''} onChange={id => upd(c.key, { categoryId: id || null })}
                    placeholder="—" width="100%" ariaLabel="Catégorie de charge"
                    options={(categories as Record<string, any>[]).filter(x => x.is_active !== false).map(x => ({ id: String(x.id), label: x.name as string }))} />
                </td>
                <td><input className="ds-input sm ds-num" type="number" step="0.01" aria-label={`Montant HT de ${c.label || 'ce frais'}`} value={c.amount || ''} onChange={e => upd(c.key, { amount: Number(e.target.value) })} /></td>
                <td className="ds-actions">{charges.length > 1 && <button type="button" className="ds-icon-btn" aria-label={`Retirer la ligne de frais ${c.label || ''}`.trim()} onClick={() => setCharges(cs => cs.filter(x => x.key !== c.key))}><Trash2 size={14} /></button>}</td>
              </tr>
            ))}</tbody>
            <tfoot><tr><td colSpan={2}><button type="button" className="odoo-btn-secondary ds-btn-sm" onClick={() => setCharges(cs => [...cs, { key: Date.now(), label: '', amount: 0, categoryId: null }])}><Plus size={12} aria-hidden="true" /> Ligne de frais</button></td><td className="ds-num">{n2(total)}</td><td /></tr></tfoot>
          </table>
        </DataPanel>
        {charges.some(c => !c.label.trim() || !Number(c.amount)) && <span className="ds-field-hint">Chaque ligne de frais demande un libellé et un montant.</span>}
      </FormSection>

      {receptionId && (
        <FormSection title={<>Répartition sur les lignes reçues {isFetching && <Loader2 size={11} className="animate-spin" aria-hidden="true" />}</>}>
          {method === 'weight' && weightGaps.length > 0 && (
            <StatusBanner tone="warning" icon={AlertTriangle} title={`Poids inconnu sur ${weightGaps.length} ligne(s) — elles ne porteront aucun frais`}>
              {weightGaps.map(l => l.label).join(', ')}. Renseignez la densité (liquides) ou le poids d'une pièce (articles à l'unité) sur ces articles pour les inclure.
            </StatusBanner>
          )}
          {preview.length === 0 ? <Alert tone="danger">Cette réception n'a aucune ligne d'article valorisable.</Alert> : (
            <DataPanel label="Répartition sur les lignes reçues">
              <table className="odoo-table ds-dense">
                <thead><tr><th>Article</th><th>Lot</th><th className="ds-num">Qté</th>{method === 'weight' && <th className="ds-num">Poids (kg)</th>}<th className="ds-num">Prix reçu ({currencySymbol()})</th><th className="ds-num">Part (%)</th><th className="ds-num">Frais ({currencySymbol()})</th><th className="ds-num">+ par unité ({currencySymbol()})</th><th className="ds-num">Coût rendu ({currencySymbol()})</th></tr></thead>
                <tbody>{preview.map(l => (
                  <tr key={l.id}>
                    <td className="ds-strong">{l.label}</td>
                    <td className="ds-ref">{l.lot_number || '—'}</td>
                    <td className="ds-num">{Number(l.quantity).toLocaleString('fr-FR')} {l.unit ?? ''}</td>
                    {method === 'weight' && <td className="ds-num" style={{ color: l.weight_kg == null ? 'var(--ds-danger)' : undefined }}>{l.weight_kg == null ? 'inconnu' : n2(l.weight_kg)}</td>}
                    <td className="ds-num">{n4(l.unit_price)}</td>
                    <td className="ds-num" style={{ color: 'var(--ds-muted)' }}>{l.share_pct.toLocaleString('fr-FR', { maximumFractionDigits: 1 })}</td>
                    <td className="ds-num">{n2(l.amount)}</td>
                    <td className="ds-num ds-strong">+{n4(l.unit_increment)}</td>
                    <td className="ds-num ds-strong">{n4(Number(l.unit_price) + l.unit_increment)}</td>
                  </tr>
                ))}</tbody>
              </table>
            </DataPanel>
          )}
        </FormSection>
      )}
      <FormField label="Notes" htmlFor="lc-notes">
        <input id="lc-notes" className="ds-input" value={notes} onChange={e => setNotes(e.target.value)} placeholder="Référence de la facture du transporteur, n° de déclaration en douane…" />
      </FormField>
    </Modal>
  );
}

/* ═══════════════════ Fiche compacte (vue Colonnes) ═══════════════════ */
function LandedCostPane({ id, onFull }: { id: string; onFull: () => void }) {
  const qc = useQueryClient();
  const confirm = useConfirm();
  const { data: v, isLoading } = useQuery({ queryKey: ['landed-cost', id], queryFn: () => landedCostApi.get(id) });
  const refresh = () => { qc.invalidateQueries({ queryKey: ['landed-cost', id] }); qc.invalidateQueries({ queryKey: ['landed-costs'] }); qc.invalidateQueries({ queryKey: ['ingredients'] }); };
  const apply = useMutation({ mutationFn: () => landedCostApi.apply(id), onSuccess: () => { refresh(); notify.success('Frais appliqués : coûts des lots et coûts standard mis à jour'); }, onError: e => notify.error(apiErrorMessage(e)) });
  const cancel = useMutation({ mutationFn: () => landedCostApi.cancel(id), onSuccess: refresh, onError: e => notify.error(apiErrorMessage(e)) });
  if (isLoading || !v) return <section className="ord-pane"><div className="kl-empty">Chargement…</div></section>;
  const applied = v.status === 'applied';
  return (
    <section className="ord-pane" aria-label={`Frais ${v.number}`}>
      <PaneHead name={v.supplier_name || '—'} sub={<><span className="sal-num">{v.number}</span> · réception {v.reception_number}{v.order_number ? ` · ${v.order_number}` : ''}</>}
        amount={pmoney(v.total_amount)} amountSub={`${v.line_count} ligne${Number(v.line_count) > 1 ? 's' : ''} · ${METHOD_LABELS[v.allocation_method]}`} />
      <div className="ord-actions">
        {v.status === 'draft' && <>
          <button type="button" className="odoo-btn-primary" disabled={apply.isPending} onClick={async () => {
            if (await confirm(`Appliquer ${money(v.total_amount)} de frais sur ${v.line_count} ligne(s) ? Les coûts des lots et les coûts standard seront augmentés ; l'opération ne se défait pas.`)) apply.mutate();
          }}><CheckCircle2 size={13} /> Appliquer aux coûts</button>
        </>}
        <button type="button" className="odoo-btn-secondary" onClick={onFull}>Fiche complète</button>
        {v.status === 'draft' && (
          <RowMenu label={`Plus d'actions pour ${v.number}`} items={[
            { label: 'Annuler le brouillon', icon: XCircle, danger: true, disabled: cancel.isPending, onSelect: async () => { if (await confirm('Annuler ce brouillon ?', { danger: true })) cancel.mutate(); } },
          ]} />
        )}
      </div>
      <PaneState title={LANDED_STATUS_LABELS[v.status]} pct={applied ? 100 : v.status === 'draft' ? 45 : 0}
        sub={applied ? `Appliqué le ${pdate(v.applied_at)} par ${v.applied_by_name ?? '—'}` : v.status === 'draft' ? 'À appliquer aux coûts des lots reçus' : 'Brouillon annulé'}
        steps={[
          { label: 'Réception', sub: pdate(v.reception_date), tone: 'done' },
          { label: 'Frais saisis', sub: `créé par ${v.created_by_name || '—'}`, tone: 'done' },
          { label: 'Appliqué', sub: applied ? pdate(v.applied_at) : v.status === 'draft' ? 'à faire' : '—', tone: applied ? 'done' : v.status === 'draft' ? 'current' : '' },
        ]} />
      <section>
        <div className="kl-sec"><h2>Frais</h2><small>{(v.charges ?? []).length}</small></div>
        <div className="kl-group">
          {(v.charges ?? []).map(c => (
            <div key={c.id} className="ord-line">
              <span className="ord-pn">{c.label}<small>{[c.category_name, c.supplier_name, c.invoice_number].filter(Boolean).join(' · ') || '—'}</small></span>
              <span className="ord-pv">{pmoney(c.amount)}</span>
            </div>
          ))}
          <div className="ord-line tot"><span className="ord-pn">Total</span><span className="ord-pv">{pmoney(v.total_amount)}</span></div>
        </div>
      </section>
      <section>
        <div className="kl-sec"><h2>Répartition</h2><small>{(v.allocations ?? []).length} ligne{(v.allocations ?? []).length > 1 ? 's' : ''}</small></div>
        <div className="kl-group">
          {(v.allocations ?? []).map(a => (
            <div key={a.id} className="ord-line">
              <span className="ord-qty">{Number(a.share_pct).toLocaleString('fr-FR', { maximumFractionDigits: 1 })} %</span>
              <span className="ord-pn">{a.label}<small>{Number(a.quantity).toLocaleString('fr-FR')} {a.unit ?? ''}{a.lot_number ? ` · lot ${a.lot_number}` : ''} · +{n4(a.unit_increment)} par unité</small></span>
              <span className="ord-pv">{pmoney(a.amount)}</span>
            </div>
          ))}
        </div>
      </section>
      {v.notes && <section><div className="kl-sec"><h2>Notes</h2></div><div className="kl-group"><div className="ord-kv"><span style={{ whiteSpace: 'pre-line' }}>{v.notes}</span></div></div></section>}
    </section>
  );
}

/* ═══════════════════ Fiche : charges, répartition, application ═══════════════════ */
function LandedCostDrawer({ id, onClose }: { id: string; onClose: () => void }) {
  const qc = useQueryClient();
  const confirm = useConfirm();
  const { data: v, isLoading, error } = useQuery({ queryKey: ['landed-cost', id], queryFn: () => landedCostApi.get(id) });
  const refresh = () => { qc.invalidateQueries({ queryKey: ['landed-cost', id] }); qc.invalidateQueries({ queryKey: ['landed-costs'] }); qc.invalidateQueries({ queryKey: ['ingredients'] }); };
  const apply = useMutation({ mutationFn: () => landedCostApi.apply(id), onSuccess: () => { refresh(); notify.success('Frais appliqués : coûts des lots et coûts standard mis à jour'); }, onError: e => notify.error(apiErrorMessage(e)) });
  const cancel = useMutation({ mutationFn: () => landedCostApi.cancel(id), onSuccess: refresh, onError: e => notify.error(apiErrorMessage(e)) });
  const askApply = async () => {
    if (!v || apply.isPending) return;
    if (await confirm(`Appliquer ${money(v.total_amount)} de frais sur ${v.line_count} ligne(s) ? Les coûts des lots et les coûts standard seront augmentés ; l'opération ne se défait pas.`)) apply.mutate();
  };
  return (
    <Drawer width={900} onClose={onClose}
      title={v ? <span className="ds-ref">{v.number}</span> : 'Frais d\'approche'}
      subtitle={v ? <>Réception {v.reception_number} du {pdate(v.reception_date)}{v.order_number ? ` · BC ${v.order_number}` : ''}{v.supplier_name ? ` · ${v.supplier_name}` : ''}</> : undefined}
      aside={v ? <StatusTag tone={STATUS_TONE[v.status] ?? 'draft'} label={LANDED_STATUS_LABELS[v.status]} /> : undefined}
      footer={v?.status === 'draft' ? (
        <>
          <RowMenu label={`Plus d'actions pour ${v.number}`} items={[
            { label: 'Annuler le brouillon', icon: XCircle, danger: true, disabled: cancel.isPending, onSelect: async () => { if (await confirm('Annuler ce brouillon ?', { danger: true })) cancel.mutate(); } },
          ]} />
          <button type="button" className="odoo-btn-primary" disabled={apply.isPending} aria-busy={apply.isPending || undefined} onClick={() => { void askApply(); }}>
            {apply.isPending ? <Loader2 size={13} className="animate-spin" aria-hidden="true" /> : <CheckCircle2 size={13} aria-hidden="true" />} Appliquer aux coûts
          </button>
        </>
      ) : undefined}>
        {isLoading ? <Loading /> : error || !v ? <ErrorState bare error={error} title="Les frais d'approche n'ont pas pu être chargés" /> : (
          <>
              <p style={{ fontSize: 14, margin: 0, color: 'var(--ds-muted)' }}>
                {METHOD_LABELS[v.allocation_method]} · créé par {v.created_by_name || '—'}
                {v.notes && <span style={{ display: 'block', marginTop: 4 }}>{v.notes}</span>}
              </p>
              {v.status === 'applied' && <StatusBanner tone="success" icon={CheckCircle2} title={`Appliqué le ${pdate(v.applied_at)} par ${v.applied_by_name ?? '—'}`}>Les coûts ci-dessous sont ceux écrits à l'application.</StatusBanner>}
              <section style={{ display: 'grid', gap: 10 }}>
                <SectionHeader title="Frais" />
                <DataPanel label="Frais">
                  <table className="odoo-table ds-dense">
                    <thead><tr><th>Libellé</th><th>Catégorie</th><th>Fournisseur / facture</th><th className="ds-num">Montant ({currencySymbol()})</th></tr></thead>
                    <tbody>{(v.charges ?? []).map(c => (
                      <tr key={c.id}><td className="ds-strong">{c.label}</td><td>{c.category_name || '—'}</td><td>{[c.supplier_name, c.invoice_number].filter(Boolean).join(' · ') || '—'}</td><td className="ds-num">{n2(c.amount)}</td></tr>
                    ))}</tbody>
                    <tfoot><tr><td colSpan={3}>Total</td><td className="ds-num">{n2(v.total_amount)}</td></tr></tfoot>
                  </table>
                </DataPanel>
              </section>
              <section style={{ display: 'grid', gap: 10 }}>
                <SectionHeader title="Répartition" note={METHOD_LABELS[v.allocation_method]} />
                <DataPanel label="Répartition">
                  <table className="odoo-table ds-dense">
                    <thead><tr><th>Article</th><th>Lot</th><th className="ds-num">Qté</th><th className="ds-num">Part (%)</th><th className="ds-num">Frais ({currencySymbol()})</th><th className="ds-num">+ par unité ({currencySymbol()})</th><th className="ds-num">Coût du lot ({currencySymbol()})</th><th className="ds-num">Coût standard ({currencySymbol()})</th></tr></thead>
                    <tbody>{(v.allocations ?? []).map(a => (
                      <tr key={a.id}>
                        <td className="ds-strong">{a.label}</td>
                        <td className="ds-ref">{a.lot_number || '—'}</td>
                        <td className="ds-num">{Number(a.quantity).toLocaleString('fr-FR')} {a.unit ?? ''}</td>
                        <td className="ds-num" style={{ color: 'var(--ds-muted)' }}>{Number(a.share_pct).toLocaleString('fr-FR', { maximumFractionDigits: 1 })}</td>
                        <td className="ds-num">{n2(a.amount)}</td>
                        <td className="ds-num ds-strong">+{n4(a.unit_increment)}</td>
                        <td className="ds-num">{v.status === 'applied' && a.lot_cost_after != null ? <>{n4(a.lot_cost_before)} → <strong>{n4(a.lot_cost_after)}</strong></> : a.lot_number ? `${n4(a.current_cost)} → ${n4(Number(a.current_cost) + Number(a.unit_increment))}` : '—'}</td>
                        <td className="ds-num">{v.status === 'applied' && a.standard_cost_after != null ? <>{n4(a.standard_cost_before)} → <strong>{n4(a.standard_cost_after)}</strong></> : <span style={{ color: 'var(--ds-muted)' }}>CMUP à l'application</span>}</td>
                      </tr>
                    ))}</tbody>
                  </table>
                </DataPanel>
              </section>
              {(v.valuationAdjustments ?? []).length > 0 && (
                <section style={{ display: 'grid', gap: 10 }}>
                  <SectionHeader title="Réévaluation : part en stock et part en écart" />
                  <StatusBanner tone="info" icon={Ship} title="Traçabilité de la réévaluation">
                    Le coût du lot et le CMUP sont <strong>déjà mis à jour</strong> à l'application des frais. Ce tableau trace la répartition entre la part <strong>capitalisée en stock</strong> (quantité encore en stock) et la part en <strong>écart</strong> (déjà consommée). Compta en inventaire intermittent : pas d'écriture comptable, la charge est déjà au compte de frais.
                  </StatusBanner>
                  <DataPanel label="Réévaluation">
                    <table className="odoo-table ds-dense">
                      <thead><tr><th>Article</th><th>Lot</th><th className="ds-num">Qté base</th><th className="ds-num">Encore en stock</th><th className="ds-num">+ / unité ({currencySymbol()})</th><th className="ds-num">Part en stock ({currencySymbol()})</th><th className="ds-num">Part en écart ({currencySymbol()})</th></tr></thead>
                      <tbody>{(v.valuationAdjustments ?? []).map(s => (
                        <tr key={s.id}>
                          <td className="ds-strong">{s.label || '—'}</td>
                          <td className="ds-ref">{s.lot_number || '—'}</td>
                          <td className="ds-num">{Number(s.qty_basis).toLocaleString('fr-FR')}</td>
                          <td className="ds-num">{Number(s.qty_remaining).toLocaleString('fr-FR')}</td>
                          <td className="ds-num">+{n4(s.unit_delta)}</td>
                          <td className="ds-num" style={{ fontWeight: 600, color: 'var(--ds-success)' }}>{n2(s.amount_to_stock)}</td>
                          <td className="ds-num" style={{ color: Number(s.amount_to_variance) > 0 ? 'var(--ds-warning)' : 'var(--ds-muted)' }}>{n2(s.amount_to_variance)}</td>
                        </tr>
                      ))}</tbody>
                    </table>
                  </DataPanel>
                </section>
              )}
          </>
        )}
    </Drawer>
  );
}
