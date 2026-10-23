import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Thermometer, SprayCan, AlertTriangle, CheckCircle2, Loader2, Plus, Clock, Info } from 'lucide-react';
import { format } from 'date-fns';
import { fr } from 'date-fns/locale';
import {
  haccpApi, FREQUENCY_LABELS, ACTION_SOURCE_LABELS,
  type TodayEquipment, type TodayTask, type CorrectiveAction,
} from '../../api/haccp.api';
import { StatusBanner } from '../../components/ui/StatusBanner';
import { notify } from '../../components/ui/InlineNotification';

/**
 * Relevés HACCP (mig 315) — écran de saisie des chefs : la feuille du jour.
 *   1. Températures des enceintes froides (hors plage → action corrective + alerte gérant).
 *   2. Plan de nettoyage : tâches dues aujourd'hui.
 *   3. Actions correctives en cours : décrire ce qui a été fait ; le gérant valide.
 */

const t = (v: number | null) => (v == null ? '—' : `${v.toLocaleString('fr-FR', { maximumFractionDigits: 1 })} °C`);
const time = (iso: string | null) => (iso ? format(new Date(iso), 'HH:mm') : '');
const day = (iso: string | null) => (iso ? format(new Date(iso), 'd MMM', { locale: fr }) : 'jamais');

export default function HaccpPage() {
  const { data, isLoading, error } = useQuery({ queryKey: ['haccp-today'], queryFn: haccpApi.today, refetchInterval: 120_000, retry: false });

  if (error) {
    return (
      <div style={{ padding: '16px 20px' }}>
        <StatusBanner tone="danger" icon={AlertTriangle} title="Relevés HACCP indisponibles">
          {String((error as any)?.response?.data?.error?.message ?? error)} — écran réservé aux chefs et au gérant.
        </StatusBanner>
      </div>
    );
  }
  if (isLoading || !data) {
    return <div style={{ display: 'flex', justifyContent: 'center', padding: '3rem' }}><Loader2 size={22} className="animate-spin" /></div>;
  }
  const toRead = data.equipment.filter(e => e.readings_today < e.readings_per_day).length;
  const tasksDue = data.tasks.filter(k => k.due).length;
  const actionsOpen = data.actions.filter(a => a.status === 'open').length;
  const allGood = toRead === 0 && tasksDue === 0 && actionsOpen === 0;

  return (
    <div className="odoo-scope" style={{ minHeight: '100%' }}>
      <div className="odoo-control-bar">
        <div className="odoo-breadcrumb">
          <Thermometer size={14} style={{ color: 'var(--theme-accent)' }} />
          <span>Relevés HACCP</span>
          <span className="odoo-breadcrumb-separator">/</span>
          <span className="odoo-breadcrumb-current" style={{ textTransform: 'capitalize' }}>{format(new Date(), 'EEEE d MMMM', { locale: fr })}</span>
        </div>
      </div>
      <div style={{ padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: 18, maxWidth: 1100 }}>
        {allGood ? (
          <StatusBanner tone="success" icon={CheckCircle2} title="Feuille du jour à jour">
            Tous les relevés et nettoyages prévus sont faits, aucune action corrective en attente.
          </StatusBanner>
        ) : (
          <StatusBanner tone="orange" icon={Clock} title="Reste à faire aujourd'hui">
            {[toRead && `${toRead} enceinte(s) à relever`, tasksDue && `${tasksDue} nettoyage(s)`, actionsOpen && `${actionsOpen} action(s) corrective(s) à traiter`]
              .filter(Boolean).join(' · ')}
          </StatusBanner>
        )}

        <Section icon={Thermometer} title="Températures">
          {data.equipment.length === 0 ? (
            <StatusBanner tone="info" icon={Info} title="Aucune enceinte surveillée">Le gérant les configure dans Contrôle & Qualité › HACCP.</StatusBanner>
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
            ? <p style={{ margin: 0, fontSize: '0.8125rem', color: 'var(--theme-text-muted)' }}>Aucune action en cours.</p>
            : <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>{data.actions.map(a => <ActionCard key={a.id} a={a} />)}</div>}
        </Section>
      </div>
    </div>
  );
}

function Section({ icon: Icon, title, extra, children }: { icon: typeof Thermometer; title: string; extra?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <Icon size={16} style={{ color: 'var(--theme-accent)' }} />
        <h2 style={{ margin: 0, fontSize: '0.9375rem', fontWeight: 600 }}>{title}</h2>
        <div style={{ marginLeft: 'auto', position: 'relative' }}>{extra}</div>
      </div>
      {children}
    </section>
  );
}

const textareaStyle: React.CSSProperties = { width: '100%', minHeight: 60, padding: 8, border: '1px solid var(--odoo-border)', borderRadius: 4, fontSize: '0.8125rem', fontFamily: 'inherit' };

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
    <div style={{ border: `1px solid ${e.last_in_range === false ? '#dc3545' : 'var(--odoo-border)'}`, borderRadius: 6, padding: 12, display: 'flex', flexDirection: 'column', gap: 8, background: 'var(--odoo-bg)' }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
        <strong style={{ fontSize: '0.875rem' }}>{e.nom}</strong>
        <span style={{ fontSize: '0.75rem', color: 'var(--theme-text-muted)' }}>{t(e.temp_min)} à {t(e.temp_max)}</span>
        <span className={`odoo-tag ${done ? 'odoo-tag-green' : 'odoo-tag-orange'}`} style={{ marginLeft: 'auto' }}>{e.readings_today}/{e.readings_per_day}</span>
      </div>
      <div style={{ fontSize: '0.75rem', color: 'var(--theme-text-muted)' }}>
        {e.last_value == null ? 'Aucun relevé aujourd\'hui' : <>Dernier : <strong style={{ color: e.last_in_range ? 'var(--odoo-text)' : '#dc3545' }}>{t(e.last_value)}</strong> à {time(e.last_at)}</>}
      </div>
      <div style={{ display: 'flex', gap: 6 }}>
        <input type="text" inputMode="decimal" value={value} onChange={ev => setValue(ev.target.value)} placeholder="°C"
          aria-label={`Température ${e.nom}`} className="odoo-search-input" style={{ flex: 1, fontSize: '1rem', padding: '8px 10px' }}
          onKeyDown={ev => { if (ev.key === 'Enter' && valid && !outOfRange) save.mutate(); }} />
        <button type="button" className="odoo-btn-primary" disabled={!valid || save.isPending} onClick={() => save.mutate()}>Enregistrer</button>
      </div>
      {outOfRange && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <span style={{ color: '#dc3545', fontSize: '0.75rem', fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: 4 }}>
            <AlertTriangle size={12} /> Hors plage : le gérant sera prévenu
          </span>
          <textarea value={action} onChange={ev => setAction(ev.target.value)} style={textareaStyle}
            placeholder="Action réalisée (porte refermée, produits déplacés, technicien appelé…). Laissez vide si rien n'est encore fait." />
        </div>
      )}
    </div>
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
  if (tasks.length === 0) return <p style={{ margin: 0, fontSize: '0.8125rem', color: 'var(--theme-text-muted)' }}>Aucune tâche au plan de nettoyage.</p>;

  return (
    <div style={{ overflowX: 'auto', border: '1px solid var(--odoo-border)', borderRadius: 4 }}>
      <table className="odoo-table" style={{ margin: 0 }}>
        <thead><tr><th>Tâche</th><th>Fréquence</th><th>Dernier passage</th><th style={{ textAlign: 'right' }}></th></tr></thead>
        <tbody>
          {sorted.map(k => [
            <tr key={k.id} className={k.due ? 'row-warning' : undefined}>
              <td>
                <div style={{ fontWeight: 600 }}>{k.label}</div>
                <div style={{ fontSize: '0.6875rem', color: 'var(--theme-text-muted)' }}>{k.zone}{k.method ? ` · ${k.method}` : ''}</div>
              </td>
              <td>{FREQUENCY_LABELS[k.frequency]}</td>
              <td style={{ fontSize: '0.75rem' }}>
                {k.last_done_at ? <>{day(k.last_done_at)} {time(k.last_done_at)}{k.last_done_by ? ` · ${k.last_done_by}` : ''}{k.last_conforme === false && <span style={{ color: '#dc3545', fontWeight: 600 }}> · non conforme</span>}</> : <span style={{ color: 'var(--theme-text-muted)' }}>jamais</span>}
              </td>
              <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                {k.due ? (
                  <>
                    <button type="button" className="odoo-btn-primary" disabled={log.isPending} onClick={() => log.mutate({ taskId: k.id, conforme: true })}>Fait</button>{' '}
                    <button type="button" className="odoo-btn-secondary" onClick={() => setFailing(failing === k.id ? null : k.id)}>Non conforme</button>
                  </>
                ) : <span className="odoo-tag odoo-tag-green"><CheckCircle2 size={11} /> à jour</span>}
              </td>
            </tr>,
            failing === k.id && (
              <tr key={`${k.id}-nc`}>
                <td colSpan={4} style={{ background: '#fdf0ed' }}>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr auto', gap: 8, alignItems: 'end' }}>
                    <textarea value={note} onChange={ev => setNote(ev.target.value)} style={textareaStyle} placeholder="Ce qui n'est pas conforme (obligatoire)" />
                    <textarea value={action} onChange={ev => setAction(ev.target.value)} style={textareaStyle} placeholder="Action réalisée (facultatif)" />
                    <button type="button" className="odoo-btn-danger" disabled={!note.trim() || log.isPending} onClick={() => log.mutate({ taskId: k.id, conforme: false })}>Enregistrer</button>
                  </div>
                </td>
              </tr>
            ),
          ])}
        </tbody>
      </table>
    </div>
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
    <div style={{ border: `1px solid ${a.status === 'open' ? '#dc3545' : 'var(--odoo-border)'}`, borderRadius: 6, padding: 12, display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <span className="odoo-tag odoo-tag-grey">{ACTION_SOURCE_LABELS[a.source_kind]}</span>
        <strong style={{ fontSize: '0.8125rem' }}>{a.problem}</strong>
        <span style={{ marginLeft: 'auto', fontSize: '0.6875rem', color: 'var(--theme-text-muted)' }}>{day(a.created_at)} {time(a.created_at)}{a.created_by_name ? ` · ${a.created_by_name}` : ''}</span>
      </div>
      {a.validation_note && a.status === 'open' && (
        <div style={{ fontSize: '0.75rem', color: '#b85d1a' }}>Renvoyée par le gérant : {a.validation_note}</div>
      )}
      {a.status === 'done' ? (
        <div style={{ fontSize: '0.75rem' }}>
          <span className="odoo-tag odoo-tag-yellow">En attente de validation</span> {a.action_taken}
        </div>
      ) : (
        <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }}>
          <textarea value={text} onChange={ev => setText(ev.target.value)} style={textareaStyle} placeholder="Qu'avez-vous fait pour corriger ?" />
          <button type="button" className="odoo-btn-primary" disabled={text.trim().length < 3 || complete.isPending} onClick={() => complete.mutate()}>Action réalisée</button>
        </div>
      )}
    </div>
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
    return <button type="button" className="odoo-btn-secondary" style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }} onClick={() => setOpen(true)}><Plus size={13} /> Signaler un problème</button>;
  }
  return (
    <div style={{ position: 'absolute', right: 0, top: 0, zIndex: 10, width: 'min(420px, 90vw)', background: 'var(--odoo-bg, #fff)', border: '1px solid var(--odoo-border)', borderRadius: 6, padding: 12, boxShadow: '0 6px 20px rgba(0,0,0,0.12)', display: 'flex', flexDirection: 'column', gap: 8 }}>
      <textarea autoFocus value={problem} onChange={ev => setProblem(ev.target.value)} style={textareaStyle} placeholder="Problème constaté (nuisible, produit suspect, panne…)" />
      <textarea value={action} onChange={ev => setAction(ev.target.value)} style={textareaStyle} placeholder="Action réalisée (facultatif)" />
      <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
        <button type="button" className="odoo-btn-secondary" onClick={() => setOpen(false)}>Annuler</button>
        <button type="button" className="odoo-btn-primary" disabled={problem.trim().length < 3 || create.isPending} onClick={() => create.mutate()}>Signaler</button>
      </div>
    </div>
  );
}
