import { money, currencySymbol } from '../../../utils/money';
import PayrollPayDialog from './PayrollPayDialog';
import { useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { weeklyPayrollApi, advancesApi } from '../../../api/employees.api';
import { format, startOfWeek, endOfWeek, addWeeks } from 'date-fns';
import { fr } from 'date-fns/locale';
import {
  Banknote, Check, ChevronLeft, ChevronRight, AlertTriangle, RotateCcw, HandCoins, Calculator, Clock, Landmark,
} from 'lucide-react';
import { useConfirm } from '../../../components/ui/ConfirmDialog';
import { StatusBanner } from '../../../components/ui/StatusBanner';
import { StatusTag } from '../../../components/ui/StatusTag';
import { RowMenu } from '../../../components/ui/RowMenu';
import { FilterChips } from '../../sales/ListTemplate';
import { KpiGrid, KpiCard, Toolbar, DataPanel, TableFooter, EmptyState, NoResultState, ErrorState } from '../../../components/ds';
import type { LucideIcon } from 'lucide-react';
import { LoadingPanel, HrHeaderActions } from '../ui';

type PayStage = 'togenerate' | 'topay' | 'paid';
const PAY_STAGES: Array<{ key: string; label: string; hint: string; icon: LucideIcon }> = [
  { key: 'togenerate', label: 'À générer', hint: 'calcul depuis le pointage', icon: Calculator },
  { key: 'topay', label: 'À payer', hint: 'paie calculée', icon: Clock },
  { key: 'paid', label: 'Payés', hint: 'paiement enregistré', icon: Check },
];
import { notify } from '../../../components/ui/InlineNotification';
import { useAuth } from '../../../context/AuthContext';
import { apiErrorMessage, openPeriodMessage, OPEN_PERIOD_CONFIRM, amount as fmt } from '../shared';
import { useEmployeeRoleLabel } from '../../../hooks/useReferentiel';

/* ═══════════════════════ WEEKLY PAYROLL VIEW ═══════════════════════ */
type WeeklyPayrollRow = {
  employee_id: string;
  first_name: string;
  last_name: string;
  role: string;
  weekly_salary: string | null;
  payroll_id: string | null;
  base_amount: string | null;
  worked_days: number | string | null;
  absent_days: number | null;
  overtime_hours: string | null;
  overtime_amount: string | null;
  net_amount: string | null;
  // Salarie declare (mig 327) : net = brut - retenue provisoire (acompte).
  gross_amount?: string | null;
  withholding_amount?: string | null;
  is_declared?: boolean | null;
  advance_deduction: string | null;
  paid: boolean | null;
  paid_at: string | null;
  payment_method: string | null;
  notes: string | null;
  // Calcules serveur (regle repos paye centralisee, cf. reposDaysFor).
  repos_days?: number | null;
  paid_days?: number | null;
};

type WeeklyPayrollData = { weekStart: string; weekEnd: string; rows: WeeklyPayrollRow[] };

export default function WeeklyPayrollView({ queryClient }: { queryClient: ReturnType<typeof useQueryClient> }) {
  // Par defaut : semaine PRECEDENTE (Lun S-1 -> Dim S-1), conformement
  // au cas d'usage "lundi = jour de paie pour la semaine ecoulee".
  const [weekOffset, setWeekOffset] = useState(-1);
  const weekStartDate = startOfWeek(addWeeks(new Date(), weekOffset), { weekStartsOn: 1 });
  const weekEndDate = endOfWeek(addWeeks(new Date(), weekOffset), { weekStartsOn: 1 });
  const weekStartStr = format(weekStartDate, 'yyyy-MM-dd');

  const { data: weekData, isLoading, isError, error, refetch } = useQuery<WeeklyPayrollData>({
    queryKey: ['weekly-payroll', weekStartStr],
    queryFn: () => weeklyPayrollApi.list(weekStartStr) as Promise<WeeklyPayrollData>,
  });

  // Soldes d'avances en cours (pour proposer la retenue au paiement)
  const { data: outstandingRows = [] } = useQuery({
    queryKey: ['advances-outstanding'],
    queryFn: () => advancesApi.outstanding(),
  });
  const { outstandingByEmp, suggestedByEmp } = useMemo(() => {
    const o = new Map<string, number>();
    const s = new Map<string, number>();
    (outstandingRows as Record<string, any>[]).forEach(r => {
      o.set(r.employee_id as string, parseFloat(r.outstanding as string) || 0);
      s.set(r.employee_id as string, parseFloat(r.suggested as string) || 0);
    });
    return { outstandingByEmp: o, suggestedByEmp: s };
  }, [outstandingRows]);
  // Cible du dialogue de paiement (ouvert seulement si l'employe a une avance en cours)
  const [stageFilter, setStageFilter] = useState<PayStage | null>(null);
  const confirm = useConfirm();
  const isAdmin = useAuth().user?.role === 'admin';
  const fnLabel = useEmployeeRoleLabel();
  const [payTarget, setPayTarget] = useState<{ row: WeeklyPayrollRow; method: string } | null>(null);

  const generateMutation = useMutation({
    mutationFn: (allowOpenPeriod: boolean = false) => weeklyPayrollApi.generate(weekStartStr, allowOpenPeriod),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['weekly-payroll'] });
      notify.success('Paies hebdomadaires générées depuis le pointage');
    },
    onError: async (err: unknown) => {
      // G0-10 : période non terminée — raison et date affichées ; l'administrateur
      // peut générer une paie provisoire (non payable).
      const open = openPeriodMessage(err);
      if (!open) { notify.error(apiErrorMessage(err, 'Erreur lors de la génération')); return; }
      if (isAdmin && await confirm(open + OPEN_PERIOD_CONFIRM)) generateMutation.mutate(true);
      else notify.error(open);
    },
  });

  const payMutation = useMutation({
    mutationFn: ({ id, method, deduction }: { id: string; method: string; deduction?: number }) =>
      weeklyPayrollApi.markPaid(id, method, deduction || 0),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['weekly-payroll'] });
      queryClient.invalidateQueries({ queryKey: ['advances-outstanding'] });
      queryClient.invalidateQueries({ queryKey: ['salary-advances'] });
      notify.success('Marqué comme payé + écriture comptable créée');
      setPayTarget(null);
    },
    onError: (err: unknown) => {
      const msg = err && typeof err === 'object' && 'response' in err
        ? (err as { response?: { data?: { error?: { message?: string } } } }).response?.data?.error?.message
        : null;
      notify.error(msg || 'Erreur');
    },
  });

  /** Paiement direct si pas d'avance en cours, sinon dialogue avec retenue proposée. */
  const startPay = (row: WeeklyPayrollRow, method: string) => {
    const outstanding = outstandingByEmp.get(row.employee_id) || 0;
    if (outstanding > 0) setPayTarget({ row, method });
    else payMutation.mutate({ id: row.payroll_id as string, method });
  };

  const unpayMutation = useMutation({
    mutationFn: (id: string) => weeklyPayrollApi.unmarkPaid(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['weekly-payroll'] });
      queryClient.invalidateQueries({ queryKey: ['advances-outstanding'] });
      queryClient.invalidateQueries({ queryKey: ['salary-advances'] });
      notify.success('Paiement annulé : décaissement supprimé et retenues re-créditées');
    },
    onError: (err: unknown) => {
      const msg = err && typeof err === 'object' && 'response' in err
        ? (err as { response?: { data?: { error?: { message?: string } } } }).response?.data?.error?.message
        : null;
      notify.error(msg || 'Erreur lors de l\'annulation');
    },
  });

  const rows = weekData?.rows ?? [];
  const generated = rows.filter(r => r.payroll_id);
  const ungenerated = rows.filter(r => !r.payroll_id);
  const paidCount = generated.filter(r => r.paid).length;
  // Montants REELS de tresorerie : net moins la retenue d'avance (faite pour
  // les paies payees, proposee — plan d'etalement — pour celles a payer).
  const cashOutOf = (r: WeeklyPayrollRow) => {
    const net = parseFloat(r.net_amount || '0');
    const ded = r.paid
      ? parseFloat(r.advance_deduction || '0')
      : Math.min(suggestedByEmp.get(r.employee_id) ?? 0, net);
    return Math.max(0, Math.round((net - ded) * 100) / 100);
  };
  const totalDue = generated.filter(r => !r.paid).reduce((s, r) => s + cashOutOf(r), 0);
  const totalPaid = generated.filter(r => r.paid).reduce((s, r) => s + cashOutOf(r), 0);

  // Filtre client issu du pipeline (les totaux restent sur toute la periode).
  const visibleRows = rows.filter(r =>
    stageFilter === 'togenerate' ? !r.payroll_id
      : stageFilter === 'topay' ? !!r.payroll_id && !r.paid
      : stageFilter === 'paid' ? !!r.paid : true);
  const stageStats = {
    togenerate: { count: ungenerated.length, sub: '' },
    topay: { count: generated.length - paidCount, sub: money(totalDue) },
    paid: { count: paidCount, sub: money(totalPaid) },
  };

  const isCurrentWeek = weekOffset === 0;

  const cur = currencySymbol();
  const n2 = (v: string | number | null | undefined) => fmt(parseFloat(String(v ?? 0)) || 0);

  return (
    <>
      {/* Action principale de la page, à droite du fil d'Ariane. */}
      <HrHeaderActions>
        <button type="button" onClick={async () => {
          if (!(await confirm(`Générer la paie hebdomadaire pour la semaine du ${weekStartStr} ?\n\nLes lignes déjà PAYÉES ne sont jamais écrasées. Les autres sont recalculées depuis le pointage.`,
            { title: 'Générer la paie', confirmLabel: 'Générer' }))) return;
          generateMutation.mutate(false);
        }} disabled={generateMutation.isPending || rows.length === 0} className="odoo-btn-primary" aria-busy={generateMutation.isPending || undefined}
          style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
          <Banknote size={13} aria-hidden="true" /> {generateMutation.isPending ? 'Génération…' : 'Générer depuis le pointage'}
        </button>
      </HrHeaderActions>

      {isCurrentWeek && (
        <StatusBanner tone="warning" icon={AlertTriangle} title="Semaine en cours">
          Vous regardez la semaine en cours. La paie est habituellement faite le lundi pour la semaine précédente.
        </StatusBanner>
      )}

      <KpiGrid>
        <KpiCard label="Employés payés à la semaine" value={rows.length} sub="à payer cette semaine" />
        <KpiCard label={`Versé (${cur})`} value={fmt(totalPaid)} sub={`${paidCount} sur ${rows.length} payés`} tone={rows.length > 0 && paidCount === rows.length ? 'green' : undefined} />
        <KpiCard label={`Reste dû (${cur})`} value={fmt(totalDue)} sub={totalDue > 0 ? 'à payer' : 'rien à payer'} tone={totalDue > 0 ? 'orange' : undefined} />
      </KpiGrid>

      {/* Pastilles d'étape : filtre de la liste (les totaux restent sur toute la période). */}
      <FilterChips label="Étape des paies" value={stageFilter ?? ''} onChange={k => setStageFilter((k || null) as PayStage | null)}
        chips={[
          { key: '', label: 'Toutes', count: rows.length },
          ...PAY_STAGES.map(st => ({ key: st.key, label: st.label, icon: st.icon, count: stageStats[st.key as PayStage].count })),
        ]} />

      {/* Barre d'outils : période. */}
      <Toolbar>
        <div className="hr-tools">
          <button type="button" onClick={() => setWeekOffset(w => w - 1)} className="ds-icon-btn" aria-label="Semaine précédente"><ChevronLeft size={16} /></button>
          <span className="ds-strong">
            Semaine du {format(weekStartDate, 'd MMM', { locale: fr })} au {format(weekEndDate, 'd MMM yyyy', { locale: fr })}
          </span>
          <button type="button" onClick={() => setWeekOffset(w => w + 1)} className="ds-icon-btn" aria-label="Semaine suivante"><ChevronRight size={16} /></button>
          {weekOffset !== -1 && (
            <button type="button" onClick={() => setWeekOffset(-1)} className="ds-btn-ghost ds-btn-sm">Semaine précédente</button>
          )}
        </div>
      </Toolbar>

      {isLoading ? (
        <LoadingPanel />
      ) : isError ? (
        <ErrorState error={error} onRetry={() => void refetch()} />
      ) : rows.length === 0 ? (
        <EmptyState icon={Banknote} title="Aucun employé payé à la semaine" text="Passez un employé en « Fréquence de paie : Hebdomadaire » dans l'écran Employés pour le voir ici." />
      ) : visibleRows.length === 0 ? (
        <NoResultState text="Aucune paie à cette étape." onReset={() => setStageFilter(null)} />
      ) : (
        <DataPanel label="Paies de la semaine" footer={<TableFooter
          note={`${visibleRows.length} salarié${visibleRows.length > 1 ? 's' : ''} · ${paidCount} sur ${rows.length} payés · à payer ${stageStats.topay.sub} · payé ${stageStats.paid.sub}`} />}>
          <table className="odoo-table ds-dense">
            <thead>
              <tr>
                <th>Employé</th>
                <th>Poste</th>
                <th className="ds-num">Salaire par semaine ({cur})</th>
                <th className="ds-num">Jours travaillés</th>
                <th className="ds-num" title="Repos hebdomadaire payé (automatique dès que la semaine a été travaillée)">Repos (j)</th>
                <th className="ds-num">Absences (j)</th>
                <th className="ds-num">Base ({cur})</th>
                <th className="ds-num">Heures sup ({cur})</th>
                <th className="ds-num" title="Solde d'avances à récupérer, ou retenue faite sur cette paie">Avance ({cur})</th>
                <th className="ds-num">Net à verser ({cur})</th>
                <th>Statut</th>
                <th className="ds-actions"><span className="sr-only">Actions</span></th>
              </tr>
            </thead>
            <tbody>
              {visibleRows.map(r => {
                const generated = !!r.payroll_id;
                const paid = !!r.paid;
                const who = `${r.first_name} ${r.last_name}`;
                return (
                  <tr key={r.employee_id}>
                    <td className="ds-strong">{who}</td>
                    <td>{fnLabel(r.role)}</td>
                    <td className="ds-num">
                      {r.weekly_salary ? n2(r.weekly_salary) : <StatusTag tone="blocked" label="Non défini" />}
                    </td>
                    {generated ? (
                      <>
                        <td className="ds-num ds-strong">
                          {(Math.round(parseFloat(String(r.worked_days ?? 0)) * 100) / 100).toString()}
                        </td>
                        <td className="ds-num"
                          title="Repos payé proportionnel : 0 si moins de 4 jours travaillés, sinon min(jours travaillés / 6, 1). Valeur calculée serveur.">
                          {(() => {
                            const repos = parseFloat(String(r.repos_days ?? 0));
                            if (repos <= 0) return '—';
                            return (Math.round(repos * 100) / 100).toString();
                          })()}
                        </td>
                        <td className="ds-num" style={{ color: (r.absent_days ?? 0) > 0 ? 'var(--ds-danger)' : 'var(--ds-muted)', fontWeight: (r.absent_days ?? 0) > 0 ? 600 : undefined }}>{r.absent_days}</td>
                        <td className="ds-num">{n2(r.base_amount)}</td>
                        <td className="ds-num">
                          {parseFloat(r.overtime_amount || '0') > 0 ? `+ ${n2(r.overtime_amount)}` : '—'}
                        </td>
                        <td className="ds-num">
                          {paid ? (
                            parseFloat(r.advance_deduction || '0') > 0
                              ? <span title="Retenue d'avance sur cette paie">− {n2(r.advance_deduction)}</span>
                              : '—'
                          ) : (outstandingByEmp.get(r.employee_id) || 0) > 0 ? (
                            <span className="odoo-tag odoo-tag-orange" title={`Avance en cours : ${money((outstandingByEmp.get(r.employee_id) || 0))} — retenue proposée au paiement`}>
                              <HandCoins size={10} aria-hidden="true" style={{ marginRight: 2 }} />
                              {fmt(outstandingByEmp.get(r.employee_id) || 0)}
                            </span>
                          ) : '—'}
                        </td>
                        <td className="ds-num ds-strong">
                          {(() => {
                            const net = parseFloat(r.net_amount || '0');
                            const ded = paid
                              ? parseFloat(r.advance_deduction || '0')
                              : Math.min(suggestedByEmp.get(r.employee_id) ?? 0, net);
                            const verse = Math.max(0, Math.round((net - ded) * 100) / 100);
                            const wh = parseFloat(r.withholding_amount || '0');
                            const whNote = wh > 0 && (
                              <div style={{ fontSize: 11, fontWeight: 400, color: 'var(--ds-muted)' }}
                                title="Acompte d'un salarié déclaré : retenue provisoire CNSS / AMO / IR, régularisée sur le bulletin mensuel">
                                brut {n2(r.gross_amount)} − retenue provisoire {fmt(wh)}
                              </div>
                            );
                            if (ded <= 0.005) return <>{fmt(net)}{whNote}</>;
                            return (
                              <span title={paid
                                ? `Net ${net.toFixed(2)} − retenue avance ${ded.toFixed(2)} = versé ${verse.toFixed(2)}`
                                : `Net dû ${net.toFixed(2)} − retenue proposée ${ded.toFixed(2)} (modifiable au paiement)`}>
                                {fmt(verse)}
                                <div style={{ fontSize: 11, fontWeight: 400, color: 'var(--ds-muted)' }}>
                                  net {fmt(net)}
                                </div>
                                {whNote}
                              </span>
                            );
                          })()}
                        </td>
                        <td>{paid ? <StatusTag tone="done" label="Payé" /> : <StatusTag tone="todo" label="À payer" />}</td>
                        <td className="ds-actions">
                          {paid ? (
                            <RowMenu label={`Plus d'actions pour la paie de ${who}`} items={[{
                              label: 'Annuler le paiement', icon: RotateCcw, danger: true,
                              onSelect: async () => {
                                if (!(await confirm(`Annuler le paiement de ${who} ?\n\nLe décaissement lié sera supprimé (écriture comptable reversée) et les retenues d'avance re-créditées. Vous pourrez ensuite re-payer sans doublon.`,
                                  { title: 'Annuler le paiement', confirmLabel: 'Annuler le paiement', danger: true }))) return;
                                unpayMutation.mutate(r.payroll_id as string);
                              },
                            }]} />
                          ) : (
                            <>
                              <button type="button" onClick={() => startPay(r, 'cash')} className="odoo-btn-secondary ds-btn-sm" disabled={payMutation.isPending}>
                                <Banknote size={13} aria-hidden="true" /> Payer
                              </button>
                              <RowMenu label={`Plus d'actions pour la paie de ${who}`} items={[
                                { label: 'Payer par virement', icon: Landmark, disabled: payMutation.isPending, onSelect: () => startPay(r, 'bank') },
                              ]} />
                            </>
                          )}
                        </td>
                      </>
                    ) : (
                      <>
                        <td colSpan={7} style={{ color: 'var(--ds-muted)' }}>
                          À calculer : « Générer depuis le pointage »
                        </td>
                        <td><StatusTag tone="draft" label="Non généré" /></td>
                        <td className="ds-actions"></td>
                      </>
                    )}
                  </tr>
                );
              })}
            </tbody>
            {generated.length > 0 && (
              <tfoot>
                <tr>
                  <td colSpan={6}>Total de la semaine</td>
                  <td className="ds-num">{fmt(generated.reduce((s, r) => s + parseFloat(r.base_amount || '0'), 0))}</td>
                  <td className="ds-num">{fmt(generated.reduce((s, r) => s + parseFloat(r.overtime_amount || '0'), 0))}</td>
                  <td className="ds-num" title="Retenues d'avance effectuées sur les paies payées">
                    {(() => {
                      const t = generated.reduce((s, r) => s + parseFloat(r.advance_deduction || '0'), 0);
                      return t > 0 ? `− ${fmt(t)}` : '—';
                    })()}
                  </td>
                  <td className="ds-num" title="Total à verser (net moins retenues d'avance)">
                    {fmt(generated.reduce((s, r) => s + cashOutOf(r), 0))}
                  </td>
                  <td colSpan={2}></td>
                </tr>
              </tfoot>
            )}
          </table>
        </DataPanel>
      )}

      {/* ─── Dialogue de paiement avec retenue d'avance ─── */}
      {payTarget && (
        <PayrollPayDialog
          employeeName={`${payTarget.row.first_name} ${payTarget.row.last_name}`}
          periodLabel={`Semaine du ${format(weekStartDate, 'dd MMM yyyy', { locale: fr })}`}
          net={parseFloat(payTarget.row.net_amount || '0')}
          outstanding={outstandingByEmp.get(payTarget.row.employee_id) || 0}
          suggested={suggestedByEmp.get(payTarget.row.employee_id) ?? (outstandingByEmp.get(payTarget.row.employee_id) || 0)}
          defaultMethod={payTarget.method}
          pending={payMutation.isPending}
          onClose={() => setPayTarget(null)}
          onConfirm={(method, deduction) => payMutation.mutate({ id: payTarget.row.payroll_id as string, method, deduction })}
        />
      )}

      <div className="prj-note" style={{ fontSize: 12, color: 'var(--ds-muted)', margin: '0 4px' }}>
        Le bouton « Générer depuis le pointage » recalcule la paie à partir du pointage (jours présents/absents/retards et heures sup). Les lignes déjà payées ne sont jamais écrasées.
        Taux journalier = salaire / 7. Le repos hebdomadaire est payé au prorata des jours travaillés (jours ÷ 6, plafonné à 1) : 6 jours = 1 journée de repos (salaire complet), une demi-semaine = une demi-journée de repos, 7 jours travaillés (repos non pris) = salaire + 1 journée.
        Une demi-journée compte 0,5 ; un « Double shift » compte 2 jours payés.
        Marquer payé crée automatiquement une écriture comptable « Salaires » sur la caisse correspondante.
        Si l'employé a une avance en cours, une retenue est proposée au moment du paiement.
      </div>
    </>
  );
}
