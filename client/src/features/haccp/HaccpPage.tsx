import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Thermometer, SprayCan, AlertTriangle, CheckCircle2, Plus, Clock } from 'lucide-react';
import { format } from 'date-fns';
import { fr } from 'date-fns/locale';
import {
  haccpApi, FREQUENCY_LABELS, ACTION_SOURCE_LABELS,
  type TodayEquipment, type TodayTask, type CorrectiveAction,
} from '../../api/haccp.api';
import { StatusTag } from '../../components/ui/StatusTag';
import { notify } from '../../components/ui/InlineNotification';
import SalesPageShell from '../sales/SalesPageShell';
import { Alert, DataPanel, EmptyState, EntryCard, ErrorState, LoadingState, SectionHeader, TableFooter } from '../../components/ds';
import '../controle/kl-ui.css';

/**
 * Relevés HACCP (mig 315) — écran de saisie des chefs : la feuille du jour.
 *   1. Températures des enceintes froides (hors plage → action corrective + alerte gérant).
 *   2. Plan de nettoyage : tâches dues aujourd'hui.
 *   3. Actions correctives en cours : décrire ce qui a été fait ; le gérant valide.
 */

const t = (v: number | null) => (v == null ? '—' : `${v.toLocaleString('fr-FR', { maximumFractionDigits: 1 })} °C`);
const time = (iso: string | null) => (iso ? format(new Date(iso), 'HH:mm') : '');
const day = (iso: string | null) => (iso ? format(new Date(iso), 'd MMM', { locale: fr }) : 'jamais');

/** Date du jour en tête de page (« Mercredi 18 novembre »). */
const todayLabel = () => { const s = format(new Date(), 'EEEE d MMMM', { locale: fr }); return s.charAt(0).toUpperCase() + s.slice(1); };

const SHELL = { icon: Thermometer, parent: 'Production › Opérations', title: 'Relevés HACCP' } as const;

export default function HaccpPage() {
  const { data, isLoading, error, refetch } = useQuery({ queryKey: ['haccp-today'], queryFn: haccpApi.today, refetchInterval: 120_000, retry: false });
  const summary = `Feuille du jour — ${todayLabel()} : températures, nettoyage et actions correctives.`;

  // Coquille Production en bar={false} : la page pose sa barre puis son grand titre (design Ventes).
  if (error) {
    return (
      <SalesPageShell {...SHELL} summary={summary}>
        <ErrorState error={error} title="Relevés HACCP indisponibles" onRetry={() => refetch()}
          text={`${String((error as any)?.response?.data?.error?.message ?? error)} — écran réservé aux chefs et au gérant.`} />
      </SalesPageShell>
    );
  }
  if (isLoading || !data) {
    return <SalesPageShell {...SHELL} summary={summary}><LoadingState /></SalesPageShell>;
  }
  const toRead = data.equipment.filter(e => e.readings_today < e.readings_per_day).length;
  const tasksDue = data.tasks.filter(k => k.due).length;
  const actionsOpen = data.actions.filter(a => a.status === 'open').length;
  const allGood = toRead === 0 && tasksDue === 0 && actionsOpen === 0;

  return (
    <SalesPageShell {...SHELL} summary={summary}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 20, maxWidth: 1100 }}>
        {allGood ? (
          <Alert tone="success" icon={CheckCircle2}>
            Feuille du jour à jour : tous les relevés et nettoyages prévus sont faits, aucune action corrective en attente.
          </Alert>
        ) : (
          <Alert tone="warning" icon={Clock}>
            Reste à faire aujourd'hui : {[toRead && `${toRead} enceinte(s) à relever`, tasksDue && `${tasksDue} nettoyage(s)`, actionsOpen && `${actionsOpen} action(s) corrective(s) à traiter`]
              .filter(Boolean).join(' · ')}
          </Alert>
        )}

        <Section icon={Thermometer} title="Températures">
          {data.equipment.length === 0 ? (
            <EmptyState icon={Thermometer} title="Aucune enceinte surveillée" text="Le gérant les configure dans Contrôle & Qualité › HACCP." />
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 12 }}>
              {data.equipment.map(e => <ReadingCard key={e.id} e={e} />)}
            </div>
          )}
        </Section>

        <Section icon={SprayCan} title="Nettoyage">
          <CleaningTable tasks={data.tasks} />
        </Section>

        <Section icon={AlertTriangle} title="Actions correctives" extra={<NewActionButton />}>
          {data.actions.length === 0
            ? <EmptyState icon={CheckCircle2} title="Aucune action en cours" text="Un relevé hors plage ou un nettoyage non conforme crée une action corrective ici." />
            : <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>{data.actions.map(a => <ActionCard key={a.id} a={a} />)}</div>}
        </Section>
      </div>
    </SalesPageShell>
  );
}

function Section({ icon: Icon, title, extra, children }: { icon: typeof Thermometer; title: string; extra?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section style={{ display: 'grid', gap: 12 }}>
      <SectionHeader title={<span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}><Icon size={18} aria-hidden="true" />{title}</span>}>
        {extra && <div style={{ position: 'relative' }}>{extra}</div>}
      </SectionHeader>
      {children}
    </section>
  );
}

const textareaStyle: React.CSSProperties = { minHeight: 60 };

/* ─── Températures ─────────────────────────────────────────────────── */

function ReadingCard({ e }: { e: TodayEquipment }) {
  const qc = useQueryClient();
  const [value, setValue] = useState('');
  const [action, setAction] = useState('');
  const num = value.trim() === '' ? null : Number(value.replace(',', '.'));
  const valid = num != null && Number.isFinite(num) && num >= -60 && num <= 60;
  const outOfRange = valid && (num! < e.temp_min || num! > e.temp_max);
  const done = e.readings_today >= e.readings_per_day;

  const save = useMutation({
    mutationFn: () => haccpApi.addReading({ equipmentId: e.id, value: num!, actionTaken: outOfRange ? action || null : null }),
    onSuccess: (r) => {
      setValue(''); setAction('');
      qc.invalidateQueries({ queryKey: ['haccp-today'] });
      if (r.action) notify.warning(r.action.status === 'open' ? 'Hors plage : le gérant est prévenu, décrivez l\'action corrective dès que possible' : 'Hors plage : action corrective enregistrée, le gérant est prévenu');
      else notify.success('Relevé enregistré');
    },
    onError: (err) => notify.error(err),
  });

  return (
    <EntryCard alert={e.last_in_range === false} title={e.nom} detail={`${t(e.temp_min)} à ${t(e.temp_max)}`}
      aside={<StatusTag tone={done ? 'done' : 'todo'} icon={Thermometer} label={`${e.readings_today}/${e.readings_per_day}`} title="Relevés du jour" />}>
      <div style={{ fontSize: '0.75rem', color: 'var(--ds-muted)' }}>
        {e.last_value == null ? 'Aucun relevé aujourd\'hui' : <>Dernier : <strong style={{ color: e.last_in_range ? 'var(--ds-ink)' : 'var(--ds-danger)' }}>{t(e.last_value)}</strong> à {time(e.last_at)}</>}
      </div>
      <div style={{ display: 'flex', gap: 6 }}>
        <input type="text" inputMode="decimal" value={value} onChange={ev => setValue(ev.target.value)} placeholder="°C"
          aria-label={`Température ${e.nom} en °C`} className="ds-input" style={{ flex: 1, fontSize: 16, height: 44 }}
          onKeyDown={ev => { if (ev.key === 'Enter' && valid && !outOfRange) save.mutate(); }} />
        <button type="button" className="odoo-btn-primary" style={{ minHeight: 44 }} disabled={!valid || save.isPending} aria-busy={save.isPending || undefined} onClick={() => save.mutate()}>Enregistrer</button>
      </div>
      {outOfRange && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <span style={{ color: 'var(--ds-danger)', fontSize: '0.75rem', fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: 4 }}>
            <AlertTriangle size={12} aria-hidden="true" /> Hors plage : le gérant sera prévenu
          </span>
          <textarea value={action} onChange={ev => setAction(ev.target.value)} className="ds-input" style={textareaStyle} aria-label="Action réalisée"
            placeholder="Action réalisée (porte refermée, produits déplacés, technicien appelé…). Laissez vide si rien n'est encore fait." />
        </div>
      )}
    </EntryCard>
  );
}

/* ─── Nettoyage ────────────────────────────────────────────────────── */

function CleaningTable({ tasks }: { tasks: TodayTask[] }) {
  const qc = useQueryClient();
  const [failing, setFailing] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [action, setAction] = useState('');
  const log = useMutation({
    mutationFn: (p: { taskId: string; conforme: boolean }) => haccpApi.logCleaning({ ...p, note: p.conforme ? null : note, actionTaken: p.conforme ? null : action || null }),
    onSuccess: (_r, p) => {
      setFailing(null); setNote(''); setAction('');
      qc.invalidateQueries({ queryKey: ['haccp-today'] });
      notify.success(p.conforme ? 'Nettoyage enregistré' : 'Non-conformité enregistrée, le gérant est prévenu');
    },
    onError: (err) => notify.error(err),
  });
  const sorted = [...tasks].sort((a, b) => Number(b.due) - Number(a.due));
  if (tasks.length === 0) return <EmptyState icon={SprayCan} title="Aucune tâche au plan de nettoyage" text="Le gérant le configure dans Contrôle & Qualité › HACCP." />;
  const dueCount = tasks.filter(k => k.due).length;

  return (
    <DataPanel label="Plan de nettoyage" footer={<TableFooter note={`${tasks.length} tâche(s) · ${dueCount} à faire aujourd'hui`} />}>
      <table className="odoo-table">
        <thead><tr><th>Tâche</th><th>Fréquence</th><th>Dernier passage</th><th className="ds-actions"><span className="sr-only">Actions</span></th></tr></thead>
        <tbody>
          {sorted.map(k => [
            <tr key={k.id} className={k.due ? 'row-warning' : undefined}>
              <td>
                <div className="ds-strong">{k.label}</div>
                <div style={{ fontSize: 12, color: 'var(--ds-muted)' }}>{k.zone}{k.method ? ` · ${k.method}` : ''}</div>
              </td>
              <td>{FREQUENCY_LABELS[k.frequency]}</td>
              <td style={{ fontSize: 13 }}>
                {k.last_done_at ? <>{day(k.last_done_at)} {time(k.last_done_at)}{k.last_done_by ? ` · ${k.last_done_by}` : ''}{k.last_conforme === false && <span style={{ color: 'var(--ds-danger)', fontWeight: 600 }}> · non conforme</span>}</> : <span style={{ color: 'var(--ds-muted)' }}>jamais</span>}
              </td>
              <td className="ds-actions">
                {k.due ? (
                  <>
                    <button type="button" className="odoo-btn-secondary" style={{ minHeight: 40 }} onClick={() => setFailing(failing === k.id ? null : k.id)}>Non conforme</button>
                    <button type="button" className="odoo-btn-primary" style={{ minHeight: 40 }} disabled={log.isPending} onClick={() => log.mutate({ taskId: k.id, conforme: true })}>Fait</button>
                  </>
                ) : <StatusTag tone="done" label="À jour" />}
              </td>
            </tr>,
            failing === k.id && (
              <tr key={`${k.id}-nc`}>
                <td colSpan={4} style={{ background: 'var(--ds-danger-bg)' }}>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr auto', gap: 8, alignItems: 'end' }}>
                    <textarea value={note} onChange={ev => setNote(ev.target.value)} className="ds-input" style={textareaStyle} aria-label="Ce qui n'est pas conforme" aria-required="true" placeholder="Ce qui n'est pas conforme (obligatoire)" />
                    <textarea value={action} onChange={ev => setAction(ev.target.value)} className="ds-input" style={textareaStyle} placeholder="Action réalisée (facultatif)" />
                    <button type="button" className="ds-btn-danger" disabled={!note.trim() || log.isPending} onClick={() => log.mutate({ taskId: k.id, conforme: false })}>Enregistrer la non-conformité</button>
                  </div>
                </td>
              </tr>
            ),
          ])}
        </tbody>
      </table>
    </DataPanel>
  );
}

/* ─── Actions correctives ──────────────────────────────────────────── */

function ActionCard({ a }: { a: CorrectiveAction }) {
  const qc = useQueryClient();
  const [text, setText] = useState('');
  const complete = useMutation({
    mutationFn: () => haccpApi.completeAction(a.id, text),
    onSuccess: () => { setText(''); qc.invalidateQueries({ queryKey: ['haccp-today'] }); notify.success('Action enregistrée, en attente de validation'); },
    onError: (err) => notify.error(err),
  });
  return (
    <EntryCard alert={a.status === 'open'}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <span className="odoo-tag odoo-tag-grey">{ACTION_SOURCE_LABELS[a.source_kind]}</span>
        <strong className="ds-strong" style={{ fontSize: 14 }}>{a.problem}</strong>
        <span style={{ marginLeft: 'auto', fontSize: 12, color: 'var(--ds-muted)' }}>{day(a.created_at)} {time(a.created_at)}{a.created_by_name ? ` · ${a.created_by_name}` : ''}</span>
      </div>
      {a.validation_note && a.status === 'open' && (
        <div style={{ fontSize: '0.75rem', color: 'var(--ds-warning)' }}>Renvoyée par le gérant : {a.validation_note}</div>
      )}
      {a.status === 'done' ? (
        <div style={{ fontSize: '0.75rem' }}>
          <StatusTag tone="todo" label="En attente de validation" /> {a.action_taken}
        </div>
      ) : (
        <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }}>
          <textarea value={text} onChange={ev => setText(ev.target.value)} className="ds-input" style={textareaStyle} aria-label="Action corrective réalisée" placeholder="Qu'avez-vous fait pour corriger ?" />
          <button type="button" className="odoo-btn-primary" disabled={text.trim().length < 3 || complete.isPending} onClick={() => complete.mutate()}>Action réalisée</button>
        </div>
      )}
    </EntryCard>
  );
}

function NewActionButton() {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [problem, setProblem] = useState('');
  const [action, setAction] = useState('');
  const create = useMutation({
    mutationFn: () => haccpApi.createAction({ problem, actionTaken: action || null }),
    onSuccess: () => { setOpen(false); setProblem(''); setAction(''); qc.invalidateQueries({ queryKey: ['haccp-today'] }); notify.success('Problème signalé au gérant'); },
    onError: (err) => notify.error(err),
  });
  if (!open) {
    return <button type="button" className="odoo-btn-secondary" onClick={() => setOpen(true)}><Plus size={13} aria-hidden="true" /> Signaler un problème</button>;
  }
  return (
    <div style={{ position: 'absolute', right: 0, top: 0, zIndex: 10, width: 'min(420px, 90vw)', background: 'var(--ds-card)', borderRadius: 16, padding: 12, boxShadow: '0 12px 32px rgba(15,23,42,0.16), 0 0 0 .5px rgba(15,23,42,.08)', display: 'flex', flexDirection: 'column', gap: 8, fontSize: '0.875rem', fontWeight: 400, letterSpacing: 0 }}>
      <textarea autoFocus value={problem} onChange={ev => setProblem(ev.target.value)} className="ds-input" style={textareaStyle} aria-label="Problème constaté" aria-required="true" placeholder="Problème constaté (nuisible, produit suspect, panne…)" />
      <textarea value={action} onChange={ev => setAction(ev.target.value)} className="ds-input" style={textareaStyle} aria-label="Action réalisée" placeholder="Action réalisée (facultatif)" />
      <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
        <button type="button" className="odoo-btn-secondary" onClick={() => setOpen(false)}>Annuler</button>
        <button type="button" className="odoo-btn-primary" disabled={problem.trim().length < 3 || create.isPending} aria-busy={create.isPending || undefined} onClick={() => create.mutate()}>Signaler</button>
      </div>
    </div>
  );
}
