import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ClipboardCheck, Download, ExternalLink, Lock, Plus, ScanSearch } from 'lucide-react';
import { reviewsApi, type ReviewCampaign, type ReviewDecision, type ReviewItem, type ReviewSignals } from '../../api/users.api';
import { Alert, DataPanel, EmptyState, ErrorState, FormField, LoadingState, Modal, SectionHeader, TableFooter } from '../../components/ds';
import { StatusTag, type StatusTone } from '../../components/ui/StatusTag';
import { useConfirm } from '../../components/ui/ConfirmDialog';
import { notify } from '../../components/ui/InlineNotification';
import { FilterChips } from '../sales/ListTemplate';
import { useAccountActions, errorMessage, formatLastLogin, formatDateTime } from './AccountSecurity';
import { fmtDate } from './UsersOverview';
import { AccessReviewModal } from './AccessReviewPanel';
import { useAuth } from '../../context/AuthContext';

/**
 * Revue des accès en campagnes (refonte Utilisateurs, lot 9, mig 709) : chaque compte actif est
 * confirmé, corrigé ou désactivé ; la décision est datée et signée, puis reprise dans le rapport.
 * Une seule revue ouverte à la fois ; la clôture exige que tous les comptes aient une décision.
 */

const DECISION_LABEL: Record<ReviewDecision, string> = { confirmed: 'Confirmé', corrected: 'Corrigé', deactivated: 'Désactivé' };
const DECISION_TONE: Record<ReviewDecision, StatusTone> = { confirmed: 'done', corrected: 'progress', deactivated: 'cancelled' };

function signalTags(s: ReviewSignals): { tone: StatusTone; label: string }[] {
  const out: { tone: StatusTone; label: string }[] = [];
  if (s.conflicts.length) out.push({ tone: 'blocked', label: 'Conflit de tâches' });
  if (s.dormantDays !== null) out.push({ tone: 'draft', label: `Dormant (${s.dormantDays} j)` });
  if (s.delegated.length) out.push({ tone: 'todo', label: 'Délégation en cours' });
  if (s.exceptions) out.push({ tone: 'todo', label: `${s.exceptions} exception${s.exceptions > 1 ? 's' : ''}` });
  return out;
}
const signalText = (s?: ReviewSignals) => (s ? signalTags(s).map(t => t.label).join(', ') || 'aucun' : '');

/** Trimestre en cours : « Revue du 4ᵉ trimestre 2026 ». */
function defaultLabel() {
  const d = new Date();
  const q = Math.floor(d.getMonth() / 3) + 1;
  return `Revue du ${q}${q === 1 ? 'er' : 'ᵉ'} trimestre ${d.getFullYear()}`;
}
const inDays = (n: number) => new Date(Date.now() + n * 86_400_000).toLocaleDateString('sv-SE');

/** Rapport de revue (CSV, séparateur « ; », lisible par un tableur) : une ligne par compte. */
function downloadReport(c: ReviewCampaign, items: ReviewItem[]) {
  const esc = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const lines = [
    [c.label], [`Ouverte le ${fmtDate(c.opened_at)} par ${c.opened_by_name ?? '—'}`],
    [c.closed_at ? `Clôturée le ${fmtDate(c.closed_at)} par ${c.closed_by_name ?? '—'}` : 'En cours'],
    [],
    ['Compte', 'E-mail', 'Rôles à l\'ouverture', 'Établissements', 'Signaux à l\'ouverture', 'Décision', 'Ce qui a été fait', 'Par', 'Le'],
    ...items.map(i => [
      i.name, i.email, (i.snapshot.roles ?? i.roles).map(r => r.label).join(', '), (i.snapshot.stores ?? i.stores).join(', '),
      signalText(i.snapshot.signals), i.decision ? DECISION_LABEL[i.decision] : 'À examiner', i.comment ?? '', i.decidedBy ?? '',
      i.decidedAt ? formatDateTime(i.decidedAt) : '',
    ]),
  ];
  const csv = '﻿' + lines.map(l => l.map(esc).join(';')).join('\r\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  a.download = `${c.label.replace(/[^\p{L}\p{N}]+/gu, '-').toLowerCase()}.csv`;
  a.click();
  URL.revokeObjectURL(a.href);
}

export default function ReviewCampaigns() {
  const { data: campaigns = [], isLoading, isError, error, refetch } = useQuery({ queryKey: ['access-reviews'], queryFn: reviewsApi.list });
  const [opening, setOpening] = useState(false);
  if (isError) return <ErrorState error={error} title="Les revues n'ont pas pu être chargées" onRetry={() => void refetch()} />;
  if (isLoading) return <LoadingState />;
  const open = campaigns.find(c => c.status === 'open');
  const closed = campaigns.filter(c => c.status === 'closed');
  return (
    <div style={{ display: 'grid', gap: 'var(--ds-s5)' }}>
      {open ? <OpenCampaign id={open.id} /> : (
        <DataPanel label="Revue en cours">
          <EmptyState icon={ClipboardCheck} title="Aucune revue en cours"
            text="Une revue reprend tous les comptes actifs : chacun est confirmé, corrigé ou désactivé, et la décision est datée et signée."
            action={<button type="button" className="odoo-btn-primary" onClick={() => setOpening(true)}><Plus size={14} aria-hidden="true" /> Ouvrir une revue</button>} />
        </DataPanel>
      )}
      {closed.length > 0 && (
        <section style={{ display: 'grid', gap: 'var(--ds-s3)' }}>
          <SectionHeader title="Revues clôturées" note="Le rapport reprend les décisions et la photo des droits à l'ouverture" />
          <DataPanel label="Revues clôturées">
            <table className="odoo-table ds-dense">
              <thead><tr><th>Revue</th><th>Ouverte le</th><th>Clôturée</th><th className="ds-num">Confirmés</th><th className="ds-num">Corrigés</th><th className="ds-actions"><span className="sr-only">Rapport</span></th></tr></thead>
              <tbody>
                {closed.map(c => <ClosedRow key={c.id} c={c} />)}
              </tbody>
            </table>
          </DataPanel>
        </section>
      )}
      {opening && <OpenReviewModal onClose={() => setOpening(false)} />}
    </div>
  );
}

function ClosedRow({ c }: { c: ReviewCampaign }) {
  const [busy, setBusy] = useState(false);
  const report = async () => {
    setBusy(true);
    try { const d = await reviewsApi.get(c.id); downloadReport(d.campaign, d.items); }
    catch (err) { notify.error(errorMessage(err, 'Rapport indisponible')); }
    finally { setBusy(false); }
  };
  return (
    <tr>
      <td className="ds-strong">{c.label}</td>
      <td>{fmtDate(c.opened_at)}</td>
      <td>{fmtDate(c.closed_at)}{c.closed_by_name ? ` par ${c.closed_by_name}` : ''}</td>
      <td className="ds-num">{c.confirmed}</td>
      <td className="ds-num">{c.corrected}</td>
      <td className="ds-actions"><button type="button" className="odoo-btn-secondary ds-btn-sm" disabled={busy} onClick={() => void report()}><Download size={13} aria-hidden="true" /> Rapport</button></td>
    </tr>
  );
}

function OpenReviewModal({ onClose }: { onClose: () => void }) {
  const queryClient = useQueryClient();
  const [label, setLabel] = useState(defaultLabel());
  const [due, setDue] = useState(inDays(14));
  const open = useMutation({
    mutationFn: () => reviewsApi.open(label.trim(), due || null),
    onSuccess: () => { notify.success('Revue ouverte'); queryClient.invalidateQueries({ queryKey: ['access-reviews'] }); onClose(); },
    onError: err => notify.error(errorMessage(err, 'Ouverture refusée')),
  });
  return (
    <Modal subtitle="Revue des accès" title="Ouvrir une revue" width={520} onClose={onClose}
      footer={<>
        <button type="button" className="odoo-btn-secondary" onClick={onClose}>Annuler</button>
        <button type="button" className="odoo-btn-primary" disabled={label.trim().length < 3 || open.isPending} onClick={() => open.mutate()}>
          {open.isPending ? 'Ouverture…' : 'Ouvrir la revue'}
        </button>
      </>}>
      <div style={{ display: 'grid', gap: 'var(--ds-s4)' }}>
        <FormField label="Nom" required htmlFor="rv-label">
          <input id="rv-label" className="ds-input" value={label} maxLength={120} onChange={e => setLabel(e.target.value)} />
        </FormField>
        <FormField label="Échéance" htmlFor="rv-due" hint="Date à laquelle chaque compte doit avoir une décision.">
          <input id="rv-due" type="date" className="ds-input" min={inDays(0)} value={due} onChange={e => setDue(e.target.value)} />
        </FormField>
        <Alert tone="info">Tous les comptes actifs sont repris, avec une photo de leurs droits à l'ouverture pour le rapport.</Alert>
      </div>
    </Modal>
  );
}

type Tab = 'todo' | 'confirmed' | 'corrected';

function OpenCampaign({ id }: { id: string }) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const confirm = useConfirm();
  const { run } = useAccountActions();
  const { user: me } = useAuth();
  const { data, isLoading, isError, error, refetch } = useQuery({ queryKey: ['access-review', 'campaign', id], queryFn: () => reviewsApi.get(id) });
  const [tab, setTab] = useState<Tab>('todo');
  const [correcting, setCorrecting] = useState<ReviewItem | null>(null);
  const [analyse, setAnalyse] = useState<ReviewItem | null>(null);
  const refresh = () => ['access-reviews', 'access-review', 'users'].forEach(k => queryClient.invalidateQueries({ queryKey: [k] }));
  const decide = useMutation({
    mutationFn: (v: { userId: string; decision: ReviewDecision; comment?: string }) => reviewsApi.decide(id, v.userId, v.decision, v.comment),
    onSuccess: (_d, v) => { notify.success(`${DECISION_LABEL[v.decision]} : décision enregistrée`); setCorrecting(null); refresh(); },
    onError: err => notify.error(errorMessage(err, 'Décision refusée')),
  });
  const reset = useMutation({
    mutationFn: (userId: string) => reviewsApi.reset(id, userId),
    onSuccess: () => { notify.success('Décision annulée : le compte est à examiner'); refresh(); },
    onError: err => notify.error(errorMessage(err, 'Annulation refusée')),
  });
  const clean = useMutation({
    mutationFn: () => reviewsApi.confirmClean(id),
    onSuccess: r => { notify.success(r.confirmed ? `${r.confirmed} compte${r.confirmed > 1 ? 's confirmés' : ' confirmé'}` : 'Aucun compte sans signal à confirmer'); refresh(); },
    onError: err => notify.error(errorMessage(err, 'Confirmation refusée')),
  });
  const close = useMutation({
    mutationFn: () => reviewsApi.close(id),
    onSuccess: () => { notify.success('Revue clôturée'); refresh(); },
    onError: err => notify.error(errorMessage(err, 'Clôture refusée')),
  });

  if (isError) return <ErrorState error={error} title="La revue n'a pas pu être chargée" onRetry={() => void refetch()} />;
  if (isLoading || !data) return <LoadingState />;
  const { campaign: c, items } = data;
  const todo = items.filter(i => !i.decision);
  const confirmed = items.filter(i => i.decision === 'confirmed');
  const corrected = items.filter(i => i.decision === 'corrected' || i.decision === 'deactivated');
  const decided = items.length - todo.length;
  // Son propre compte est revu par un autre administrateur (sauf seul administrateur actif).
  const locked = (i: ReviewItem) => i.userId === me?.id && !data.selfDecisionAllowed;
  const cleanCount = todo.filter(i => i.isActive && signalTags(i.signals).length === 0 && !locked(i)).length;
  const overdue = !!c.due_on && c.due_on < new Date().toLocaleDateString('sv-SE');

  const deactivate = async (i: ReviewItem) => {
    const ok = await run('deactivate', { id: i.userId, firstName: i.name, lastName: '' });
    if (ok) decide.mutate({ userId: i.userId, decision: 'deactivated', comment: i.signals.dormantDays !== null ? `Compte dormant (${i.signals.dormantDays} j)` : 'Compte désactivé' });
  };
  const askClose = async () => {
    if (await confirm(`Les ${items.length} décisions de « ${c.label} » sont figées et le rapport reste disponible.`, { title: 'Clôturer la revue ?', confirmLabel: 'Clôturer la revue' })) close.mutate();
  };

  const who = (i: ReviewItem) => (
    <td>
      <div className="ds-strong">{i.name}{i.userId === me?.id && <span className="kl-tag b" style={{ marginLeft: 6 }}>Vous</span>}{!i.isActive && <span className="kl-tag x" style={{ marginLeft: 6 }}>Désactivé</span>}</div>
      <div style={{ fontSize: 12, color: 'var(--ds-muted)' }}>{i.stores.length ? i.stores.join(', ') : 'Tous les établissements'}</div>
    </td>
  );
  const rolesCell = (i: ReviewItem) => (
    <td><div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
      {i.roles.map((r, k) => <span key={r.code} className={`kl-tag ${k === 0 && !r.delegated ? 'b' : 'x'}`}>{r.label}{r.delegated ? ' (délégué)' : ''}</span>)}
    </div></td>
  );

  return (
    <div style={{ display: 'grid', gap: 'var(--ds-s4)' }}>
      <DataPanel label={c.label}>
        <div className="usr-pad" style={{ display: 'flex', gap: 16, alignItems: 'center', flexWrap: 'wrap' }}>
          <div style={{ flex: '1 1 320px', minWidth: 0 }}>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              <h2 style={{ margin: 0, fontSize: 18, fontWeight: 600 }}>{c.label}</h2>
              <StatusTag tone={overdue ? 'late' : 'progress'} label={overdue ? 'En retard' : 'En cours'} />
            </div>
            <p style={{ margin: '4px 0 0', fontSize: 13, color: 'var(--ds-muted)' }}>
              Ouverte le {fmtDate(c.opened_at)} par {c.opened_by_name ?? '—'}{c.due_on ? ` · échéance le ${fmtDate(c.due_on)}` : ''}
            </p>
            <div style={{ marginTop: 10, display: 'flex', alignItems: 'center', gap: 10 }}>
              <div role="progressbar" aria-valuemin={0} aria-valuemax={items.length} aria-valuenow={decided} aria-label="Comptes décidés"
                style={{ flex: '0 1 260px', height: 6, borderRadius: 3, background: 'var(--ds-hair)', overflow: 'hidden' }}>
                <div style={{ width: `${items.length ? (decided / items.length) * 100 : 0}%`, height: '100%', background: 'var(--ds-accent)' }} />
              </div>
              <span style={{ fontSize: 13 }}>{decided} compte{decided > 1 ? 's' : ''} décidé{decided > 1 ? 's' : ''} sur {items.length}</span>
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button type="button" className="odoo-btn-secondary ds-btn-sm" onClick={() => downloadReport(c, items)}><Download size={13} aria-hidden="true" /> Rapport de revue</button>
            <button type="button" className="odoo-btn-primary ds-btn-sm" disabled={todo.length > 0 || close.isPending}
              title={todo.length ? `${todo.length} compte${todo.length > 1 ? 's' : ''} à examiner` : undefined} onClick={() => void askClose()}>
              <Lock size={13} aria-hidden="true" /> Clôturer la revue
            </button>
          </div>
        </div>
      </DataPanel>

      <FilterChips label="Comptes de la revue" value={tab} onChange={k => setTab(k as Tab)} chips={[
        { key: 'todo', label: 'À examiner', count: todo.length },
        { key: 'confirmed', label: 'Confirmés', count: confirmed.length },
        { key: 'corrected', label: 'Corrigés', count: corrected.length },
      ]} />

      {tab === 'todo' && (
        <DataPanel label="À examiner" footer={todo.length > 0 ? (
          <TableFooter note={`${todo.length} compte${todo.length > 1 ? 's' : ''} à examiner`}>
            <button type="button" className="odoo-btn-secondary ds-btn-sm" disabled={!cleanCount || clean.isPending} onClick={() => clean.mutate()}>
              Confirmer les comptes sans signal{cleanCount ? ` (${cleanCount})` : ''}
            </button>
          </TableFooter>
        ) : undefined}>
          {todo.length ? (
            <table className="odoo-table">
              <thead><tr><th>Compte</th><th>Rôles</th><th className="ds-num">Exceptions</th><th>Signal</th><th>Dernière connexion</th><th className="ds-actions">Décision</th></tr></thead>
              <tbody>
                {todo.map(i => {
                  const tags = signalTags(i.signals);
                  return (
                    <tr key={i.userId}>
                      {who(i)}
                      {rolesCell(i)}
                      <td className="ds-num">{i.signals.exceptions || '—'}</td>
                      <td><div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>{tags.length ? tags.map(t => <StatusTag key={t.label} tone={t.tone} label={t.label} title={t.label === 'Conflit de tâches' ? i.signals.conflicts.join(' ; ') : undefined} />) : '—'}</div></td>
                      <td>{i.lastLoginAt ? formatLastLogin(i.lastLoginAt) : 'Jamais'}</td>
                      <td className="ds-actions" style={{ whiteSpace: 'nowrap' }}>
                        <button type="button" className="ds-icon-btn" aria-label={`Analyser les droits de ${i.name}`} title="Analyser" onClick={() => setAnalyse(i)}><ScanSearch size={15} /></button>
                        {locked(i) ? <span style={{ fontSize: 13, color: 'var(--ds-muted)' }}>Revu par un autre administrateur</span> : <>
                        {i.signals.dormantDays !== null && i.isActive
                          ? <button type="button" className="odoo-btn-secondary ds-btn-sm" onClick={() => void deactivate(i)}>Désactiver</button>
                          : <button type="button" className="odoo-btn-secondary ds-btn-sm" onClick={() => setCorrecting(i)}>Corriger</button>}
                        <button type="button" className="odoo-btn-primary ds-btn-sm" disabled={decide.isPending} onClick={() => decide.mutate({ userId: i.userId, decision: 'confirmed' })}>Confirmer</button>
                        </>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          ) : <EmptyState icon={ClipboardCheck} bare title="Tous les comptes ont une décision" text="La revue peut être clôturée ; le rapport reprend chaque décision." />}
        </DataPanel>
      )}

      {tab !== 'todo' && (
        <DataPanel label={tab === 'confirmed' ? 'Confirmés' : 'Corrigés'} footer={<TableFooter note="Chaque décision est datée et signée, puis reprise dans le rapport de revue." />}>
          {(tab === 'confirmed' ? confirmed : corrected).length ? (
            <table className="odoo-table ds-dense">
              <thead><tr><th>Compte</th><th>Rôles</th><th>Décision</th>{tab === 'corrected' && <th>Ce qui a été fait</th>}<th>Par</th><th>Le</th><th className="ds-actions"><span className="sr-only">Annuler</span></th></tr></thead>
              <tbody>
                {(tab === 'confirmed' ? confirmed : corrected).map(i => (
                  <tr key={i.userId}>
                    {who(i)}
                    {rolesCell(i)}
                    <td><StatusTag tone={DECISION_TONE[i.decision!]} label={DECISION_LABEL[i.decision!]} /></td>
                    {tab === 'corrected' && <td>{i.comment ?? '—'}</td>}
                    <td>{i.decidedBy ?? '—'}</td>
                    <td>{fmtDate(i.decidedAt)}</td>
                    <td className="ds-actions">{!locked(i) && <button type="button" className="ds-btn-ghost ds-btn-sm" disabled={reset.isPending} onClick={() => reset.mutate(i.userId)}>Annuler</button>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : <EmptyState icon={ClipboardCheck} bare
              title={tab === 'confirmed' ? 'Aucun compte confirmé pour l\'instant' : 'Aucun compte corrigé pour l\'instant'}
              text={tab === 'confirmed' ? 'Les comptes confirmés apparaîtront ici.' : 'Les comptes dont vous retirez un rôle, une exception ou un établissement pendant la revue apparaîtront ici.'} />}
        </DataPanel>
      )}

      {correcting && <CorrectModal item={correcting} busy={decide.isPending} onClose={() => setCorrecting(null)}
        onOpen={() => navigate(`/users/${correcting.userId}?tab=roles`)}
        onSave={comment => decide.mutate({ userId: correcting.userId, decision: 'corrected', comment })} />}
      {analyse && <AccessReviewModal userId={analyse.userId} name={analyse.name} onClose={() => setAnalyse(null)} />}
    </div>
  );
}

function CorrectModal({ item, busy, onClose, onOpen, onSave }: {
  item: ReviewItem; busy: boolean; onClose: () => void; onOpen: () => void; onSave: (comment: string) => void;
}) {
  const [comment, setComment] = useState('');
  const tags = signalTags(item.signals);
  return (
    <Modal subtitle="Revue des accès" title={`Corriger les droits de ${item.name}`} width={560} onClose={onClose}
      footer={<>
        <button type="button" className="odoo-btn-secondary" style={{ marginRight: 'auto' }} onClick={onOpen}>Ouvrir la fiche <ExternalLink size={12} aria-hidden="true" /></button>
        <button type="button" className="odoo-btn-secondary" onClick={onClose}>Annuler</button>
        <button type="button" className="odoo-btn-primary" disabled={!comment.trim() || busy} onClick={() => onSave(comment.trim())}>Enregistrer « Corrigé »</button>
      </>}>
      <div style={{ display: 'grid', gap: 'var(--ds-s4)' }}>
        <p style={{ margin: 0, fontSize: 14 }}>
          Retirez le rôle, l'exception ou l'établissement en trop depuis la fiche du compte, puis notez ici ce qui a changé.
        </p>
        {tags.length > 0 && (
          <div style={{ display: 'grid', gap: 4, fontSize: 13 }}>
            {item.signals.conflicts.map(v => <div key={v}><StatusTag tone="blocked" label="Conflit" /> {v}</div>)}
            {item.signals.delegated.length > 0 && <div><StatusTag tone="todo" label="Délégation" /> {item.signals.delegated.join(', ')}</div>}
            {item.signals.exceptions > 0 && <div><StatusTag tone="todo" label="Exceptions" /> {item.signals.exceptions} exception{item.signals.exceptions > 1 ? 's' : ''} individuelle{item.signals.exceptions > 1 ? 's' : ''}</div>}
          </div>
        )}
        <FormField label="Ce qui a été corrigé" required htmlFor="rv-comment">
          <textarea id="rv-comment" className="ds-input" rows={3} maxLength={500} value={comment} onChange={e => setComment(e.target.value)}
            placeholder="Ex. rôle Magasinier retiré (séparation avec la réception)" />
        </FormField>
      </div>
    </Modal>
  );
}
