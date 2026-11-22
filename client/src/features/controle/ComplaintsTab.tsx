import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlertTriangle, CheckCircle2, Clock, X, XCircle, PlayCircle, Lock, RotateCcw, User, Send,
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
import { RowMenu } from '../../components/ui/RowMenu';
import { StatusBanner } from '../../components/ui/StatusBanner';
import { StatusTag, type StatusTone } from '../../components/ui/StatusTag';
import ComplaintFormModal from '../../components/sav/ComplaintFormModal';
import { PAGE_SIZE, type StageDef } from '../../components/purchasing/ProcessBoard';
import { ListToolbar } from '../sales/ListTemplate';
import { StageChips, Panel, PagerFoot, PageLoading } from './KlUi';
import { Drawer, EmptyState, FormField, FormFooter, NoResultState, SectionHeader } from '../../components/ds';
import { InterventionFormModal } from '../maintenance/forms';
import { usePermissions } from '../../context/PermissionsContext';
import { useNavigate } from 'react-router-dom';
import { Wrench } from 'lucide-react';
import { money, currencySymbol } from '../../utils/money';

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
/** Statut d'une réclamation en étiquette commune : ouverte = à traiter, non fondée = classée sans suite. */
const STATUS_TONE: Record<ComplaintStatus, StatusTone> = { open: 'todo', in_progress: 'progress', resolved: 'done', closed: 'done', rejected: 'cancelled' };

export default function ComplaintsTab({ range, periodText, creating, onCreatingChange }: {
  range: Record<string, string>; periodText: string;
  /** Fenêtre « Nouvelle réclamation » : ouverte depuis le bouton de la barre (ControlePage). */
  creating: boolean; onCreatingChange: (open: boolean) => void;
}) {
  const [status, setStatus] = useState<ComplaintStatus | ''>('');
  const [priority, setPriority] = useState<ComplaintPriority | ''>('');
  const [overdueOnly, setOverdueOnly] = useState(false);
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [openId, setOpenId] = useState<string | null>(null);

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
      <StageChips
        title="Où en sont les réclamations"
        summary={`${openCount} à traiter · ${overdue} en retard · ${periodText}`}
        stages={STAGES}
        stats={Object.fromEntries(STAGES.map(s => [s.key, {
          count: by[s.key]?.count ?? 0, sub: '', late: by[s.key]?.overdue ?? 0, alertLabel: 'en retard',
        }]))}
        isActive={k => status === k}
        onPick={k => setStatus(status === k ? '' : (k as ComplaintStatus))}
      />

      <ListToolbar search={searchInput} onSearch={setSearchInput} placeholder="N°, sujet, client, article…">
        <select className="odoo-filter-dropdown" aria-label="Priorité" value={priority} onChange={e => setPriority(e.target.value as ComplaintPriority | '')}>
          <option value="">Toutes priorités</option>
          {Object.entries(PRIORITY_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 13, cursor: 'pointer' }}>
          <input type="checkbox" checked={overdueOnly} onChange={e => setOverdueOnly(e.target.checked)} /> En retard seulement
        </label>
      </ListToolbar>

      {isLoading ? <PageLoading /> : rows.length === 0 ? (
        (status || priority || overdueOnly || search)
          ? <NoResultState text="Aucune réclamation ne correspond aux filtres." onReset={() => { setStatus(''); setPriority(''); setOverdueOnly(false); setSearchInput(''); setSearch(''); }} />
          : <EmptyState icon={CheckCircle2} title="Aucune réclamation sur la période" text="Les réclamations saisies ici ou depuis la caisse s'affichent dans cette liste." />
      ) : (
        <Panel footer={<PagerFoot page={page} total={data?.total ?? 0} onPage={setPage} note={`${data?.total ?? 0} réclamation${(data?.total ?? 0) > 1 ? 's' : ''}`} />}>
          <table className="odoo-table">
            <thead>
              <tr>
                <th>N°</th><th>Client</th><th>Motif</th><th>Sujet</th><th>Article</th><th>Priorité</th><th>Statut</th><th>Délai</th><th>Responsable</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(c => (
                <tr key={c.id} onClick={() => setOpenId(c.id)} style={{ cursor: 'pointer' }}>
                  <td className="ds-ref" style={{ whiteSpace: 'nowrap' }}>{c.number}</td>
                  <td className="ds-strong">{c.customer_label || '—'}</td>
                  <td><span className="odoo-tag" style={{ background: c.category_color ? `${c.category_color}22` : undefined, color: c.category_color || undefined }}>{c.category_label || c.category_code}</span></td>
                  <td style={{ maxWidth: 260, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={c.subject}>{c.subject}</td>
                  <td>{c.product_name || '—'}{c.lot_number ? <span style={{ color: 'var(--ds-muted)', fontSize: '0.75rem' }}> · {c.lot_number}</span> : null}</td>
                  <td><span className={`odoo-tag ${PRIORITY_TAG[c.priority]}`}>{PRIORITY_LABELS[c.priority]}</span></td>
                  <td><StatusTag tone={STATUS_TONE[c.status] ?? 'draft'} label={STATUS_LABELS[c.status]} /></td>
                  <td style={{ whiteSpace: 'nowrap' }}><Due c={c} /></td>
                  <td>{c.assigned_name || <span style={{ color: 'var(--ds-muted)' }}>—</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Panel>
      )}

      {creating && <ComplaintFormModal mode="full" onClose={() => onCreatingChange(false)} onCreated={id => setOpenId(id)} />}
      {openId && <ComplaintDrawer id={openId} onClose={() => setOpenId(null)} />}
    </>
  );
}

function Due({ c }: { c: Complaint }) {
  if (!c.due_at || !['open', 'in_progress'].includes(c.status)) return <span style={{ color: 'var(--ds-muted)' }}>—</span>;
  const d = new Date(c.due_at);
  const text = formatDistanceToNow(d, { locale: fr, addSuffix: true });
  return <span style={{ color: c.is_overdue ? 'var(--ds-danger)' : 'var(--ds-muted)', fontWeight: c.is_overdue ? 600 : 400 }}>{c.is_overdue ? `en retard (${text})` : text}</span>;
}

/* ═══════════════════════ FICHE ═══════════════════════ */

function ComplaintDrawer({ id, onClose }: { id: string; onClose: () => void }) {
  const qc = useQueryClient();
  const { user } = useAuth();
  const { hasModule } = usePermissions();
  const navigate = useNavigate();
  const [intervention, setIntervention] = useState(false);
  const { getLabel } = useReferentiel('complaint_categories');
  const { data: c, isLoading } = useQuery({ queryKey: ['complaint', id], queryFn: () => complaintsApi.get(id) });
  const [note, setNote] = useState('');
  const [resolving, setResolving] = useState<null | 'resolved' | 'rejected'>(null);
  const [resolutionCode, setResolutionCode] = useState<ResolutionCode>('replacement');
  const [resolution, setResolution] = useState('');
  const [amount, setAmount] = useState('');

  const refresh = () => { qc.invalidateQueries({ queryKey: ['complaint', id] }); qc.invalidateQueries({ queryKey: ['complaints'] }); qc.invalidateQueries({ queryKey: ['controle-overview'] }); };
  // Hook appelé à chaque rendu, en tête du composant (règle des hooks React).
  const useAct = <T,>(fn: () => Promise<T>, done?: string) => useMutation({
    mutationFn: fn, onSuccess: () => { refresh(); if (done) notify.success(done); }, onError: e => notify.error(apiErrorMessage(e)),
  });
  const setStatus = useMutation({
    mutationFn: (p: Parameters<typeof complaintsApi.setStatus>[1]) => complaintsApi.setStatus(id, p),
    onSuccess: () => { refresh(); setResolving(null); setNote(''); setResolution(''); setAmount(''); },
    onError: e => notify.error(apiErrorMessage(e)),
  });
  const assignMe = useAct(() => complaintsApi.assign(id, user!.id), 'Réclamation prise en charge');
  const unassign = useAct(() => complaintsApi.assign(id, null));
  const comment = useMutation({
    mutationFn: () => complaintsApi.comment(id, note.trim()),
    onSuccess: () => { refresh(); setNote(''); }, onError: e => notify.error(apiErrorMessage(e)),
  });
  const setPriority = useMutation({
    mutationFn: (p: ComplaintPriority) => complaintsApi.setPriority(id, p), onSuccess: refresh, onError: e => notify.error(apiErrorMessage(e)),
  });

  const row = (k: string, v: React.ReactNode) => (
    <div style={{ display: 'grid', gridTemplateColumns: '130px 1fr', gap: 8, fontSize: '0.8125rem', padding: '4px 0' }}>
      <span style={{ color: 'var(--ds-muted)' }}>{k}</span><span>{v ?? '—'}</span>
    </div>
  );

  return (
    <Drawer
      title={c ? <span className="ds-ref" style={{ fontSize: 'inherit' }}>{c.number}</span> : 'Réclamation'}
      subtitle={c?.subject}
      aside={c ? <StatusTag tone={STATUS_TONE[c.status] ?? 'draft'} label={STATUS_LABELS[c.status]} /> : undefined}
      label={c ? `Réclamation ${c.number}` : 'Réclamation'}
      onClose={onClose} width={760}>
        {isLoading || !c ? (
          <PageLoading />
        ) : (
          <>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
                <span className={`odoo-tag ${PRIORITY_TAG[c.priority]}`}>{PRIORITY_LABELS[c.priority]}</span>
              </div>
              {c.is_overdue && (
                <StatusBanner tone="danger" icon={Clock} title="Délai de traitement dépassé">
                  À traiter avant le {format(new Date(c.due_at!), 'd MMM yyyy HH:mm', { locale: fr })} ; priorité {PRIORITY_LABELS[c.priority].toLowerCase()}.
                </StatusBanner>
              )}

              {/* Actions selon l'étape : une seule action principale, une secondaire, le reste dans le menu. */}
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
                {c.status === 'open' && (
                  <>
                    <button type="button" className="odoo-btn-primary" onClick={() => { if (!c.assigned_to) assignMe.mutate(); setStatus.mutate({ status: 'in_progress' }); }}>
                      <PlayCircle size={13} /> Prendre en charge
                    </button>
                    <button type="button" className="odoo-btn-secondary" onClick={() => setResolving('resolved')}><CheckCircle2 size={13} /> Résoudre</button>
                  </>
                )}
                {c.status === 'in_progress' && (
                  <>
                    <button type="button" className="odoo-btn-primary" onClick={() => setResolving('resolved')}><CheckCircle2 size={13} /> Résoudre</button>
                    <button type="button" className="odoo-btn-secondary" onClick={() => setResolving('rejected')}><XCircle size={13} /> Non fondée</button>
                  </>
                )}
                {c.status === 'resolved' && (
                  <button type="button" className="odoo-btn-primary" onClick={() => setStatus.mutate({ status: 'closed' })}><Lock size={13} /> Clôturer</button>
                )}
                {['resolved', 'closed', 'rejected'].includes(c.status) && (
                  <button type="button" className="odoo-btn-secondary" onClick={() => setStatus.mutate({ status: 'open' })}><RotateCcw size={13} /> Rouvrir</button>
                )}
                {['open', 'in_progress'].includes(c.status) && (
                  <select className="ds-input sm" style={{ width: 'auto' }} value={c.priority} onChange={e => setPriority.mutate(e.target.value as ComplaintPriority)} title="Changer la priorité" aria-label="Priorité">
                    {Object.entries(PRIORITY_LABELS).map(([k, v]) => <option key={k} value={k}>Priorité : {v}</option>)}
                  </select>
                )}
                {['open', 'in_progress'].includes(c.status) && (
                  <RowMenu label="Autres actions" items={[
                    ...(c.status === 'open' ? [{ label: 'Non fondée', icon: XCircle, onSelect: () => setResolving('rejected') }] : []),
                    c.assigned_to === user?.id
                      ? { label: 'Me retirer', icon: User, onSelect: () => unassign.mutate() }
                      : { label: 'Me l\'affecter', icon: User, onSelect: () => assignMe.mutate() },
                    // Pont vers la Maintenance (mig 359) : panne chez le client, installation défectueuse…
                    ...(hasModule('maintenance') ? [{ label: 'Créer une intervention', icon: Wrench, onSelect: () => setIntervention(true) }] : []),
                  ]} />
                )}
              </div>

              {resolving && (
                <div className="kl-widget" style={{ display: 'grid', gap: 10 }}>
                  <h3 className="ds-subhead">{resolving === 'resolved' ? 'Réponse donnée au client' : 'Réclamation non fondée'}</h3>
                  {resolving === 'resolved' && (
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 160px', gap: 10 }}>
                      <FormField label="Réponse" htmlFor="cpl-res-code">
                        <select id="cpl-res-code" className="ds-input" value={resolutionCode} onChange={e => setResolutionCode(e.target.value as ResolutionCode)}>
                          {(Object.entries(RESOLUTION_LABELS) as [ResolutionCode, string][]).filter(([k]) => k !== 'not_founded').map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                        </select>
                      </FormField>
                      <FormField label={`Montant (${currencySymbol()})`} htmlFor="cpl-res-amount">
                        <input id="cpl-res-amount" className="ds-input" type="number" min="0" step="0.01" value={amount} onChange={e => setAmount(e.target.value)} />
                      </FormField>
                    </div>
                  )}
                  <FormField label={resolving === 'resolved' ? 'Ce qui a été fait pour le client' : 'Pourquoi la réclamation n\'est pas retenue'} htmlFor="cpl-res-text">
                    <textarea id="cpl-res-text" className="ds-input" style={{ minHeight: 70 }} value={resolution} onChange={e => setResolution(e.target.value)} />
                  </FormField>
                  <FormFooter onCancel={() => setResolving(null)} submitLabel="Confirmer" busy={setStatus.isPending}
                    onSubmit={() => setStatus.mutate(resolving === 'resolved'
                      ? { status: 'resolved', resolutionCode, resolution: resolution.trim() || undefined, resolutionAmount: amount ? Number(amount) : null }
                      : { status: 'rejected', note: resolution.trim() || undefined })} />
                </div>
              )}

              {c.description && <div className="kl-widget" style={{ fontSize: '0.875rem', whiteSpace: 'pre-wrap' }}>{c.description}</div>}

              <div className="kl-widget" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: '0 24px' }}>
                <div>
                  {row('Client', <>{c.customer_label}{c.customer_phone ? <span style={{ color: 'var(--ds-muted)' }}> · {c.customer_phone}</span> : null}</>)}
                  {row('Motif', getLabel(c.category_code) || c.category_label || c.category_code)}
                  {row('Canal', CHANNEL_LABELS[c.channel])}
                  {row('Article', c.product_name)}
                  {row('Lot', c.lot_number)}
                  {row('Quantité', c.quantity ? Number(c.quantity).toLocaleString('fr-FR') : null)}
                </div>
                <div>
                  {row('Ticket', c.sale_number && <span className="ds-ref">{c.sale_number}</span>)}
                  {row('Commande', c.order_number && <span className="ds-ref">{c.order_number}</span>)}
                  {row('Facture', c.invoice_number && <span className="ds-ref">{c.invoice_number}</span>)}
                  {row('Déclarée le', `${format(new Date(c.created_at), 'd MMM yyyy HH:mm', { locale: fr })} par ${c.created_by_name || '—'}`)}
                  {row('Délai', c.due_at ? format(new Date(c.due_at), 'd MMM yyyy HH:mm', { locale: fr }) : null)}
                  {row('Responsable', c.assigned_name)}
                </div>
              </div>

              {c.resolution_code && (
                <StatusBanner tone={c.status === 'rejected' ? 'neutral' : 'success'} icon={c.status === 'rejected' ? XCircle : CheckCircle2}
                  title={`${RESOLUTION_LABELS[c.resolution_code]}${c.resolution_amount ? ` · ${money(Number(c.resolution_amount))}` : ''}`}>
                  {c.resolution || '—'}{c.resolved_by_name ? ` — ${c.resolved_by_name}, ${format(new Date(c.resolved_at!), 'd MMM yyyy', { locale: fr })}` : ''}
                </StatusBanner>
              )}

              {c.photo_url && <img src={serverUrl(c.photo_url)} alt="Photo jointe" style={{ maxHeight: 240, borderRadius: 6, border: '1px solid var(--odoo-border)', objectFit: 'contain', alignSelf: 'start' }} />}

              {/* Journal */}
              <div>
                <SectionHeader title="Journal" />
                <ol className="kl-widget" style={{ listStyle: 'none', margin: 0, display: 'grid', gap: 6 }}>
                  {(c.events ?? []).map(e => (
                    <li key={e.id} style={{ fontSize: '0.8125rem', display: 'grid', gridTemplateColumns: '120px 1fr', gap: 8 }}>
                      <span style={{ color: 'var(--ds-muted)' }}>{format(new Date(e.created_at), 'dd/MM HH:mm')}</span>
                      <span>
                        <strong>{e.by_name || '—'}</strong> · {eventLabel(e.event_type, e.from_value, e.to_value)}
                        {e.note && <span style={{ display: 'block', whiteSpace: 'pre-wrap' }}>{e.note}</span>}
                      </span>
                    </li>
                  ))}
                </ol>
                <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
                  <input className="ds-input" style={{ flex: 1 }} value={note} onChange={e => setNote(e.target.value)} aria-label="Ajouter une note" placeholder="Ajouter une note (appel du client, décision…)"
                    onKeyDown={e => { if (e.key === 'Enter' && note.trim()) comment.mutate(); }} />
                  <button type="button" className="odoo-btn-secondary" disabled={!note.trim() || comment.isPending} onClick={() => comment.mutate()} aria-label="Ajouter la note"><Send size={13} aria-hidden="true" /></button>
                </div>
              </div>
            </div>
          </>
        )}
      {intervention && c && (
        <InterventionFormModal onClose={() => setIntervention(false)} onCreated={id => navigate(`/maintenance?tab=interventions&open=${id}`)}
          defaults={{ title: c.subject, customerId: c.customer_id, customerName: c.customer_label ?? '', equipmentLabel: c.product_name ?? '',
            reportedProblem: c.description ?? '', complaintId: c.id, priority: c.priority, kind: 'corrective' }} />
      )}
    </Drawer>
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
