import { money, currencySymbol } from '../../utils/money';
import { Fragment, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { BellRing, Loader2, Mail, Printer, Phone, Ban, Lock, Unlock, PauseCircle, ChevronDown, ChevronUp, Settings2, CheckCircle2, Plus, Send, type LucideIcon } from 'lucide-react';
import { StatusTag, type StatusTone } from '../../components/ui/StatusTag';
import { format } from 'date-fns';
import { dunningApi, DUNNING_STATUS_LABELS, type Dunning, type DunningLevel, type DunningStatus } from '../../api/dunning.api';
import { apiErrorMessage } from '../../api/errors';
import { notify } from '../../components/ui/InlineNotification';
import { StatusBanner } from '../../components/ui/StatusBanner';
import { useConfirm } from '../../components/ui/ConfirmDialog';
import { PAGE_SIZE } from '../../components/purchasing/ProcessBoard';
import SalesPageShell from '../sales/SalesPageShell';
import { ListKpi, FilterChips } from '../sales/ListTemplate';
import { RowMenu, type RowMenuItem } from '../../components/ui/RowMenu';
import { Tabs, SectionHeader, DataPanel, TableFooter, EmptyState, LoadingState } from '../../components/ds';

/** Statut d'une lettre de relance en étiquette commune (à envoyer = action attendue). */
const DUNNING_TONE: Record<DunningStatus, { tone: StatusTone; icon?: LucideIcon }> = {
  draft: { tone: 'todo' }, sent: { tone: 'progress', icon: Send }, resolved: { tone: 'done' }, cancelled: { tone: 'cancelled' },
};

/**
 * Relances clients (mig 366) : clients à relancer selon les niveaux, lettres (e-mail ou
 * papier), clients bloqués ou en pause, et paramétrage des niveaux.
 */
const n2 = (v: number | string | null | undefined) => Number(v ?? 0).toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fr = (v: string | null | undefined) => (v ? format(new Date(`${String(v).slice(0, 10)}T00:00:00`), 'dd/MM/yyyy') : '—');
const field: React.CSSProperties = { fontSize: '0.875rem', padding: '6px 8px', border: '1px solid var(--odoo-border)', borderRadius: 4, background: 'var(--odoo-bg)', color: 'var(--odoo-text)', width: '100%' };
const lab: React.CSSProperties = { display: 'grid', gap: 4, fontSize: '0.8125rem', color: 'var(--odoo-text-muted)' };
const VIA: Record<string, string> = { email: 'e-mail', print: 'courrier', phone: 'téléphone', other: 'autre' };

async function openPdf(id: string) {
  try { window.open(URL.createObjectURL(await dunningApi.pdf(id)), '_blank'); } catch (e) { notify.error(apiErrorMessage(e)); }
}

export default function DunningPage() {
  const [tab, setTab] = useState<'letters' | 'levels'>('letters');
  return (
    <SalesPageShell icon={BellRing} parent="Ventes" title="Relances" list
      summary="Clients en retard de paiement : relances à préparer, lettres à envoyer et blocages de crédit.">
      <Tabs label="Rubrique" value={tab} onChange={setTab} tabs={[{ key: 'letters', label: 'Relances' }, { key: 'levels', label: 'Niveaux de relance' }]} />
      {tab === 'letters' ? <Letters /> : <Levels />}
    </SalesPageShell>
  );
}

function Letters() {
  const qc = useQueryClient();
  const confirm = useConfirm();
  const { data: ov, isLoading } = useQuery({ queryKey: ['dunning', 'overview'], queryFn: dunningApi.overview });
  const [status, setStatus] = useState<DunningStatus | ''>('draft');
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [openId, setOpenId] = useState<string | null>(null);
  const params: Record<string, string> = { page: String(page), limit: String(PAGE_SIZE) };
  if (status) params.status = status;
  const { data: list } = useQuery({ queryKey: ['dunning', 'list', params], queryFn: () => dunningApi.list(params) });
  const refresh = () => qc.invalidateQueries({ queryKey: ['dunning'] });

  const create = useMutation({
    mutationFn: (ids: string[]) => dunningApi.create(ids),
    onSuccess: r => {
      refresh(); setSelected(new Set()); setStatus('draft');
      notify.success(`${r.data.length} relance(s) créée(s)`);
      if (r.errors.length) notify.error(r.errors[0].error);
    },
    onError: e => notify.error(apiErrorMessage(e)),
  });
  const send = useMutation({
    mutationFn: ({ id, via }: { id: string; via: 'email' | 'print' | 'phone' }) => dunningApi.send(id, via),
    onSuccess: (d, v) => { refresh(); notify.success(v.via === 'email' ? `E-mail mis en file pour ${d.email_to}` : 'Relance marquée envoyée'); },
    onError: e => notify.error(apiErrorMessage(e)),
  });
  const cancel = useMutation({ mutationFn: (id: string) => dunningApi.cancel(id), onSuccess: refresh, onError: e => notify.error(apiErrorMessage(e)) });
  const release = useMutation({ mutationFn: (id: string) => dunningApi.release(id), onSuccess: () => { refresh(); notify.success('Client débloqué'); }, onError: e => notify.error(apiErrorMessage(e)) });
  const unpause = useMutation({ mutationFn: (id: string) => dunningApi.pause(id, null), onSuccess: refresh, onError: e => notify.error(apiErrorMessage(e)) });

  if (isLoading || !ov) return <LoadingState label="Chargement des relances…" />;
  const letterMenu = (d: Dunning): RowMenuItem[] => [
    { label: openId === d.id ? 'Masquer la lettre' : 'Voir la lettre', icon: openId === d.id ? ChevronUp : ChevronDown, onSelect: () => setOpenId(openId === d.id ? null : d.id) },
    ...(d.status === 'draft' ? [
      { label: 'Lettre PDF', icon: Printer, onSelect: () => openPdf(d.id) },
      { label: 'Envoyée par courrier', icon: Mail, onSelect: () => send.mutate({ id: d.id, via: 'print' as const }) },
      { label: 'Relancé par téléphone', icon: Phone, onSelect: () => send.mutate({ id: d.id, via: 'phone' as const }) },
    ] : []),
    ...(d.status === 'draft' || d.status === 'sent' ? [{
      label: 'Annuler la relance', icon: Ban, danger: true,
      onSelect: async () => { if (await confirm(`Annuler la relance ${d.number} ?`, { title: 'Annuler la relance', confirmLabel: 'Annuler la relance', cancelLabel: 'Retour', danger: true })) cancel.mutate(d.id); },
    }] : []),
  ];
  const toRemind = ov.proposals.reduce((s, p) => s + p.overdue, 0);
  const held = ov.blocked.filter(b => b.credit_hold_at);
  return (
    <>
      {!ov.settings.enabled && <StatusBanner tone="warning" icon={BellRing} title="Relances désactivées">Activez-les dans Paramètres › Ventes › Relances clients.</StatusBanner>}
      <section className="prj-kpis" aria-label="Indicateurs">
        <ListKpi label="Clients à relancer" value={String(ov.proposals.length)} sub={`${money(toRemind)} échus`} tone={ov.proposals.length > 0 ? 'red' : undefined} />
        <ListKpi label="Lettres à envoyer" value={String(ov.drafts.count)} sub={`${money(ov.drafts.amount)}`} />
        <ListKpi label="Clients bloqués" value={String(held.length)} sub="achats à crédit suspendus" tone={held.length > 0 ? 'red' : undefined} />
        <ListKpi label="Contrôle du plafond" value={ov.settings.credit_control === 'block' ? 'Bloquant' : 'Alerte'} sub={ov.settings.auto_send ? 'e-mails envoyés automatiquement' : 'e-mails validés à la main'} />
      </section>

      <section style={{ display: 'grid', gap: 8 }}>
        <SectionHeader title="À relancer maintenant" note={ov.proposals.length ? `${ov.proposals.length} client${ov.proposals.length > 1 ? 's' : ''} · ${money(toRemind)} échus` : undefined} />
        {ov.proposals.length === 0 ? (
          <StatusBanner tone="success" icon={CheckCircle2} title="Aucun client à relancer">Chaque client en retard a déjà reçu la relance de son niveau. La tâche quotidienne propose la suivante quand un seuil est franchi.</StatusBanner>
        ) : (
          <DataPanel label="Clients à relancer" footer={
            <TableFooter note={selected.size ? `${selected.size} client${selected.size > 1 ? 's' : ''} sélectionné${selected.size > 1 ? 's' : ''}` : 'Cochez les clients à relancer'}>
              <button type="button" className="odoo-btn-primary ds-btn-sm" disabled={!selected.size || create.isPending} onClick={() => create.mutate([...selected])}>
                {create.isPending ? <Loader2 size={13} className="animate-spin" /> : <Plus size={13} />} Préparer {selected.size || ''} relance{selected.size > 1 ? 's' : ''}
              </button>
            </TableFooter>
          }>
            <table className="odoo-table">
              <thead><tr>
                <th style={{ width: 32 }}><input type="checkbox" aria-label="Tout sélectionner" checked={selected.size === ov.proposals.length}
                  onChange={e => setSelected(e.target.checked ? new Set(ov.proposals.map(p => p.customerId)) : new Set())} /></th>
                <th>Client</th><th className="ds-num">Échu ({currencySymbol()})</th><th className="ds-num">Plus ancien retard (j)</th><th>Pièces</th><th>Dernière relance</th><th>Relance proposée</th>
              </tr></thead>
              <tbody>{ov.proposals.map(p => (
                <tr key={p.customerId} className={selected.has(p.customerId) ? 'ds-selected' : undefined}>
                  <td><input type="checkbox" aria-label={`Sélectionner ${p.customerName}`} checked={selected.has(p.customerId)}
                    onChange={e => { const s = new Set(selected); if (e.target.checked) s.add(p.customerId); else s.delete(p.customerId); setSelected(s); }} /></td>
                  <td><span className="ds-strong">{p.customerName}</span>{p.creditHold && <>{' '}<StatusTag tone="blocked" icon={Lock} label="bloqué" /></>}
                    <div style={{ fontSize: '0.75rem', color: 'var(--theme-text-muted)' }}>{p.email || <span style={{ color: 'var(--ds-warning)' }}>pas d'e-mail</span>}{p.phone ? ` · ${p.phone}` : ''}</div></td>
                  <td className="ds-num ds-strong">{n2(p.overdue)}</td>
                  <td className="ds-num" style={{ color: p.maxDaysLate > 60 ? 'var(--ds-danger)' : undefined }}>{p.maxDaysLate}</td>
                  <td style={{ fontSize: '0.8125rem' }}>{p.docs.map(d => d.number).join(', ')}</td>
                  <td>{p.lastLevel ? `Niveau ${p.lastLevel} · ${fr(p.lastDunningAt)}` : '—'}</td>
                  <td><span className="odoo-tag odoo-tag-orange">{p.targetLevel} · {p.targetLabel}</span></td>
                </tr>
              ))}</tbody>
            </table>
          </DataPanel>
        )}
      </section>

      <section style={{ display: 'grid', gap: 8 }}>
        <SectionHeader title="Lettres de relance" />
        <FilterChips label="Filtrer les lettres par statut" value={status} onChange={k => { setStatus(k as DunningStatus | ''); setPage(1); }} chips={[
          { key: '', label: 'Toutes' },
          ...(Object.keys(DUNNING_STATUS_LABELS) as DunningStatus[]).map(k => ({ key: k, label: DUNNING_STATUS_LABELS[k] })),
        ]} />
        {!list ? <LoadingState label="Chargement des lettres…" /> : !list.data.length ? (
          <EmptyState icon={Mail} title={`Aucune lettre${status ? ` « ${DUNNING_STATUS_LABELS[status]} »` : ''}`} text="Les lettres préparées depuis « À relancer maintenant » apparaissent ici." />
        ) : (
          <DataPanel label="Lettres de relance" footer={<TableFooter page={page} pageSize={PAGE_SIZE} total={list.total} onPage={setPage} note={`lettre${list.total > 1 ? 's' : ''}`} />}>
            <table className="odoo-table">
              <thead><tr><th>N°</th><th>Client</th><th>Niveau</th><th>Date</th><th className="ds-num">Montant ({currencySymbol()})</th><th>Statut</th><th className="ds-actions">Actions</th></tr></thead>
              <tbody>{list.data.map((d: Dunning) => (
                <Fragment key={d.id}>
                  <tr>
                    <td><span className="ds-ref">{d.number}</span></td>
                    <td><span className="ds-strong">{d.customer_name}</span>{d.credit_hold && <>{' '}<StatusTag tone="blocked" icon={Lock} label="bloqué" /></>}</td>
                    <td>{d.level} · {d.level_label}</td>
                    <td>{fr(d.dunning_date)}<div style={{ fontSize: '0.7rem', color: 'var(--theme-text-muted)' }}>{d.created_by_name ?? 'proposée automatiquement'}</div></td>
                    <td className="ds-num">{n2(d.amount_due)}{Number(d.fee_amount) + Number(d.interest_amount) > 0 && <div style={{ fontSize: '0.7rem', color: 'var(--theme-text-muted)' }}>+ {n2(Number(d.fee_amount) + Number(d.interest_amount))} frais et pénalités</div>}</td>
                    <td><StatusTag tone={DUNNING_TONE[d.status]?.tone ?? 'draft'} icon={DUNNING_TONE[d.status]?.icon} label={DUNNING_STATUS_LABELS[d.status]} />
                      {d.sent_at && <div style={{ fontSize: '0.7rem', color: 'var(--theme-text-muted)' }}>{format(new Date(d.sent_at), 'dd/MM HH:mm')} · {VIA[d.sent_via ?? ''] ?? ''}</div>}</td>
                    <td className="ds-actions">
                      {d.status === 'draft' ? (
                        <button type="button" className="odoo-btn-secondary ds-btn-sm" disabled={!d.customer_email || send.isPending}
                          title={d.customer_email ? `Envoyer à ${d.customer_email}` : 'Pas d\'adresse e-mail sur la fiche client'}
                          onClick={() => send.mutate({ id: d.id, via: 'email' })}><Mail size={12} /> Envoyer par e-mail</button>
                      ) : (
                        <button type="button" className="odoo-btn-secondary ds-btn-sm" onClick={() => openPdf(d.id)}><Printer size={13} /> Lettre PDF</button>
                      )}
                      <RowMenu items={letterMenu(d)} />
                    </td>
                  </tr>
                  {openId === d.id && (
                    <tr><td colSpan={7} style={{ background: 'var(--odoo-bg-alt)' }}>
                      <div style={{ fontWeight: 600, marginBottom: 6 }}>{d.subject}</div>
                      <pre style={{ whiteSpace: 'pre-wrap', fontFamily: 'inherit', fontSize: '0.8125rem', margin: 0 }}>{d.body}</pre>
                    </td></tr>
                  )}
                </Fragment>
              ))}</tbody>
            </table>
          </DataPanel>
        )}
      </section>

      <section style={{ display: 'grid', gap: 8 }}>
        <SectionHeader title="Clients bloqués ou en pause" />
        {ov.blocked.length === 0 ? <EmptyState icon={Unlock} title="Aucun client bloqué ni en pause" /> : (
          <DataPanel label="Clients bloqués ou en pause" footer={<TableFooter note={`${ov.blocked.length} client${ov.blocked.length > 1 ? 's' : ''}`} />}>
          <table className="odoo-table">
            <thead><tr><th>Client</th><th>Situation</th><th>Motif</th><th>Depuis</th><th className="ds-actions">Actions</th></tr></thead>
            <tbody>{ov.blocked.map(b => (
              <tr key={b.id}>
                <td className="ds-strong">{b.name}</td>
                <td>{b.credit_hold_at ? <StatusTag tone="blocked" icon={Lock} label="bloqué" /> : null}{' '}
                  {b.dunning_paused_until && <StatusTag tone="cancelled" icon={PauseCircle} label={`relances en pause jusqu'au ${fr(b.dunning_paused_until)}`} />}</td>
                <td style={{ fontSize: '0.8125rem' }}>{b.credit_hold_reason ?? '—'}</td>
                <td style={{ fontSize: '0.8125rem' }}>{b.credit_hold_at ? `${format(new Date(b.credit_hold_at), 'dd/MM/yyyy')}${b.held_by_name ? ` · ${b.held_by_name}` : ' · relance'}` : '—'}</td>
                <td className="ds-actions">
                  {b.credit_hold_at && <button type="button" className="odoo-btn-secondary ds-btn-sm"
                    onClick={async () => { if (await confirm(`Débloquer ${b.name} ? Ses achats à crédit redeviennent possibles.`, { title: 'Débloquer le client', confirmLabel: 'Débloquer' })) release.mutate(b.id); }}><Unlock size={12} /> Débloquer</button>}
                  {b.dunning_paused_until && <button type="button" className="odoo-btn-secondary ds-btn-sm" onClick={() => unpause.mutate(b.id)}>Reprendre les relances</button>}
                </td>
              </tr>
            ))}</tbody>
          </table>
          </DataPanel>
        )}
      </section>
    </>
  );
}

/* ─── Niveaux ─────────────────────────────────────────────────────────────── */
function Levels() {
  const qc = useQueryClient();
  const { data: levels = [], isLoading } = useQuery({ queryKey: ['dunning', 'levels'], queryFn: dunningApi.levels });
  const [editing, setEditing] = useState<DunningLevel | null>(null);
  const save = useMutation({
    mutationFn: (l: DunningLevel) => dunningApi.saveLevel(l.level, {
      label: l.label, daysAfterDue: Number(l.days_after_due), feeAmount: Number(l.fee_amount), interestRate: Number(l.interest_rate),
      subject: l.subject, body: l.body, sendEmail: l.send_email, creditHold: l.credit_hold, isActive: l.is_active,
    }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['dunning'] }); setEditing(null); notify.success('Niveau enregistré'); },
    onError: e => notify.error(apiErrorMessage(e)),
  });
  if (isLoading) return <LoadingState label="Chargement des niveaux…" />;
  const nextLevel = Math.min(9, (levels.at(-1)?.level ?? 0) + 1);
  return (
    <>
      <StatusBanner tone="neutral" icon={Settings2} title="Un niveau par étape de recouvrement">
        La relance proposée est le plus haut niveau dont le seuil est atteint par la plus ancienne pièce échue du client.
        Champs du texte : {'{client} {montant} {pieces} {jours} {frais} {penalites} {total} {societe} {date}'}.
        Frais et pénalités figurent sur la lettre ; ils ne sont pas comptabilisés automatiquement.
      </StatusBanner>
      <DataPanel label="Niveaux de relance" footer={<TableFooter note={`${levels.length} niveau${levels.length > 1 ? 'x' : ''}`} />}>
      <table className="odoo-table">
        <thead><tr><th>Niveau</th><th>Libellé</th><th className="ds-num">Après échéance (j)</th><th className="ds-num">Frais ({currencySymbol()})</th><th className="ds-num">Pénalités (% / an)</th><th>E-mail</th><th>Bloque le client</th><th>Actif</th><th className="ds-actions">Actions</th></tr></thead>
        <tbody>{levels.map(l => (
          <tr key={l.level} style={{ opacity: l.is_active ? 1 : 0.55 }}>
            <td>{l.level}</td><td><span className="ds-strong">{l.label}</span><span className="sal-sub">{l.subject}</span></td>
            <td className="ds-num">{l.days_after_due}</td><td className="ds-num">{n2(l.fee_amount)}</td>
            <td className="ds-num">{Number(l.interest_rate)}</td>
            <td>{l.send_email ? 'oui' : 'non'}</td><td>{l.credit_hold ? <StatusTag tone="blocked" icon={Lock} label="oui" /> : 'non'}</td><td>{l.is_active ? 'oui' : 'non'}</td>
            <td className="ds-actions"><button type="button" className="odoo-btn-secondary ds-btn-sm" onClick={() => setEditing({ ...l })}>Modifier</button></td>
          </tr>
        ))}</tbody>
      </table>
      </DataPanel>
      {levels.length < 9 && !editing && (
        <div><button className="odoo-btn-secondary" style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}
          onClick={() => setEditing({ level: nextLevel, label: `Niveau ${nextLevel}`, days_after_due: (levels.at(-1)?.days_after_due ?? 0) + 30, fee_amount: '0', interest_rate: '0',
            subject: 'Relance', body: `{client},\n\n{pieces}\n\nMontant dû : {montant} ${currencySymbol()}.\n\n{societe}`, send_email: true, credit_hold: false, is_active: true })}>
          <Plus size={13} /> Ajouter un niveau</button></div>
      )}
      {editing && (
        <div style={{ border: '1px solid var(--odoo-border)', borderRadius: 6, padding: 16, display: 'grid', gap: 12, background: 'var(--odoo-bg-alt)' }}>
          <div style={{ fontWeight: 600 }}>Niveau {editing.level}</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 12 }}>
            <label style={lab}>Libellé<input style={field} maxLength={80} value={editing.label} onChange={e => setEditing({ ...editing, label: e.target.value })} /></label>
            <label style={lab}>Jours après l'échéance<input style={field} type="number" min={0} value={editing.days_after_due} onChange={e => setEditing({ ...editing, days_after_due: Number(e.target.value) })} /></label>
            <label style={lab}>Frais de relance ({currencySymbol()})<input style={field} type="number" min={0} step="0.01" value={editing.fee_amount} onChange={e => setEditing({ ...editing, fee_amount: e.target.value })} /></label>
            <label style={lab}>Pénalités (% par an)<input style={field} type="number" min={0} max={100} step="0.01" value={editing.interest_rate} onChange={e => setEditing({ ...editing, interest_rate: e.target.value })} /></label>
          </div>
          <label style={lab}>Objet<input style={field} maxLength={200} value={editing.subject} onChange={e => setEditing({ ...editing, subject: e.target.value })} /></label>
          <label style={lab}>Texte de la lettre<textarea style={{ ...field, minHeight: 180, fontFamily: 'inherit' }} maxLength={4000} value={editing.body} onChange={e => setEditing({ ...editing, body: e.target.value })} /></label>
          <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', fontSize: '0.8125rem' }}>
            <label style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}><input type="checkbox" checked={editing.send_email} onChange={e => setEditing({ ...editing, send_email: e.target.checked })} /> Envoyer par e-mail</label>
            <label style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}><input type="checkbox" checked={editing.credit_hold} onChange={e => setEditing({ ...editing, credit_hold: e.target.checked })} /> Bloquer les achats à crédit à l'envoi</label>
            <label style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}><input type="checkbox" checked={editing.is_active} onChange={e => setEditing({ ...editing, is_active: e.target.checked })} /> Actif</label>
          </div>
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
            <button className="odoo-btn-secondary" onClick={() => setEditing(null)}>Annuler</button>
            <button type="button" className="odoo-btn-primary" disabled={save.isPending || editing.label.trim().length < 2 || editing.body.trim().length < 10} onClick={() => save.mutate(editing)}>
              {save.isPending && <Loader2 size={13} className="animate-spin" />} Enregistrer</button>
          </div>
        </div>
      )}
    </>
  );
}
