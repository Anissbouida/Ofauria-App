import { Fragment, useEffect, useMemo, useState, type CSSProperties } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  FileQuestion, Send, Plus, XCircle, Trophy, Trash2, X, Inbox, FilePenLine, Clock, Ban, RotateCcw, Award, Filter, ClipboardList,
} from 'lucide-react';
import '../projects/projects.css';
import './purchasing.css';
import { PurHeaderActions } from './PurHeaderActions';
import { format } from 'date-fns';
import { fr } from 'date-fns/locale';
import { rfqApi, RFQ_STATUS_LABELS, type Rfq, type RfqStatus, type RfqItem, type RfqItemInput, type Quotation, type RfqSupplier } from '../../api/rfq.api';
import { ingredientsApi } from '../../api/inventory.api';
import { packagingApi } from '../../api/packaging.api';
import { suppliersApi } from '../../api/accounting.api';
import { apiErrorMessage } from '../../api/errors';
import { currenciesApi, BASE_CURRENCY } from '../../api/currencies.api';
import { notify } from '../../components/ui/InlineNotification';
import ModalBackdrop from '../../components/ui/ModalBackdrop';
import SearchSelect from '../../components/ui/SearchSelect';
import { StatusBanner } from '../../components/ui/StatusBanner';
import { StatusTag, type StatusTone } from '../../components/ui/StatusTag';
import { useConfirm } from '../../components/ui/ConfirmDialog';
import { RowMenu } from '../../components/ui/RowMenu';
import { StagePipeline, SelectFilter, PAGE_SIZE, type StageDef } from '../../components/purchasing/ProcessBoard';
import {
  Alert, DataPanel, EmptyState, FormField, FormFooter, FormSection, KpiCard, KpiGrid, LoadingState, NoResultState,
  SearchBar, SectionHeader, Segmented, TableFooter, Toolbar,
} from '../../components/ds';
import { money, currencySymbol } from '../../utils/money';

/**
 * Achats › Appels d'offres (mig 360) : articles à acheter envoyés à plusieurs
 * fournisseurs, saisie de leurs devis, tableau comparatif, BC créé depuis le devis
 * retenu. Même squelette que les autres listes du module.
 */
const n2 = (v: string | number | null | undefined) => Number(v ?? 0).toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const n4 = (v: string | number | null | undefined) => Number(v ?? 0).toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 4 });
const STATUS_TONE: Record<RfqStatus, StatusTone> = { draft: 'draft', sent: 'progress', quoted: 'todo', awarded: 'done', cancelled: 'cancelled', closed: 'cancelled' };
const RfqStatusTag = ({ status }: { status: RfqStatus }) => (
  <StatusTag tone={STATUS_TONE[status] ?? 'draft'} label={RFQ_STATUS_LABELS[status]} icon={status === 'sent' ? Send : status === 'awarded' ? Trophy : undefined} />
);
const STAGES: Array<StageDef & { key: RfqStatus }> = [
  { key: 'draft', label: 'Brouillons', hint: 'à compléter', icon: FilePenLine },
  { key: 'sent', label: 'Envoyés', hint: 'en attente des devis', icon: Send },
  { key: 'quoted', label: 'Devis reçus', hint: 'à comparer', icon: Inbox },
  { key: 'awarded', label: 'Attribués', hint: 'BC créé', icon: Trophy },
];
/** Date d'affichage du Design System : « 21 nov. 2026 ». */
const day = (d: string | null | undefined) => (d ? format(new Date(d), 'd MMM yyyy', { locale: fr }) : '—');
const muted: CSSProperties = { color: 'var(--ds-muted)' };
const sub: CSSProperties = { fontSize: 12, fontWeight: 400, color: 'var(--ds-muted)' };

// Vue « En cours » (à traiter) vs « Historique » (clôturés), comme les onglets BC et Factures.
const OPEN_STATUSES: RfqStatus[] = ['draft', 'sent', 'quoted'];
const HISTORY_STATUSES: RfqStatus[] = ['awarded', 'cancelled', 'closed'];

export default function RfqTab({ onOpenOrder }: { onOpenOrder?: (purchaseOrderId: string) => void }) {
  const [view, setView] = useState<'open' | 'history'>('open');
  const [status, setStatus] = useState<RfqStatus | ''>('');
  const [searchInput, setSearchInput] = useState(''); const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [openId, setOpenId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  useEffect(() => { const t = setTimeout(() => setSearch(searchInput.trim()), 300); return () => clearTimeout(t); }, [searchInput]);
  useEffect(() => { setPage(1); }, [view, status, search]);
  const params: Record<string, string> = { page: String(page), pageSize: String(PAGE_SIZE), view };
  if (status) params.status = status; if (search) params.search = search;
  const { data, isLoading } = useQuery({ queryKey: ['rfqs', params], queryFn: () => rfqApi.list(params) });
  const by = data?.byStatus ?? {};
  const count = (keys: RfqStatus[]) => keys.reduce((s, k) => s + (by[k]?.count ?? 0), 0);
  const openCount = count(OPEN_STATUSES);
  const historyCount = count(HISTORY_STATUSES);
  const switchView = (v: 'open' | 'history') => { if (v === view) return; setView(v); setStatus(''); };
  // Clic sur une tuile du pipeline : filtre sur ce statut et bascule dans la bonne vue.
  const pickStage = (k: string) => {
    const st = k as RfqStatus;
    const targetView = HISTORY_STATUSES.includes(st) ? 'history' : 'open';
    if (status === st) { setStatus(''); return; }
    setView(targetView); setStatus(st);
  };
  const statusOptions = (view === 'open' ? OPEN_STATUSES : HISTORY_STATUSES).map(k => ({ key: k, label: RFQ_STATUS_LABELS[k] }));
  const overdue = (by.sent?.overdue ?? 0) + (by.quoted?.overdue ?? 0);
  const filtered = !!status || !!searchInput.trim();
  return (
    <>
      <KpiGrid>
        <KpiCard label="En attente de devis" value={by.sent?.count ?? 0} sub="envoyées aux fournisseurs" />
        <KpiCard label="Devis à comparer" value={by.quoted?.count ?? 0} sub="au moins un devis reçu" tone={(by.quoted?.count ?? 0) > 0 ? 'orange' : undefined} />
        <KpiCard label="Date limite dépassée" value={overdue} sub="à relancer ou clôturer" tone={overdue > 0 ? 'red' : undefined} />
        <KpiCard label="Clôturées" value={historyCount} sub="attribuées, annulées ou sans suite" />
      </KpiGrid>
      <PurHeaderActions>
        <button type="button" className="odoo-btn-primary" onClick={() => setCreating(true)}><Plus size={14} aria-hidden="true" /> Nouvelle demande de prix</button>
      </PurHeaderActions>
      <StagePipeline title="Où en sont les demandes de prix" summary={`${(by.sent?.count ?? 0) + (by.quoted?.count ?? 0)} en cours · ${overdue} au-delà de la date limite`}
        stages={STAGES} stats={Object.fromEntries(STAGES.map(s => [s.key, { count: by[s.key]?.count ?? 0, sub: '', late: by[s.key]?.overdue ?? 0, alertLabel: 'en retard' }]))}
        isActive={k => status === k} onPick={pickStage} />
      <Toolbar>
        <SearchBar value={searchInput} onChange={setSearchInput} label="Rechercher une demande de prix" placeholder="N°, objet, fournisseur…" />
        <SelectFilter label="Statut" icon={Filter} value={status} onChange={v => setStatus(v as RfqStatus | '')} options={statusOptions} allLabel="Tous statuts" />
        <Segmented label="Vue des demandes de prix" value={view} onChange={switchView}
          options={[{ key: 'open', label: 'En cours', count: openCount }, { key: 'history', label: 'Historique', count: historyCount }]} />
      </Toolbar>
      {isLoading ? <LoadingState /> : !data?.rows.length ? (
        filtered ? <NoResultState text="Aucune demande de prix ne correspond aux filtres." onReset={() => { setSearchInput(''); setStatus(''); }} />
          : (
            <EmptyState icon={FileQuestion} title={view === 'history' ? 'Aucune demande de prix clôturée' : 'Aucune demande de prix en cours'}
              text={view === 'history'
                ? 'Les demandes de prix attribuées, annulées ou sans suite apparaîtront ici.'
                : 'Demandez des prix à plusieurs fournisseurs sur une même liste d\'articles, puis comparez les devis par notation.'}
              action={view === 'open' ? <button type="button" className="odoo-btn-secondary ds-btn-sm" onClick={() => setCreating(true)}><Plus size={13} aria-hidden="true" /> Nouvelle demande de prix</button> : undefined} />
          )
      ) : (
        <DataPanel label="Demandes de prix"
          footer={<TableFooter page={page} pageSize={PAGE_SIZE} total={data.total} onPage={setPage}
            note={`${data.total} demande${data.total > 1 ? 's' : ''} de prix · ${view === 'history' ? 'historique' : 'en cours'}`} />}>
          <table className="odoo-table">
            <thead><tr><th>N°</th><th>Objet</th><th>Fournisseurs</th><th>Devis</th><th>Date limite</th><th>Statut</th><th className="ds-actions">Action</th></tr></thead>
            <tbody>{data.rows.map(r => (
              <tr key={r.id} onClick={() => setOpenId(r.id)} style={{ cursor: 'pointer' }}>
                <td className="ds-ref" style={{ whiteSpace: 'nowrap' }}>{r.number}</td>
                <td className="ds-strong">{r.title}<div style={sub}>{r.item_count} article{Number(r.item_count) > 1 ? 's' : ''}</div></td>
                <td>
                  {r.supplier_count}
                  {r.awarded_supplier_name && <div style={sub}>retenu : {r.awarded_supplier_name}{r.purchase_order_number ? <> · <span className="ds-ref">{r.purchase_order_number}</span></> : null}</div>}
                </td>
                <td>{r.quotation_count} sur {r.supplier_count}</td>
                <td style={{ whiteSpace: 'nowrap', ...(r.is_overdue ? { color: 'var(--ds-danger)', fontWeight: 600 } : {}) }}>{day(r.response_deadline)}</td>
                <td><RfqStatusTag status={r.status} /></td>
                <td className="ds-actions">
                  <button type="button" className="odoo-btn-secondary ds-btn-sm" onClick={e => { e.stopPropagation(); setOpenId(r.id); }}>Ouvrir</button>
                  <RowMenu label={`Plus d'actions pour ${r.number}`} items={r.purchase_order_id && onOpenOrder
                    ? [{ label: `Ouvrir le bon de commande ${r.purchase_order_number ?? ''}`.trim(), icon: ClipboardList, onSelect: () => onOpenOrder(r.purchase_order_id!) }]
                    : []} />
                </td>
              </tr>
            ))}</tbody>
          </table>
        </DataPanel>
      )}
      {creating && <RfqFormModal onClose={() => setCreating(false)} onSaved={id => setOpenId(id)} />}
      {openId && <RfqDrawer id={openId} onClose={() => setOpenId(null)} onOpenOrder={onOpenOrder} />}
    </>
  );
}

/* ═══════════════════ Création / modification ═══════════════════ */
type DraftItem = RfqItemInput & { key: string; label: string };

function RfqFormModal({ rfq, onClose, onSaved }: { rfq?: Rfq | null; onClose: () => void; onSaved?: (id: string) => void }) {
  const qc = useQueryClient();
  const [title, setTitle] = useState(rfq?.title ?? '');
  const [neededBy, setNeededBy] = useState(rfq?.needed_by?.slice(0, 10) ?? '');
  const [deadline, setDeadline] = useState(rfq?.response_deadline?.slice(0, 10) ?? '');
  const [notes, setNotes] = useState(rfq?.notes ?? '');
  const [items, setItems] = useState<DraftItem[]>(() => (rfq?.items ?? []).map(i => ({
    key: i.id, label: i.label, lineType: i.line_type, ingredientId: i.ingredient_id, packagingId: i.packaging_id, description: i.description,
    categoryId: i.category_id, unit: i.unit, quantity: Number(i.quantity),
  })));
  const [supplierIds, setSupplierIds] = useState<string[]>(() => (rfq?.suppliers ?? []).map(s => s.supplier_id));
  const [pick, setPick] = useState('');
  const [freeLabel, setFreeLabel] = useState('');
  const { data: ingredients = [] } = useQuery({ queryKey: ['ingredients'], queryFn: ingredientsApi.list });
  const { data: packaging = [] } = useQuery({ queryKey: ['packaging-items', 'rfq'], queryFn: () => packagingApi.list({ activeOnly: true }) });
  const { data: suppliers = [] } = useQuery({ queryKey: ['suppliers', 'active'], queryFn: suppliersApi.listActive });
  const options = useMemo(() => [
    ...(ingredients as Record<string, any>[]).map(i => ({ id: `ing:${i.id}`, label: i.name, sublabel: `Ingrédient · ${i.unit ?? ''}` })),
    ...(packaging as Record<string, any>[]).map(p => ({ id: `pk:${p.id}`, label: p.name, sublabel: `Consommable · ${p.unit ?? ''}` })),
  ], [ingredients, packaging]);
  const locked = !!rfq && rfq.status !== 'draft';

  const addItem = (id: string) => {
    if (!id || items.some(i => i.key === id)) { setPick(''); return; }
    const [kind, real] = id.split(':');
    const src = kind === 'ing' ? (ingredients as Record<string, any>[]).find(i => i.id === real) : (packaging as Record<string, any>[]).find(p => p.id === real);
    setItems(s => [...s, { key: id, label: src?.name ?? '', lineType: kind === 'ing' ? 'ingredient' : 'consumable', ingredientId: kind === 'ing' ? real : null, packagingId: kind === 'pk' ? real : null, unit: src?.unit ?? null, quantity: 1 }]);
    setPick('');
  };
  const addFree = () => {
    if (!freeLabel.trim()) return;
    setItems(s => [...s, { key: `free:${Date.now()}`, label: freeLabel.trim(), lineType: 'service', description: freeLabel.trim(), quantity: 1 }]);
    setFreeLabel('');
  };
  const save = useMutation({
    mutationFn: () => {
      const body = { title: title.trim(), neededBy: neededBy || null, responseDeadline: deadline || null, notes: notes.trim() || null,
        items: items.map(({ key: _k, label: _l, ...i }) => i), supplierIds };
      return rfq ? rfqApi.update(rfq.id, body) : rfqApi.create(body);
    },
    onSuccess: r => { qc.invalidateQueries({ queryKey: ['rfqs'] }); qc.invalidateQueries({ queryKey: ['rfq', r.id] }); notify.success(rfq ? 'Demande de prix enregistrée' : `Demande de prix ${r.number} créée`); onSaved?.(r.id); onClose(); },
    onError: e => notify.error(apiErrorMessage(e)),
  });
  const can = title.trim().length > 0 && items.length > 0 && items.every(i => i.quantity > 0) && !save.isPending;
  const [titleTouched, setTitleTouched] = useState(false);

  return (
    <ModalBackdrop onClose={onClose} className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="odoo-scope" onClick={e => e.stopPropagation()} style={{ width: '100%', maxWidth: 820, maxHeight: '92vh', overflowY: 'auto', background: 'var(--theme-bg-card)', borderRadius: 10, boxShadow: '0 10px 30px rgba(0,0,0,0.2)' }}>
        <div className="odoo-control-bar" style={{ position: 'sticky', top: 0, zIndex: 1 }}>
          <div className="odoo-breadcrumb"><span className="odoo-breadcrumb-current">{rfq ? `Modifier ${rfq.number}` : 'Nouvelle demande de prix'}</span></div>
          <div style={{ flex: 1 }} />
          <button type="button" onClick={onClose} className="ds-icon-btn" aria-label="Fermer"><X size={16} /></button>
        </div>
        <div style={{ padding: '16px 24px', display: 'grid', gap: 20 }}>
          <FormSection title="Demande">
            <FormField label="Objet" htmlFor="rfq-title" required error={titleTouched && !title.trim() ? 'Indiquez l\'objet de la demande de prix.' : undefined}>
              <input id="rfq-title" className="ds-input" value={title} maxLength={200} aria-required="true" onChange={e => setTitle(e.target.value)} onBlur={() => setTitleTouched(true)}
                placeholder="Ex. : Farine et beurre novembre, Four à sole neuf…" autoFocus />
            </FormField>
            <div className="ds-form-grid">
              <FormField label="Réponse avant le" htmlFor="rfq-deadline">
                <input id="rfq-deadline" className="ds-input" type="date" value={deadline} onChange={e => setDeadline(e.target.value)} />
              </FormField>
              <FormField label="Besoin pour le" htmlFor="rfq-needed">
                <input id="rfq-needed" className="ds-input" type="date" value={neededBy} onChange={e => setNeededBy(e.target.value)} />
              </FormField>
            </div>
          </FormSection>

          <FormSection title={<>Articles demandés<span className="ds-req" aria-hidden="true"> *</span></>}>
            {!locked && (
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                <SearchSelect options={options} value={pick} onChange={addItem} placeholder="Ajouter un ingrédient ou un consommable" width={360} ariaLabel="Ajouter un ingrédient ou un consommable" />
                <span style={{ ...muted, fontSize: 13 }}>ou</span>
                <input className="ds-input sm" aria-label="Service ou matériel (désignation libre)" value={freeLabel} onChange={e => setFreeLabel(e.target.value)} placeholder="Service / matériel (désignation libre)" style={{ width: 260 }} onKeyDown={e => { if (e.key === 'Enter') addFree(); }} />
                <button type="button" className="odoo-btn-secondary ds-btn-sm" onClick={addFree} disabled={!freeLabel.trim()}><Plus size={13} aria-hidden="true" /> Ajouter</button>
              </div>
            )}
            {items.length === 0 ? <span className="ds-field-hint">Aucun article : ajoutez-en au moins un pour enregistrer la demande.</span> : (
              <table className="odoo-table">
                <thead><tr><th>Article</th><th style={{ width: 130 }}>Quantité</th><th style={{ width: 120 }}>Unité</th><th style={{ width: 48 }} /></tr></thead>
                <tbody>{items.map((it, idx) => (
                  <tr key={it.key}>
                    <td className="ds-strong">{it.label}{it.lineType === 'service' && <span className="odoo-tag odoo-tag-grey" style={{ marginLeft: 6 }}>libre</span>}</td>
                    <td><input className="ds-input sm" type="number" min="0.001" step="any" aria-label={`Quantité de ${it.label}`} aria-invalid={!(it.quantity > 0) || undefined} value={it.quantity} disabled={locked} onChange={e => setItems(s => s.map((x, i) => i === idx ? { ...x, quantity: Number(e.target.value) } : x))} /></td>
                    <td><input className="ds-input sm" aria-label={`Unité de ${it.label}`} value={it.unit ?? ''} disabled={locked} onChange={e => setItems(s => s.map((x, i) => i === idx ? { ...x, unit: e.target.value } : x))} placeholder="kg, unité…" /></td>
                    <td className="ds-actions">{!locked && <button type="button" className="ds-icon-btn" aria-label={`Retirer ${it.label}`} onClick={() => setItems(s => s.filter((_, i) => i !== idx))}><Trash2 size={14} /></button>}</td>
                  </tr>
                ))}</tbody>
              </table>
            )}
            {items.some(i => !(i.quantity > 0)) && <span className="ds-field-hint" role="alert" style={{ color: 'var(--ds-danger)', fontWeight: 600 }}>Chaque quantité doit être supérieure à zéro.</span>}
          </FormSection>

          <FormSection title="Fournisseurs consultés">
            <div className="prj-chips" role="group" aria-label="Fournisseurs consultés">
              {(suppliers as Record<string, any>[]).map(s => {
                const on = supplierIds.includes(s.id);
                return (
                  <button key={s.id} type="button" aria-pressed={on} className={`prj-chip${on ? ' active' : ''}`}
                    onClick={() => setSupplierIds(ids => on ? ids.filter(x => x !== s.id) : [...ids, s.id])}>
                    {s.name}
                  </button>
                );
              })}
            </div>
            <FormField label="Précisions pour les fournisseurs" htmlFor="rfq-notes">
              <textarea id="rfq-notes" className="ds-input" value={notes} onChange={e => setNotes(e.target.value)} placeholder="Qualité attendue, conditions de livraison, lieu…" />
            </FormField>
          </FormSection>
        </div>
        <div style={{ position: 'sticky', bottom: 0, background: 'var(--ds-card)' }}>
          <FormFooter onCancel={onClose} submitLabel="Enregistrer" busy={save.isPending} disabled={!can} onSubmit={() => save.mutate()} />
        </div>
      </div>
    </ModalBackdrop>
  );
}

/* ═══════════════════ Fiche : fournisseurs, devis, comparatif ═══════════════════ */
function RfqDrawer({ id, onClose, onOpenOrder }: { id: string; onClose: () => void; onOpenOrder?: (poId: string) => void }) {
  const qc = useQueryClient();
  const confirm = useConfirm();
  const { data: r, isLoading } = useQuery({ queryKey: ['rfq', id], queryFn: () => rfqApi.get(id) });
  const [editing, setEditing] = useState(false);
  const [quoting, setQuoting] = useState<RfqSupplier | null>(null);
  // Devis choisi dans le comparatif avant l'attribution (par défaut : le devis recommandé).
  const [chosen, setChosen] = useState<string | null>(null);
  const refresh = () => { qc.invalidateQueries({ queryKey: ['rfq', id] }); qc.invalidateQueries({ queryKey: ['rfqs'] }); };
  const send = useMutation({ mutationFn: () => rfqApi.send(id), onSuccess: (data) => { refresh(); const n = data?.emailsQueued ?? 0; notify.success(n > 0 ? `Demande de prix envoyée — ${n} e-mail(s) fournisseur mis en file` : 'Demande de prix envoyée : aucun fournisseur avec e-mail, saisissez les devis au fur et à mesure'); }, onError: e => notify.error(apiErrorMessage(e)) });
  const setStatus = useMutation({ mutationFn: (s: 'cancelled' | 'closed' | 'draft') => rfqApi.setStatus(id, s), onSuccess: refresh, onError: e => notify.error(apiErrorMessage(e)) });
  const supplierStatus = useMutation({ mutationFn: (p: { supplierId: string; status: 'invited' | 'declined' | 'no_response' }) => rfqApi.setSupplierStatus(id, p.supplierId, p.status), onSuccess: refresh, onError: e => notify.error(apiErrorMessage(e)) });
  const award = useMutation({
    mutationFn: (quotationId: string) => rfqApi.award(id, quotationId),
    onSuccess: ({ purchaseOrder }) => { refresh(); qc.invalidateQueries({ queryKey: ['purchase-orders'] }); notify.success(`Bon de commande ${purchaseOrder.order_number} créé`); },
    onError: e => notify.error(apiErrorMessage(e)),
  });

  if (isLoading || !r) return <ModalBackdrop onClose={onClose} className="fixed inset-0 z-50 flex justify-end bg-black/30"><div className="odoo-scope" style={{ width: 'min(960px, 100%)', height: '100%', background: 'var(--theme-bg-card)' }}><LoadingState bare /></div></ModalBackdrop>;
  const items = r.items ?? []; const quotes = r.quotations ?? []; const suppliers = r.suppliers ?? [];
  const open = ['sent', 'quoted'].includes(r.status);
  const cs = currencySymbol();
  // Colonne mise en avant dans le comparatif : le devis choisi (demande ouverte) ou le devis retenu (demande attribuée).
  const retainedId = open
    ? (chosen && quotes.some(q => q.id === chosen) ? chosen : r.recommended_quotation_id ?? null)
    : (r.awarded_quotation_id ?? quotes.find(q => q.status === 'selected')?.id ?? null);
  const retained = quotes.find(q => q.id === retainedId);
  const tint = (q: Quotation): CSSProperties | undefined => (q.id === retainedId ? { background: 'var(--ds-tint)' } : undefined);
  const criteria = r.criteria ?? [];
  const totalWeight = criteria.reduce((t, x) => t + Number(x.weight || 0), 0) || 1;

  return (
    <ModalBackdrop onClose={onClose} className="fixed inset-0 z-50 flex justify-end bg-black/30">
      <div className="odoo-scope" onClick={e => e.stopPropagation()} style={{ width: 'min(960px, 100%)', height: '100%', overflowY: 'auto', background: 'var(--theme-bg-card)', boxShadow: '-6px 0 24px rgba(0,0,0,0.15)' }}>
        <div className="odoo-control-bar" style={{ position: 'sticky', top: 0, zIndex: 2 }}>
          <div className="odoo-breadcrumb">
            <FileQuestion size={14} style={{ color: 'var(--ds-accent)' }} aria-hidden="true" />
            <span className="ds-ref">{r.number}</span>
          </div>
          <div style={{ flex: 1 }} />
          {r.status === 'draft' && <>
            <button type="button" className="odoo-btn-secondary" onClick={() => setEditing(true)}><FilePenLine size={13} aria-hidden="true" /> Modifier</button>
            <button type="button" className="odoo-btn-primary" onClick={() => send.mutate()} disabled={send.isPending}><Send size={13} aria-hidden="true" /> Envoyer aux fournisseurs</button>
          </>}
          {open && <button type="button" className="odoo-btn-secondary" onClick={() => setEditing(true)}><FilePenLine size={13} aria-hidden="true" /> Fournisseurs / dates</button>}
          {open && <button type="button" className="odoo-btn-secondary" onClick={async () => { if (await confirm('Clore sans retenir de devis ?')) setStatus.mutate('closed'); }}><Ban size={13} aria-hidden="true" /> Sans suite</button>}
          {['draft', 'sent', 'quoted'].includes(r.status) && <button type="button" className="odoo-btn-secondary" onClick={async () => { if (await confirm('Annuler cet appel d\'offres ?', { danger: true })) setStatus.mutate('cancelled'); }}><XCircle size={13} aria-hidden="true" /> Annuler</button>}
          {['cancelled', 'closed'].includes(r.status) && <button type="button" className="odoo-btn-secondary" onClick={() => setStatus.mutate('draft')}><RotateCcw size={13} aria-hidden="true" /> Rouvrir</button>}
          <button type="button" className="ds-icon-btn" onClick={onClose} aria-label="Fermer"><X size={16} /></button>
        </div>

        <div style={{ padding: '16px 24px', display: 'grid', gap: 20 }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
              <h2 style={{ margin: 0, fontSize: 22, fontWeight: 700, letterSpacing: '-.02em', color: 'var(--ds-ink)' }}>{r.title}</h2>
              <RfqStatusTag status={r.status} />
            </div>
            <div style={{ ...muted, fontSize: 14, marginTop: 4 }}>
              {r.response_deadline ? `Réponse avant le ${day(r.response_deadline)}` : 'Pas de date limite'}{r.needed_by ? ` · besoin pour le ${day(r.needed_by)}` : ''}
              {r.sent_at ? ` · envoyé le ${day(r.sent_at)}` : ''} · créé par {r.created_by_name || '—'}
            </div>
            {r.notes && <p style={{ margin: '6px 0 0', fontSize: 14, whiteSpace: 'pre-wrap' }}>{r.notes}</p>}
          </div>
          {r.is_overdue && <Alert tone="warning" icon={Clock}>Date limite de réponse dépassée : relancez les fournisseurs sans réponse, ou comparez avec les devis reçus.</Alert>}
          {r.status === 'awarded' && (
            <StatusBanner tone="success" icon={Trophy} title={`Devis retenu : ${r.awarded_supplier_name}`}
              actions={r.purchase_order_id && onOpenOrder ? <button type="button" className="odoo-btn-primary" onClick={() => onOpenOrder(r.purchase_order_id!)}>Ouvrir le BC {r.purchase_order_number}</button> : undefined}>
              Le bon de commande {r.purchase_order_number} a été créé depuis ce devis{r.awarded_at ? ` le ${day(r.awarded_at)}` : ''}.
            </StatusBanner>
          )}

          {/* Fournisseurs consultés : une ligne par fournisseur, avec l'en-tête de son devis. */}
          <section style={{ display: 'grid', gap: 12 }}>
            <SectionHeader title="Fournisseurs consultés" note={`${quotes.length} devis reçu${quotes.length > 1 ? 's' : ''} sur ${suppliers.length}`} />
            {suppliers.length === 0 ? <EmptyState bare icon={Inbox} title="Aucun fournisseur consulté" text="Modifiez la demande de prix pour en ajouter." /> : (
              <DataPanel label="Fournisseurs consultés">
                <table className="odoo-table">
                  <thead><tr>
                    <th>Fournisseur</th><th>Contact</th><th>Réponse</th><th>Reçu le</th><th>Référence du devis</th><th>Valable jusqu'au</th>
                    <th>Conditions de paiement</th><th className="ds-num">Total HT ({cs})</th><th className="ds-actions">Action</th>
                  </tr></thead>
                  <tbody>{suppliers.map(s => {
                    const q = quotes.find(x => x.supplier_id === s.supplier_id);
                    return (
                      <tr key={s.id}>
                        <td className="ds-strong">{s.supplier_name}</td>
                        <td style={muted}>{[s.contact_name, s.phone, s.email].filter(Boolean).join(' · ') || '—'}</td>
                        <td>
                          {s.status === 'quoted' ? <StatusTag tone="done" label="Devis reçu" />
                            : s.status === 'declined' ? <StatusTag tone="cancelled" label="A décliné" />
                            : s.status === 'no_response' ? <StatusTag tone="blocked" label="Sans réponse" />
                            : r.status === 'draft' ? <StatusTag tone="todo" label="À consulter" />
                            : <StatusTag tone="progress" label="En attente" icon={Send} />}
                        </td>
                        <td style={{ whiteSpace: 'nowrap' }}>{day(q?.received_at)}</td>
                        <td>{q?.quotation_ref ? <span className="ds-ref">{q.quotation_ref}</span> : '—'}</td>
                        <td style={{ whiteSpace: 'nowrap' }}>{day(q?.valid_until)}</td>
                        <td>{q?.payment_terms || '—'}</td>
                        <td className="ds-num">{q ? n2(q.total_ht) : '—'}</td>
                        <td className="ds-actions">
                          {open && <>
                            <button type="button" className="odoo-btn-secondary ds-btn-sm" onClick={() => setQuoting(s)}>{s.quotation_id ? 'Modifier le devis' : 'Saisir le devis'}</button>
                            <RowMenu label={`Plus d'actions pour ${s.supplier_name}`} items={s.status !== 'quoted' ? [{
                              label: s.status === 'declined' ? 'Rétablir' : 'A décliné', icon: s.status === 'declined' ? RotateCcw : Ban, disabled: supplierStatus.isPending,
                              onSelect: () => supplierStatus.mutate({ supplierId: s.supplier_id, status: s.status === 'declined' ? 'invited' : 'declined' }),
                            }] : []} />
                          </>}
                        </td>
                      </tr>
                    );
                  })}</tbody>
                </table>
              </DataPanel>
            )}
          </section>

          {/* Tableau comparatif : une ligne par article, deux colonnes (prix unitaire, total) par devis ; notation (mig 459) en pied. */}
          <section style={{ display: 'grid', gap: 12 }}>
            <SectionHeader title="Tableau comparatif" note={quotes.length ? 'le meilleur prix de chaque ligne en vert' : 'aucun devis saisi'} />
            <DataPanel label="Tableau comparatif">
              <table className="odoo-table">
                <thead>
                  <tr>
                    <th rowSpan={quotes.length ? 2 : 1}>Article</th>
                    <th rowSpan={quotes.length ? 2 : 1} className="ds-num">Qté demandée</th>
                    <th rowSpan={quotes.length ? 2 : 1} className="ds-num">Dernier prix payé ({cs})</th>
                    {quotes.map(q => (
                      <th key={q.id} colSpan={2} style={{ ...tint(q), textAlign: 'right' }}>
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                          <span className="ds-strong" style={{ fontSize: 14 }}>{q.supplier_name}</span>
                          {q.status === 'selected' && <StatusTag tone="done" label="Retenu" icon={Trophy} />}
                          {q.status !== 'selected' && q.id === r.recommended_quotation_id && <StatusTag tone="progress" label="Recommandé" icon={Award} />}
                          {q.id === r.best_total_quotation_id && <StatusTag tone="done" label="Moins cher" />}
                        </span>
                      </th>
                    ))}
                  </tr>
                  {quotes.length > 0 && (
                    <tr>
                      {quotes.map(q => (
                        <Fragment key={q.id}>
                          <th className="ds-num" style={tint(q)}>Prix unitaire ({cs})</th>
                          <th className="ds-num" style={tint(q)}>Total ({cs})</th>
                        </Fragment>
                      ))}
                    </tr>
                  )}
                </thead>
                <tbody>
                  {items.map(it => (
                    <tr key={it.id}>
                      <td className="ds-strong">{it.label}</td>
                      <td className="ds-num" style={{ whiteSpace: 'nowrap' }}>{Number(it.quantity).toLocaleString('fr-FR')} {it.unit_label ?? ''}</td>
                      <td className="ds-num" style={muted}>{it.last_price ? n4(it.last_price) : '—'}</td>
                      {quotes.map(q => {
                        const l = q.lines.find(x => x.rfq_item_id === it.id);
                        const priced = !!l && l.available && l.unit_price != null;
                        const best = r.best_by_item?.[it.id]?.quotationId === q.id;
                        const qty = l?.quantity != null && l.quantity !== '' ? Number(l.quantity) : Number(it.quantity);
                        return (
                          <Fragment key={q.id}>
                            <td className="ds-num" style={{ ...tint(q), ...(best ? { color: 'var(--ds-success)', fontWeight: 700 } : {}) }}>
                              {priced ? n4(l!.unit_price) : <span style={muted}>—</span>}
                              {l?.note && <div style={sub}>{l.note}</div>}
                            </td>
                            <td className="ds-num" style={tint(q)}>{priced ? n2(Number(l!.unit_price) * qty) : <span style={muted}>—</span>}</td>
                          </Fragment>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
                {quotes.length > 0 && (
                  <tfoot>
                    <tr>
                      <td colSpan={3} className="ds-strong">Total HT ({cs})<div style={sub}>remise et port compris</div></td>
                      {quotes.map(q => (
                        <td key={q.id} colSpan={2} className="ds-num" style={{ ...tint(q), fontWeight: 700 }}>
                          {n2(q.total_ht)}
                          {q.total_foreign && <div style={sub}>{n2(q.total_foreign)} {String(q.currency_code).trim()}</div>}
                          {!q.complete && <div style={{ ...sub, color: 'var(--ds-warning)', fontWeight: 600 }}>{q.covered} sur {items.length} lignes chiffrées</div>}
                        </td>
                      ))}
                    </tr>
                    <tr>
                      <td colSpan={3} className="ds-strong">Délai</td>
                      {quotes.map(q => <td key={q.id} colSpan={2} className="ds-num" style={{ ...tint(q), fontWeight: 400 }}>{q.delivery_days != null ? `Livré en ${q.delivery_days} j` : 'Délai non précisé'}</td>)}
                    </tr>
                    <tr>
                      <td colSpan={3} className="ds-strong">Conditions<div style={sub}>validité · paiement · port · remise</div></td>
                      {quotes.map(q => (
                        <td key={q.id} colSpan={2} className="ds-num" style={{ ...tint(q), fontWeight: 400 }}>
                          {[q.valid_until ? `valable jusqu'au ${day(q.valid_until)}` : null, q.payment_terms || null,
                            Number(q.shipping_cost) > 0 ? `port ${n2(q.shipping_cost)}` : 'franco', Number(q.discount_pct) > 0 ? `remise ${q.discount_pct} %` : null].filter(Boolean).join(' · ')}
                        </td>
                      ))}
                    </tr>
                    {criteria.map(c => (
                      <tr key={c.code}>
                        <td colSpan={3} style={{ fontWeight: 400 }}>{c.label}<div style={sub}>critère · {Math.round(Number(c.weight) / totalWeight * 100)} % · {c.type === 'manual' ? 'noté à la main' : 'calculé'}</div></td>
                        {quotes.map(q => {
                          const v = q.scores?.[c.code];
                          const unrated = c.type === 'manual' && q.criteria_scores?.[c.code] == null;
                          return <td key={q.id} colSpan={2} className="ds-num" style={{ ...tint(q), fontWeight: 400 }} title={unrated ? 'non noté' : undefined}>{v ?? '—'}{unrated ? ' *' : ''}</td>;
                        })}
                      </tr>
                    ))}
                    <tr>
                      <td colSpan={3} className="ds-strong">Note (sur 100)</td>
                      {quotes.map(q => <td key={q.id} colSpan={2} className="ds-num" style={{ ...tint(q), fontWeight: 700 }}>{q.score ?? '—'}</td>)}
                    </tr>
                    <tr>
                      <td colSpan={3} className="ds-strong">Devis retenu</td>
                      {quotes.map(q => (
                        <td key={q.id} colSpan={2} className="ds-num" style={{ ...tint(q), fontWeight: 400 }}>
                          {open ? (
                            <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
                              <input type="radio" name={`rfq-award-${r.id}`} checked={retainedId === q.id} onChange={() => setChosen(q.id)} /> Retenir ce devis
                            </label>
                          ) : q.id === retainedId ? <StatusTag tone="done" label="Retenu" icon={Trophy} /> : <span style={muted}>—</span>}
                        </td>
                      ))}
                    </tr>
                  </tfoot>
                )}
              </table>
            </DataPanel>
            {open && quotes.length > 0 && (
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 12, flexWrap: 'wrap' }}>
                <span style={{ ...muted, fontSize: 14 }}>
                  {retained ? `Devis retenu : ${retained.supplier_name} · ${money(retained.total_ht)} HT` : 'Choisissez le devis à retenir dans le tableau.'}
                </span>
                <button type="button" className="odoo-btn-primary" disabled={!retained || award.isPending} aria-busy={award.isPending || undefined}
                  onClick={async () => {
                    const q = retained; if (!q) return;
                    if (await confirm(`Retenir le devis de ${q.supplier_name} (note ${q.score ?? '—'}/100${q.id === r.recommended_quotation_id ? ', recommandé' : ''}) et créer le bon de commande (${money(q.total_ht)} HT) ?`)) award.mutate(q.id);
                  }}>
                  <Award size={14} aria-hidden="true" /> Attribuer et créer le bon de commande
                </button>
              </div>
            )}
          </section>
        </div>

        {editing && <RfqFormModal rfq={r} onClose={() => setEditing(false)} />}
        {quoting && <QuotationModal rfq={r} supplier={quoting} onClose={() => setQuoting(null)} />}
      </div>
    </ModalBackdrop>
  );
}

/* ═══════════════════ Saisie d'un devis ═══════════════════ */
function QuotationModal({ rfq, supplier, onClose }: { rfq: Rfq; supplier: RfqSupplier; onClose: () => void }) {
  const qc = useQueryClient();
  const existing: Quotation | undefined = (rfq.quotations ?? []).find(q => q.supplier_id === supplier.supplier_id);
  const items = rfq.items ?? [];
  // Saisie selon le conditionnement d'achat : si l'article a un contenant (carton de N),
  // le prix et les quantités se saisissent PAR CONTENANT ; sinon par unité de base.
  // Le stockage reste en unité de base (prix/qté ÷ et × la taille) : l'attribution,
  // le BC et la réception ne changent pas.
  const packOf = (it: RfqItem) => {
    const size = Number(it.container_size) || 1;
    return { size, hasContainer: size > 1, pack: it.container_label || 'contenant' };
  };
  const [head, setHead] = useState({
    quotationRef: existing?.quotation_ref ?? '', receivedAt: existing?.received_at?.slice(0, 10) ?? format(new Date(), 'yyyy-MM-dd'),
    validUntil: existing?.valid_until?.slice(0, 10) ?? '', deliveryDays: existing?.delivery_days != null ? String(existing.delivery_days) : '',
    paymentTerms: existing?.payment_terms ?? '', shippingCost: existing ? String(existing.shipping_cost) : '0', discountPct: existing ? String(existing.discount_pct) : '0', notes: existing?.notes ?? '',
  });
  // Critères manuels configurables (mig 459) : une note par critère, saisie sur le devis.
  const manualCriteria = (rfq.criteria ?? []).filter(c => c.type === 'manual');
  const [critScores, setCritScores] = useState<Record<string, string>>(() => Object.fromEntries(manualCriteria.map(c => {
    const v = existing?.criteria_scores?.[c.code];
    const legacy = c.code === 'quality' && existing?.quality_score != null ? Number(existing.quality_score) : null;
    return [c.code, v != null ? String(v) : (legacy != null ? String(legacy) : '')];
  })));
  // Devise du devis (mig 363) : prix et port saisis dans la devise du fournisseur, comparés en DH.
  const { data: currencies = [] } = useQuery({ queryKey: ['currencies'], queryFn: () => currenciesApi.list(), staleTime: 60_000 });
  const [currency, setCurrency] = useState(String(existing?.currency_code ?? supplier.supplier_currency ?? BASE_CURRENCY).trim());
  const [rateInput, setRateInput] = useState(existing?.exchange_rate && currency !== BASE_CURRENCY ? String(Number(existing.exchange_rate)) : '');
  const rate = currency === BASE_CURRENCY ? 1 : (parseFloat(rateInput) || 0);
  useEffect(() => {
    if (currency !== BASE_CURRENCY && !rateInput) { const c = currencies.find(x => x.code === currency); if (c?.rate) setRateInput(String(Number(c.rate))); }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currency, currencies]);
  const cur = currency === BASE_CURRENCY ? currencySymbol() : currency;
  const [lines, setLines] = useState<Record<string, { price: string; qty: string; note: string; available: boolean }>>(() => Object.fromEntries(items.map(it => {
    const { size, hasContainer } = packOf(it);
    const l = existing?.lines.find(x => x.rfq_item_id === it.id);
    const basePrice = l?.foreign_unit_price ?? l?.unit_price;
    // Stocké en unité de base → affiché par contenant (× la taille).
    const price = basePrice != null ? Number(basePrice) * (hasContainer ? size : 1) : null;
    const baseQty = l?.quantity != null && l.quantity !== '' ? Number(l.quantity) : null;
    const qty = baseQty != null ? (hasContainer ? baseQty / size : baseQty) : null;
    return [it.id, { price: price != null ? String(price) : '', qty: qty != null ? String(qty) : '', note: l?.note ?? '', available: l ? l.available : true }];
  })));
  const save = useMutation({
    mutationFn: () => rfqApi.saveQuotation(rfq.id, {
      supplierId: supplier.supplier_id, quotationRef: head.quotationRef || null, receivedAt: head.receivedAt, validUntil: head.validUntil || null,
      deliveryDays: head.deliveryDays === '' ? null : Number(head.deliveryDays), paymentTerms: head.paymentTerms || null,
      shippingCost: Number(head.shippingCost) || 0, discountPct: Number(head.discountPct) || 0, notes: head.notes || null,
      criteriaScores: Object.fromEntries(manualCriteria.map(c => [c.code, critScores[c.code] === '' || critScores[c.code] == null ? null : Number(critScores[c.code])])),
      currencyCode: currency, ...(currency !== BASE_CURRENCY ? { exchangeRate: rate } : {}),
      // Conversion saisie (par contenant) → unité de base pour le stockage.
      items: items.map(it => {
        const l = lines[it.id]; const available = l.available && l.price !== '';
        const { size, hasContainer } = packOf(it);
        const unitPrice = available ? Number(l.price) / (hasContainer ? size : 1) : null;
        const qtyEntry = l.qty ? Number(l.qty) : null;
        const quantity = qtyEntry != null ? (hasContainer ? qtyEntry * size : qtyEntry) : null;
        return { rfqItemId: it.id, available, unitPrice, quantity, note: l.note || null };
      }),
    }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['rfq', rfq.id] }); qc.invalidateQueries({ queryKey: ['rfqs'] }); notify.success('Devis enregistré'); onClose(); },
    onError: e => notify.error(apiErrorMessage(e)),
  });
  // Sous-total : prix (par contenant ou unité) × quantité dans la même unité de saisie.
  const subtotal = items.reduce((s, it) => {
    const l = lines[it.id]; if (!(l.available && l.price !== '')) return s;
    const { size, hasContainer } = packOf(it);
    const demandedEntry = hasContainer ? Number(it.quantity) / size : Number(it.quantity);
    return s + Number(l.price) * (l.qty ? Number(l.qty) : demandedEntry);
  }, 0);
  const total = subtotal * (1 - (Number(head.discountPct) || 0) / 100) + (Number(head.shippingCost) || 0);
  const set = (k: keyof typeof head, v: string) => setHead(h => ({ ...h, [k]: v }));

  return (
    <ModalBackdrop onClose={onClose} className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-4">
      <div className="odoo-scope" onClick={e => e.stopPropagation()} style={{ width: '100%', maxWidth: 820, maxHeight: '92vh', overflowY: 'auto', background: 'var(--theme-bg-card)', borderRadius: 10, boxShadow: '0 10px 30px rgba(0,0,0,0.2)' }}>
        <div className="odoo-control-bar" style={{ position: 'sticky', top: 0, zIndex: 1 }}>
          <div className="odoo-breadcrumb"><span className="odoo-breadcrumb-current">Devis de {supplier.supplier_name}</span></div>
          <div style={{ flex: 1 }} />
          <button type="button" onClick={onClose} className="ds-icon-btn" aria-label="Fermer"><X size={16} /></button>
        </div>
        <div style={{ padding: '16px 24px', display: 'grid', gap: 20 }}>
          <FormSection title="Devis">
            <div className="ds-form-grid cols-4">
              <FormField label="Référence du devis" htmlFor="q-ref"><input id="q-ref" className="ds-input" value={head.quotationRef} onChange={e => set('quotationRef', e.target.value)} /></FormField>
              <FormField label="Reçu le" htmlFor="q-received"><input id="q-received" className="ds-input" type="date" value={head.receivedAt} onChange={e => set('receivedAt', e.target.value)} /></FormField>
              <FormField label="Valable jusqu'au" htmlFor="q-valid"><input id="q-valid" className="ds-input" type="date" value={head.validUntil} onChange={e => set('validUntil', e.target.value)} /></FormField>
              <FormField label="Délai (jours)" htmlFor="q-days"><input id="q-days" className="ds-input" type="number" min="0" value={head.deliveryDays} onChange={e => set('deliveryDays', e.target.value)} /></FormField>
              <FormField label="Conditions de paiement" htmlFor="q-terms"><input id="q-terms" className="ds-input" value={head.paymentTerms} onChange={e => set('paymentTerms', e.target.value)} placeholder="30 j fin de mois…" /></FormField>
              <FormField label="Devise">
                <SearchSelect value={currency} onChange={v => { setCurrency(v); setRateInput(''); }}
                  placeholder="Devise" width="100%" size="md" ariaLabel="Devise" clearable={false}
                  options={(currencies.length ? currencies : [{ code: BASE_CURRENCY, label: 'Dirham marocain' }]).map(c => ({ id: c.code, label: `${c.code} — ${c.label}` }))} />
              </FormField>
              {currency === BASE_CURRENCY ? (
                <div className="ds-field"><span className="ds-field-label">Taux</span><div style={{ ...muted, height: 40, display: 'flex', alignItems: 'center' }}>—</div></div>
              ) : (
                <FormField label={`1 ${currency} = … ${currencySymbol()}`} htmlFor="q-rate" required error={rate > 0 ? undefined : 'Saisissez le taux de change.'}>
                  <input id="q-rate" className="ds-input" type="number" min="0" step="0.0001" aria-required="true" value={rateInput} onChange={e => setRateInput(e.target.value)} />
                </FormField>
              )}
              <FormField label={`Frais de port (${cur})`} htmlFor="q-ship"><input id="q-ship" className="ds-input" type="number" min="0" step="0.01" value={head.shippingCost} onChange={e => set('shippingCost', e.target.value)} /></FormField>
              <FormField label="Remise globale (%)" htmlFor="q-disc"><input id="q-disc" className="ds-input" type="number" min="0" max="100" step="0.01" value={head.discountPct} onChange={e => set('discountPct', e.target.value)} /></FormField>
              {manualCriteria.map(c => (
                <FormField key={c.code} label={`${c.label} (0-100)`} htmlFor={`q-crit-${c.code}`} hint="Critère de la notation">
                  <input id={`q-crit-${c.code}`} className="ds-input" type="number" min="0" max="100" step="1"
                    value={critScores[c.code] ?? ''} onChange={e => setCritScores(s => ({ ...s, [c.code]: e.target.value }))} placeholder="ex. 80" />
                </FormField>
              ))}
              <div className="ds-field">
                <span className="ds-field-label">Total HT</span>
                <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--ds-ink)', minHeight: 40, display: 'flex', alignItems: 'center', fontVariantNumeric: 'tabular-nums' }}>{n2(total)} {cur}</div>
                {currency !== BASE_CURRENCY && rate > 0 && <span className="ds-field-hint">≈ {money(total * rate)}</span>}
              </div>
            </div>
          </FormSection>

          <FormSection title="Prix par article">
            <div style={{ overflowX: 'auto' }}>
              <table className="odoo-table">
                <thead><tr><th>Article</th><th className="ds-num">Qté demandée</th><th style={{ width: 140 }}>Prix unitaire HT ({cur})</th><th style={{ width: 120 }}>Qté proposée</th><th>Remarque</th><th style={{ width: 80, textAlign: 'center' }}>Proposé</th></tr></thead>
                <tbody>{items.map(it => { const l = lines[it.id]; const upd = (p: Partial<typeof l>) => setLines(s => ({ ...s, [it.id]: { ...s[it.id], ...p } }));
                  const { size, hasContainer, pack } = packOf(it);
                  const entryUnit = hasContainer ? pack : (it.unit_label ?? 'unité');
                  const demandedEntry = hasContainer ? Number(it.quantity) / size : Number(it.quantity);
                  return (
                  <tr key={it.id} style={{ opacity: l.available ? 1 : 0.5 }}>
                    <td className="ds-strong">{it.label}
                      {hasContainer && <div style={{ ...sub, color: 'var(--ds-accent-ink)' }}>acheté par {pack} de {Number(size).toLocaleString('fr-FR')} {it.unit_label ?? ''}</div>}
                      {it.last_price && <div style={sub}>dernier prix {n4(Number(it.last_price) * (hasContainer ? size : 1))} {currencySymbol()}{hasContainer ? ` / ${pack}` : ''}</div>}</td>
                    <td className="ds-num">{demandedEntry.toLocaleString('fr-FR', { maximumFractionDigits: 3 })} {entryUnit}{hasContainer ? <div style={sub}>= {Number(it.quantity).toLocaleString('fr-FR')} {it.unit_label ?? ''}</div> : null}</td>
                    <td>
                      <input className="ds-input sm" type="number" min="0" step="0.0001" aria-label={`Prix unitaire HT de ${it.label}`} value={l.price} disabled={!l.available} onChange={e => upd({ price: e.target.value })} />
                      <div style={sub}>/ {entryUnit}</div>
                    </td>
                    <td><input className="ds-input sm" type="number" min="0" step="any" aria-label={`Quantité proposée de ${it.label}`} value={l.qty} disabled={!l.available} onChange={e => upd({ qty: e.target.value })} placeholder={String(demandedEntry)} /></td>
                    <td><input className="ds-input sm" aria-label={`Remarque sur ${it.label}`} value={l.note} onChange={e => upd({ note: e.target.value })} placeholder="Marque, conditionnement…" /></td>
                    <td style={{ textAlign: 'center' }}><input type="checkbox" aria-label={`${it.label} proposé par le fournisseur`} checked={l.available} onChange={e => upd({ available: e.target.checked })} title="Décocher si le fournisseur ne propose pas cet article" /></td>
                  </tr>
                ); })}</tbody>
              </table>
            </div>
          </FormSection>

          <FormField label="Notes" htmlFor="q-notes"><textarea id="q-notes" className="ds-input" value={head.notes} onChange={e => set('notes', e.target.value)} /></FormField>
        </div>
        <div style={{ position: 'sticky', bottom: 0, background: 'var(--ds-card)' }}>
          <FormFooter onCancel={onClose} submitLabel="Enregistrer le devis" busy={save.isPending} disabled={!(rate > 0)} onSubmit={() => save.mutate()} />
        </div>
      </div>
    </ModalBackdrop>
  );
}
