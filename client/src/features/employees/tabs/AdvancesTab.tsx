import { money, currencySymbol } from '../../../utils/money';
import { Fragment, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { employeesApi, advancesApi } from '../../../api/employees.api';
import { useReferentiel } from '../../../hooks/useReferentiel';
import { format } from 'date-fns';
import {
  Plus, Pencil, ChevronDown, ChevronUp, Trash2, RotateCcw, HandCoins, Info,
} from 'lucide-react';
import { useConfirm } from '../../../components/ui/ConfirmDialog';
import { StatusBanner } from '../../../components/ui/StatusBanner';
import { StatusTag, type StatusTone } from '../../../components/ui/StatusTag';
import { RowMenu } from '../../../components/ui/RowMenu';
import { HrModal, Field, LoadingPanel, Segmented, SubmitButton, HrHeaderActions, inputCls } from '../ui';
import { KpiGrid, KpiCard, Toolbar, DataPanel, TableFooter, EmptyState, ErrorState } from '../../../components/ds';
import { notify } from '../../../components/ui/InlineNotification';
import SearchSelect from '../../../components/ui/SearchSelect';
import { useAuth } from '../../../context/AuthContext';
import { MONTH_NAMES, isoDate, amount as fmt } from '../shared';
import AdvanceRequestsPanel from './AdvanceRequestsPanel';

const HINT = { fontSize: 12, margin: 0, color: 'var(--ds-muted)' } as const;

/* ═══════════════════════ ADVANCES TAB (avances sur salaire) ═══════════════════════ */
export default function AdvancesTab({ queryClient }: { queryClient: ReturnType<typeof useQueryClient> }) {
  const [showForm, setShowForm] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [statusFilter, setStatusFilter] = useState<'open' | 'all'>('open');
  // Champs controles du formulaire d'octroi (pour l'apercu d'etalement en direct)
  const [formAmount, setFormAmount] = useState('');
  const [formMonthly, setFormMonthly] = useState('');
  const [formEmployeeId, setFormEmployeeId] = useState('');
  // Modale de modification (admin) : montant/date/mode si aucune retenue, plan+notes toujours
  const [editingAdvance, setEditingAdvance] = useState<Record<string, any> | null>(null);
  const [editAmount, setEditAmount] = useState('');
  const [editMonthly, setEditMonthly] = useState('');
  const [editDate, setEditDate] = useState('');
  const [editMethod, setEditMethod] = useState('cash');
  const [editNotes, setEditNotes] = useState('');
  const { getLabel: getRoleLabel } = useReferentiel('employee_roles');
  const { entries: paymentMethods, getLabel: getPaymentLabel } = useReferentiel('payment_methods');
  const { user } = useAuth();
  const confirm = useConfirm();

  const { data: advances = [], isLoading, isError, error, refetch } = useQuery({
    queryKey: ['salary-advances', statusFilter],
    queryFn: () => advancesApi.list(statusFilter === 'open' ? { status: 'open' } : undefined),
  });
  const { data: employees = [] } = useQuery({ queryKey: ['employees'], queryFn: employeesApi.list });

  const createMutation = useMutation({
    mutationFn: (data: Record<string, any>) => advancesApi.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['salary-advances'] });
      queryClient.invalidateQueries({ queryKey: ['advances-outstanding'] });
      notify.success('Avance enregistrée (le décaissement apparaît en Caisse)');
      setShowForm(false);
    },
    onError: (err: unknown) => {
      const msg = err && typeof err === 'object' && 'response' in err
        ? (err as { response?: { data?: { error?: { message?: string } } } }).response?.data?.error?.message
        : null;
      notify.error(msg || 'Erreur lors de l\'enregistrement');
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Record<string, any> }) => advancesApi.update(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['salary-advances'] });
      queryClient.invalidateQueries({ queryKey: ['advances-outstanding'] });
      notify.success('Avance modifiée');
      setEditingAdvance(null);
    },
    onError: (err: unknown) => {
      const msg = err && typeof err === 'object' && 'response' in err
        ? (err as { response?: { data?: { error?: { message?: string } } } }).response?.data?.error?.message
        : null;
      notify.error(msg || 'Modification impossible');
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => advancesApi.remove(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['salary-advances'] });
      queryClient.invalidateQueries({ queryKey: ['advances-outstanding'] });
      notify.success('Avance supprimée (décaissement annulé)');
    },
    onError: (err: unknown) => {
      const msg = err && typeof err === 'object' && 'response' in err
        ? (err as { response?: { data?: { error?: { message?: string } } } }).response?.data?.error?.message
        : null;
      notify.error(msg || 'Suppression impossible');
    },
  });

  const pn = (v: unknown) => parseFloat(v as string || '0');
  const rows = advances as Record<string, any>[];
  const totalOutstanding = rows.filter(a => a.status !== 'repaid').reduce((s, a) => s + pn(a.remaining_amount), 0);
  const employeesConcerned = new Set(rows.filter(a => a.status !== 'repaid' && pn(a.remaining_amount) > 0).map(a => a.employee_id)).size;
  const totalGranted = rows.reduce((s, a) => s + pn(a.amount), 0);
  const totalRepaid = rows.reduce((s, a) => s + pn(a.amount) - pn(a.remaining_amount), 0);

  const STATUS_META: Record<string, { label: string; tone: StatusTone }> = {
    open: { label: 'En cours', tone: 'progress' },
    partial: { label: 'Partiel', tone: 'progress' },
    repaid: { label: 'Soldée', tone: 'done' },
  };

  const toggleExpand = (id: string) => setExpanded(prev => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  const repaymentLabel = (r: Record<string, any>) => {
    if (r.payrollMonth) return `Paie ${MONTH_NAMES[(r.payrollMonth as number) - 1]} ${r.payrollYear}`;
    if (r.weekStart) return `Paie semaine du ${r.weekStart}`;
    return r.repaymentDate as string;
  };

  const openEdit = (a: Record<string, any>) => {
    setEditingAdvance(a);
    setEditAmount(pn(a.amount).toFixed(2));
    setEditMonthly(pn(a.monthly_deduction) > 0 ? pn(a.monthly_deduction).toFixed(2) : '');
    setEditDate(isoDate(a.advance_date));
    setEditMethod((a.payment_method as string) || 'cash');
    setEditNotes((a.notes as string) || '');
  };
  const isAdmin = user?.role === 'admin';

  return (
    <>
      {/* Action principale de la page, à droite du fil d'Ariane. */}
      <HrHeaderActions>
        <button type="button" onClick={() => { setFormAmount(''); setFormMonthly(''); setFormEmployeeId(''); setShowForm(true); }} className="odoo-btn-primary"
          style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
          <Plus size={13} aria-hidden="true" /> Accorder une avance
        </button>
      </HrHeaderActions>

      <AdvanceRequestsPanel />

      <KpiGrid>
        <KpiCard label={`Avances en cours (${currencySymbol()})`} value={fmt(totalOutstanding)} sub="à récupérer sur les paies" tone={totalOutstanding > 0 ? 'orange' : undefined} />
        <KpiCard label="Employés concernés" value={employeesConcerned} />
        <KpiCard label={`Total accordé${statusFilter === 'open' ? ' (en cours)' : ''} (${currencySymbol()})`} value={fmt(totalGranted)} />
        <KpiCard label={`Déjà remboursé (${currencySymbol()})`} value={fmt(totalRepaid)} />
      </KpiGrid>

      <Toolbar>
        <Segmented label="Filtre des avances" value={statusFilter} onChange={setStatusFilter}
          options={[{ key: 'open', label: 'En cours' }, { key: 'all', label: 'Toutes' }]} />
      </Toolbar>

      {isLoading ? (
        <LoadingPanel />
      ) : isError ? (
        <ErrorState error={error} onRetry={() => void refetch()} />
      ) : rows.length === 0 ? (
        <EmptyState icon={HandCoins} title={statusFilter === 'open' ? 'Aucune avance en cours' : 'Aucune avance enregistrée'}
          text="La retenue se fait automatiquement au moment de payer le salaire (écran Paie)." />
      ) : (
        <DataPanel label="Avances sur salaire" footer={<TableFooter note={<>
          {rows.length} avance{rows.length > 1 ? 's' : ''} · L'avance sort de la caisse au moment de l'octroi (visible dans Caisse et la trésorerie) mais n'est pas une charge :
          c'est une créance sur l'employé (compte 3431). La charge salaire est reconnue au fil des retenues, proposées automatiquement au paiement de la paie.
        </>} />}>
          <table className="odoo-table">
            <thead>
              <tr>
                <th style={{ width: 20 }}><span className="sr-only">Retenues</span></th>
                <th>Employé</th>
                <th>Poste</th>
                <th>Date</th>
                <th className="ds-num">Montant ({currencySymbol()})</th>
                <th className="ds-num">Remboursé ({currencySymbol()})</th>
                <th className="ds-num">Solde ({currencySymbol()})</th>
                <th className="ds-num" title="Plan d'étalement : retenue proposée à chaque paie">Retenue par mois ({currencySymbol()})</th>
                <th>Statut</th>
                <th>Mode</th>
                <th className="ds-actions"><span className="sr-only">Actions</span></th>
              </tr>
            </thead>
            <tbody>
              {rows.map(a => {
                const reps = (a.repayments || []) as Record<string, any>[];
                const isExpanded = expanded.has(a.id as string);
                const meta = STATUS_META[a.status as string] || STATUS_META.open;
                const who = `${a.first_name} ${a.last_name}`;
                return (
                  <Fragment key={a.id as string}>
                    <tr onClick={() => reps.length > 0 && toggleExpand(a.id as string)} style={{ cursor: reps.length > 0 ? 'pointer' : 'default' }}>
                      <td>{reps.length > 0 && (
                        <button type="button" className="ds-icon-btn" aria-expanded={isExpanded} aria-label={`${isExpanded ? 'Masquer' : 'Afficher'} les retenues de ${who}`}
                          onClick={ev => { ev.stopPropagation(); toggleExpand(a.id as string); }}>
                          {isExpanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                        </button>
                      )}</td>
                      <td className="ds-strong">{who}</td>
                      <td>{getRoleLabel(a.employee_role as string)}</td>
                      <td>{isoDate(a.advance_date) ? format(new Date(isoDate(a.advance_date)), 'dd/MM/yyyy') : ''}</td>
                      <td className="ds-num">{fmt(pn(a.amount))}</td>
                      <td className="ds-num">{fmt(pn(a.amount) - pn(a.remaining_amount))}</td>
                      <td className="ds-num ds-strong">{fmt(pn(a.remaining_amount))}</td>
                      <td className="ds-num">
                        {pn(a.monthly_deduction) > 0 ? (
                          <span title={pn(a.remaining_amount) > 0 ? `≈ ${Math.ceil(pn(a.remaining_amount) / pn(a.monthly_deduction))} paie(s) restante(s)` : 'Plan soldé'}>
                            {fmt(pn(a.monthly_deduction))}
                            {pn(a.remaining_amount) > 0 && (
                              <span style={{ color: 'var(--ds-muted)', fontSize: 12 }}> · {Math.ceil(pn(a.remaining_amount) / pn(a.monthly_deduction))} paies</span>
                            )}
                          </span>
                        ) : '—'}
                      </td>
                      <td><StatusTag tone={meta.tone} label={meta.label} /></td>
                      <td>{getPaymentLabel(a.payment_method as string)}</td>
                      <td className="ds-actions" onClick={ev => ev.stopPropagation()}>
                        {isAdmin && (
                          <>
                            <button type="button" className="odoo-btn-secondary ds-btn-sm" onClick={() => openEdit(a)}
                              title={reps.length > 0 ? 'Modifier le plan de retenue / notes' : 'Modifier l\'avance'}>
                              <Pencil size={13} aria-hidden="true" /> Modifier
                            </button>
                            {reps.length === 0 && (
                              <RowMenu label={`Plus d'actions pour l'avance de ${who}`} items={[{
                                label: 'Supprimer', icon: Trash2, danger: true,
                                onSelect: async () => {
                                  if (!(await confirm(`Supprimer l'avance de ${money(pn(a.amount))} pour ${who} ?\n\nLe décaissement lié sera annulé (écriture comptable reversée).`,
                                    { title: 'Supprimer l\'avance', confirmLabel: 'Supprimer', danger: true }))) return;
                                  deleteMutation.mutate(a.id as string);
                                },
                              }]} />
                            )}
                          </>
                        )}
                      </td>
                    </tr>
                    {isExpanded && reps.map(r => (
                      <tr key={r.id as string} style={{ background: 'color-mix(in srgb, var(--ds-bg) 60%, transparent)' }}>
                        <td></td>
                        <td colSpan={4} style={{ color: 'var(--ds-muted)' }}>
                          <RotateCcw size={12} aria-hidden="true" style={{ display: 'inline', marginRight: 4 }} />
                          {repaymentLabel(r)}
                        </td>
                        <td className="ds-num">+ {fmt(pn(r.amount))}</td>
                        <td colSpan={5} style={{ color: 'var(--ds-muted)' }}>{r.repaymentDate as string}</td>
                      </tr>
                    ))}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </DataPanel>
      )}

      {/* ─── Grant advance modal ─── */}
      {showForm && (
        <HrModal icon={HandCoins} crumb="Avance" title="Accorder une avance" width={520} onClose={() => setShowForm(false)}
          footer={<>
            <button type="button" className="odoo-btn-secondary" onClick={() => setShowForm(false)}>Annuler</button>
            <SubmitButton pending={createMutation.isPending} onClick={() => (document.getElementById('advance-grant-form') as HTMLFormElement | null)?.requestSubmit()}>Accorder l'avance</SubmitButton>
          </>}>
          <form id="advance-grant-form" onSubmit={e => {
            e.preventDefault();
            const fd = Object.fromEntries(new FormData(e.currentTarget)) as Record<string, any>;
            if (!formEmployeeId) { notify.error('Sélectionnez un employé'); return; }
            const amount = parseFloat(fd.amount as string);
            if (!amount || amount <= 0) { notify.error('Montant invalide'); return; }
            const monthly = parseFloat(formMonthly) || 0;
            if (formMonthly && (monthly <= 0 || monthly > amount)) {
              notify.error('La retenue par mois doit être comprise entre 0 et le montant de l\'avance');
              return;
            }
            createMutation.mutate({
              employeeId: formEmployeeId, amount,
              paymentMethod: fd.paymentMethod || 'cash',
              advanceDate: fd.advanceDate || undefined,
              notes: fd.notes || undefined,
              monthlyDeduction: monthly > 0 ? monthly : undefined,
            });
          }} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <Field label="Employé" required>
              <SearchSelect value={formEmployeeId} onChange={setFormEmployeeId}
                placeholder="Sélectionner un employé…" width="100%" size="md" ariaLabel="Employé"
                options={(employees as Record<string, any>[]).filter(e2 => e2.is_active).map(e2 => ({ id: e2.id as string, label: `${e2.first_name as string} ${e2.last_name as string}` }))} />
            </Field>
            <div className="ds-form-grid">
              <Field label={`Montant (${currencySymbol()})`} required>
                <input name="amount" type="number" step="0.01" min="0.01" required
                  value={formAmount} onChange={e => setFormAmount(e.target.value)} className={inputCls} />
              </Field>
              <Field label="Date" required>
                <input name="advanceDate" type="date" required defaultValue={format(new Date(), 'yyyy-MM-dd')} className={inputCls} />
              </Field>
            </div>
            <Field label="Mode de paiement">
              <select name="paymentMethod" className={inputCls}>
                {paymentMethods.length > 0
                  ? paymentMethods.map(m => <option key={m.code} value={m.code}>{m.label}</option>)
                  : <><option value="cash">Espèces</option><option value="bank">Virement</option></>}
              </select>
            </Field>
            <Field label="Retenue par mois (optionnel)">
              <input type="number" step="0.01" min="0.01" placeholder="Vide = tout retenir à la prochaine paie"
                value={formMonthly} onChange={e => setFormMonthly(e.target.value)} className={inputCls} />
              {(() => {
                const amountNum = parseFloat(formAmount) || 0;
                const monthlyNum = parseFloat(formMonthly) || 0;
                if (amountNum <= 0 || monthlyNum <= 0) return (
                  <p style={HINT}>Le système proposera ce montant à chaque paie jusqu'au solde de l'avance (modifiable au moment du paiement).</p>
                );
                if (monthlyNum > amountNum) return (
                  <p style={{ ...HINT, color: 'var(--ds-danger)', fontWeight: 600 }}>La retenue par mois dépasse le montant de l'avance.</p>
                );
                const nbMonths = Math.ceil(amountNum / monthlyNum);
                const lastAmount = Math.round((amountNum - monthlyNum * (nbMonths - 1)) * 100) / 100;
                return (
                  <p style={{ ...HINT, color: 'var(--ds-info)' }}>
                    Étalement : {nbMonths} paie{nbMonths > 1 ? 's' : ''} — {nbMonths > 1 ? `${nbMonths - 1} × ${money(monthlyNum)}` : money(monthlyNum)}
                    {lastAmount !== monthlyNum && nbMonths > 1 ? ` + 1 × ${money(lastAmount)}` : ''}
                  </p>
                );
              })()}
            </Field>
            <Field label="Notes">
              <input name="notes" type="text" placeholder="Motif, accord de remboursement…" className={inputCls} />
            </Field>
          </form>
        </HrModal>
      )}

      {/* ─── Edit advance modal (admin) ─── */}
      {editingAdvance && (() => {
        const hasReps = ((editingAdvance.repayments || []) as Record<string, any>[]).length > 0;
        const remaining = pn(editingAdvance.remaining_amount);
        const meta = STATUS_META[editingAdvance.status as string] || STATUS_META.open;
        return (
          <HrModal icon={HandCoins} crumb="Avance" width={520} onClose={() => setEditingAdvance(null)}
            title={`Modifier — ${editingAdvance.first_name as string} ${editingAdvance.last_name as string}`}
            tag={<StatusTag tone={meta.tone} label={meta.label} />}
            footer={<>
              <button type="button" className="odoo-btn-secondary" onClick={() => setEditingAdvance(null)}>Annuler</button>
              <SubmitButton pending={updateMutation.isPending} onClick={() => (document.getElementById('advance-edit-form') as HTMLFormElement | null)?.requestSubmit()}>Enregistrer</SubmitButton>
            </>}>
            <form id="advance-edit-form" onSubmit={e => {
              e.preventDefault();
              const amount = parseFloat(editAmount) || 0;
              const monthly = parseFloat(editMonthly) || 0;
              if (!hasReps && amount <= 0) { notify.error('Montant invalide'); return; }
              const refAmount = hasReps ? pn(editingAdvance.amount) : amount;
              if (editMonthly && (monthly <= 0 || monthly > refAmount)) {
                notify.error('La retenue par mois doit être comprise entre 0 et le montant de l\'avance');
                return;
              }
              const data: Record<string, any> = {
                monthlyDeduction: monthly > 0 ? monthly : null,
                notes: editNotes,
              };
              if (!hasReps) {
                data.amount = amount;
                data.paymentMethod = editMethod;
                data.advanceDate = editDate || undefined;
              }
              updateMutation.mutate({ id: editingAdvance.id as string, data });
            }} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {hasReps && (
                <StatusBanner tone="info" icon={Info} title="Retenues déjà imputées">
                  Le montant, la date et le mode ne sont plus modifiables.
                  Le plan de retenue et les notes restent ajustables — les prochaines paies suivront le nouveau plan.
                </StatusBanner>
              )}
              <div className="ds-form-grid">
                <Field label={`Montant (${currencySymbol()})`} required>
                  <input type="number" step="0.01" min="0.01" required disabled={hasReps}
                    value={editAmount} onChange={e => setEditAmount(e.target.value)} className={inputCls} />
                </Field>
                <Field label="Date">
                  <input type="date" disabled={hasReps} value={editDate} onChange={e => setEditDate(e.target.value)} className={inputCls} />
                </Field>
              </div>
              <Field label="Mode de paiement">
                <select disabled={hasReps} value={editMethod} onChange={e => setEditMethod(e.target.value)} className={inputCls}>
                  {paymentMethods.length > 0
                    ? paymentMethods.map(m => <option key={m.code} value={m.code}>{m.label}</option>)
                    : <><option value="cash">Espèces</option><option value="bank">Virement</option></>}
                </select>
              </Field>
              <Field label="Retenue par mois (vide = tout à la prochaine paie)">
                <input type="number" step="0.01" min="0.01" placeholder="Vide = tout retenir à la prochaine paie"
                  value={editMonthly} onChange={e => setEditMonthly(e.target.value)} className={inputCls} />
                {(() => {
                  const monthlyNum = parseFloat(editMonthly) || 0;
                  if (monthlyNum <= 0) return (
                    <p style={HINT}>Sans plan, tout le solde ({money(remaining)}) sera proposé à la prochaine paie.</p>
                  );
                  const refAmount = hasReps ? pn(editingAdvance.amount) : (parseFloat(editAmount) || 0);
                  if (monthlyNum > refAmount) return (
                    <p style={{ ...HINT, color: 'var(--ds-danger)', fontWeight: 600 }}>La retenue par mois dépasse le montant de l'avance.</p>
                  );
                  if (remaining <= 0) return null;
                  const nbLeft = Math.ceil(remaining / monthlyNum);
                  return (
                    <p style={{ ...HINT, color: 'var(--ds-info)' }}>
                      Solde restant {money(remaining)} → {nbLeft} paie{nbLeft > 1 ? 's' : ''} de {money(monthlyNum)} max.
                    </p>
                  );
                })()}
              </Field>
              <Field label="Notes">
                <input type="text" value={editNotes} onChange={e => setEditNotes(e.target.value)}
                  placeholder="Motif, accord de remboursement…" className={inputCls} />
              </Field>
            </form>
          </HrModal>
        );
      })()}
    </>
  );
}
