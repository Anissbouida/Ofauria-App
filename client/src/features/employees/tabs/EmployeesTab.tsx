import { useEffect, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { employeesApi, shiftsApi, payrollConfigApi } from '../../../api/employees.api';
import { useReferentiel } from '../../../hooks/useReferentiel';
import { fr } from 'date-fns/locale';
import {
  Plus, Pencil, UserCog, Users, Banknote, Search, ArrowUpDown, ArrowUp, ArrowDown, FileText, Trash2, RotateCcw, AlertOctagon,
  StickyNote, UserRound, Briefcase, Phone, Loader2,
} from 'lucide-react';
import { useConfirm } from '../../../components/ui/ConfirmDialog';
import { StatusBanner } from '../../../components/ui/StatusBanner';
import { HrModal, SectionTitle, EmptyState, fieldLabel, inputCls } from '../ui';
import { notify } from '../../../components/ui/InlineNotification';
import { useAuth } from '../../../context/AuthContext';
import { isoDate, syncSalaryFields, saveBlobResponse, apiErrorMessage } from '../shared';
import EmployeeSalaryHistory from './EmployeeSalaryHistory';
import EmployeePayrollItems from './EmployeePayrollItems';
import HrAlertsPanel from '../contracts/HrAlertsPanel';
import EmployeeContracts from '../contracts/EmployeeContracts';
import EmployeeDocuments from '../contracts/EmployeeDocuments';
import EmployeeDeparture from '../contracts/EmployeeDeparture';

/* ═══════════════════════ EMPLOYEES TAB ═══════════════════════ */
export default function EmployeesTab({ queryClient }: { queryClient: ReturnType<typeof useQueryClient> }) {
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<Record<string, any> | null>(null);
  const [viewDetail, setViewDetail] = useState<Record<string, any> | null>(null);
  const [searchEmp, setSearchEmp] = useState('');
  const [statusFilter, setStatusFilter] = useState<'active' | 'inactive' | 'all'>('active');
  const [sortKey, setSortKey] = useState<string>('name');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');

  const { data: employees = [], isLoading } = useQuery({ queryKey: ['employees'], queryFn: employeesApi.list });
  const { entries: roles, getLabel: getRoleLabel, getColor: getRoleColor } = useReferentiel('employee_roles');
  const { entries: contractTypes, getLabel: getContractLabel } = useReferentiel('contract_types');
  const { data: shifts = [] } = useQuery<Record<string, any>[]>({
    queryKey: ['shifts'],
    queryFn: shiftsApi.list as () => Promise<Record<string, any>[]>,
  });
  // Suppression/reactivation employes : backend reserve admin. On masque les
  // boutons aux non-admins pour eviter d'afficher une action qui retournerait 403.
  const { user } = useAuth();
  const canDeleteEmployee = user?.role === 'admin';
  const confirm = useConfirm();

  const saveMutation = useMutation({
    mutationFn: (data: Record<string, any>) =>
      editing ? employeesApi.update(editing.id as string, data) : employeesApi.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['employees'] });
      notify.success(editing ? 'Employé mis à jour' : 'Employé ajouté');
      setShowForm(false); setEditing(null);
    },
    onError: () => notify.error('Erreur'),
  });

  /**
   * Suppression employe = soft delete (UPDATE is_active=false cote backend).
   * On preserve l'historique attendance/paie/paiements lies via FK qui sont
   * sans CASCADE — un DELETE physique echouerait de toute facon. L'employe
   * peut etre reactive ulterieurement.
   */
  const deactivateMutation = useMutation({
    mutationFn: (id: string) => employeesApi.remove(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['employees'] });
      notify.success('Employé désactivé — historique préservé');
    },
    onError: (err: unknown) => {
      const msg = err && typeof err === 'object' && 'response' in err
        ? (err as { response?: { data?: { error?: { message?: string } } } }).response?.data?.error?.message
        : null;
      notify.error(msg || 'Erreur lors de la désactivation');
    },
  });

  const reactivateMutation = useMutation({
    mutationFn: (id: string) => employeesApi.update(id, { isActive: true }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['employees'] });
      notify.success('Employé réactivé');
    },
    onError: () => notify.error('Erreur lors de la réactivation'),
  });

  /**
   * Hard delete : suppression PHYSIQUE de l'employe + cascade sur attendance,
   * paie, conges, paiements, etc. Irreversible.
   *
   * Flow : preview (compte les references) -> confirm avec details -> delete.
   */
  const hardDeleteMutation = useMutation({
    mutationFn: (id: string) => employeesApi.hardDelete(id),
    onSuccess: (result: Record<string, number>) => {
      queryClient.invalidateQueries({ queryKey: ['employees'] });
      queryClient.invalidateQueries({ queryKey: ['payments-charges'] });
      const totalLinked = (result.payments || 0) + (result.payroll || 0)
        + (result.leaves || 0) + (result.attendance || 0)
        + (result.schedules || 0) + (result.productionCoutReel || 0);
      notify.success(`Employé supprimé définitivement${totalLinked > 0 ? ` (+ ${totalLinked} enregistrement(s) lié(s))` : ''}`);
    },
    onError: (err: unknown) => {
      const msg = err && typeof err === 'object' && 'response' in err
        ? (err as { response?: { data?: { error?: { message?: string } } } }).response?.data?.error?.message
        : null;
      notify.error(msg || 'Erreur lors de la suppression définitive');
    },
  });

  /**
   * Trigger hard delete avec preview + double confirmation.
   */
  async function handleHardDelete(emp: Record<string, any>) {
    const fullName = `${emp.first_name} ${emp.last_name}`;

    if (!(await confirm(
      `Vous êtes sur le point d'effacer ${fullName} DE LA BASE DE DONNÉES.\n\n` +
      `Cette action est IRRÉVERSIBLE. Toutes les références (paie, présence,\n` +
      `congés, paiements) seront aussi supprimées.\n\n` +
      `Si vous voulez juste masquer l'employé en gardant l'historique,\n` +
      `utilisez plutôt le bouton "Désactiver".\n\n` +
      `Continuer vers le détail des données qui seront supprimées ?`,
      { title: 'Suppression définitive', confirmLabel: 'Continuer', danger: true },
    ))) return;

    // Fetch counts pour montrer ce qui sera detruit
    let counts: Record<string, number>;
    try {
      counts = await employeesApi.dependencies(emp.id as string);
    } catch {
      notify.error('Impossible de prévisualiser les données liées');
      return;
    }

    const deleteLines: string[] = [];
    // Retenues d'avance imputees : le serveur refuse (ecritures 6171/3431),
    // on le dit tout de suite plutot qu'apres confirmation.
    if (counts.salaryAdvanceRepayments) {
      notify.error(`${counts.salaryAdvanceRepayments} retenue(s) d'avance imputée(s) sur des paies : annulez d'abord ces paiements avant la suppression définitive.`);
      return;
    }
    if (counts.payroll) deleteLines.push(`• ${counts.payroll} fiche(s) de paie mensuelle`);
    if (counts.biweeklyPayroll) deleteLines.push(`• ${counts.biweeklyPayroll} paie(s) par quinzaine`);
    if (counts.weeklyPayroll) deleteLines.push(`• ${counts.weeklyPayroll} paie(s) hebdomadaire(s)`);
    if (counts.salaryAdvances) deleteLines.push(`• ${counts.salaryAdvances} avance(s) sur salaire`);
    if (counts.salaryHistory) deleteLines.push(`• ${counts.salaryHistory} ligne(s) d'historique de salaire`);
    if (counts.attendance) deleteLines.push(`• ${counts.attendance} pointage(s) / présence(s)`);
    if (counts.leaves) deleteLines.push(`• ${counts.leaves} congé(s)`);
    if (counts.schedules) deleteLines.push(`• ${counts.schedules} planning(s)`);
    if (counts.payments) deleteLines.push(`• ${counts.payments} paiement(s) lié(s)`);
    if (counts.productionTempsTravail) deleteLines.push(`• ${counts.productionTempsTravail} temps de production`);

    // Ventes : preservees (NULL employee_id) — historique chiffre d'affaires garde
    const salesNote = counts.sales
      ? `\nVentes liées (${counts.sales}) : préservées — l'employé sera juste détaché des ventes.\n`
      : '';

    const details = deleteLines.length > 0
      ? `Données qui seront EFFACÉES en cascade :\n${deleteLines.join('\n')}\n${salesNote}\n`
      : `Aucune donnée liée à effacer.${salesNote}\n`;

    if (!(await confirm(
      `${details}` +
      `Confirmer la suppression DÉFINITIVE de ${fullName} ?\n\n` +
      `Action irréversible.`,
      { title: 'Suppression définitive', confirmLabel: 'Supprimer définitivement', danger: true },
    ))) return;

    hardDeleteMutation.mutate(emp.id as string);
  }

  const activeCount = employees.filter((e: Record<string, any>) => e.is_active).length;

  // ─── Agregats masse salariale (uniquement sur actifs) ────────────────────
  // Masse mensuelle = somme des monthly_salary des actifs mensuels ET quinzaine
  // (la quinzaine paie sur la base du salaire mensuel).
  // Masse hebdo = somme des weekly_salary des actifs hebdo.
  // Coût mensuel équivalent = mensuel + hebdo × 4.33 (nb moyen de semaines / mois).
  const activeEmployees = employees.filter((e: Record<string, any>) => e.is_active);
  const activeMonthly = activeEmployees.filter((e: Record<string, any>) => ['monthly', 'biweekly'].includes(e.pay_frequency ?? 'monthly'));
  const activeBiweeklyCount = activeEmployees.filter((e: Record<string, any>) => e.pay_frequency === 'biweekly').length;
  const activeWeekly = activeEmployees.filter((e: Record<string, any>) => e.pay_frequency === 'weekly');
  const massMonthly = activeMonthly.reduce((s: number, e: Record<string, any>) => s + (parseFloat(e.monthly_salary as string) || 0), 0);
  const massWeekly = activeWeekly.reduce((s: number, e: Record<string, any>) => s + (parseFloat(e.weekly_salary as string) || 0), 0);
  const WEEKS_PER_MONTH = 52 / 12; // ≈ 4.333
  const massMonthlyEquiv = massMonthly + massWeekly * WEEKS_PER_MONTH;
  const withSalaryCount = activeMonthly.filter((e: Record<string, any>) => parseFloat(e.monthly_salary as string) > 0).length
    + activeWeekly.filter((e: Record<string, any>) => parseFloat(e.weekly_salary as string) > 0).length;
  const avgSalary = withSalaryCount > 0 ? massMonthlyEquiv / withSalaryCount : 0;

  // Repartition par contrat (uniquement actifs)
  const contractCounts: Record<string, number> = {};
  for (const e of activeEmployees) {
    const c = (e.contract_type as string) || 'cdi';
    contractCounts[c] = (contractCounts[c] || 0) + 1;
  }
  const formatMoney = (v: number) => v.toLocaleString('fr-FR', { maximumFractionDigits: 0 });

  const toggleSort = (key: string) => {
    if (sortKey === key) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortKey(key); setSortDir('asc'); }
  };
  const SortIcon = ({ col }: { col: string }) => {
    if (sortKey !== col) return <ArrowUpDown size={13} className="text-gray-300 ml-1 inline" />;
    return sortDir === 'asc'
      ? <ArrowUp size={13} className="text-teal-600 ml-1 inline" />
      : <ArrowDown size={13} className="text-teal-600 ml-1 inline" />;
  };

  const inactiveCount = employees.length - activeCount;
  const filteredEmp = employees.filter((e: Record<string, any>) => {
    if (statusFilter === 'active' && !e.is_active) return false;
    if (statusFilter === 'inactive' && e.is_active) return false;
    if (!searchEmp) return true;
    const s = searchEmp.toLowerCase();
    return (e.first_name as string).toLowerCase().includes(s) || (e.last_name as string).toLowerCase().includes(s) || (e.cin as string || '').toLowerCase().includes(s);
  });

  const sortedEmp = [...filteredEmp].sort((a: Record<string, any>, b: Record<string, any>) => {
    let va: string | number = '';
    let vb: string | number = '';
    switch (sortKey) {
      case 'name':
        va = `${a.first_name || ''} ${a.last_name || ''}`.toLowerCase();
        vb = `${b.first_name || ''} ${b.last_name || ''}`.toLowerCase();
        break;
      case 'role':
        va = getRoleLabel(a.role as string).toLowerCase();
        vb = getRoleLabel(b.role as string).toLowerCase();
        break;
      case 'contract':
        va = getContractLabel(a.contract_type as string || 'cdi').toLowerCase();
        vb = getContractLabel(b.contract_type as string || 'cdi').toLowerCase();
        break;
      case 'salary':
        va = parseFloat(a.monthly_salary as string) || 0;
        vb = parseFloat(b.monthly_salary as string) || 0;
        break;
      case 'status':
        va = a.is_active ? 1 : 0;
        vb = b.is_active ? 1 : 0;
        break;
      default:
        return 0;
    }
    if (va < vb) return sortDir === 'asc' ? -1 : 1;
    if (va > vb) return sortDir === 'asc' ? 1 : -1;
    return 0;
  });

  // La fiche ouverte suit les mises a jour (contrat, salaire) de la liste.
  useEffect(() => {
    if (!viewDetail) return;
    const fresh = (employees as Record<string, any>[]).find(e => e.id === viewDetail.id);
    if (fresh && fresh !== viewDetail) setViewDetail(fresh);
  }, [employees]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <>
      <HrAlertsPanel onOpenEmployee={id => {
        const e = (employees as Record<string, any>[]).find(x => x.id === id);
        if (e) setViewDetail(e);
      }} />

      {/* Stat tiles - style Odoo */}
      <div className="odoo-stat-grid">
        <div className="odoo-stat-card">
          <div className="odoo-stat-card-label"><Users size={11} style={{ display: 'inline', marginRight: 4 }} />Effectif actif</div>
          <div className="odoo-stat-card-value" style={{ color: activeCount > 0 ? '#28a745' : undefined }}>{activeCount}</div>
          <div className="odoo-stat-card-sub" title="Repartition mensuel / quinzaine / hebdomadaire">
            {activeMonthly.length - activeBiweeklyCount} mensuel{activeBiweeklyCount > 0 && <> · {activeBiweeklyCount} quinzaine</>} · {activeWeekly.length} hebdo
            {employees.length - activeCount > 0 && (
              <> · <span style={{ color: '#adb5bd' }}>{employees.length - activeCount} inactif(s)</span></>
            )}
          </div>
        </div>
        <div className="odoo-stat-card" title="Somme des salaires mensuels des employés actifs mensuels + équivalent mensuel des hebdos (salaire hebdo × 52/12 semaines)">
          <div className="odoo-stat-card-label"><Banknote size={11} style={{ display: 'inline', marginRight: 4 }} />Masse salariale</div>
          <div className="odoo-stat-card-value" style={{ color: '#155724' }}>
            {formatMoney(massMonthlyEquiv)} <span style={{ fontSize: '0.75rem', fontWeight: 500, color: 'var(--odoo-text-muted)' }}>DH/mois</span>
          </div>
          <div className="odoo-stat-card-sub">
            {formatMoney(massMonthly)} mensuel
            {massWeekly > 0 && <> + {formatMoney(massWeekly * WEEKS_PER_MONTH)} hebdo eq.</>}
          </div>
        </div>
        <div className="odoo-stat-card" title="Coût annuel projeté = masse salariale mensuelle × 12 (indicatif, hors primes/cotisations)">
          <div className="odoo-stat-card-label"><Banknote size={11} style={{ display: 'inline', marginRight: 4 }} />Coût annuel projeté</div>
          <div className="odoo-stat-card-value" style={{ color: '#155724' }}>
            {formatMoney(massMonthlyEquiv * 12)} <span style={{ fontSize: '0.75rem', fontWeight: 500, color: 'var(--odoo-text-muted)' }}>DH</span>
          </div>
          <div className="odoo-stat-card-sub">
            {withSalaryCount > 0 ? <>salaire moyen {formatMoney(avgSalary)} DH/mois</> : 'aucun salaire renseigné'}
          </div>
        </div>
        <div className="odoo-stat-card" title="Répartition par type de contrat des employés actifs">
          <div className="odoo-stat-card-label"><FileText size={11} style={{ display: 'inline', marginRight: 4 }} />Contrats</div>
          <div className="odoo-stat-card-value" style={{ fontSize: '1.125rem' }}>
            {Object.entries(contractCounts).length === 0
              ? <span style={{ color: 'var(--odoo-text-light)' }}>—</span>
              : Object.entries(contractCounts).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([code, count], idx) => (
                <span key={code} style={{ marginRight: 10 }}>
                  <span style={{ fontWeight: 700 }}>{count}</span>
                  <span style={{ fontSize: '0.6875rem', color: 'var(--odoo-text-muted)', marginLeft: 3, textTransform: 'uppercase' }}>
                    {getContractLabel(code).slice(0, 4)}
                  </span>
                  {idx < 2 && Object.entries(contractCounts).length > idx + 1 && (
                    <span style={{ color: 'var(--odoo-text-light)' }}> ·</span>
                  )}
                </span>
              ))}
          </div>
          <div className="odoo-stat-card-sub">sur {activeCount} actif(s)</div>
        </div>
      </div>

      {/* Search panel + action */}
      <div className="odoo-search-panel">
        <div className="odoo-view-switcher" role="tablist" aria-label="Statut des employés">
          {([['active', 'Actifs', activeCount], ['inactive', 'Inactifs', inactiveCount], ['all', 'Tous', employees.length]] as const).map(([key, label, count]) => (
            <button key={key} type="button" role="tab" aria-selected={statusFilter === key} onClick={() => setStatusFilter(key)}
              style={{
                padding: '0.3rem 0.75rem', fontSize: '0.8125rem',
                background: statusFilter === key ? 'var(--odoo-purple-light)' : 'transparent',
                color: statusFilter === key ? 'var(--odoo-purple)' : 'var(--odoo-text-muted)',
                fontWeight: statusFilter === key ? 600 : 400,
              }}>
              {label} <span style={{ opacity: 0.6, marginLeft: 4 }}>({count})</span>
            </button>
          ))}
        </div>
        <Search size={14} style={{ color: 'var(--odoo-text-muted)' }} />
        <input type="text" placeholder="Rechercher employé, CIN..." value={searchEmp} onChange={(e) => setSearchEmp(e.target.value)}
          className="odoo-search-input" style={{ flex: 1 }} />
        <button onClick={() => { setEditing(null); setShowForm(true); }} className="odoo-btn-primary"
          style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
          <Plus size={13} /> Nouvel employé
        </button>
      </div>

      {isLoading ? (
        <div style={{ padding: '3rem', textAlign: 'center', color: 'var(--odoo-text-muted)' }}>
          <div className="animate-spin w-5 h-5 border-2 border-current border-t-transparent rounded-full" style={{ margin: '0 auto 8px' }} />
          <p style={{ fontSize: '0.8125rem' }}>Chargement des employés...</p>
        </div>
      ) : sortedEmp.length === 0 ? (
        <EmptyState icon={Users}>Aucun employé trouvé</EmptyState>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table className="odoo-table">
            <thead>
              <tr>
                <th style={{ width: 24 }}></th>
                <th onClick={() => toggleSort('name')} style={{ cursor: 'pointer' }}>Employé <SortIcon col="name" /></th>
                <th onClick={() => toggleSort('role')} style={{ cursor: 'pointer' }}>Rôle <SortIcon col="role" /></th>
                <th onClick={() => toggleSort('contract')} style={{ cursor: 'pointer' }}>Contrat <SortIcon col="contract" /></th>
                <th>Téléphone</th>
                <th onClick={() => toggleSort('salary')} style={{ cursor: 'pointer', textAlign: 'right' }}>Salaire <SortIcon col="salary" /></th>
                <th onClick={() => toggleSort('status')} style={{ cursor: 'pointer' }}>Statut <SortIcon col="status" /></th>
                <th style={{ textAlign: 'right', width: 90 }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {sortedEmp.map((e: Record<string, any>) => (
                <tr key={e.id as string} onClick={() => setViewDetail(e)} style={{ cursor: 'pointer' }}>
                  <td><span className={`odoo-status-dot ${e.is_active ? 'ok' : 'neutral'}`} /></td>
                  <td>
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontWeight: 500 }}>
                      <Users size={11} style={{ color: 'var(--theme-accent)' }} />
                      {e.first_name as string} {e.last_name as string}
                      {e.cin ? <span style={{ color: 'var(--odoo-text-muted)', fontSize: '0.6875rem', fontFamily: 'ui-monospace, monospace' }}>· {e.cin as string}</span> : null}
                    </span>
                  </td>
                  <td>
                    <span className="odoo-tag odoo-tag-purple"
                      style={getRoleColor(e.role as string) ? { backgroundColor: getRoleColor(e.role as string) + '22', color: getRoleColor(e.role as string) } : undefined}>
                      {getRoleLabel(e.role as string)}
                    </span>
                  </td>
                  <td><span className="odoo-tag odoo-tag-grey">{getContractLabel(e.contract_type as string || 'cdi')}</span></td>
                  <td style={{ color: 'var(--odoo-text-muted)' }}>{e.phone as string || '—'}</td>
                  <td style={{ textAlign: 'right' }}>
                    {(() => {
                      const isWeekly = e.pay_frequency === 'weekly';

                      const sal = isWeekly ? e.weekly_salary : e.monthly_salary;
                      if (!sal) return <span style={{ color: 'var(--odoo-text-light)' }}>—</span>;
                      const val = parseFloat(sal as string);
                      const eqMonth = isWeekly ? val * WEEKS_PER_MONTH : val;
                      return (
                        <span title={isWeekly ? `Salaire hebdo × 52/12 ≈ ${eqMonth.toFixed(0)} DH/mois equivalent` : 'Salaire mensuel'}>
                          <span style={{ fontWeight: 600 }}>{val.toFixed(0)}</span>
                          <span style={{ color: 'var(--odoo-text-muted)', fontWeight: 400, fontSize: '0.6875rem', marginLeft: 3 }}>
                            DH/{isWeekly ? 'sem' : 'mois'}
                          </span>
                          {isWeekly && (
                            <div style={{ fontSize: '0.625rem', color: 'var(--odoo-text-light)' }}>
                              ≈ {eqMonth.toFixed(0)} DH/mois
                            </div>
                          )}
                        </span>
                      );
                    })()}
                  </td>
                  <td>
                    <span className={`odoo-tag ${e.is_active ? 'odoo-tag-green' : 'odoo-tag-grey'}`}>
                      {e.is_active ? 'Actif' : 'Inactif'}
                    </span>
                  </td>
                  <td style={{ textAlign: 'right' }} onClick={(ev) => ev.stopPropagation()}>
                    <div style={{ display: 'inline-flex', gap: 2 }}>
                      <button onClick={() => setViewDetail(e)} className="odoo-pager-btn" title="Détails">
                        <UserCog size={13} />
                      </button>
                      <button onClick={() => { setEditing(e); setShowForm(true); }} className="odoo-pager-btn" title="Modifier">
                        <Pencil size={13} />
                      </button>
                      {e.is_active && canDeleteEmployee && (
                        <button
                          onClick={async () => {
                            const fullName = `${e.first_name} ${e.last_name}`;
                            if (!(await confirm(`Désactiver ${fullName} ?\n\nL'employé sera masqué des listes actives.\nSon historique (paie, présence, paiements) reste préservé.\nVous pourrez le réactiver à tout moment.`,
                              { title: 'Désactiver l\'employé', confirmLabel: 'Désactiver', danger: true }))) return;
                            deactivateMutation.mutate(e.id as string);
                          }}
                          disabled={deactivateMutation.isPending}
                          className="odoo-pager-btn" title="Désactiver" style={{ color: '#dc3545' }}>
                          <Trash2 size={13} />
                        </button>
                      )}
                      {canDeleteEmployee && (
                        <button
                          onClick={() => handleHardDelete(e)}
                          disabled={hardDeleteMutation.isPending}
                          className="odoo-pager-btn" title="Supprimer définitivement" style={{ color: '#7a0c12' }}>
                          <AlertOctagon size={13} />
                        </button>
                      )}
                      {!e.is_active && canDeleteEmployee && (
                        <button
                          onClick={async () => {
                            const fullName = `${e.first_name} ${e.last_name}`;
                            if (!(await confirm(`Réactiver ${fullName} ? Il réapparaitra dans les listes actives.`,
                              { title: 'Réactiver l\'employé', confirmLabel: 'Réactiver' }))) return;
                            reactivateMutation.mutate(e.id as string);
                          }}
                          disabled={reactivateMutation.isPending}
                          className="odoo-pager-btn" title="Réactiver" style={{ color: '#28a745' }}>
                          <RotateCcw size={13} />
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Fiche employé */}
      {viewDetail && (
        <HrModal icon={UserCog} crumb="Employé" width={860}
          title={`${viewDetail.first_name as string} ${viewDetail.last_name as string}`}
          tag={<span className="odoo-tag odoo-tag-purple">{getRoleLabel(viewDetail.role as string)}</span>}
          onClose={() => setViewDetail(null)}
          headerActions={
            <button type="button" className="odoo-btn-secondary" style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '3px 10px' }}
              onClick={() => { setViewDetail(null); setEditing(viewDetail); setShowForm(true); }}>
              <Pencil size={12} /> Modifier
            </button>
          }>
          <div className="grid grid-cols-3 gap-x-4 gap-y-3" style={{ fontSize: '0.8125rem' }}>
            {([
              ['CIN', viewDetail.cin], ['Téléphone', viewDetail.phone],
              ['Date de naissance', (() => { const s = isoDate(viewDetail.birth_date); return s ? `${s.slice(8,10)}/${s.slice(5,7)}/${s.slice(0,4)}` : null; })()],
              ['Adresse', viewDetail.address], ['Ville', viewDetail.city],
              ['N° CNSS', viewDetail.cnss_number],
              ['RIB (virement)', viewDetail.rib ? `${String(viewDetail.rib).replace(/^(\d{3})(\d{3})(\d{16})(\d{2})$/, '$1 $2 $3 $4')}${viewDetail.bank_name ? ` · ${viewDetail.bank_name}` : ''}` : null],
              ['Type de contrat', getContractLabel(viewDetail.contract_type as string || 'cdi')],
              ['Début contrat', (() => { const s = isoDate(viewDetail.contract_start); return s ? `${s.slice(8,10)}/${s.slice(5,7)}/${s.slice(0,4)}` : null; })()],
              ['Fin contrat', (() => { const s = isoDate(viewDetail.contract_end); return s ? `${s.slice(8,10)}/${s.slice(5,7)}/${s.slice(0,4)}` : null; })()],
              ['Date d\'embauche', (() => { const s = isoDate(viewDetail.hire_date); return s ? `${s.slice(8,10)}/${s.slice(5,7)}/${s.slice(0,4)}` : null; })()],
              ['Déclaration', viewDetail.is_declared === false ? 'Non déclaré (ni CNSS ni IR)' : 'Déclaré CNSS + IR'],
              ['Fréquence de paie', ({ monthly: 'Mensuelle', biweekly: 'Par quinzaine', weekly: 'Hebdomadaire' } as Record<string, string>)[(viewDetail.pay_frequency as string) || 'monthly']],
              ['Salaire mensuel', viewDetail.monthly_salary ? `${parseFloat(viewDetail.monthly_salary as string).toFixed(2)} DH` : null],
              ['Salaire hebdo', viewDetail.pay_frequency === 'weekly' && viewDetail.weekly_salary ? `${parseFloat(viewDetail.weekly_salary as string).toFixed(2)} DH` : null],
              ['Contact urgence', viewDetail.emergency_contact_name],
              ['Tel. urgence', viewDetail.emergency_contact_phone],
            ] as [string, unknown][]).map(([label, val]) => val ? (
              <div key={label}>
                <div style={fieldLabel}>{label}</div>
                <div style={{ fontWeight: 600, color: 'var(--theme-text-strong)' }}>{val as string}</div>
              </div>
            ) : null)}
          </div>
          {viewDetail.notes && (
            <StatusBanner tone="neutral" icon={StickyNote} title="Notes">{viewDetail.notes as string}</StatusBanner>
          )}
          {viewDetail.is_active !== false && !viewDetail.exit_date && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', fontSize: '0.8125rem' }}>
              <span style={{ color: 'var(--odoo-text-muted)' }}>Attestations :</span>
              {(['travail', 'salaire'] as const).map(kind => (
                <button key={kind} type="button" className="odoo-btn-secondary"
                  onClick={async () => {
                    try { saveBlobResponse(await payrollConfigApi.attestation(viewDetail.id as string, kind), `attestation_${kind}.pdf`); }
                    catch (err) { notify.error(apiErrorMessage(err, 'Erreur')); }
                  }}>
                  {kind === 'travail' ? 'Attestation de travail' : 'Attestation de salaire'}
                </button>
              ))}
            </div>
          )}
          <EmployeeContracts employeeId={viewDetail.id as string} onChanged={() => undefined} />
          <EmployeeDocuments employeeId={viewDetail.id as string} />
          <EmployeeDeparture employee={viewDetail} />
          {(viewDetail.pay_frequency ?? 'monthly') === 'monthly' && <EmployeePayrollItems employeeId={viewDetail.id as string} />}
          <EmployeeSalaryHistory employeeId={viewDetail.id as string} />
        </HrModal>
      )}

      {/* Formulaire employé */}
      {showForm && (
        <HrModal icon={UserCog} crumb="Employé" width={720}
          title={editing ? `${editing.first_name as string} ${editing.last_name as string}` : 'Nouveau'}
          onClose={() => { setShowForm(false); setEditing(null); }}
          footer={<>
            <button type="button" onClick={() => { setShowForm(false); setEditing(null); }} className="odoo-btn-secondary">Annuler</button>
            <button type="submit" form="employee-form" disabled={saveMutation.isPending} className="odoo-btn-primary"
              style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
              {saveMutation.isPending && <Loader2 size={12} className="animate-spin" />}
              Enregistrer
            </button>
          </>}>
          <form id="employee-form" onSubmit={(e) => {
            e.preventDefault();
            const fd = new FormData(e.currentTarget);
            const data: Record<string, any> = Object.fromEntries(fd);
            if (data.monthlySalary) data.monthlySalary = parseFloat(data.monthlySalary as string);
            if (data.weeklySalary) data.weeklySalary = parseFloat(data.weeklySalary as string);
            // Case a cocher : absente du FormData quand decochee.
            data.isDeclared = fd.has('isDeclared');
            if (!editing) data.withTrial = fd.has('withTrial');
            if (data.jobTitle === '') delete data.jobTitle;
            if (data.nbDependents) data.nbDependents = parseInt(data.nbDependents as string);
            if (data.cimrRate) data.cimrRate = parseFloat(data.cimrRate as string);
            if (data.defaultShiftCode === '') data.defaultShiftCode = null;
            if (data.rib === '') data.rib = null;
            if (data.bankName === '') data.bankName = null;
            saveMutation.mutate(data);
          }} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <SectionTitle icon={UserRound}>Informations personnelles</SectionTitle>
            <div className="grid grid-cols-3 gap-3">
              <div><label style={fieldLabel}>Prénom *</label><input name="firstName" defaultValue={editing?.first_name as string} className={inputCls} required /></div>
              <div><label style={fieldLabel}>Nom *</label><input name="lastName" defaultValue={editing?.last_name as string} className={inputCls} required /></div>
              <div><label style={fieldLabel}>CIN</label><input name="cin" defaultValue={editing?.cin as string} className={inputCls} />
                <label style={{ ...fieldLabel, fontWeight: 400, marginTop: 4, marginBottom: 0 }}>Expire le <input name="cinExpiresOn" type="date" defaultValue={isoDate(editing?.cin_expires_on)} className={inputCls} style={{ display: 'inline-block', width: 'auto' }} /></label></div>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div><label style={fieldLabel}>Téléphone</label><input name="phone" defaultValue={editing?.phone as string} className={inputCls} /></div>
              <div><label style={fieldLabel}>Date de naissance</label><input name="birthDate" type="date" defaultValue={isoDate(editing?.birth_date)} className={inputCls} /></div>
              <div><label style={fieldLabel}>Ville</label><input name="city" defaultValue={editing?.city as string} className={inputCls} /></div>
            </div>
            <div><label style={fieldLabel}>Adresse</label><input name="address" defaultValue={editing?.address as string} className={inputCls} /></div>

            <SectionTitle icon={Briefcase}>Contrat & Salaire</SectionTitle>
            <div className="grid grid-cols-3 gap-3">
              <div><label style={fieldLabel}>Rôle *</label>
                <select name="role" defaultValue={editing?.role as string || ''} className={inputCls} required>
                  <option value="" disabled>Choisir un rôle</option>
                  {roles.map((r) => (
                    <option key={r.code as string} value={r.code as string}>{r.label as string}</option>
                  ))}
                </select></div>
              <div><label style={fieldLabel}>Type de contrat</label>
                <select name="contractType" defaultValue={editing?.contract_type as string || 'cdi'} className={inputCls}>
                  {contractTypes.map((ct) => (
                    <option key={ct.code} value={ct.code}>{ct.label}</option>
                  ))}
                </select></div>
              <div><label style={fieldLabel}>Salaire mensuel (DH)</label>
                <input name="monthlySalary" type="number" step="0.01" defaultValue={editing?.monthly_salary as string} className={inputCls}
                  onChange={(e) => syncSalaryFields(e.currentTarget.form)} /></div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label style={fieldLabel}>Fréquence de paie</label>
                <select name="payFrequency" defaultValue={(editing?.pay_frequency as string) || 'monthly'} className={inputCls}
                  onChange={(e) => syncSalaryFields(e.currentTarget.form)}>
                  <option value="monthly">Mensuelle (fin de mois)</option>
                  <option value="biweekly">Par quinzaine (1-15 / 16-fin, base mensuel ÷ 26)</option>
                  <option value="weekly">Hebdomadaire (lundi pour S-1)</option>
                </select>
              </div>
              <div>
                <label style={fieldLabel}>Salaire hebdomadaire (DH)</label>
                <input name="weeklySalary" type="number" step="0.01" defaultValue={editing?.weekly_salary as string} className={inputCls} placeholder="Requis si fréquence = hebdo" />
                <p style={hintStyle}>Auto-calculé si fréquence = hebdo : mensuel × 12 ÷ 52 (modifiable à la main).</p>
              </div>
            </div>
            <div>
              <label style={fieldLabel}>Shift par défaut</label>
              <select name="defaultShiftCode" defaultValue={(editing?.default_shift_code as string) || ''} className={inputCls}>
                <option value="">— Aucun (à choisir manuellement dans le planning) —</option>
                {(shifts as Record<string, any>[]).map(s => (
                  <option key={s.code as string} value={s.code as string}>{s.label as string}</option>
                ))}
              </select>
              <p style={hintStyle}>Utilisé par le bouton « Appliquer défaut » dans l'onglet Planning hebdomadaire.</p>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div><label style={fieldLabel}>Date d'embauche *</label><input name="hireDate" type="date" defaultValue={isoDate(editing?.hire_date)} className={inputCls} required={!editing} /></div>
              <div><label style={fieldLabel}>Début contrat</label><input name="contractStart" type="date" defaultValue={isoDate(editing?.contract_start)} className={inputCls} /></div>
              <div><label style={fieldLabel}>Fin contrat</label><input name="contractEnd" type="date" defaultValue={isoDate(editing?.contract_end)} className={inputCls} /></div>
            </div>
            {editing ? (
              <p style={hintStyle}>Correction directe du contrat en vigueur. Un changement de conditions (salaire, poste, type) se fait par un avenant depuis la fiche.</p>
            ) : (
              <div className="grid grid-cols-3 gap-3">
                <div><label style={fieldLabel}>Catégorie</label>
                  <select name="category" defaultValue="employe" className={inputCls}>
                    <option value="cadre">Cadre (essai 3 mois)</option>
                    <option value="employe">Employé (essai 1,5 mois)</option>
                    <option value="ouvrier">Ouvrier (essai 15 jours)</option>
                  </select></div>
                <div><label style={fieldLabel}>Poste</label><input name="jobTitle" className={inputCls} /></div>
                <label style={checkStyle}><input name="withTrial" type="checkbox" defaultChecked /> Période d'essai légale</label>
              </div>
            )}
            <div className="grid grid-cols-2 gap-3">
              <div><label style={fieldLabel}>N° CNSS</label><input name="cnssNumber" defaultValue={editing?.cnss_number as string} className={inputCls} /></div>
              <div><label style={fieldLabel}>Taux CIMR (%)</label><input name="cimrRate" type="number" min="0" max="10" step="0.5" defaultValue={editing?.cimr_rate as string || '0'} className={inputCls} /></div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div><label style={fieldLabel}>RIB (24 chiffres, virement du salaire)</label>
                <input name="rib" defaultValue={editing?.rib as string} className={inputCls} inputMode="numeric" pattern="[0-9 ]{24,30}" placeholder="000 000 0000000000000000 00" /></div>
              <div><label style={fieldLabel}>Banque</label><input name="bankName" defaultValue={editing?.bank_name as string} className={inputCls} maxLength={80} /></div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label style={{ ...checkStyle, fontWeight: 600 }}>
                  <input name="isDeclared" type="checkbox" defaultChecked={editing ? editing.is_declared !== false : true} />
                  Salarié déclaré (CNSS, AMO et IR)
                </label>
                <p style={hintStyle}>Ancienneté calculée depuis la date d'embauche.</p>
              </div>
              <div><label style={fieldLabel}>Personnes a charge</label><input name="nbDependents" type="number" min="0" max="6" defaultValue={editing?.nb_dependents as string || '0'} className={inputCls} /></div>
            </div>

            <SectionTitle icon={Phone}>Contact d'urgence</SectionTitle>
            <div className="grid grid-cols-2 gap-3">
              <div><label style={fieldLabel}>Nom</label><input name="emergencyContactName" defaultValue={editing?.emergency_contact_name as string} className={inputCls} /></div>
              <div><label style={fieldLabel}>Téléphone</label><input name="emergencyContactPhone" defaultValue={editing?.emergency_contact_phone as string} className={inputCls} /></div>
            </div>

            <div><label style={fieldLabel}>Notes</label><textarea name="notes" rows={2} defaultValue={editing?.notes as string} className={inputCls} /></div>
          </form>
        </HrModal>
      )}
    </>
  );
}

const hintStyle = { fontSize: '0.6875rem', color: 'var(--theme-text-muted)', margin: '2px 0 0' } as const;
const checkStyle = { display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.8125rem', marginTop: 20 } as const;
