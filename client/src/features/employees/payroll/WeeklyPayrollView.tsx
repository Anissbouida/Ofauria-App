import PayrollPayDialog from './PayrollPayDialog';
import { useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { weeklyPayrollApi, advancesApi } from '../../../api/employees.api';
import { format, startOfWeek, endOfWeek, addWeeks } from 'date-fns';
import { fr } from 'date-fns/locale';
import {
  Users, Banknote, Check, ChevronLeft, ChevronRight, AlertTriangle, RotateCcw, HandCoins,
} from 'lucide-react';
import { notify } from '../../../components/ui/InlineNotification';
import { ROLE_LABELS } from '@ofauria/shared';

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

  const { data: weekData, isLoading } = useQuery<WeeklyPayrollData>({
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
  const [payTarget, setPayTarget] = useState<{ row: WeeklyPayrollRow; method: string } | null>(null);

  const generateMutation = useMutation({
    mutationFn: () => weeklyPayrollApi.generate(weekStartStr),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['weekly-payroll'] });
      notify.success('Paies hebdomadaires générées depuis le pointage');
    },
    onError: () => notify.error('Erreur lors de la génération'),
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
      notify.success('Paiement annulé : sortie de caisse supprimée et retenues re-créditées');
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

  const isCurrentWeek = weekOffset === 0;

  return (
    <>
      <div className="odoo-search-panel" style={{ justifyContent: 'space-between' }}>
        <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          <button onClick={() => setWeekOffset(w => w - 1)} className="odoo-pager-btn" aria-label="Semaine précédente"><ChevronLeft size={14} /></button>
          <span style={{ fontSize: '0.8125rem', fontWeight: 500 }}>
            Semaine du {format(weekStartDate, 'dd MMM', { locale: fr })} au {format(weekEndDate, 'dd MMM yyyy', { locale: fr })}
          </span>
          <button onClick={() => setWeekOffset(w => w + 1)} className="odoo-pager-btn" aria-label="Semaine suivante"><ChevronRight size={14} /></button>
          <button onClick={() => setWeekOffset(-1)} style={{ fontSize: '0.6875rem', color: 'var(--odoo-purple)', background: 'none', border: 'none', textDecoration: 'underline', cursor: 'pointer', marginLeft: 4 }}>
            Semaine précédente
          </button>
        </div>
        <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          <button onClick={() => {
            if (confirm(`Generer la paie hebdo pour la semaine du ${weekStartStr} ?\n\nLes lignes deja PAYEES ne sont jamais ecrasees. Les autres sont recalculees depuis le pointage.`)) {
              generateMutation.mutate();
            }
          }} disabled={generateMutation.isPending || rows.length === 0} className="odoo-btn-primary"
            style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
            <Banknote size={13} /> {generateMutation.isPending ? 'Génération...' : 'Générer depuis pointage'}
          </button>
        </div>
      </div>

      {isCurrentWeek && (
        <div className="odoo-alert warning" style={{ padding: '0.625rem 0.875rem' }}>
          <div style={{ fontSize: '0.75rem' }}>
            <AlertTriangle size={12} style={{ display: 'inline', marginRight: 4 }} />
            Vous regardez la semaine en cours. La paie est habituellement faite le lundi pour la semaine précédente.
          </div>
        </div>
      )}

      {/* Stat tiles */}
      <div className="odoo-stat-grid">
        <div className="odoo-stat-card">
          <div className="odoo-stat-card-label"><Users size={11} style={{ display: 'inline', marginRight: 4 }} />Employés hebdo</div>
          <div className="odoo-stat-card-value">{rows.length}</div>
          <div className="odoo-stat-card-sub">à payer cette semaine</div>
        </div>
        <div className="odoo-stat-card">
          <div className="odoo-stat-card-label"><Check size={11} style={{ display: 'inline', marginRight: 4 }} />Payés</div>
          <div className="odoo-stat-card-value" style={{ color: paidCount > 0 ? '#28a745' : undefined }}>{paidCount}</div>
          <div className="odoo-stat-card-sub">{totalPaid.toFixed(2)} DH</div>
        </div>
        <div className="odoo-stat-card">
          <div className="odoo-stat-card-label"><Banknote size={11} style={{ display: 'inline', marginRight: 4 }} />Reste dû</div>
          <div className="odoo-stat-card-value" style={{ color: totalDue > 0 ? '#dc3545' : undefined }}>{totalDue.toFixed(2)} <span style={{ fontSize: '0.6875rem', color: 'var(--odoo-text-muted)', fontWeight: 400 }}>DH</span></div>
        </div>
        <div className="odoo-stat-card">
          <div className="odoo-stat-card-label"><AlertTriangle size={11} style={{ display: 'inline', marginRight: 4 }} />Non générés</div>
          <div className="odoo-stat-card-value" style={{ color: ungenerated.length > 0 ? '#b08504' : undefined }}>{ungenerated.length}</div>
          <div className="odoo-stat-card-sub">en attente du calcul</div>
        </div>
      </div>

      {isLoading ? (
        <p style={{ color: 'var(--odoo-text-muted)', fontSize: '0.8125rem' }}>Chargement...</p>
      ) : rows.length === 0 ? (
        <div style={{ padding: '3rem', textAlign: 'center', color: 'var(--odoo-text-muted)' }}>
          <Banknote size={28} style={{ margin: '0 auto 0.5rem', opacity: 0.4 }} />
          <p style={{ fontSize: '0.8125rem' }}>Aucun employé en fréquence hebdomadaire.</p>
          <p style={{ fontSize: '0.75rem', marginTop: 4 }}>Passez un employé en « Fréquence de paie : Hebdomadaire » dans l'onglet Employés pour le voir ici.</p>
        </div>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table className="odoo-table">
            <thead>
              <tr>
                <th style={{ width: 24 }}></th>
                <th>Employé</th>
                <th style={{ textAlign: 'right' }}>Salaire hebdo</th>
                <th style={{ textAlign: 'center' }}>Jours trav.</th>
                <th style={{ textAlign: 'center' }} title="Repos hebdomadaire payé (automatique dès que la semaine a été travaillée)">Repos</th>
                <th style={{ textAlign: 'center' }}>Absents</th>
                <th style={{ textAlign: 'right' }}>Base</th>
                <th style={{ textAlign: 'right' }}>H. Sup</th>
                <th style={{ textAlign: 'right' }} title="Solde d'avances à récupérer, ou retenue faite sur cette paie">Avance</th>
                <th style={{ textAlign: 'right', background: '#eafaf1', color: '#155724' }}>Net</th>
                <th style={{ textAlign: 'center', width: 110 }}>Paiement</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(r => {
                const generated = !!r.payroll_id;
                const paid = !!r.paid;
                return (
                  <tr key={r.employee_id} className={paid ? '' : generated ? 'row-warning' : ''}>
                    <td>
                      <span className={`odoo-status-dot ${paid ? 'ok' : generated ? 'warning' : 'neutral'}`} />
                    </td>
                    <td>
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontWeight: 500 }}>
                        <Users size={11} style={{ color: 'var(--theme-accent)' }} />
                        {r.first_name} {r.last_name}
                        <span style={{ color: 'var(--odoo-text-muted)', fontSize: '0.6875rem' }}>· {ROLE_LABELS[r.role as keyof typeof ROLE_LABELS] ?? r.role}</span>
                      </span>
                    </td>
                    <td style={{ textAlign: 'right', color: 'var(--odoo-text-muted)' }}>
                      {r.weekly_salary ? `${parseFloat(r.weekly_salary).toFixed(2)} DH` : <span style={{ color: '#dc3545' }}>Non défini</span>}
                    </td>
                    {generated ? (
                      <>
                        <td style={{ textAlign: 'center', fontWeight: 600 }}>
                          {(Math.round(parseFloat(String(r.worked_days ?? 0)) * 100) / 100).toString()}
                        </td>
                        <td style={{ textAlign: 'center', color: parseFloat(String(r.worked_days ?? 0)) > 0 ? '#7c3aed' : 'var(--odoo-text-light)' }}
                          title="Repos payé proportionnel : 0 si moins de 4 jours travaillés, sinon min(jours travaillés / 6, 1). Valeur calculée serveur.">
                          {(() => {
                            const repos = parseFloat(String(r.repos_days ?? 0));
                            if (repos <= 0) return '—';
                            return (Math.round(repos * 100) / 100).toString();
                          })()}
                        </td>
                        <td style={{ textAlign: 'center', color: (r.absent_days ?? 0) > 0 ? '#dc3545' : 'var(--odoo-text-light)' }}>{r.absent_days}</td>
                        <td style={{ textAlign: 'right' }}>{parseFloat(r.base_amount || '0').toFixed(2)}</td>
                        <td style={{ textAlign: 'right', color: parseFloat(r.overtime_amount || '0') > 0 ? '#b85d1a' : 'var(--odoo-text-light)' }}>
                          {parseFloat(r.overtime_amount || '0') > 0 ? `+${parseFloat(r.overtime_amount || '0').toFixed(2)}` : '—'}
                        </td>
                        <td style={{ textAlign: 'right' }}>
                          {paid ? (
                            parseFloat(r.advance_deduction || '0') > 0
                              ? <span style={{ color: '#b85d1a', fontWeight: 500 }} title="Retenue d'avance sur cette paie">− {parseFloat(r.advance_deduction || '0').toFixed(2)}</span>
                              : <span style={{ color: 'var(--odoo-text-light)' }}>—</span>
                          ) : (outstandingByEmp.get(r.employee_id) || 0) > 0 ? (
                            <span className="odoo-tag odoo-tag-orange" title={`Avance en cours : ${(outstandingByEmp.get(r.employee_id) || 0).toFixed(2)} DH — retenue proposée au paiement`}>
                              <HandCoins size={10} style={{ marginRight: 2 }} />
                              {(outstandingByEmp.get(r.employee_id) || 0).toFixed(2)}
                            </span>
                          ) : (
                            <span style={{ color: 'var(--odoo-text-light)' }}>—</span>
                          )}
                        </td>
                        <td style={{ textAlign: 'right', fontWeight: 700, color: '#155724', background: '#eafaf1' }}>
                          {(() => {
                            const net = parseFloat(r.net_amount || '0');
                            const ded = paid
                              ? parseFloat(r.advance_deduction || '0')
                              : Math.min(suggestedByEmp.get(r.employee_id) ?? 0, net);
                            const verse = Math.max(0, Math.round((net - ded) * 100) / 100);
                            if (ded <= 0.005) return `${net.toFixed(2)} DH`;
                            return (
                              <span title={paid
                                ? `Net ${net.toFixed(2)} − retenue avance ${ded.toFixed(2)} = versé ${verse.toFixed(2)}`
                                : `Net dû ${net.toFixed(2)} − retenue proposée ${ded.toFixed(2)} (modifiable au paiement)`}>
                                {verse.toFixed(2)} DH
                                <div style={{ fontSize: '0.625rem', fontWeight: 400, color: 'var(--odoo-text-muted)' }}>
                                  net {net.toFixed(2)}
                                </div>
                              </span>
                            );
                          })()}
                        </td>
                        <td style={{ textAlign: 'center' }}>
                          {paid ? (
                            <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                              <span className="odoo-tag odoo-tag-green">
                                <Check size={10} style={{ marginRight: 3 }} /> Payé
                              </span>
                              <button onClick={() => {
                                if (confirm(`Annuler le paiement de ${r.first_name} ${r.last_name} ?\n\nLa sortie de caisse liée sera supprimée (écriture comptable reversée) et les retenues d'avance re-créditées. Vous pourrez ensuite re-payer sans doublon.`)) {
                                  unpayMutation.mutate(r.payroll_id as string);
                                }
                              }} className="odoo-pager-btn" title="Annuler le paiement" style={{ color: '#dc3545' }}>
                                <RotateCcw size={12} />
                              </button>
                            </div>
                          ) : (
                            <div style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                              <button onClick={() => startPay(r, 'cash')} className="odoo-btn-primary"
                                disabled={payMutation.isPending}
                                style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '0.25rem 0.5rem', fontSize: '0.6875rem' }}>
                                <Banknote size={11} /> Espèces
                              </button>
                              <button onClick={() => startPay(r, 'bank')} className="odoo-btn-secondary"
                                disabled={payMutation.isPending}
                                style={{ padding: '0.25rem 0.5rem', fontSize: '0.6875rem' }}>
                                Virement
                              </button>
                            </div>
                          )}
                        </td>
                      </>
                    ) : (
                      <>
                        <td colSpan={7} style={{ textAlign: 'center', color: 'var(--odoo-text-light)', fontStyle: 'italic' }}>
                          — Cliquez « Générer depuis pointage » pour calculer —
                        </td>
                        <td style={{ textAlign: 'center' }}>
                          <span className="odoo-tag odoo-tag-grey">Non généré</span>
                        </td>
                      </>
                    )}
                  </tr>
                );
              })}
            </tbody>
            {generated.length > 0 && (
              <tfoot style={{ background: 'var(--odoo-bg-alt)', borderTop: '2px solid var(--odoo-border)' }}>
                <tr>
                  <td colSpan={6} style={{ padding: '0.5rem 0.75rem', fontWeight: 700 }}>Total semaine</td>
                  <td style={{ textAlign: 'right', padding: '0.5rem 0.75rem', fontWeight: 700 }}>
                    {generated.reduce((s, r) => s + parseFloat(r.base_amount || '0'), 0).toFixed(2)} DH
                  </td>
                  <td style={{ textAlign: 'right', padding: '0.5rem 0.75rem', fontWeight: 700, color: '#b85d1a' }}>
                    {generated.reduce((s, r) => s + parseFloat(r.overtime_amount || '0'), 0).toFixed(2)} DH
                  </td>
                  <td style={{ textAlign: 'right', padding: '0.5rem 0.75rem', fontWeight: 700, color: '#b85d1a' }} title="Retenues d'avance effectuées sur les paies payées">
                    {(() => {
                      const t = generated.reduce((s, r) => s + parseFloat(r.advance_deduction || '0'), 0);
                      return t > 0 ? `− ${t.toFixed(2)} DH` : '—';
                    })()}
                  </td>
                  <td style={{ textAlign: 'right', padding: '0.5rem 0.75rem', fontWeight: 700, color: '#155724', background: '#eafaf1' }}
                    title="Total à verser (net moins retenues d'avance)">
                    {generated.reduce((s, r) => s + cashOutOf(r), 0).toFixed(2)} DH
                  </td>
                  <td></td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
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

      <div style={{ fontSize: '0.6875rem', color: 'var(--odoo-text-muted)' }}>
        Le bouton « Générer depuis pointage » recalcule la paie à partir du pointage (jours présents/absents/retards et heures sup). Les lignes déjà payées ne sont jamais écrasées.
        Taux journalier = salaire / 7. Le repos hebdomadaire est payé au prorata des jours travaillés (jours ÷ 6, plafonné à 1) : 6 jours = 1 journée de repos (salaire complet), une demi-semaine = une demi-journée de repos, 7 jours travaillés (repos non pris) = salaire + 1 journée.
        Une demi-journée compte 0,5 ; un « Double shift » compte 2 jours payés.
        Marquer payé crée automatiquement une écriture comptable « Salaires » sur la caisse correspondante.
        Si l'employé a une avance en cours, une retenue est proposée au moment du paiement.
      </div>
    </>
  );
}
