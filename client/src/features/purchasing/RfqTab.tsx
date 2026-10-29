import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  FileQuestion, Send, Plus, Search, Loader2, CheckCircle2, XCircle, Trophy, Trash2, X, Inbox, FilePenLine, Clock, Ban, RotateCcw, Award,
} from 'lucide-react';
import { format } from 'date-fns';
import { rfqApi, RFQ_STATUS_LABELS, type Rfq, type RfqStatus, type RfqItemInput, type Quotation, type RfqSupplier } from '../../api/rfq.api';
import { ingredientsApi } from '../../api/inventory.api';
import { packagingApi } from '../../api/packaging.api';
import { suppliersApi } from '../../api/accounting.api';
import { apiErrorMessage } from '../../api/errors';
import { currenciesApi } from '../../api/currencies.api';
import { notify } from '../../components/ui/InlineNotification';
import ModalBackdrop from '../../components/ui/ModalBackdrop';
import SearchSelect from '../../components/ui/SearchSelect';
import { StatusBanner } from '../../components/ui/StatusBanner';
import { useConfirm } from '../../components/ui/ConfirmDialog';
import { StagePipeline, Pager, PAGE_SIZE, type StageDef } from '../../components/purchasing/ProcessBoard';

/**
 * Achats › Appels d'offres (mig 360) : articles à acheter envoyés à plusieurs
 * fournisseurs, saisie de leurs devis, tableau comparatif, BC créé depuis le devis
 * retenu. Même squelette que les autres listes du module.
 */
const n2 = (v: string | number | null | undefined) => Number(v ?? 0).toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const n4 = (v: string | number | null | undefined) => Number(v ?? 0).toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 4 });
const STATUS_TAG: Record<RfqStatus, string> = { draft: 'odoo-tag-grey', sent: 'odoo-tag-blue', quoted: 'odoo-tag-purple', awarded: 'odoo-tag-green', cancelled: 'odoo-tag-grey', closed: 'odoo-tag-grey' };
const STAGES: Array<StageDef & { key: RfqStatus }> = [
  { key: 'draft', label: 'Brouillons', hint: 'à compléter', icon: FilePenLine },
  { key: 'sent', label: 'Envoyés', hint: 'en attente des devis', icon: Send },
  { key: 'quoted', label: 'Devis reçus', hint: 'à comparer', icon: Inbox },
  { key: 'awarded', label: 'Attribués', hint: 'BC créé', icon: Trophy },
];
const label: React.CSSProperties = { fontSize: '0.75rem', fontWeight: 600, color: 'var(--theme-text-muted)', marginBottom: 4, display: 'block' };

export default function RfqTab({ onOpenOrder }: { onOpenOrder?: (purchaseOrderId: string) => void }) {
  const [status, setStatus] = useState<RfqStatus | ''>('');
  const [searchInput, setSearchInput] = useState(''); const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [openId, setOpenId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  useEffect(() => { const t = setTimeout(() => setSearch(searchInput.trim()), 300); return () => clearTimeout(t); }, [searchInput]);
  useEffect(() => { setPage(1); }, [status, search]);
  const params: Record<string, string> = { page: String(page), pageSize: String(PAGE_SIZE) };
  if (status) params.status = status; if (search) params.search = search;
  const { data, isLoading } = useQuery({ queryKey: ['rfqs', params], queryFn: () => rfqApi.list(params) });
  const by = data?.byStatus ?? {};
  return (
    <>
      <StagePipeline title="Où en sont les appels d'offres" summary={`${(by.sent?.count ?? 0) + (by.quoted?.count ?? 0)} en cours · ${(by.sent?.overdue ?? 0) + (by.quoted?.overdue ?? 0)} au-delà de la date limite`}
        stages={STAGES} stats={Object.fromEntries(STAGES.map(s => [s.key, { count: by[s.key]?.count ?? 0, sub: '', late: by[s.key]?.overdue ?? 0, alertLabel: 'en retard' }]))}
        isActive={k => status === k} onPick={k => setStatus(status === k ? '' : (k as RfqStatus))} />
      <div className="odoo-search-panel" style={{ margin: 0 }}>
        <Search size={14} style={{ color: 'var(--theme-text-muted)' }} />
        <input className="odoo-search-input" value={searchInput} onChange={e => setSearchInput(e.target.value)} placeholder="N°, objet, fournisseur…" />
        <select className="odoo-filter-dropdown" value={status} onChange={e => setStatus(e.target.value as RfqStatus | '')}>
          <option value="">Tous statuts</option>
          {Object.entries(RFQ_STATUS_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <div style={{ flex: 1 }} />
        <button className="odoo-btn-primary" onClick={() => setCreating(true)}><Plus size={14} /> Nouvel appel d'offres</button>
      </div>
      {isLoading ? <Loading /> : !data?.rows.length ? (
        <StatusBanner tone="info" icon={FileQuestion} title="Aucun appel d'offres">Demandez des prix à plusieurs fournisseurs sur une même liste d'articles, puis comparez.</StatusBanner>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table className="odoo-table">
            <thead><tr><th>N°</th><th>Objet</th><th>Articles</th><th>Fournisseurs</th><th>Devis</th><th>Date limite</th><th>Statut</th><th>Retenu</th></tr></thead>
            <tbody>{data.rows.map(r => (
              <tr key={r.id} onClick={() => setOpenId(r.id)} style={{ cursor: 'pointer' }}>
                <td className="font-mono" style={{ whiteSpace: 'nowrap' }}>{r.number}</td>
                <td><strong>{r.title}</strong></td>
                <td style={{ textAlign: 'center' }}>{r.item_count}</td>
                <td style={{ textAlign: 'center' }}>{r.supplier_count}</td>
                <td style={{ textAlign: 'center' }}>{r.quotation_count}/{r.supplier_count}</td>
                <td style={{ color: r.is_overdue ? '#dc3545' : undefined, fontWeight: r.is_overdue ? 600 : 400 }}>{r.response_deadline ? format(new Date(r.response_deadline), 'dd/MM/yyyy') : '—'}</td>
                <td><span className={`odoo-tag ${STATUS_TAG[r.status]}`}>{RFQ_STATUS_LABELS[r.status]}</span></td>
                <td>{r.awarded_supplier_name ? <>{r.awarded_supplier_name} <span className="font-mono" style={{ color: 'var(--theme-text-muted)', fontSize: '0.75rem' }}>{r.purchase_order_number}</span></> : '—'}</td>
              </tr>
            ))}</tbody>
          </table>
          <Pager page={page} total={data.total} onPage={setPage} note={`${data.total} appel${data.total > 1 ? 's' : ''} d'offres`} />
        </div>
      )}
      {creating && <RfqFormModal onClose={() => setCreating(false)} onSaved={id => setOpenId(id)} />}
      {openId && <RfqDrawer id={openId} onClose={() => setOpenId(null)} onOpenOrder={onOpenOrder} />}
    </>
  );
}

function Loading() { return <div style={{ display: 'flex', justifyContent: 'center', padding: '3rem' }}><Loader2 size={28} className="animate-spin" style={{ color: 'var(--theme-accent)' }} /></div>; }

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
    onSuccess: r => { qc.invalidateQueries({ queryKey: ['rfqs'] }); qc.invalidateQueries({ queryKey: ['rfq', r.id] }); notify.success(rfq ? 'Appel d\'offres enregistré' : `Appel d'offres ${r.number} créé`); onSaved?.(r.id); onClose(); },
    onError: e => notify.error(apiErrorMessage(e)),
  });
  const can = title.trim().length > 0 && items.length > 0 && items.every(i => i.quantity > 0) && !save.isPending;

  return (
    <ModalBackdrop onClose={onClose} className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="odoo-scope" onClick={e => e.stopPropagation()} style={{ width: '100%', maxWidth: 820, maxHeight: '92vh', overflowY: 'auto', background: 'var(--theme-bg-card)', borderRadius: 10, boxShadow: '0 10px 30px rgba(0,0,0,0.2)' }}>
        <div className="odoo-control-bar" style={{ position: 'sticky', top: 0, zIndex: 1 }}>
          <div className="odoo-breadcrumb"><span className="odoo-breadcrumb-current">{rfq ? `Modifier ${rfq.number}` : 'Nouvel appel d\'offres'}</span></div>
          <div style={{ flex: 1 }} />
          <button type="button" onClick={onClose} className="odoo-btn-secondary" aria-label="Fermer"><X size={14} /></button>
        </div>
        <div style={{ padding: '16px 20px', display: 'grid', gap: 14 }}>
          <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr', gap: 12 }}>
            <div><span style={label}>Objet</span><input className="input" style={{ width: '100%' }} value={title} maxLength={200} onChange={e => setTitle(e.target.value)} placeholder="Ex. : Farine et beurre novembre, Four à sole neuf…" autoFocus /></div>
            <div><span style={label}>Réponse avant le</span><input className="input" type="date" style={{ width: '100%' }} value={deadline} onChange={e => setDeadline(e.target.value)} /></div>
            <div><span style={label}>Besoin pour le</span><input className="input" type="date" style={{ width: '100%' }} value={neededBy} onChange={e => setNeededBy(e.target.value)} /></div>
          </div>

          <div>
            <span style={label}>Articles demandés</span>
            {!locked && (
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 8 }}>
                <SearchSelect options={options} value={pick} onChange={addItem} placeholder="Ajouter un ingrédient ou un consommable" width={360} />
                <span style={{ color: 'var(--theme-text-muted)', fontSize: '0.75rem' }}>ou</span>
                <input className="input" value={freeLabel} onChange={e => setFreeLabel(e.target.value)} placeholder="Service / matériel (désignation libre)" style={{ width: 260 }} onKeyDown={e => { if (e.key === 'Enter') addFree(); }} />
                <button type="button" className="odoo-btn-secondary" onClick={addFree} disabled={!freeLabel.trim()}><Plus size={12} /></button>
              </div>
            )}
            {items.length === 0 ? <p style={{ fontSize: '0.8125rem', color: 'var(--theme-text-muted)', margin: 0 }}>Aucun article.</p> : (
              <table className="odoo-table">
                <thead><tr><th>Article</th><th style={{ width: 120 }}>Quantité</th><th style={{ width: 100 }}>Unité</th><th style={{ width: 40 }} /></tr></thead>
                <tbody>{items.map((it, idx) => (
                  <tr key={it.key}>
                    <td>{it.label}{it.lineType === 'service' && <span className="odoo-tag odoo-tag-grey" style={{ marginLeft: 6 }}>libre</span>}</td>
                    <td><input className="input" type="number" min="0.001" step="any" style={{ width: '100%' }} value={it.quantity} disabled={locked} onChange={e => setItems(s => s.map((x, i) => i === idx ? { ...x, quantity: Number(e.target.value) } : x))} /></td>
                    <td><input className="input" style={{ width: '100%' }} value={it.unit ?? ''} disabled={locked} onChange={e => setItems(s => s.map((x, i) => i === idx ? { ...x, unit: e.target.value } : x))} placeholder="kg, unité…" /></td>
                    <td>{!locked && <button type="button" className="odoo-btn-secondary" onClick={() => setItems(s => s.filter((_, i) => i !== idx))}><Trash2 size={12} /></button>}</td>
                  </tr>
                ))}</tbody>
              </table>
            )}
          </div>

          <div>
            <span style={label}>Fournisseurs consultés</span>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {(suppliers as Record<string, any>[]).map(s => {
                const on = supplierIds.includes(s.id);
                return (
                  <button key={s.id} type="button" onClick={() => setSupplierIds(ids => on ? ids.filter(x => x !== s.id) : [...ids, s.id])}
                    style={{ padding: '5px 12px', borderRadius: 999, fontSize: '0.8125rem', cursor: 'pointer', border: `1px solid ${on ? 'var(--odoo-purple)' : 'var(--odoo-border)'}`,
                      background: on ? 'var(--odoo-purple)' : 'transparent', color: on ? '#fff' : 'var(--odoo-text)', fontWeight: on ? 600 : 400 }}>
                    {s.name}
                  </button>
                );
              })}
            </div>
          </div>
          <div><span style={label}>Précisions pour les fournisseurs</span><textarea className="input" style={{ width: '100%', minHeight: 60 }} value={notes} onChange={e => setNotes(e.target.value)} placeholder="Qualité attendue, conditions de livraison, lieu…" /></div>
        </div>
        <div style={{ padding: '12px 20px', borderTop: '1px solid var(--odoo-border)', display: 'flex', justifyContent: 'flex-end', gap: 8, position: 'sticky', bottom: 0, background: 'var(--theme-bg-card)' }}>
          <button className="odoo-btn-secondary" onClick={onClose}>Annuler</button>
          <button className="odoo-btn-primary" disabled={!can} onClick={() => save.mutate()}>{save.isPending && <Loader2 size={13} className="animate-spin" />} Enregistrer</button>
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
  const refresh = () => { qc.invalidateQueries({ queryKey: ['rfq', id] }); qc.invalidateQueries({ queryKey: ['rfqs'] }); };
  const send = useMutation({ mutationFn: () => rfqApi.send(id), onSuccess: (data) => { refresh(); const n = data?.emailsQueued ?? 0; notify.success(n > 0 ? `Appel d'offres envoyé — ${n} e-mail(s) fournisseur mis en file` : 'Appel d\'offres envoyé : aucun fournisseur avec e-mail, saisissez les devis au fur et à mesure'); }, onError: e => notify.error(apiErrorMessage(e)) });
  const setStatus = useMutation({ mutationFn: (s: 'cancelled' | 'closed' | 'draft') => rfqApi.setStatus(id, s), onSuccess: refresh, onError: e => notify.error(apiErrorMessage(e)) });
  const supplierStatus = useMutation({ mutationFn: (p: { supplierId: string; status: 'invited' | 'declined' | 'no_response' }) => rfqApi.setSupplierStatus(id, p.supplierId, p.status), onSuccess: refresh, onError: e => notify.error(apiErrorMessage(e)) });
  const award = useMutation({
    mutationFn: (quotationId: string) => rfqApi.award(id, quotationId),
    onSuccess: ({ purchaseOrder }) => { refresh(); qc.invalidateQueries({ queryKey: ['purchase-orders'] }); notify.success(`Bon de commande ${purchaseOrder.order_number} créé`); },
    onError: e => notify.error(apiErrorMessage(e)),
  });

  if (isLoading || !r) return <ModalBackdrop onClose={onClose} className="fixed inset-0 z-50 flex justify-end bg-black/30"><div className="odoo-scope" style={{ width: 'min(960px, 100%)', height: '100%', background: 'var(--theme-bg-card)' }}><Loading /></div></ModalBackdrop>;
  const items = r.items ?? []; const quotes = r.quotations ?? []; const suppliers = r.suppliers ?? [];
  const open = ['sent', 'quoted'].includes(r.status);

  return (
    <ModalBackdrop onClose={onClose} className="fixed inset-0 z-50 flex justify-end bg-black/30">
      <div className="odoo-scope" onClick={e => e.stopPropagation()} style={{ width: 'min(960px, 100%)', height: '100%', overflowY: 'auto', background: 'var(--theme-bg-card)', boxShadow: '-6px 0 24px rgba(0,0,0,0.15)' }}>
        <div className="odoo-control-bar" style={{ position: 'sticky', top: 0, zIndex: 1 }}>
          <div className="odoo-breadcrumb">
            <FileQuestion size={14} style={{ color: 'var(--theme-accent)' }} />
            <span className="font-mono">{r.number}</span>
            <span className={`odoo-tag ${STATUS_TAG[r.status]}`} style={{ marginLeft: 6 }}>{RFQ_STATUS_LABELS[r.status]}</span>
          </div>
          <div style={{ flex: 1 }} />
          {r.status === 'draft' && <>
            <button className="odoo-btn-secondary" onClick={() => setEditing(true)}><FilePenLine size={13} /> Modifier</button>
            <button className="odoo-btn-primary" onClick={() => send.mutate()} disabled={send.isPending}><Send size={13} /> Envoyer aux fournisseurs</button>
          </>}
          {open && <button className="odoo-btn-secondary" onClick={() => setEditing(true)}><FilePenLine size={13} /> Fournisseurs / dates</button>}
          {open && <button className="odoo-btn-secondary" onClick={async () => { if (await confirm('Clore sans retenir de devis ?')) setStatus.mutate('closed'); }}><Ban size={13} /> Sans suite</button>}
          {['draft', 'sent', 'quoted'].includes(r.status) && <button className="odoo-btn-secondary" onClick={async () => { if (await confirm('Annuler cet appel d\'offres ?', { danger: true })) setStatus.mutate('cancelled'); }}><XCircle size={13} /> Annuler</button>}
          {['cancelled', 'closed'].includes(r.status) && <button className="odoo-btn-secondary" onClick={() => setStatus.mutate('draft')}><RotateCcw size={13} /> Rouvrir</button>}
          <button type="button" className="odoo-btn-secondary" onClick={onClose} aria-label="Fermer"><X size={14} /></button>
        </div>

        <div style={{ padding: '16px 20px', display: 'grid', gap: 16 }}>
          <div>
            <h3 style={{ margin: '0 0 4px', fontSize: '1rem' }}>{r.title}</h3>
            <div style={{ fontSize: '0.8125rem', color: 'var(--theme-text-muted)' }}>
              {r.response_deadline ? `Réponse avant le ${format(new Date(r.response_deadline), 'dd/MM/yyyy')}` : 'Pas de date limite'}{r.needed_by ? ` · besoin pour le ${format(new Date(r.needed_by), 'dd/MM/yyyy')}` : ''}
              {r.sent_at ? ` · envoyé le ${format(new Date(r.sent_at), 'dd/MM/yyyy')}` : ''} · créé par {r.created_by_name || '—'}
            </div>
            {r.notes && <p style={{ margin: '6px 0 0', fontSize: '0.8125rem', whiteSpace: 'pre-wrap' }}>{r.notes}</p>}
          </div>
          {r.is_overdue && <StatusBanner tone="warning" icon={Clock} title="Date limite de réponse dépassée">Relancez les fournisseurs sans réponse, ou comparez avec les devis reçus.</StatusBanner>}
          {r.status === 'awarded' && (
            <StatusBanner tone="success" icon={Trophy} title={`Devis retenu : ${r.awarded_supplier_name}`}
              actions={r.purchase_order_id && onOpenOrder ? <button className="odoo-btn-primary" onClick={() => onOpenOrder(r.purchase_order_id!)}>Ouvrir le BC {r.purchase_order_number}</button> : undefined}>
              Le bon de commande {r.purchase_order_number} a été créé depuis ce devis{r.awarded_at ? ` le ${format(new Date(r.awarded_at), 'dd/MM/yyyy')}` : ''}.
            </StatusBanner>
          )}

          {/* Fournisseurs consultés */}
          <div>
            <div className="odoo-section-header" style={{ border: 'none', paddingLeft: 0 }}>Fournisseurs consultés</div>
            {suppliers.length === 0 ? <p style={{ fontSize: '0.8125rem', color: 'var(--theme-text-muted)' }}>Aucun fournisseur. Modifiez l'appel d'offres pour en ajouter.</p> : (
              <table className="odoo-table">
                <thead><tr><th>Fournisseur</th><th>Contact</th><th>Réponse</th><th /></tr></thead>
                <tbody>{suppliers.map(s => (
                  <tr key={s.id}>
                    <td><strong>{s.supplier_name}</strong></td>
                    <td style={{ color: 'var(--theme-text-muted)' }}>{[s.contact_name, s.phone, s.email].filter(Boolean).join(' · ') || '—'}</td>
                    <td>
                      {s.status === 'quoted' ? <span className="odoo-tag odoo-tag-green">devis reçu</span>
                        : s.status === 'declined' ? <span className="odoo-tag odoo-tag-grey">a décliné</span>
                        : s.status === 'no_response' ? <span className="odoo-tag odoo-tag-orange">sans réponse</span>
                        : <span className="odoo-tag odoo-tag-blue">{r.status === 'draft' ? 'à consulter' : 'en attente'}</span>}
                    </td>
                    <td style={{ whiteSpace: 'nowrap' }}>
                      {open && <>
                        <button className="odoo-btn-primary" onClick={() => setQuoting(s)}>{s.quotation_id ? 'Modifier le devis' : 'Saisir le devis'}</button>{' '}
                        {s.status !== 'quoted' && <button className="odoo-btn-secondary" onClick={() => supplierStatus.mutate({ supplierId: s.supplier_id, status: s.status === 'declined' ? 'invited' : 'declined' })}>{s.status === 'declined' ? 'Rétablir' : 'A décliné'}</button>}
                      </>}
                    </td>
                  </tr>
                ))}</tbody>
              </table>
            )}
          </div>

          {/* Comparatif */}
          <div>
            <div className="odoo-section-header" style={{ border: 'none', paddingLeft: 0 }}>Tableau comparatif</div>
            {quotes.length === 0 ? (
              <table className="odoo-table">
                <thead><tr><th>Article</th><th style={{ textAlign: 'right' }}>Quantité</th><th style={{ textAlign: 'right' }}>Dernier prix payé</th></tr></thead>
                <tbody>{items.map(it => (
                  <tr key={it.id}><td>{it.label}</td><td style={{ textAlign: 'right' }}>{Number(it.quantity).toLocaleString('fr-FR')} {it.unit_label ?? ''}</td><td style={{ textAlign: 'right', color: 'var(--theme-text-muted)' }}>{it.last_price ? n4(it.last_price) : '—'}</td></tr>
                ))}</tbody>
              </table>
            ) : (
              <div style={{ overflowX: 'auto' }}>
                <table className="odoo-table">
                  <thead>
                    <tr>
                      <th>Article</th><th style={{ textAlign: 'right' }}>Qté</th><th style={{ textAlign: 'right' }}>Dernier prix</th>
                      {quotes.map(q => <th key={q.id} style={{ textAlign: 'right', background: q.id === r.best_total_quotation_id ? 'rgba(40,167,69,0.08)' : undefined }}>{q.supplier_name}{q.status === 'selected' && <Trophy size={12} style={{ marginLeft: 4, color: '#28a745' }} />}</th>)}
                    </tr>
                  </thead>
                  <tbody>
                    {items.map(it => (
                      <tr key={it.id}>
                        <td>{it.label}</td>
                        <td style={{ textAlign: 'right' }}>{Number(it.quantity).toLocaleString('fr-FR')} {it.unit_label ?? ''}</td>
                        <td style={{ textAlign: 'right', color: 'var(--theme-text-muted)' }}>{it.last_price ? n4(it.last_price) : '—'}</td>
                        {quotes.map(q => {
                          const l = q.lines.find(x => x.rfq_item_id === it.id);
                          const best = r.best_by_item?.[it.id]?.quotationId === q.id;
                          return (
                            <td key={q.id} style={{ textAlign: 'right', fontWeight: best ? 700 : 400, color: best ? '#28a745' : undefined }}>
                              {l && l.available && l.unit_price != null ? n4(l.unit_price) : <span style={{ color: 'var(--theme-text-muted)' }}>—</span>}
                              {l?.note && <div style={{ fontSize: '0.7rem', color: 'var(--theme-text-muted)', fontWeight: 400 }}>{l.note}</div>}
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                    <tr style={{ fontWeight: 600 }}>
                      <td colSpan={3}>Total HT (remise et port compris)</td>
                      {quotes.map(q => <td key={q.id} style={{ textAlign: 'right', color: q.id === r.best_total_quotation_id ? '#28a745' : undefined }}>{n2(q.total_ht)}{q.total_foreign && <div style={{ fontSize: '0.7rem', fontWeight: 400, color: 'var(--theme-text-muted)' }}>{n2(q.total_foreign)} {String(q.currency_code).trim()}</div>}{!q.complete && <div style={{ fontSize: '0.7rem', fontWeight: 400, color: '#d9822b' }}>{q.covered}/{items.length} lignes</div>}</td>)}
                    </tr>
                    <tr style={{ fontSize: '0.75rem', color: 'var(--theme-text-muted)' }}>
                      <td colSpan={3}>Délai · validité · conditions</td>
                      {quotes.map(q => <td key={q.id} style={{ textAlign: 'right' }}>{q.delivery_days != null ? `${q.delivery_days} j` : '—'}{q.valid_until ? ` · jusqu'au ${format(new Date(q.valid_until), 'dd/MM')}` : ''}{q.payment_terms ? ` · ${q.payment_terms}` : ''}{Number(q.shipping_cost) > 0 ? ` · port ${n2(q.shipping_cost)}${q.currency_code && String(q.currency_code).trim() !== 'MAD' ? ` ${String(q.currency_code).trim()}` : ''}` : ''}{Number(q.discount_pct) > 0 ? ` · remise ${q.discount_pct} %` : ''}</td>)}
                    </tr>
                    {open && (
                      <tr>
                        <td colSpan={3} />
                        {quotes.map(q => (
                          <td key={q.id} style={{ textAlign: 'right' }}>
                            <button className={q.id === r.best_total_quotation_id ? 'odoo-btn-primary' : 'odoo-btn-secondary'} disabled={award.isPending}
                              onClick={async () => { if (await confirm(`Retenir le devis de ${q.supplier_name} et créer le bon de commande (${n2(q.total_ht)} DH HT) ?`)) award.mutate(q.id); }}>
                              <Award size={12} /> Retenir
                            </button>
                          </td>
                        ))}
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            )}
          </div>
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
  const [head, setHead] = useState({
    quotationRef: existing?.quotation_ref ?? '', receivedAt: existing?.received_at?.slice(0, 10) ?? format(new Date(), 'yyyy-MM-dd'),
    validUntil: existing?.valid_until?.slice(0, 10) ?? '', deliveryDays: existing?.delivery_days != null ? String(existing.delivery_days) : '',
    paymentTerms: existing?.payment_terms ?? '', shippingCost: existing ? String(existing.shipping_cost) : '0', discountPct: existing ? String(existing.discount_pct) : '0', notes: existing?.notes ?? '',
  });
  // Devise du devis (mig 363) : prix et port saisis dans la devise du fournisseur, comparés en DH.
  const { data: currencies = [] } = useQuery({ queryKey: ['currencies'], queryFn: () => currenciesApi.list(), staleTime: 60_000 });
  const [currency, setCurrency] = useState(String(existing?.currency_code ?? supplier.supplier_currency ?? 'MAD').trim());
  const [rateInput, setRateInput] = useState(existing?.exchange_rate && currency !== 'MAD' ? String(Number(existing.exchange_rate)) : '');
  const rate = currency === 'MAD' ? 1 : (parseFloat(rateInput) || 0);
  useEffect(() => {
    if (currency !== 'MAD' && !rateInput) { const c = currencies.find(x => x.code === currency); if (c?.rate) setRateInput(String(Number(c.rate))); }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currency, currencies]);
  const cur = currency === 'MAD' ? 'DH' : currency;
  const [lines, setLines] = useState<Record<string, { price: string; qty: string; note: string; available: boolean }>>(() => Object.fromEntries(items.map(it => {
    const l = existing?.lines.find(x => x.rfq_item_id === it.id);
    const price = l?.foreign_unit_price ?? l?.unit_price;
    return [it.id, { price: price != null ? String(Number(price)) : '', qty: l?.quantity ?? '', note: l?.note ?? '', available: l ? l.available : true }];
  })));
  const save = useMutation({
    mutationFn: () => rfqApi.saveQuotation(rfq.id, {
      supplierId: supplier.supplier_id, quotationRef: head.quotationRef || null, receivedAt: head.receivedAt, validUntil: head.validUntil || null,
      deliveryDays: head.deliveryDays === '' ? null : Number(head.deliveryDays), paymentTerms: head.paymentTerms || null,
      shippingCost: Number(head.shippingCost) || 0, discountPct: Number(head.discountPct) || 0, notes: head.notes || null,
      currencyCode: currency, ...(currency !== 'MAD' ? { exchangeRate: rate } : {}),
      items: items.map(it => { const l = lines[it.id]; const available = l.available && l.price !== ''; return { rfqItemId: it.id, available, unitPrice: available ? Number(l.price) : null, quantity: l.qty ? Number(l.qty) : null, note: l.note || null }; }),
    }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['rfq', rfq.id] }); qc.invalidateQueries({ queryKey: ['rfqs'] }); notify.success('Devis enregistré'); onClose(); },
    onError: e => notify.error(apiErrorMessage(e)),
  });
  const subtotal = items.reduce((s, it) => { const l = lines[it.id]; return l.available && l.price !== '' ? s + Number(l.price) * Number(l.qty || it.quantity) : s; }, 0);
  const total = subtotal * (1 - (Number(head.discountPct) || 0) / 100) + (Number(head.shippingCost) || 0);
  const set = (k: keyof typeof head, v: string) => setHead(h => ({ ...h, [k]: v }));

  return (
    <ModalBackdrop onClose={onClose} className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-4">
      <div className="odoo-scope" onClick={e => e.stopPropagation()} style={{ width: '100%', maxWidth: 820, maxHeight: '92vh', overflowY: 'auto', background: 'var(--theme-bg-card)', borderRadius: 10, boxShadow: '0 10px 30px rgba(0,0,0,0.2)' }}>
        <div className="odoo-control-bar" style={{ position: 'sticky', top: 0, zIndex: 1 }}>
          <div className="odoo-breadcrumb"><span className="odoo-breadcrumb-current">Devis de {supplier.supplier_name}</span></div>
          <div style={{ flex: 1 }} />
          <button type="button" onClick={onClose} className="odoo-btn-secondary" aria-label="Fermer"><X size={14} /></button>
        </div>
        <div style={{ padding: '16px 20px', display: 'grid', gap: 12 }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10 }}>
            <div><span style={label}>Référence du devis</span><input className="input" style={{ width: '100%' }} value={head.quotationRef} onChange={e => set('quotationRef', e.target.value)} /></div>
            <div><span style={label}>Reçu le</span><input className="input" type="date" style={{ width: '100%' }} value={head.receivedAt} onChange={e => set('receivedAt', e.target.value)} /></div>
            <div><span style={label}>Valable jusqu'au</span><input className="input" type="date" style={{ width: '100%' }} value={head.validUntil} onChange={e => set('validUntil', e.target.value)} /></div>
            <div><span style={label}>Délai (jours)</span><input className="input" type="number" min="0" style={{ width: '100%' }} value={head.deliveryDays} onChange={e => set('deliveryDays', e.target.value)} /></div>
            <div><span style={label}>Conditions de paiement</span><input className="input" style={{ width: '100%' }} value={head.paymentTerms} onChange={e => set('paymentTerms', e.target.value)} placeholder="30 j fin de mois…" /></div>
            <div><span style={label}>Devise</span><select className="input" style={{ width: '100%' }} value={currency} onChange={e => { setCurrency(e.target.value); setRateInput(''); }}>
              {(currencies.length ? currencies : [{ code: 'MAD', label: 'Dirham marocain' }]).map(c => <option key={c.code} value={c.code}>{c.code} — {c.label}</option>)}
            </select></div>
            <div><span style={label}>{currency === 'MAD' ? 'Taux' : `1 ${currency} = … DH`}</span>{currency === 'MAD'
              ? <div style={{ paddingTop: 6, color: 'var(--theme-text-muted)' }}>—</div>
              : <input className="input" type="number" min="0" step="0.0001" style={{ width: '100%' }} value={rateInput} onChange={e => setRateInput(e.target.value)} />}</div>
            <div><span style={label}>Frais de port ({cur})</span><input className="input" type="number" min="0" step="0.01" style={{ width: '100%' }} value={head.shippingCost} onChange={e => set('shippingCost', e.target.value)} /></div>
            <div><span style={label}>Remise globale (%)</span><input className="input" type="number" min="0" max="100" step="0.01" style={{ width: '100%' }} value={head.discountPct} onChange={e => set('discountPct', e.target.value)} /></div>
            <div><span style={label}>Total HT</span><div style={{ fontSize: '1.125rem', fontWeight: 700, paddingTop: 4 }}>{n2(total)} {cur}</div>
              {currency !== 'MAD' && rate > 0 && <div style={{ fontSize: '0.75rem', color: 'var(--theme-text-muted)' }}>≈ {n2(total * rate)} DH</div>}</div>
          </div>
          <table className="odoo-table">
            <thead><tr><th>Article</th><th style={{ textAlign: 'right' }}>Qté demandée</th><th style={{ width: 130 }}>Prix unitaire HT ({cur})</th><th style={{ width: 110 }}>Qté proposée</th><th>Remarque</th><th style={{ width: 70 }}>Proposé</th></tr></thead>
            <tbody>{items.map(it => { const l = lines[it.id]; const upd = (p: Partial<typeof l>) => setLines(s => ({ ...s, [it.id]: { ...s[it.id], ...p } })); return (
              <tr key={it.id} style={{ opacity: l.available ? 1 : 0.5 }}>
                <td>{it.label}{it.last_price && <div style={{ fontSize: '0.7rem', color: 'var(--theme-text-muted)' }}>dernier prix {n4(it.last_price)} DH</div>}</td>
                <td style={{ textAlign: 'right' }}>{Number(it.quantity).toLocaleString('fr-FR')} {it.unit_label ?? ''}</td>
                <td><input className="input" type="number" min="0" step="0.0001" style={{ width: '100%' }} value={l.price} disabled={!l.available} onChange={e => upd({ price: e.target.value })} /></td>
                <td><input className="input" type="number" min="0" step="any" style={{ width: '100%' }} value={l.qty} disabled={!l.available} onChange={e => upd({ qty: e.target.value })} placeholder={String(Number(it.quantity))} /></td>
                <td><input className="input" style={{ width: '100%' }} value={l.note} onChange={e => upd({ note: e.target.value })} placeholder="Marque, conditionnement…" /></td>
                <td style={{ textAlign: 'center' }}><input type="checkbox" checked={l.available} onChange={e => upd({ available: e.target.checked })} title="Décocher si le fournisseur ne propose pas cet article" /></td>
              </tr>
            ); })}</tbody>
          </table>
          <div><span style={label}>Notes</span><textarea className="input" style={{ width: '100%', minHeight: 50 }} value={head.notes} onChange={e => set('notes', e.target.value)} /></div>
        </div>
        <div style={{ padding: '12px 20px', borderTop: '1px solid var(--odoo-border)', display: 'flex', justifyContent: 'flex-end', gap: 8, position: 'sticky', bottom: 0, background: 'var(--theme-bg-card)' }}>
          <button className="odoo-btn-secondary" onClick={onClose}>Annuler</button>
          <button className="odoo-btn-primary" disabled={save.isPending || !(rate > 0)} title={rate > 0 ? undefined : 'Saisissez le taux de change'} onClick={() => save.mutate()}>{save.isPending ? <Loader2 size={13} className="animate-spin" /> : <CheckCircle2 size={13} />} Enregistrer le devis</button>
        </div>
      </div>
    </ModalBackdrop>
  );
}
