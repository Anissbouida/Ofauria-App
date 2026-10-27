import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlertTriangle, CheckCircle2, Clock, Loader2, MessageSquareWarning, Plus, Search, X, XCircle, PlayCircle, Lock, RotateCcw, User, Send,
} from 'lucide-react';
import { format, formatDistanceToNow } from 'date-fns';
import { fr } from 'date-fns/locale';
import {
  complaintsApi, PRIORITY_LABELS, STATUS_LABELS, CHANNEL_LABELS, RESOLUTION_LABELS,
  type Complaint, type ComplaintPriority, type ComplaintStatus, type ResolutionCode,
} from '../../api/complaints.api';
import { apiErrorMessage } from '../../api/errors';
import { serverUrl } from '../../api/client';
import { useAuth } from '../../context/AuthContext';
import { useReferentiel } from '../../hooks/useReferentiel';
import { notify } from '../../components/ui/InlineNotification';
import ModalBackdrop from '../../components/ui/ModalBackdrop';
import { StatusBanner } from '../../components/ui/StatusBanner';
import ComplaintFormModal from '../../components/sav/ComplaintFormModal';
import { StagePipeline, Pager, PAGE_SIZE, type StageDef } from '../../components/purchasing/ProcessBoard';

/**
 * Contrôle & Qualité › Réclamations (SAV, mig 357). Même squelette que les autres
 * listes : cartes par étape, filtres, fiche avec journal et actions. Ouvert aux
 * admin / gérant ; la saisie rapide se fait aussi depuis la caisse.
 */

const STAGES: Array<StageDef & { key: ComplaintStatus }> = [
  { key: 'open', label: 'Ouvertes', hint: 'à prendre en charge', icon: AlertTriangle },
  { key: 'in_progress', label: 'En cours', hint: 'prises en charge', icon: PlayCircle },
  { key: 'resolved', label: 'Résolues', hint: 'réponse donnée au client', icon: CheckCircle2 },
  { key: 'closed', label: 'Clôturées', hint: 'dossier fermé', icon: Lock },
  { key: 'rejected', label: 'Non fondées', hint: 'sans suite', icon: XCircle },
];
const PRIORITY_TAG: Record<ComplaintPriority, string> = { critical: 'odoo-tag-red', high: 'odoo-tag-orange', normal: 'odoo-tag-blue', low: 'odoo-tag-grey' };
const STATUS_TAG: Record<ComplaintStatus, string> = { open: 'odoo-tag-orange', in_progress: 'odoo-tag-blue', resolved: 'odoo-tag-green', closed: 'odoo-tag-grey', rejected: 'odoo-tag-grey' };

export default function ComplaintsTab({ range, periodText }: { range: Record<string, string>; periodText: string }) {
  const [status, setStatus] = useState<ComplaintStatus | ''>('');
  const [priority, setPriority] = useState<ComplaintPriority | ''>('');
  const [overdueOnly, setOverdueOnly] = useState(false);
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [openId, setOpenId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  useEffect(() => { const t = setTimeout(() => setSearch(searchInput.trim()), 300); return () => clearTimeout(t); }, [searchInput]);
  useEffect(() => { setPage(1); }, [status, priority, overdueOnly, search, range]);

  const params: Record<string, string> = { ...range, page: String(page), pageSize: String(PAGE_SIZE) };
  if (status) params.status = status;
  if (priority) params.priority = priority;
  if (overdueOnly) params.overdueOnly = 'true';
  if (search) params.search = search;
  const { data, isLoading } = useQuery({ queryKey: ['complaints', params], queryFn: () => complaintsApi.list(params) });
  const rows = data?.rows ?? [];
  const by = data?.byStatus ?? {};
  const openCount = (by.open?.count ?? 0) + (by.in_progress?.count ?? 0);
  const overdue = (by.open?.overdue ?? 0) + (by.in_progress?.overdue ?? 0);

  return (
    <>
      <StagePipeline
        title="Où en sont les réclamations"
        summary={`${openCount} à traiter · ${overdue} en retard · ${periodText}`}
        stages={STAGES}
        stats={Object.fromEntries(STAGES.map(s => [s.key, {
          count: by[s.key]?.count ?? 0, sub: '', late: by[s.key]?.overdue ?? 0, alertLabel: 'en retard',
        }]))}
        isActive={k => status === k}
        onPick={k => setStatus(status === k ? '' : (k as ComplaintStatus))}
      />

      <div className="odoo-search-panel" style={{ flexWrap: 'wrap', rowGap: 8, margin: 0 }}>
        <Search size={14} style={{ color: 'var(--theme-text-muted)', flexShrink: 0 }} />
        <input className="odoo-search-input" value={searchInput} onChange={e => setSearchInput(e.target.value)}
          placeholder="N°, sujet, client, article…" />
        {search && <span className="odoo-filter-chip">{search}<span className="odoo-filter-chip-remove" onClick={() => setSearchInput('')}>×</span></span>}
        <select className="odoo-filter-dropdown" value={priority} onChange={e => setPriority(e.target.value as ComplaintPriority | '')}>
          <option value="">Toutes priorités</option>
          {Object.entries(PRIORITY_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: '0.8125rem', cursor: 'pointer' }}>
          <input type="checkbox" checked={overdueOnly} onChange={e => setOverdueOnly(e.target.checked)} /> En retard seulement
        </label>
        <div style={{ flex: 1 }} />
        <button type="button" className="odoo-btn-primary" onClick={() => setCreating(true)}><Plus size={14} /> Nouvelle réclamation</button>
      </div>

      {isLoading ? (
        <div style={{ display: 'flex', justifyContent: 'center', padding: '3rem' }}><Loader2 size={28} className="animate-spin" style={{ color: 'var(--theme-accent)' }} /></div>
      ) : rows.length === 0 ? (
        <StatusBanner tone="success" icon={CheckCircle2} title="Aucune réclamation">
          Rien à traiter sur la période et les filtres choisis.
        </StatusBanner>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table className="odoo-table">
            <thead>
              <tr>
                <th>N°</th><th>Client</th><th>Motif</th><th>Sujet</th><th>Article</th><th>Priorité</th><th>Statut</th><th>Délai</th><th>Responsable</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(c => (
                <tr key={c.id} onClick={() => setOpenId(c.id)} style={{ cursor: 'pointer' }}>
                  <td className="font-mono" style={{ whiteSpace: 'nowrap' }}>{c.number}</td>
                  <td>{c.customer_label || '—'}</td>
                  <td><span className="odoo-tag" style={{ background: c.category_color ? `${c.category_color}22` : undefined, color: c.category_color || undefined }}>{c.category_label || c.category_code}</span></td>
                  <td style={{ maxWidth: 260, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={c.subject}>{c.subject}</td>
                  <td>{c.product_name || '—'}{c.lot_number ? <span style={{ color: 'var(--theme-text-muted)', fontSize: '0.75rem' }}> · {c.lot_number}</span> : null}</td>
                  <td><span className={`odoo-tag ${PRIORITY_TAG[c.priority]}`}>{PRIORITY_LABELS[c.priority]}</span></td>
                  <td><span className={`odoo-tag ${STATUS_TAG[c.status]}`}>{STATUS_LABELS[c.status]}</span></td>
                  <td style={{ whiteSpace: 'nowrap' }}><Due c={c} /></td>
                  <td>{c.assigned_name || <span style={{ color: 'var(--theme-text-muted)' }}>—</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <Pager page={page} total={data?.total ?? 0} onPage={setPage} note={`${data?.total ?? 0} réclamation${(data?.total ?? 0) > 1 ? 's' : ''}`} />
        </div>
      )}

      {creating && <ComplaintFormModal mode="full" onClose={() => setCreating(false)} onCreated={id => setOpenId(id)} />}
      {openId && <ComplaintDrawer id={openId} onClose={() => setOpenId(null)} />}
    </>
  );
}

function Due({ c }: { c: Complaint }) {
  if (!c.due_at || !['open', 'in_progress'].includes(c.status)) return <span style={{ color: 'var(--theme-text-muted)' }}>—</span>;
  const d = new Date(c.due_at);
  const text = formatDistanceToNow(d, { locale: fr, addSuffix: true });
  return <span style={{ color: c.is_overdue ? '#dc3545' : 'var(--theme-text-muted)', fontWeight: c.is_overdue ? 600 : 400 }}>{c.is_overdue ? `en retard (${text})` : text}</span>;
}

/* ═══════════════════════ FICHE ═══════════════════════ */

function ComplaintDrawer({ id, onClose }: { id: string; onClose: () => void }) {
  const qc = useQueryClient();
  const { user } = useAuth();
  const { getLabel } = useReferentiel('complaint_categories');
  const { data: c, isLoading } = useQuery({ queryKey: ['complaint', id], queryFn: () => complaintsApi.get(id) });
  const [note, setNote] = useState('');
  const [resolving, setResolving] = useState<null | 'resolved' | 'rejected'>(null);
  const [resolutionCode, setResolutionCode] = useState<ResolutionCode>('replacement');
  const [resolution, setResolution] = useState('');
  const [amount, setAmount] = useState('');

  const refresh = () => { qc.invalidateQueries({ queryKey: ['complaint', id] }); qc.invalidateQueries({ queryKey: ['complaints'] }); qc.invalidateQueries({ queryKey: ['controle-overview'] }); };
  const act = <T,>(fn: () => Promise<T>, done?: string) => useMutation({
    mutationFn: fn, onSuccess: () => { refresh(); if (done) notify.success(done); }, onError: e => notify.error(apiErrorMessage(e)),
  });
  const setStatus = useMutation({
    mutationFn: (p: Parameters<typeof complaintsApi.setStatus>[1]) => complaintsApi.setStatus(id, p),
    onSuccess: () => { refresh(); setResolving(null); setNote(''); setResolution(''); setAmount(''); },
    onError: e => notify.error(apiErrorMessage(e)),
  });
  const assignMe = act(() => complaintsApi.assign(id, user!.id), 'Réclamation prise en charge');
  const unassign = act(() => complaintsApi.assign(id, null));
  const comment = useMutation({
    mutationFn: () => complaintsApi.comment(id, note.trim()),
    onSuccess: () => { refresh(); setNote(''); }, onError: e => notify.error(apiErrorMessage(e)),
  });
  const setPriority = useMutation({
    mutationFn: (p: ComplaintPriority) => complaintsApi.setPriority(id, p), onSuccess: refresh, onError: e => notify.error(apiErrorMessage(e)),
  });

  const row = (k: string, v: React.ReactNode) => (
    <div style={{ display: 'grid', gridTemplateColumns: '130px 1fr', gap: 8, fontSize: '0.8125rem', padding: '4px 0' }}>
      <span style={{ color: 'var(--theme-text-muted)' }}>{k}</span><span>{v ?? '—'}</span>
    </div>
  );

  return (
    <ModalBackdrop onClose={onClose} className="fixed inset-0 z-50 flex justify-end bg-black/30">
      <div className="odoo-scope" onClick={e => e.stopPropagation()}
        style={{ width: 'min(680px, 100%)', height: '100%', overflowY: 'auto', background: 'var(--theme-bg-card)', boxShadow: '-6px 0 24px rgba(0,0,0,0.15)' }}>
        {isLoading || !c ? (
          <div style={{ display: 'flex', justifyContent: 'center', padding: '3rem' }}><Loader2 size={28} className="animate-spin" style={{ color: 'var(--theme-accent)' }} /></div>
        ) : (
          <>
            <div className="odoo-control-bar" style={{ position: 'sticky', top: 0, zIndex: 1 }}>
              <div className="odoo-breadcrumb">
                <MessageSquareWarning size={14} style={{ color: 'var(--theme-accent)' }} />
                <span className="font-mono">{c.number}</span>
                <span className={`odoo-tag ${STATUS_TAG[c.status]}`} style={{ marginLeft: 6 }}>{STATUS_LABELS[c.status]}</span>
                <span className={`odoo-tag ${PRIORITY_TAG[c.priority]}`}>{PRIORITY_LABELS[c.priority]}</span>
              </div>
              <div style={{ flex: 1 }} />
              <button type="button" className="odoo-btn-secondary" onClick={onClose} aria-label="Fermer"><X size={14} /></button>
            </div>

            <div style={{ padding: '16px 20px', display: 'grid', gap: 16 }}>
              {c.is_overdue && (
                <StatusBanner tone="danger" icon={Clock} title="Délai de traitement dépassé">
                  À traiter avant le {format(new Date(c.due_at!), 'dd/MM/yyyy HH:mm')} ; priorité {PRIORITY_LABELS[c.priority].toLowerCase()}.
                </StatusBanner>
              )}

              {/* Actions selon l'étape */}
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                {c.status === 'open' && (
                  <button className="odoo-btn-primary" onClick={() => { if (!c.assigned_to) assignMe.mutate(); setStatus.mutate({ status: 'in_progress' }); }}>
                    <PlayCircle size={13} /> Prendre en charge
                  </button>
                )}
                {(c.status === 'open' || c.status === 'in_progress') && (
                  <>
                    <button className="odoo-btn-primary" onClick={() => setResolving('resolved')}><CheckCircle2 size={13} /> Résoudre</button>
                    <button className="odoo-btn-secondary" onClick={() => setResolving('rejected')}><XCircle size={13} /> Non fondée</button>
                  </>
                )}
                {c.status === 'resolved' && (
                  <button className="odoo-btn-primary" onClick={() => setStatus.mutate({ status: 'closed' })}><Lock size={13} /> Clôturer</button>
                )}
                {['resolved', 'closed', 'rejected'].includes(c.status) && (
                  <button className="odoo-btn-secondary" onClick={() => setStatus.mutate({ status: 'open' })}><RotateCcw size={13} /> Rouvrir</button>
                )}
                {['open', 'in_progress'].includes(c.status) && (
                  c.assigned_to === user?.id
                    ? <button className="odoo-btn-secondary" onClick={() => unassign.mutate()}><User size={13} /> Me retirer</button>
                    : <button className="odoo-btn-secondary" onClick={() => assignMe.mutate()}><User size={13} /> Me l'affecter</button>
                )}
                {['open', 'in_progress'].includes(c.status) && (
                  <select className="odoo-filter-dropdown" value={c.priority} onChange={e => setPriority.mutate(e.target.value as ComplaintPriority)} title="Changer la priorité">
                    {Object.entries(PRIORITY_LABELS).map(([k, v]) => <option key={k} value={k}>Priorité : {v}</option>)}
                  </select>
                )}
              </div>

              {resolving && (
                <div style={{ border: '1px solid var(--odoo-border)', borderRadius: 6, padding: 12, display: 'grid', gap: 10, background: 'var(--odoo-bg-alt)' }}>
                  <strong style={{ fontSize: '0.875rem' }}>{resolving === 'resolved' ? 'Réponse donnée au client' : 'Réclamation non fondée'}</strong>
                  {resolving === 'resolved' && (
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 160px', gap: 10 }}>
                      <select className="input" value={resolutionCode} onChange={e => setResolutionCode(e.target.value as ResolutionCode)}>
                        {(Object.entries(RESOLUTION_LABELS) as [ResolutionCode, string][]).filter(([k]) => k !== 'not_founded').map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                      </select>
                      <input className="input" type="number" min="0" step="0.01" value={amount} onChange={e => setAmount(e.target.value)} placeholder="Montant (DH)" />
                    </div>
                  )}
                  <textarea className="input" style={{ minHeight: 70 }} value={resolution} onChange={e => setResolution(e.target.value)}
                    placeholder={resolving === 'resolved' ? 'Ce qui a été fait pour le client…' : 'Pourquoi la réclamation n\'est pas retenue…'} />
                  <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                    <button className="odoo-btn-secondary" onClick={() => setResolving(null)}>Annuler</button>
                    <button className="odoo-btn-primary" disabled={setStatus.isPending}
                      onClick={() => setStatus.mutate(resolving === 'resolved'
                        ? { status: 'resolved', resolutionCode, resolution: resolution.trim() || undefined, resolutionAmount: amount ? Number(amount) : null }
                        : { status: 'rejected', note: resolution.trim() || undefined })}>
                      Confirmer
                    </button>
                  </div>
                </div>
              )}

              <div>
                <h3 style={{ margin: '0 0 6px', fontSize: '1rem' }}>{c.subject}</h3>
                {c.description && <p style={{ margin: 0, fontSize: '0.8125rem', whiteSpace: 'pre-wrap' }}>{c.description}</p>}
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 24px' }}>
                <div>
                  {row('Client', <>{c.customer_label}{c.customer_phone ? <span style={{ color: 'var(--theme-text-muted)' }}> · {c.customer_phone}</span> : null}</>)}
                  {row('Motif', getLabel(c.category_code) || c.category_label || c.category_code)}
                  {row('Canal', CHANNEL_LABELS[c.channel])}
                  {row('Article', c.product_name)}
                  {row('Lot', c.lot_number)}
                  {row('Quantité', c.quantity ? Number(c.quantity).toLocaleString('fr-FR') : null)}
                </div>
                <div>
                  {row('Ticket', c.sale_number && <span className="font-mono">{c.sale_number}</span>)}
                  {row('Commande', c.order_number && <span className="font-mono">{c.order_number}</span>)}
                  {row('Facture', c.invoice_number && <span className="font-mono">{c.invoice_number}</span>)}
                  {row('Déclarée le', `${format(new Date(c.created_at), 'dd/MM/yyyy HH:mm')} par ${c.created_by_name || '—'}`)}
                  {row('Délai', c.due_at ? format(new Date(c.due_at), 'dd/MM/yyyy HH:mm') : null)}
                  {row('Responsable', c.assigned_name)}
                </div>
              </div>

              {c.resolution_code && (
                <StatusBanner tone={c.status === 'rejected' ? 'neutral' : 'success'} icon={c.status === 'rejected' ? XCircle : CheckCircle2}
                  title={`${RESOLUTION_LABELS[c.resolution_code]}${c.resolution_amount ? ` · ${Number(c.resolution_amount).toFixed(2)} DH` : ''}`}>
                  {c.resolution || '—'}{c.resolved_by_name ? ` — ${c.resolved_by_name}, ${format(new Date(c.resolved_at!), 'dd/MM/yyyy')}` : ''}
                </StatusBanner>
              )}

              {c.photo_url && <img src={serverUrl(c.photo_url)} alt="Photo jointe" style={{ maxHeight: 240, borderRadius: 6, border: '1px solid var(--odoo-border)', objectFit: 'contain', alignSelf: 'start' }} />}

              {/* Journal */}
              <div>
                <div className="odoo-section-header" style={{ border: 'none', paddingLeft: 0 }}>Journal</div>
                <ol style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 6 }}>
                  {(c.events ?? []).map(e => (
                    <li key={e.id} style={{ fontSize: '0.8125rem', display: 'grid', gridTemplateColumns: '120px 1fr', gap: 8 }}>
                      <span style={{ color: 'var(--theme-text-muted)' }}>{format(new Date(e.created_at), 'dd/MM HH:mm')}</span>
                      <span>
                        <strong>{e.by_name || '—'}</strong> · {eventLabel(e.event_type, e.from_value, e.to_value)}
                        {e.note && <span style={{ display: 'block', whiteSpace: 'pre-wrap' }}>{e.note}</span>}
                      </span>
                    </li>
                  ))}
                </ol>
                <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
                  <input className="input" style={{ flex: 1 }} value={note} onChange={e => setNote(e.target.value)} placeholder="Ajouter une note (appel du client, décision…)"
                    onKeyDown={e => { if (e.key === 'Enter' && note.trim()) comment.mutate(); }} />
                  <button className="odoo-btn-secondary" disabled={!note.trim() || comment.isPending} onClick={() => comment.mutate()}><Send size={13} /></button>
                </div>
              </div>
            </div>
          </>
        )}
      </div>
    </ModalBackdrop>
  );
}

function eventLabel(type: string, from: string | null, to: string | null): string {
  switch (type) {
    case 'created': return `réclamation créée (priorité ${PRIORITY_LABELS[(to as ComplaintPriority) ?? 'normal']?.toLowerCase() ?? to})`;
    case 'status': return `${STATUS_LABELS[(from as ComplaintStatus)] ?? from} → ${STATUS_LABELS[(to as ComplaintStatus)] ?? to}`;
    case 'assigned': return to ? 'affectée' : 'désaffectée';
    case 'priority': return `priorité ${PRIORITY_LABELS[(from as ComplaintPriority)] ?? from} → ${PRIORITY_LABELS[(to as ComplaintPriority)] ?? to}`;
    case 'edited': return 'fiche modifiée';
    default: return 'note';
  }
}
