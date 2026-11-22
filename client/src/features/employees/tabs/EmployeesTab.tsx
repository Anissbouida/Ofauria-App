import { money, currencySymbol } from '../../../utils/money';
import { useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { employeesApi } from '../../../api/employees.api';
import { useReferentiel } from '../../../hooks/useReferentiel';
import {
  Plus, Pencil, Users, ArrowUpDown, ArrowUp, ArrowDown, Trash2, RotateCcw, AlertOctagon,
} from 'lucide-react';
import { useConfirm } from '../../../components/ui/ConfirmDialog';
import { StatusTag } from '../../../components/ui/StatusTag';
import { RowMenu, type RowMenuItem } from '../../../components/ui/RowMenu';
import { HrHeaderActions } from '../ui';
import { FilterChips } from '../../sales/ListTemplate';
import {
  KpiGrid, KpiCard, Toolbar, SearchBar, DataPanel, TableFooter, EmptyState, NoResultState, LoadingState, ErrorState,
} from '../../../components/ds';
import { notify } from '../../../components/ui/InlineNotification';
import { useAuth } from '../../../context/AuthContext';
import HrAlertsPanel from '../contracts/HrAlertsPanel';

/* ═══════════════════════ EMPLOYEES TAB ═══════════════════════ */
export default function EmployeesTab({ queryClient }: { queryClient: ReturnType<typeof useQueryClient> }) {
  // La fiche (consultation, modification, création) est une page : /employees/:id.
  const navigate = useNavigate();
  const openEmployee = (id: string, edit = false) => navigate(`/employees/${id}${edit ? '?edit=1' : ''}`);
  const [searchEmp, setSearchEmp] = useState('');
  const [statusFilter, setStatusFilter] = useState<'active' | 'inactive' | 'all'>('active');
  const [sortKey, setSortKey] = useState<string>('name');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');

  const { data: employees = [], isLoading, isError, error, refetch } = useQuery({ queryKey: ['employees'], queryFn: employeesApi.list });
  const { getLabel: getRoleLabel, getColor: getRoleColor } = useReferentiel('employee_roles');
  const { getLabel: getContractLabel } = useReferentiel('contract_types');
  // Suppression/reactivation employes : backend reserve admin. On masque les
  // boutons aux non-admins pour eviter d'afficher une action qui retournerait 403.
  const { user } = useAuth();
  const canDeleteEmployee = user?.role === 'admin';
  const confirm = useConfirm();

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
    if (sortKey !== col) return <ArrowUpDown size={13} className="ml-1 inline" aria-hidden="true" style={{ opacity: 0.35 }} />;
    return sortDir === 'asc'
      ? <ArrowUp size={13} className="ml-1 inline" aria-hidden="true" style={{ color: 'var(--ds-accent)' }} />
      : <ArrowDown size={13} className="ml-1 inline" aria-hidden="true" style={{ color: 'var(--ds-accent)' }} />;
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

  const filtered = !!searchEmp || statusFilter !== 'active';
  const resetFilters = () => { setSearchEmp(''); setStatusFilter('active'); };
  const contractEntries = Object.entries(contractCounts).sort((a, b) => b[1] - a[1]).slice(0, 3);
  // Infobulle d'explication du calcul autour d'une tuile (KpiCard n'a pas d'attribut title).
  const tip = (title: string, card: ReactNode) => <div title={title} style={{ display: 'grid' }}>{card}</div>;

  /** Actions secondaires d'une ligne (menu « ⋯ ») ; l'action visible est « Ouvrir ». */
  const rowMenu = (e: Record<string, any>): RowMenuItem[] => {
    const fullName = `${e.first_name} ${e.last_name}`;
    const items: RowMenuItem[] = [{ label: 'Modifier', icon: Pencil, onSelect: () => openEmployee(e.id as string, true) }];
    if (e.is_active && canDeleteEmployee) items.push({
      label: 'Désactiver', icon: Trash2, danger: true, disabled: deactivateMutation.isPending,
      onSelect: async () => {
        if (!(await confirm(`Désactiver ${fullName} ?\n\nL'employé sera masqué des listes actives.\nSon historique (paie, présence, paiements) reste préservé.\nVous pourrez le réactiver à tout moment.`,
          { title: 'Désactiver l\'employé', confirmLabel: 'Désactiver', danger: true }))) return;
        deactivateMutation.mutate(e.id as string);
      },
    });
    if (!e.is_active && canDeleteEmployee) items.push({
      label: 'Réactiver', icon: RotateCcw, disabled: reactivateMutation.isPending,
      onSelect: async () => {
        if (!(await confirm(`Réactiver ${fullName} ? Il réapparaitra dans les listes actives.`,
          { title: 'Réactiver l\'employé', confirmLabel: 'Réactiver' }))) return;
        reactivateMutation.mutate(e.id as string);
      },
    });
    if (canDeleteEmployee) items.push({
      label: 'Supprimer définitivement', icon: AlertOctagon, danger: true, disabled: hardDeleteMutation.isPending,
      onSelect: () => void handleHardDelete(e),
    });
    return items;
  };

  return (
    <>
      {/* Action principale de la page, à droite du fil d'Ariane. */}
      <HrHeaderActions>
        <button type="button" onClick={() => navigate('/employees/new')} className="odoo-btn-primary"
          style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
          <Plus size={13} aria-hidden="true" /> Nouvel employé
        </button>
      </HrHeaderActions>

      <HrAlertsPanel onOpenEmployee={id => openEmployee(id)} />

      <KpiGrid>
        {tip('Répartition mensuel / quinzaine / hebdomadaire',
          <KpiCard label="Effectif actif" value={activeCount}
            sub={<>{activeMonthly.length - activeBiweeklyCount} mensuel{activeBiweeklyCount > 0 && <> · {activeBiweeklyCount} quinzaine</>} · {activeWeekly.length} hebdo
              {inactiveCount > 0 && <> · {inactiveCount} inactif(s)</>}</>} />)}
        {tip('Somme des salaires mensuels des employés actifs mensuels + équivalent mensuel des hebdos (salaire hebdo × 52/12 semaines)',
          <KpiCard label={`Masse salariale (${currencySymbol()}/mois)`} value={formatMoney(massMonthlyEquiv)}
            sub={<>{formatMoney(massMonthly)} mensuel{massWeekly > 0 && <> + {formatMoney(massWeekly * WEEKS_PER_MONTH)} hebdo eq.</>}</>} />)}
        {tip('Coût annuel projeté = masse salariale mensuelle × 12 (indicatif, hors primes/cotisations)',
          <KpiCard label={`Coût annuel projeté (${currencySymbol()})`} value={formatMoney(massMonthlyEquiv * 12)}
            sub={withSalaryCount > 0 ? <>salaire moyen {money(avgSalary, { decimals: 0 })}/mois</> : 'aucun salaire renseigné'} />)}
        {tip('Répartition par type de contrat des employés actifs',
          <KpiCard label="Contrats"
            value={contractEntries.length === 0 ? '—' : contractEntries.map(([code, count]) => `${count} ${getContractLabel(code).slice(0, 4)}`).join(' · ')}
            sub={`sur ${activeCount} actif(s)`} />)}
      </KpiGrid>

      {/* Pastilles de statut, puis barre d'outils (recherche). */}
      <FilterChips label="Statut des employés" value={statusFilter} onChange={k => setStatusFilter(k as typeof statusFilter)}
        chips={[{ key: 'active', label: 'Actifs', count: activeCount }, { key: 'inactive', label: 'Inactifs', count: inactiveCount }, { key: 'all', label: 'Tous', count: employees.length }]} />
      <Toolbar>
        <SearchBar value={searchEmp} onChange={setSearchEmp} placeholder="Rechercher un employé, un CIN…" />
      </Toolbar>

      {isLoading ? (
        <LoadingState label="Chargement des employés…" />
      ) : isError ? (
        <ErrorState error={error} onRetry={() => void refetch()} />
      ) : employees.length === 0 ? (
        <EmptyState icon={Users} title="Aucun employé" text="Les fiches des salariés apparaîtront ici."
          action={<button type="button" className="odoo-btn-primary" onClick={() => navigate('/employees/new')}>Nouvel employé</button>} />
      ) : sortedEmp.length === 0 ? (
        <NoResultState text="Aucun employé ne correspond aux filtres." onReset={filtered ? resetFilters : undefined} />
      ) : (
        <DataPanel label="Employés" footer={<TableFooter note={`${sortedEmp.length} employé${sortedEmp.length > 1 ? 's' : ''}`} />}>
          <table className="odoo-table">
            <thead>
              <tr>
                <th onClick={() => toggleSort('name')} style={{ cursor: 'pointer' }}>Employé <SortIcon col="name" /></th>
                <th>CIN</th>
                <th onClick={() => toggleSort('role')} style={{ cursor: 'pointer' }}>Rôle <SortIcon col="role" /></th>
                <th onClick={() => toggleSort('contract')} style={{ cursor: 'pointer' }}>Contrat <SortIcon col="contract" /></th>
                <th>Téléphone</th>
                <th className="ds-num" onClick={() => toggleSort('salary')} style={{ cursor: 'pointer' }}>Salaire ({currencySymbol()}) <SortIcon col="salary" /></th>
                <th onClick={() => toggleSort('status')} style={{ cursor: 'pointer' }}>Statut <SortIcon col="status" /></th>
                <th className="ds-actions"><span className="sr-only">Actions</span></th>
              </tr>
            </thead>
            <tbody>
              {sortedEmp.map((e: Record<string, any>) => (
                <tr key={e.id as string} onClick={() => openEmployee(e.id as string)} style={{ cursor: 'pointer' }}>
                  <td className="ds-strong">{e.first_name as string} {e.last_name as string}</td>
                  <td className="ds-ref">{e.cin as string || '—'}</td>
                  <td>
                    <span className="odoo-tag odoo-tag-purple"
                      style={getRoleColor(e.role as string) ? { backgroundColor: getRoleColor(e.role as string) + '22', color: getRoleColor(e.role as string) } : undefined}>
                      {getRoleLabel(e.role as string)}
                    </span>
                  </td>
                  <td>{getContractLabel(e.contract_type as string || 'cdi')}</td>
                  <td>{e.phone as string || '—'}</td>
                  <td className="ds-num">
                    {(() => {
                      const isWeekly = e.pay_frequency === 'weekly';

                      const sal = isWeekly ? e.weekly_salary : e.monthly_salary;
                      if (!sal) return '—';
                      const val = parseFloat(sal as string);
                      const eqMonth = isWeekly ? val * WEEKS_PER_MONTH : val;
                      return (
                        <span title={isWeekly ? `Salaire hebdo × 52/12 ≈ ${money(eqMonth, { decimals: 0 })}/mois équivalent` : 'Salaire mensuel'}>
                          <span className="ds-strong">{val.toFixed(0)}</span>
                          <span style={{ color: 'var(--ds-muted)', fontSize: 12, marginLeft: 3 }}>/{isWeekly ? 'sem' : 'mois'}</span>
                        </span>
                      );
                    })()}
                  </td>
                  <td>
                    <StatusTag tone={e.is_active ? 'done' : 'cancelled'} label={e.is_active ? 'Actif' : 'Inactif'} />
                  </td>
                  <td className="ds-actions" onClick={(ev) => ev.stopPropagation()}>
                    <button type="button" onClick={() => openEmployee(e.id as string)} className="odoo-btn-secondary ds-btn-sm">Ouvrir</button>
                    <RowMenu items={rowMenu(e)} label={`Plus d'actions pour ${e.first_name} ${e.last_name}`} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </DataPanel>
      )}

    </>
  );
}
