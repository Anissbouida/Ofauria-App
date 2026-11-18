import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Truck, Plus, Search, Loader2, CheckCircle2, XCircle, X, Trash2, Ship, FilePenLine, AlertTriangle } from 'lucide-react';
import PageNote from '../../components/ui/PageNote';
import { format } from 'date-fns';
import {
  landedCostApi, LANDED_STATUS_LABELS, METHOD_LABELS, type AllocationMethod, type ChargeInput, type LandedCostStatus,
} from '../../api/landed-cost.api';
import { expenseCategoriesApi } from '../../api/accounting.api';
import { apiErrorMessage } from '../../api/errors';
import { notify } from '../../components/ui/InlineNotification';
import ModalBackdrop from '../../components/ui/ModalBackdrop';
import SearchSelect from '../../components/ui/SearchSelect';
import { StatusBanner } from '../../components/ui/StatusBanner';
import { StatusTag, type StatusTone } from '../../components/ui/StatusTag';
import { useConfirm } from '../../components/ui/ConfirmDialog';
import { Pager, PAGE_SIZE } from '../../components/purchasing/ProcessBoard';
import { usePurLayout, LayoutSwitch, SplitView, KanbanView, PaneHead, PaneState, pdate, pmoney, KANBAN_ALL } from './PurLayouts';
import { money, currencySymbol } from '../../utils/money';

/**
 * Achats › Frais d'approche (mig 361) : transport, douane, assurance répartis sur les
 * lignes d'une réception, puis appliqués au coût du lot et au coût standard (CMUP).
 */
const n2 = (v: string | number | null | undefined) => Number(v ?? 0).toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const n4 = (v: string | number | null | undefined) => Number(v ?? 0).toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 4 });
const STATUS_TONE: Record<LandedCostStatus, StatusTone> = { draft: 'draft', applied: 'done', cancelled: 'cancelled' };
const label: React.CSSProperties = { fontSize: '0.75rem', fontWeight: 600, color: 'var(--theme-text-muted)', marginBottom: 4, display: 'block' };

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
  const { data, isLoading } = useQuery({ queryKey: ['landed-costs', params], queryFn: () => landedCostApi.list(params) });
  return (
    <>
      <PageNote help="Répartis sur les lignes d'une réception et ajoutés au coût du lot reçu et au coût standard de l'article. La comptabilité n'est pas modifiée : la facture du transporteur reste une charge.">
        Transport, douane, assurance et manutention ajoutés au coût des articles reçus.
      </PageNote>
      <div className="odoo-search-panel" style={{ margin: 0 }}>
        <Search size={14} style={{ color: 'var(--theme-text-muted)' }} />
        <input className="odoo-search-input" value={searchInput} onChange={e => setSearchInput(e.target.value)} placeholder="N°, réception, BC, fournisseur…" />
        <select className="odoo-filter-dropdown" value={status} onChange={e => setStatus(e.target.value as LandedCostStatus | '')}>
          <option value="">Tous statuts</option>
          {Object.entries(LANDED_STATUS_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        {data && <span style={{ fontSize: '0.8125rem', color: 'var(--theme-text-muted)' }}>{money(data.appliedTotal)} appliqués</span>}
        <div style={{ flex: 1 }} />
        <LayoutSwitch value={layout} onChange={setLayout} />
        <button className="odoo-btn-primary" onClick={() => setCreating(true)}><Plus size={14} /> Nouveaux frais</button>
      </div>
      {isLoading ? <Loading /> : !data?.rows.length ? (
        <StatusBanner tone="info" icon={Ship} title="Aucun frais d'approche">Rattachez une facture de transport ou de douane à une réception pour l'intégrer au coût des articles.</StatusBanner>
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
          <Pager page={page} total={data.total} onPage={setPage} note={`${data.total} bon${data.total > 1 ? 's' : ''} de frais`} />
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
          <p className="prj-note">{data.total > data.rows.length ? `${data.rows.length} bons affichés sur ${data.total}` : `${data.total} bon${data.total > 1 ? 's' : ''} de frais`}</p>
        </>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table className="odoo-table">
            <thead><tr><th>N°</th><th>Réception</th><th>Fournisseur</th><th>Répartition</th><th style={{ textAlign: 'right' }}>Montant</th><th>Lignes</th><th>Statut</th><th>Appliqué</th></tr></thead>
            <tbody>{data.rows.map(v => (
              <tr key={v.id} onClick={() => setOpenId(v.id)} style={{ cursor: 'pointer' }}>
                <td className="font-mono" style={{ whiteSpace: 'nowrap' }}>{v.number}</td>
                <td><span className="font-mono">{v.reception_number}</span> <span style={{ color: 'var(--theme-text-muted)', fontSize: '0.75rem' }}>· {format(new Date(v.reception_date), 'dd/MM/yyyy')}{v.order_number ? ` · ${v.order_number}` : ''}</span></td>
                <td>{v.supplier_name || '—'}</td>
                <td>{METHOD_LABELS[v.allocation_method]}</td>
                <td style={{ textAlign: 'right', fontWeight: 600 }}>{n2(v.total_amount)}</td>
                <td style={{ textAlign: 'center' }}>{v.line_count}</td>
                <td><StatusTag tone={STATUS_TONE[v.status] ?? 'draft'} label={LANDED_STATUS_LABELS[v.status]} /></td>
                <td style={{ color: 'var(--theme-text-muted)' }}>{v.applied_at ? `${format(new Date(v.applied_at), 'dd/MM/yyyy')} · ${v.applied_by_name ?? ''}` : '—'}</td>
              </tr>
            ))}</tbody>
          </table>
          <Pager page={page} total={data.total} onPage={setPage} note={`${data.total} bon${data.total > 1 ? 's' : ''} de frais`} />
        </div>
      )}
      {creating && <LandedCostFormModal onClose={() => setCreating(false)} onSaved={id => setOpenId(id)} />}
      {openId && <LandedCostDrawer id={openId} onClose={() => setOpenId(null)} />}
    </>
  );
}

function Loading() { return <div style={{ display: 'flex', justifyContent: 'center', padding: '3rem' }}><Loader2 size={28} className="animate-spin" style={{ color: 'var(--theme-accent)' }} /></div>; }

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
    <ModalBackdrop onClose={onClose} className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="odoo-scope" onClick={e => e.stopPropagation()} style={{ width: '100%', maxWidth: 900, maxHeight: '92vh', overflowY: 'auto', background: 'var(--theme-bg-card)', borderRadius: 10, boxShadow: '0 10px 30px rgba(0,0,0,0.2)' }}>
        <div className="odoo-control-bar" style={{ position: 'sticky', top: 0, zIndex: 1 }}>
          <div className="odoo-breadcrumb"><span className="odoo-breadcrumb-current">Nouveaux frais d'approche</span></div>
          <div style={{ flex: 1 }} />
          <button type="button" onClick={onClose} className="odoo-btn-secondary" aria-label="Fermer"><X size={14} /></button>
        </div>
        <div style={{ padding: '16px 20px', display: 'grid', gap: 14 }}>
          <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 12 }}>
            <div>
              <span style={label}>Réception concernée</span>
              <SearchSelect options={options} value={receptionId} onChange={setReceptionId} placeholder="Choisir un bon de réception" width={520} />
            </div>
            <div>
              <span style={label}>Répartition</span>
              <select className="input" style={{ width: '100%' }} value={method} onChange={e => setMethod(e.target.value as AllocationMethod)}>
                {Object.entries(METHOD_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </div>
          </div>

          <div>
            <span style={label}>Frais</span>
            <table className="odoo-table">
              <thead><tr><th>Libellé</th><th style={{ width: 240 }}>Catégorie de charge</th><th style={{ width: 140, textAlign: 'right' }}>Montant HT ({currencySymbol()})</th><th style={{ width: 40 }} /></tr></thead>
              <tbody>{charges.map(c => (
                <tr key={c.key}>
                  <td><input className="input" style={{ width: '100%' }} value={c.label} onChange={e => upd(c.key, { label: e.target.value })} placeholder="Transport, douane, assurance…" /></td>
                  <td>
                    <SearchSelect value={c.categoryId != null ? String(c.categoryId) : ''} onChange={id => upd(c.key, { categoryId: id || null })}
                      placeholder="—" width="100%" ariaLabel="Catégorie de charge"
                      options={(categories as Record<string, any>[]).filter(x => x.is_active !== false).map(x => ({ id: String(x.id), label: x.name as string }))} />
                  </td>
                  <td><input className="input" type="number" step="0.01" style={{ width: '100%', textAlign: 'right' }} value={c.amount || ''} onChange={e => upd(c.key, { amount: Number(e.target.value) })} /></td>
                  <td>{charges.length > 1 && <button type="button" className="odoo-btn-secondary" onClick={() => setCharges(cs => cs.filter(x => x.key !== c.key))}><Trash2 size={12} /></button>}</td>
                </tr>
              ))}</tbody>
              <tfoot><tr><td colSpan={2}><button type="button" className="odoo-btn-secondary" onClick={() => setCharges(cs => [...cs, { key: Date.now(), label: '', amount: 0, categoryId: null }])}><Plus size={12} /> Ligne de frais</button></td><td style={{ textAlign: 'right', fontWeight: 700 }}>{n2(total)}</td><td /></tr></tfoot>
            </table>
          </div>

          {receptionId && (
            <div>
              <span style={label}>Répartition sur les lignes reçues {isFetching && <Loader2 size={11} className="animate-spin" />}</span>
              {method === 'weight' && weightGaps.length > 0 && (
                <div style={{ marginBottom: '0.5rem' }}>
                  <StatusBanner tone="warning" icon={AlertTriangle} title={`Poids inconnu sur ${weightGaps.length} ligne(s) — elles ne porteront aucun frais`}>
                    {weightGaps.map(l => l.label).join(', ')}. Renseignez la densité (liquides) ou le poids d'une pièce (articles à l'unité) sur ces articles pour les inclure.
                  </StatusBanner>
                </div>
              )}
              {preview.length === 0 ? <p style={{ fontSize: '0.8125rem', color: '#dc3545', margin: 0 }}>Cette réception n'a aucune ligne d'article valorisable.</p> : (
                <table className="odoo-table">
                  <thead><tr><th>Article</th><th>Lot</th><th style={{ textAlign: 'right' }}>Qté</th>{method === 'weight' && <th style={{ textAlign: 'right' }}>Poids</th>}<th style={{ textAlign: 'right' }}>Prix reçu</th><th style={{ textAlign: 'right' }}>Part</th><th style={{ textAlign: 'right' }}>Frais</th><th style={{ textAlign: 'right' }}>+ par unité</th><th style={{ textAlign: 'right' }}>Coût rendu</th></tr></thead>
                  <tbody>{preview.map(l => (
                    <tr key={l.id}>
                      <td>{l.label}</td>
                      <td className="font-mono" style={{ fontSize: '0.75rem' }}>{l.lot_number || '—'}</td>
                      <td style={{ textAlign: 'right' }}>{Number(l.quantity).toLocaleString('fr-FR')} {l.unit ?? ''}</td>
                      {method === 'weight' && <td style={{ textAlign: 'right', color: l.weight_kg == null ? '#dc3545' : undefined }}>{l.weight_kg == null ? 'inconnu' : `${n2(l.weight_kg)} kg`}</td>}
                      <td style={{ textAlign: 'right' }}>{n4(l.unit_price)}</td>
                      <td style={{ textAlign: 'right', color: 'var(--theme-text-muted)' }}>{l.share_pct.toLocaleString('fr-FR', { maximumFractionDigits: 1 })} %</td>
                      <td style={{ textAlign: 'right' }}>{n2(l.amount)}</td>
                      <td style={{ textAlign: 'right', fontWeight: 600 }}>+{n4(l.unit_increment)}</td>
                      <td style={{ textAlign: 'right', fontWeight: 600 }}>{n4(Number(l.unit_price) + l.unit_increment)}</td>
                    </tr>
                  ))}</tbody>
                </table>
              )}
            </div>
          )}
          <div><span style={label}>Notes</span><input className="input" style={{ width: '100%' }} value={notes} onChange={e => setNotes(e.target.value)} placeholder="Référence de la facture du transporteur, n° de déclaration en douane…" /></div>
        </div>
        <div style={{ padding: '12px 20px', borderTop: '1px solid var(--odoo-border)', display: 'flex', justifyContent: 'flex-end', gap: 8, position: 'sticky', bottom: 0, background: 'var(--theme-bg-card)' }}>
          <button className="odoo-btn-secondary" onClick={onClose}>Annuler</button>
          <button className="odoo-btn-primary" disabled={!can} onClick={() => save.mutate()}>{save.isPending && <Loader2 size={13} className="animate-spin" />} Enregistrer en brouillon</button>
        </div>
      </div>
    </ModalBackdrop>
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
          <button className="odoo-btn-primary" disabled={apply.isPending} onClick={async () => {
            if (await confirm(`Appliquer ${money(v.total_amount)} de frais sur ${v.line_count} ligne(s) ? Les coûts des lots et les coûts standard seront augmentés ; l'opération ne se défait pas.`)) apply.mutate();
          }}><CheckCircle2 size={13} /> Appliquer aux coûts</button>
          <button className="odoo-btn-secondary" onClick={async () => { if (await confirm('Annuler ce brouillon ?', { danger: true })) cancel.mutate(); }}><XCircle size={13} /> Annuler</button>
        </>}
        <button type="button" className="odoo-btn-secondary" onClick={onFull}>Fiche complète</button>
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
  const { data: v, isLoading } = useQuery({ queryKey: ['landed-cost', id], queryFn: () => landedCostApi.get(id) });
  const refresh = () => { qc.invalidateQueries({ queryKey: ['landed-cost', id] }); qc.invalidateQueries({ queryKey: ['landed-costs'] }); qc.invalidateQueries({ queryKey: ['ingredients'] }); };
  const apply = useMutation({ mutationFn: () => landedCostApi.apply(id), onSuccess: () => { refresh(); notify.success('Frais appliqués : coûts des lots et coûts standard mis à jour'); }, onError: e => notify.error(apiErrorMessage(e)) });
  const cancel = useMutation({ mutationFn: () => landedCostApi.cancel(id), onSuccess: refresh, onError: e => notify.error(apiErrorMessage(e)) });
  return (
    <ModalBackdrop onClose={onClose} className="fixed inset-0 z-50 flex justify-end bg-black/30">
      <div className="odoo-scope" onClick={e => e.stopPropagation()} style={{ width: 'min(900px, 100%)', height: '100%', overflowY: 'auto', background: 'var(--theme-bg-card)', boxShadow: '-6px 0 24px rgba(0,0,0,0.15)' }}>
        {isLoading || !v ? <Loading /> : (
          <>
            <div className="odoo-control-bar" style={{ position: 'sticky', top: 0, zIndex: 1 }}>
              <div className="odoo-breadcrumb">
                <Truck size={14} style={{ color: 'var(--theme-accent)' }} />
                <span className="font-mono">{v.number}</span>
                <span style={{ marginLeft: 6 }}><StatusTag tone={STATUS_TONE[v.status] ?? 'draft'} label={LANDED_STATUS_LABELS[v.status]} /></span>
              </div>
              <div style={{ flex: 1 }} />
              {v.status === 'draft' && <>
                <button className="odoo-btn-secondary" onClick={async () => { if (await confirm('Annuler ce brouillon ?', { danger: true })) cancel.mutate(); }}><XCircle size={13} /> Annuler</button>
                <button className="odoo-btn-primary" disabled={apply.isPending} onClick={async () => {
                  if (await confirm(`Appliquer ${money(v.total_amount)} de frais sur ${v.line_count} ligne(s) ? Les coûts des lots et les coûts standard seront augmentés ; l'opération ne se défait pas.`)) apply.mutate();
                }}><CheckCircle2 size={13} /> Appliquer aux coûts</button>
              </>}
              <button type="button" className="odoo-btn-secondary" onClick={onClose} aria-label="Fermer"><X size={14} /></button>
            </div>
            <div style={{ padding: '16px 20px', display: 'grid', gap: 14 }}>
              <div style={{ fontSize: '0.8125rem' }}>
                Réception <span className="font-mono">{v.reception_number}</span> du {format(new Date(v.reception_date), 'dd/MM/yyyy')}{v.order_number ? <> · BC <span className="font-mono">{v.order_number}</span></> : null}{v.supplier_name ? ` · ${v.supplier_name}` : ''}
                <span style={{ color: 'var(--theme-text-muted)' }}> · {METHOD_LABELS[v.allocation_method]} · créé par {v.created_by_name || '—'}</span>
                {v.notes && <div style={{ color: 'var(--theme-text-muted)', marginTop: 4 }}>{v.notes}</div>}
              </div>
              {v.status === 'applied' && <StatusBanner tone="success" icon={CheckCircle2} title={`Appliqué le ${format(new Date(v.applied_at!), 'dd/MM/yyyy')} par ${v.applied_by_name ?? '—'}`}>Les coûts ci-dessous sont ceux écrits à l'application.</StatusBanner>}
              <div>
                <div className="odoo-section-header" style={{ border: 'none', paddingLeft: 0 }}><FilePenLine size={12} /> Frais</div>
                <table className="odoo-table">
                  <thead><tr><th>Libellé</th><th>Catégorie</th><th>Fournisseur / facture</th><th style={{ textAlign: 'right' }}>Montant</th></tr></thead>
                  <tbody>{(v.charges ?? []).map(c => (
                    <tr key={c.id}><td>{c.label}</td><td>{c.category_name || '—'}</td><td>{[c.supplier_name, c.invoice_number].filter(Boolean).join(' · ') || '—'}</td><td style={{ textAlign: 'right' }}>{n2(c.amount)}</td></tr>
                  ))}
                  <tr style={{ fontWeight: 700 }}><td colSpan={3}>Total</td><td style={{ textAlign: 'right' }}>{n2(v.total_amount)}</td></tr></tbody>
                </table>
              </div>
              <div>
                <div className="odoo-section-header" style={{ border: 'none', paddingLeft: 0 }}><Ship size={12} /> Répartition</div>
                <table className="odoo-table">
                  <thead><tr><th>Article</th><th>Lot</th><th style={{ textAlign: 'right' }}>Qté</th><th style={{ textAlign: 'right' }}>Part</th><th style={{ textAlign: 'right' }}>Frais</th><th style={{ textAlign: 'right' }}>+ par unité</th><th style={{ textAlign: 'right' }}>Coût du lot</th><th style={{ textAlign: 'right' }}>Coût standard</th></tr></thead>
                  <tbody>{(v.allocations ?? []).map(a => (
                    <tr key={a.id}>
                      <td>{a.label}</td>
                      <td className="font-mono" style={{ fontSize: '0.75rem' }}>{a.lot_number || '—'}</td>
                      <td style={{ textAlign: 'right' }}>{Number(a.quantity).toLocaleString('fr-FR')} {a.unit ?? ''}</td>
                      <td style={{ textAlign: 'right', color: 'var(--theme-text-muted)' }}>{Number(a.share_pct).toLocaleString('fr-FR', { maximumFractionDigits: 1 })} %</td>
                      <td style={{ textAlign: 'right' }}>{n2(a.amount)}</td>
                      <td style={{ textAlign: 'right', fontWeight: 600 }}>+{n4(a.unit_increment)}</td>
                      <td style={{ textAlign: 'right' }}>{v.status === 'applied' && a.lot_cost_after != null ? <>{n4(a.lot_cost_before)} → <strong>{n4(a.lot_cost_after)}</strong></> : a.lot_number ? `${n4(a.current_cost)} → ${n4(Number(a.current_cost) + Number(a.unit_increment))}` : '—'}</td>
                      <td style={{ textAlign: 'right' }}>{v.status === 'applied' && a.standard_cost_after != null ? <>{n4(a.standard_cost_before)} → <strong>{n4(a.standard_cost_after)}</strong></> : <span style={{ color: 'var(--theme-text-muted)' }}>CMUP à l'application</span>}</td>
                    </tr>
                  ))}</tbody>
                </table>
              </div>
              {(v.valuationAdjustments ?? []).length > 0 && (
                <div>
                  <div className="odoo-section-header" style={{ border: 'none', paddingLeft: 0 }}><Ship size={12} /> Réévaluation — part en stock vs écart</div>
                  <StatusBanner tone="info" icon={Ship} title="Traçabilité de la réévaluation">
                    Le coût du lot et le CMUP sont <strong>déjà mis à jour</strong> à l'application des frais. Ce tableau trace la répartition entre la part <strong>capitalisée en stock</strong> (quantité encore en stock) et la part en <strong>écart</strong> (déjà consommée). Compta en inventaire intermittent : pas d'écriture comptable, la charge est déjà au compte de frais.
                  </StatusBanner>
                  <table className="odoo-table">
                    <thead><tr><th>Article</th><th>Lot</th><th style={{ textAlign: 'right' }}>Qté base</th><th style={{ textAlign: 'right' }}>Encore en stock</th><th style={{ textAlign: 'right' }}>+ / unité</th><th style={{ textAlign: 'right' }}>Part en stock</th><th style={{ textAlign: 'right' }}>Part en écart</th></tr></thead>
                    <tbody>{(v.valuationAdjustments ?? []).map(s => (
                      <tr key={s.id}>
                        <td>{s.label || '—'}</td>
                        <td className="font-mono" style={{ fontSize: '0.75rem' }}>{s.lot_number || '—'}</td>
                        <td style={{ textAlign: 'right' }}>{Number(s.qty_basis).toLocaleString('fr-FR')}</td>
                        <td style={{ textAlign: 'right' }}>{Number(s.qty_remaining).toLocaleString('fr-FR')}</td>
                        <td style={{ textAlign: 'right' }}>+{n4(s.unit_delta)}</td>
                        <td style={{ textAlign: 'right', fontWeight: 600, color: '#28a745' }}>{n2(s.amount_to_stock)}</td>
                        <td style={{ textAlign: 'right', color: Number(s.amount_to_variance) > 0 ? '#b85d1a' : 'var(--theme-text-muted)' }}>{n2(s.amount_to_variance)}</td>
                      </tr>
                    ))}</tbody>
                  </table>
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </ModalBackdrop>
  );
}
