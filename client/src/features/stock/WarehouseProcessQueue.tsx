import { useEffect, useRef, useState } from 'react';
import { StagePipeline, StageProgress, type StageDef } from '../../components/purchasing/ProcessBoard';
import { StatusBanner } from '../../components/ui/StatusBanner';
import { apiErrorMessage } from '../../api/errors';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { bonSortieApi } from '../../api/bon-sortie.api';
import { notify } from '../../components/ui/InlineNotification';
import { BonSortiePanel } from '../production/BonSortiePanel';
import { bonStatusTag } from '../production/status';
import { StatusTag } from '../../components/ui/StatusTag';
import { ListToolbar } from '../sales/ListTemplate';
import './stock.css';
import {
  Truck, Loader2, Scale, CheckCircle, Inbox, Handshake, ChevronLeft, ChevronRight,
  ArrowLeft, AlertTriangle, Check, ArrowRight,
} from 'lucide-react';
import { format, formatDistanceToNowStrict } from 'date-fns';
import { fr } from 'date-fns/locale';
import { DataPanel, EmptyState, LoadingState, NoResultState, TableFooter } from '../../components/ds';

/**
 * File active du Pesage, presentee comme un processus :
 *
 *   1. Demande recue  (genere)
 *   2. Preparation & pesee (preparation / preparation_partielle)
 *   3. Pret a remettre (pret — attend l'acceptation du chef)
 *   4. Remis au chef  (prelevement / verifie / cloture — visible dans l'Historique)
 *
 * Deux vues :
 *   - liste : barre d'etapes (filtre) + tableau des demandes
 *   - traitement : une seule demande, son avancement etape par etape et le tableau
 *     de ses lignes (BonSortiePanel), avec navigation demande precedente / suivante
 *     pour traiter la file demande par demande.
 */

export type ProcessStep = 'all' | 'recue' | 'preparation' | 'pret';

type Bon = Record<string, any>;

const STEP_OF_STATUS: Record<string, Exclude<ProcessStep, 'all'>> = {
  genere: 'recue',
  preparation: 'preparation',
  preparation_partielle: 'preparation',
  pret: 'pret',
};

const STEPS: { key: Exclude<ProcessStep, 'all'>; label: string; hint: string; icon: typeof Truck }[] = [
  { key: 'recue', label: 'Demande reçue', hint: 'À prendre en charge', icon: Inbox },
  { key: 'preparation', label: 'Préparation & pesée', hint: 'Pesée des ingrédients', icon: Scale },
  { key: 'pret', label: 'Prêt à remettre', hint: 'Attente du chef', icon: CheckCircle },
];

const fmtDate = (d: unknown, pattern = 'dd/MM HH:mm') =>
  d ? format(new Date(d as string), pattern, { locale: fr }) : null;

/** Depuis quand la demande attend a son etape courante. */
function waitingSince(bon: Bon): string | null {
  const ref = bon.status === 'pret' ? bon.ready_at
    : bon.status === 'genere' ? (bon.generated_at || bon.created_at)
    : (bon.preparation_at || bon.created_at);
  return ref ? formatDistanceToNowStrict(new Date(ref as string), { locale: fr }) : null;
}

// ─── Pipeline du processus (file + historique), composant partagé des écrans « processus » ───
const PIPE_STAGES: StageDef[] = [
  ...STEPS.map(s => ({ key: s.key, label: s.label, hint: s.hint.toLowerCase(), icon: s.icon })),
  { key: 'remis', label: 'Remis au chef', hint: 'voir l\'historique', icon: Handshake },
];

export function BonsPipeline({ bons, step, onStep, historyTotal, historyActive, onHistory }: {
  bons: Bon[];
  step: ProcessStep;
  onStep: (s: ProcessStep) => void;
  historyTotal?: number;
  historyActive?: boolean;
  onHistory: () => void;
}) {
  const counts: Record<string, number> = { recue: 0, preparation: 0, pret: 0 };
  const late: Record<string, number> = { recue: 0, preparation: 0, pret: 0 };
  for (const b of bons) {
    const s = STEP_OF_STATUS[b.status as string];
    if (!s) continue;
    counts[s]++;
    if (b.chef_reject_reason) late[s]++;
  }
  const open = counts.recue + counts.preparation + counts.pret;
  return (
    <div>
      <StagePipeline
        title="Où en sont les bons de sortie"
        summary={`${open} demande${open > 1 ? 's' : ''} en cours`}
        stages={PIPE_STAGES}
        stats={{
          recue: { count: counts.recue, sub: '' },
          preparation: { count: counts.preparation, sub: '', late: late.preparation, alertLabel: 'refusé par le chef' },
          pret: { count: counts.pret, sub: '', late: late.pret, alertLabel: 'refusé par le chef' },
          remis: { count: historyTotal ?? 0, sub: '' },
        }}
        isActive={k => (k === 'remis' ? !!historyActive : !historyActive && step === k)}
        onPick={k => (k === 'remis' ? onHistory() : onStep(step === k ? 'all' : (k as ProcessStep)))}
      />
    </div>
  );
}

// ─── Vue liste : tableau des demandes ───
export function WarehouseQueueList({
  bons, step, onStep, onOpen, onHistory, historyTotal,
}: {
  bons: Bon[];
  step: ProcessStep;
  onStep: (s: ProcessStep) => void;
  onOpen: (bonId: string) => void;
  onHistory: () => void;
  /** Nombre de bons remis / clôturés (4e carte du pipeline). */
  historyTotal?: number;
}) {
  const queryClient = useQueryClient();
  const takeChargeMutation = useMutation({
    mutationFn: (bonId: string) => bonSortieApi.markPreparation(bonId),
    onSuccess: (_d, bonId) => {
      queryClient.invalidateQueries({ queryKey: ['warehouse-queue'] });
      notify.success('Pris en charge — le chef a été notifié');
      onOpen(bonId);
    },
    onError: (e: any) => notify.error(apiErrorMessage(e, 'Erreur')),
  });

  const [search, setSearch] = useState('');
  const q = search.trim().toLowerCase();
  const rows = (step === 'all' ? bons : bons.filter(b => STEP_OF_STATUS[b.status as string] === step))
    .filter(b => !q || [b.numero, b.generated_by_name, b.preparation_by_name].some(v => String(v ?? '').toLowerCase().includes(q)));

  return (
    <>
      <BonsPipeline bons={bons} step={step} onStep={onStep} historyTotal={historyTotal} onHistory={onHistory} />

      <ListToolbar search={search} onSearch={setSearch} placeholder="Rechercher par N° de bon, demandeur ou préparateur…" />

      {rows.length === 0 ? (
        bons.length === 0
          ? <EmptyState icon={Inbox} title="Aucune demande en cours" text="Les bons de sortie générés par la production apparaîtront ici." />
          : <NoResultState text="Aucune demande ne correspond à cette étape ou à cette recherche." onReset={() => { setSearch(''); onStep('all'); }} />
      ) : (
        <DataPanel label="Bons de sortie en cours" footer={<TableFooter note={`${rows.length} bon${rows.length > 1 ? 's' : ''} de sortie${rows.length !== bons.length ? ` sur ${bons.length}` : ''}`} />}>
          <table className="odoo-table">
            <thead>
              <tr>
                <th style={{ width: 24 }}><span className="sr-only">État</span></th>
                <th>N° bon</th>
                <th>Plan de production</th>
                <th>Demandé par</th>
                <th className="ds-num">Lignes</th>
                <th>Étape</th>
                <th>Responsable</th>
                <th>En attente depuis</th>
                <th className="ds-actions">Prochaine action</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(bon => {
                const bonId = bon.id as string;
                const status = bon.status as string;
                const tag = bonStatusTag(status);
                const isTaking = takeChargeMutation.isPending && takeChargeMutation.variables === bonId;
                const responsible = status === 'pret' ? bon.ready_by_name : bon.preparation_by_name;
                return (
                  <tr key={bonId} onClick={() => onOpen(bonId)} style={{ cursor: 'pointer' }}>
                    <td>
                      <span className={`odoo-status-dot ${
                        bon.chef_reject_reason ? 'danger'
                        : status === 'pret' ? 'ok'
                        : status === 'genere' ? 'neutral'
                        : 'warning'}`} aria-hidden="true" />
                    </td>
                    <td><span className="ds-ref">{bon.numero as string}</span></td>
                    <td>
                      <span className="ds-strong">Plan du {fmtDate(bon.plan_date, 'dd MMM yyyy') ?? '—'}</span>
                      {bon.chef_reject_reason && (
                        <div style={{ fontSize: '12px', color: 'var(--ds-danger)', fontWeight: 600, display: 'flex', alignItems: 'center', gap: 4, marginTop: 2 }}>
                          <AlertTriangle size={10} /> Refusé par le chef : {bon.chef_reject_reason as string}
                        </div>
                      )}
                    </td>
                    <td style={{ color: 'var(--ds-muted)' }}>{(bon.generated_by_name as string) || '—'}</td>
                    <td className="ds-num" style={{ fontWeight: 600 }}>{bon.total_lines as number}</td>
                    <td>
                      <StageProgress count={PIPE_STAGES.length} current={['recue', 'preparation', 'pret'].indexOf(STEP_OF_STATUS[status] ?? 'recue')} late={!!bon.chef_reject_reason} />
                      <StatusTag tone={tag.tone} icon={tag.icon} label={tag.label} />
                    </td>
                    <td style={{ color: 'var(--ds-muted)' }}>{(responsible as string) || '—'}</td>
                    <td style={{ color: 'var(--ds-muted)' }}>{waitingSince(bon) ?? '—'}</td>
                    <td className="ds-actions" onClick={e => e.stopPropagation()}>
                      {status === 'genere' ? (
                        <button type="button" className="odoo-btn-primary ds-btn-sm" disabled={isTaking}
                          onClick={() => takeChargeMutation.mutate(bonId)}>
                          {isTaking ? <Loader2 size={12} className="animate-spin" /> : <Truck size={12} />}
                          Prendre en charge
                        </button>
                      ) : (
                        <button type="button" className="odoo-btn-secondary ds-btn-sm" onClick={() => onOpen(bonId)}>
                          {status === 'pret' ? 'Consulter' : 'Traiter'} <ChevronRight size={12} />
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </DataPanel>
      )}
    </>
  );
}

// ─── Vue traitement : une demande, son processus et ses lignes ───
export function WarehouseBonWorkspace({
  bonId, queue, onBack, onOpen,
}: {
  bonId: string;
  queue: Bon[];
  onBack: () => void;
  onOpen: (bonId: string) => void;
}) {
  const queryClient = useQueryClient();
  const queueRow = queue.find(b => b.id === bonId);

  // Le plan_id vient de la file ; si la demande en est sortie (remise au chef),
  // on le recupere via le detail du bon.
  const { data: detail, isLoading: isLoadingDetail } = useQuery<Bon>({
    queryKey: ['bon-sortie', bonId],
    queryFn: () => bonSortieApi.getById(bonId),
    enabled: !queueRow,
  });
  const planId = (queueRow?.plan_id ?? detail?.plan_id) as string | undefined;

  // Meme cle que BonSortiePanel : l'etape affichee suit en direct ses actions.
  const { data: planBons = [] } = useQuery<Bon[]>({
    queryKey: ['bons-sortie', planId],
    queryFn: () => bonSortieApi.getByPlan(planId as string),
    enabled: !!planId,
  });
  const live = planBons.find(b => b.id === bonId);
  const bon: Bon | undefined = live || queueRow || detail
    ? { ...detail, ...queueRow, ...live,
        // noms des acteurs : uniquement fournis par la file
        preparation_by_name: queueRow?.preparation_by_name,
        ready_by_name: queueRow?.ready_by_name }
    : undefined;

  // Une action dans le panneau change le statut : la file (badges, compteurs) doit suivre.
  const lastStatus = useRef<string | undefined>(undefined);
  useEffect(() => {
    const s = live?.status as string | undefined;
    if (s && lastStatus.current && s !== lastStatus.current) {
      queryClient.invalidateQueries({ queryKey: ['warehouse-queue'] });
    }
    lastStatus.current = s;
  }, [live?.status, queryClient]);

  const idx = queue.findIndex(b => b.id === bonId);
  const prev = idx > 0 ? queue[idx - 1] : null;
  const next = idx >= 0 && idx < queue.length - 1 ? queue[idx + 1] : null;

  if (!bon) {
    return (
      isLoadingDetail
        ? <LoadingState label="Chargement du bon de sortie…" />
        : <EmptyState icon={Inbox} title="Bon de sortie introuvable" text="Il a peut-être été annulé ou remis entre-temps."
            action={<button type="button" className="odoo-btn-secondary" onClick={onBack}>Retour à la file</button>} />
    );
  }

  const status = bon.status as string;
  const tag = bonStatusTag(status);
  const lines = ((live?.lines || []) as Bon[]).filter(l => l.status !== 'annule' && !l.is_packaging);
  const weighed = lines.filter(l => ['preleve', 'substitue', 'ecart'].includes(l.status as string)).length;

  // Rang de l'etape courante dans le processus (0..4). 'pret' = 3 : le magasinier
  // a fini, l'etape en cours est la remise (acceptation par le chef).
  const ingredientLines = lines.filter(l => !l.is_packaging);
  const allWeighed = ingredientLines.length > 0 && ingredientLines.every(l => ['preleve', 'substitue', 'ecart', 'rupture'].includes(l.status as string));
  const rank: number = status === 'genere' ? 0
    : ['preparation', 'preparation_partielle'].includes(status) ? (allWeighed ? 2 : 1)
    : status === 'pret' ? 3
    : 4;

  const timeline: { label: string; done: boolean; current: boolean; detail: string | null }[] = [
    {
      label: 'Demande reçue',
      done: true, current: false,
      detail: [fmtDate(bon.generated_at || bon.created_at), bon.generated_by_name].filter(Boolean).join(' · ') || null,
    },
    {
      label: 'Prise en charge',
      done: rank >= 1, current: rank === 0,
      detail: rank >= 1
        ? [fmtDate(bon.preparation_at), bon.preparation_by_name].filter(Boolean).join(' · ') || 'Faite'
        : 'En attente du magasinier',
    },
    {
      label: 'Pesée des ingrédients',
      done: rank >= 2, current: rank === 1,
      detail: lines.length > 0 ? `${weighed} / ${lines.length} ligne${lines.length > 1 ? 's' : ''} pesée${weighed > 1 ? 's' : ''}` : null,
    },
    {
      label: 'Prêt à remettre',
      done: rank >= 3, current: rank === 2,
      detail: rank >= 3 ? [fmtDate(bon.ready_at), bon.ready_by_name].filter(Boolean).join(' · ') || 'Fait' : null,
    },
    {
      label: 'Remis au chef',
      done: rank >= 4, current: rank === 3,
      detail: rank >= 4
        ? [fmtDate(bon.prelevement_at), bon.prelevement_by_name].filter(Boolean).join(' · ') || 'Fait'
        : rank === 3 ? 'Le chef doit accepter la réception' : null,
    },
  ];

  return (
    <div className="stk-stack">
      {/* En-tete de la demande + navigation dans la file */}
      <div className="wh-ws-header">
        <button type="button" className="odoo-btn-secondary" onClick={onBack}>
          <ArrowLeft size={13} aria-hidden="true" /> File active
        </button>
        <div style={{ minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <h2 className="ds-subhead" style={{ fontSize: 'var(--ds-t-section)', fontWeight: 700 }}>
              Plan du {fmtDate(bon.plan_date, 'EEEE dd MMMM yyyy') ?? '—'}
            </h2>
            <StatusTag tone={tag.tone} icon={tag.icon} label={tag.label} />
          </div>
          <div className="odoo-form-subtitle" style={{ marginTop: 2 }}>
            <span className="ds-ref">{bon.numero as string}</span>
            {bon.generated_by_name && <> · demandé par <strong>{bon.generated_by_name as string}</strong></>}
            {lines.length > 0 && <> · {lines.length} ligne{lines.length > 1 ? 's' : ''}</>}
          </div>
        </div>
        <div style={{ flex: 1 }} />
        {idx >= 0 && (
          <div className="odoo-pager" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span>Demande <strong>{idx + 1}</strong> / {queue.length}</span>
            <button type="button" className="odoo-pager-btn" disabled={!prev}
              onClick={() => prev && onOpen(prev.id as string)} title="Demande précédente" aria-label="Demande précédente">
              <ChevronLeft size={14} />
            </button>
            <button type="button" className="odoo-pager-btn" disabled={!next}
              onClick={() => next && onOpen(next.id as string)} title="Demande suivante" aria-label="Demande suivante">
              <ChevronRight size={14} />
            </button>
          </div>
        )}
      </div>

      {/* Processus de la demande */}
      <ol className="ui-timeline stk-timeline">
        {timeline.map((t, i) => (
          <li key={t.label} className={`ui-timeline-step ${t.done ? 'is-done' : ''} ${t.current ? 'is-current' : ''}`}>
            <span className="ui-timeline-dot">{t.done ? <Check size={12} /> : null}</span>
            <span className="ui-timeline-label">{t.label}</span>
            {t.detail && <span className="ui-timeline-detail">{t.detail}</span>}
          </li>
        ))}
      </ol>

      {bon.chef_reject_reason && (
        <StatusBanner tone="danger" icon={AlertTriangle} title="Refusé par le chef">
          {bon.chef_reject_reason as string} — corrigez la préparation puis remettez le bon.
        </StatusBanner>
      )}

      {/* Lignes de la demande, pesee et actions de l'etape */}
      <div style={{ maxWidth: 1100 }}>
        {planId
          // Vue magasinier : isChef=false quel que soit le role (admin/manager compris).
          // L'acceptation de la reception reste une action du chef, depuis son plan —
          // sinon celui qui prepare valide sa propre preparation.
          ? <BonSortiePanel planId={planId} isChef={false} isMagasinier variant="inline" />
          : <LoadingState label="Chargement des lignes…" />}
      </div>

      {rank >= 3 && next && (
        <div>
          <button type="button" className="odoo-btn-primary" onClick={() => onOpen(next.id as string)}>
            Demande suivante : {next.numero as string} <ChevronRight size={13} />
          </button>
        </div>
      )}
    </div>
  );
}
