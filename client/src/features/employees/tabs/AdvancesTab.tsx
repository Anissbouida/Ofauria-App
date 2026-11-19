import { money, currencySymbol } from '../../../utils/money';
import { Fragment, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { employeesApi, advancesApi } from '../../../api/employees.api';
import { useReferentiel } from '../../../hooks/useReferentiel';
import { format } from 'date-fns';
import {
  Plus, Pencil, Users, Check, ChevronDown, ChevronUp, Trash2, RotateCcw, HandCoins, Info,
} from 'lucide-react';
import { useConfirm } from '../../../components/ui/ConfirmDialog';
import { StatusBanner } from '../../../components/ui/StatusBanner';
import { StatusTag, type StatusTone } from '../../../components/ui/StatusTag';
import { ListEmpty } from '../../sales/ListTemplate';
import { HrModal, Field, LoadingPanel, Segmented, inputCls } from '../ui';
import { notify } from '../../../components/ui/InlineNotification';
import SearchSelect from '../../../components/ui/SearchSelect';
import { useAuth } from '../../../context/AuthContext';
import { MONTH_NAMES, isoDate } from '../shared';
import AdvanceRequestsPanel from './AdvanceRequestsPanel';

const HINT = { fontSize: '0.75rem', marginTop: 4, color: 'var(--odoo-text-muted)' } as const;

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

  const { data: advances = [], isLoading } = useQuery({
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

  return (
    <>
      <AdvanceRequestsPanel />
      <div className="prj-toolbar" style={{ justifyContent: 'space-between' }}>
        <Segmented label="Filtre des avances" value={statusFilter} onChange={setStatusFilter}
          options={[{ key: 'open', label: 'En cours' }, { key: 'all', label: 'Toutes' }]} />
        <button onClick={() => { setFormAmount(''); setFormMonthly(''); setFormEmployeeId(''); setShowForm(true); }} className="odoo-btn-primary"
          style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
          <Plus size={13} /> Accorder une avance
        </button>
      </div>

      {/* Tuiles d'indicateurs */}
      <div className="prj-kpis">
        <div className="prj-kpi">
          <div className="prj-kpi-head"><span>Avances en cours</span><HandCoins size={14} /></div>
          <div className="prj-kpi-value" style={{ color: totalOutstanding > 0 ? 'var(--prj-orange)' : undefined }}>
            {totalOutstanding.toFixed(2)} <span style={{ fontSize: '0.8125rem', color: 'var(--theme-text-muted)', fontWeight: 500 }}>{currencySymbol()}</span>
          </div>
          <div className="prj-kpi-sub">à récupérer sur les paies</div>
        </div>
        <div className="prj-kpi">
          <div className="prj-kpi-head"><span>Employés concernés</span><Users size={14} /></div>
          <div className="prj-kpi-value">{employeesConcerned}</div>
        </div>
        <div className="prj-kpi">
          <div className="prj-kpi-head"><span>Total accordé{statusFilter === 'open' ? ' (en cours)' : ''}</span></div>
          <div className="prj-kpi-value">{totalGranted.toFixed(2)} <span style={{ fontSize: '0.8125rem', color: 'var(--theme-text-muted)', fontWeight: 500 }}>{currencySymbol()}</span></div>
        </div>
        <div className="prj-kpi">
          <div className="prj-kpi-head"><span>Déjà remboursé</span></div>
          <div className="prj-kpi-value" style={{ color: totalRepaid > 0 ? 'var(--prj-green)' : undefined }}>
            {totalRepaid.toFixed(2)} <span style={{ fontSize: '0.8125rem', color: 'var(--theme-text-muted)', fontWeight: 500 }}>{currencySymbol()}</span>
          </div>
        </div>
      </div>

      {isLoading ? (
        <LoadingPanel />
      ) : rows.length === 0 ? (
        <ListEmpty icon={HandCoins} title={statusFilter === 'open' ? 'Aucune avance en cours.' : 'Aucune avance enregistrée.'}
          text="La retenue se fait automatiquement au moment de payer le salaire (onglet Paie)." />
      ) : (
        <div className="prj-panel hr-plain"><div className="prj-scroll">
          <table className="odoo-table">
            <thead>
              <tr>
                <th style={{ width: 20 }}></th>
                <th>Employé</th>
                <th>Date</th>
                <th style={{ textAlign: 'right' }}>Montant</th>
                <th style={{ textAlign: 'right' }}>Remboursé</th>
                <th style={{ textAlign: 'right' }}>Solde</th>
                <th style={{ textAlign: 'right' }} title="Plan d'étalement : retenue proposée à chaque paie">Retenue/mois</th>
                <th style={{ textAlign: 'center' }}>Statut</th>
                <th>Mode</th>
                <th style={{ textAlign: 'center', width: 60 }}></th>
              </tr>
            </thead>
            <tbody>
              {rows.map(a => {
                const reps = (a.repayments || []) as Record<string, any>[];
                const isExpanded = expanded.has(a.id as string);
                const meta = STATUS_META[a.status as string] || STATUS_META.open;
                return (
                  <Fragment key={a.id as string}>
                    <tr onClick={() => reps.length > 0 && toggleExpand(a.id as string)} style={{ cursor: reps.length > 0 ? 'pointer' : 'default' }}>
                      <td>{reps.length > 0 && (isExpanded ? <ChevronUp size={13} /> : <ChevronDown size={13} />)}</td>
                      <td>
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontWeight: 500 }}>
                          <Users size={11} style={{ color: 'var(--theme-accent)' }} />
                          {a.first_name as string} {a.last_name as string}
                          <span style={{ color: 'var(--odoo-text-muted)', fontSize: '0.6875rem' }}>· {getRoleLabel(a.employee_role as string)}</span>
                        </span>
                      </td>
                      <td style={{ color: 'var(--odoo-text-muted)' }}>{isoDate(a.advance_date) ? format(new Date(isoDate(a.advance_date)), 'dd/MM/yyyy') : ''}</td>
                      <td style={{ textAlign: 'right', fontWeight: 500 }}>{pn(a.amount).toFixed(2)}</td>
                      <td style={{ textAlign: 'right', color: 'var(--prj-green)' }}>{(pn(a.amount) - pn(a.remaining_amount)).toFixed(2)}</td>
                      <td style={{ textAlign: 'right', fontWeight: 700, color: 'var(--prj-orange)' }}>{pn(a.remaining_amount).toFixed(2)}</td>
                      <td style={{ textAlign: 'right' }}>
                        {pn(a.monthly_deduction) > 0 ? (
                          <span title={pn(a.remaining_amount) > 0 ? `≈ ${Math.ceil(pn(a.remaining_amount) / pn(a.monthly_deduction))} paie(s) restante(s)` : 'Plan soldé'}>
                            {pn(a.monthly_deduction).toFixed(2)}
                            {pn(a.remaining_amount) > 0 && (
                              <span style={{ color: 'var(--odoo-text-muted)', fontSize: '0.6875rem' }}> · {Math.ceil(pn(a.remaining_amount) / pn(a.monthly_deduction))} paies</span>
                            )}
                          </span>
                        ) : <span style={{ color: 'var(--odoo-text-light)' }}>—</span>}
                      </td>
                      <td style={{ textAlign: 'center' }}><StatusTag tone={meta.tone} label={meta.label} /></td>
                      <td style={{ color: 'var(--odoo-text-muted)', fontSize: '0.75rem' }}>{getPaymentLabel(a.payment_method as string)}</td>
                      <td style={{ textAlign: 'center' }}>
                        {user?.role === 'admin' && (
                          <div style={{ display: 'inline-flex', gap: 2 }}>
                            <button onClick={ev => {
                              ev.stopPropagation();
                              setEditingAdvance(a);
                              setEditAmount(pn(a.amount).toFixed(2));
                              setEditMonthly(pn(a.monthly_deduction) > 0 ? pn(a.monthly_deduction).toFixed(2) : '');
                              setEditDate(isoDate(a.advance_date));
                              setEditMethod((a.payment_method as string) || 'cash');
                              setEditNotes((a.notes as string) || '');
                            }} className="odoo-pager-btn" title={reps.length > 0 ? 'Modifier le plan de retenue / notes' : 'Modifier l\'avance'}>
                              <Pencil size={12} />
                            </button>
                            {reps.length === 0 && (
                              <button onClick={async ev => {
                                ev.stopPropagation();
                                if (!(await confirm(`Supprimer l'avance de ${money(pn(a.amount))} pour ${a.first_name} ${a.last_name} ?\n\nLe décaissement lié sera annulé (écriture comptable reversée).`,
                                  { title: 'Supprimer l\'avance', confirmLabel: 'Supprimer', danger: true }))) return;
                                deleteMutation.mutate(a.id as string);
                              }} className="odoo-pager-btn" title="Supprimer (aucun remboursement)" style={{ color: 'var(--prj-red)' }}>
                                <Trash2 size={12} />
                              </button>
                            )}
                          </div>
                        )}
                      </td>
                    </tr>
                    {isExpanded && reps.map(r => (
                      <tr key={r.id as string} style={{ background: 'color-mix(in srgb, var(--kl-bg, var(--theme-bg-page)) 60%, transparent)' }}>
                        <td></td>
                        <td colSpan={3} style={{ paddingLeft: 28, fontSize: '0.75rem', color: 'var(--odoo-text-muted)' }}>
                          <RotateCcw size={10} style={{ display: 'inline', marginRight: 4 }} />
                          {repaymentLabel(r)}
                        </td>
                        <td style={{ textAlign: 'right', fontSize: '0.75rem', color: 'var(--prj-green)' }}>+ {pn(r.amount).toFixed(2)}</td>
                        <td colSpan={5} style={{ fontSize: '0.6875rem', color: 'var(--odoo-text-light)' }}>{r.repaymentDate as string}</td>
                      </tr>
                    ))}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="hr-panel-foot" style={{ margin: 0 }}>
          L'avance sort de la caisse au moment de l'octroi (visible dans Caisse et la trésorerie) mais n'est pas une charge :
          c'est une créance sur l'employé (compte 3431). La charge salaire est reconnue au fil des retenues, proposées automatiquement au paiement de la paie.
        </p>
        </div>
      )}

      {/* ─── Grant advance modal ─── */}
      {showForm && (
        <HrModal icon={HandCoins} crumb="Avance" title="Accorder une avance" width={520} onClose={() => setShowForm(false)}
          footer={<>
            <button type="button" className="odoo-btn-secondary" onClick={() => setShowForm(false)}>Annuler</button>
            <button type="submit" form="advance-grant-form" disabled={createMutation.isPending} className="odoo-btn-primary"
              style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
              <HandCoins size={13} /> {createMutation.isPending ? 'Enregistrement...' : 'Accorder l\'avance'}
            </button>
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
            <Field label="Employé *">
              <SearchSelect value={formEmployeeId} onChange={setFormEmployeeId}
                placeholder="Sélectionner un employé…" width="100%" size="md" ariaLabel="Employé"
                options={(employees as Record<string, any>[]).filter(e2 => e2.is_active).map(e2 => ({ id: e2.id as string, label: `${e2.first_name as string} ${e2.last_name as string}` }))} />
            </Field>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <Field label={`Montant (${currencySymbol()}) *`}>
                <input name="amount" type="number" step="0.01" min="0.01" required
                  value={formAmount} onChange={e => setFormAmount(e.target.value)} className={inputCls} />
              </Field>
              <Field label="Date *">
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
                  <p style={{ ...HINT, color: 'var(--prj-red)' }}>La retenue par mois dépasse le montant de l'avance.</p>
                );
                const nbMonths = Math.ceil(amountNum / monthlyNum);
                const lastAmount = Math.round((amountNum - monthlyNum * (nbMonths - 1)) * 100) / 100;
                return (
                  <p style={{ ...HINT, color: 'var(--odoo-purple)' }}>
                    Étalement : {nbMonths} paie{nbMonths > 1 ? 's' : ''} — {nbMonths > 1 ? `${nbMonths - 1} × ${money(monthlyNum)}` : money(monthlyNum)}
                    {lastAmount !== monthlyNum && nbMonths > 1 ? ` + 1 × ${money(lastAmount)}` : ''}
                  </p>
                );
              })()}
            </Field>
            <Field label="Notes">
              <input name="notes" type="text" placeholder="Motif, accord de remboursement..." className={inputCls} />
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
              <button type="submit" form="advance-edit-form" disabled={updateMutation.isPending} className="odoo-btn-primary"
                style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                <Check size={13} /> {updateMutation.isPending ? 'Enregistrement...' : 'Enregistrer les modifications'}
              </button>
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
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <Field label={`Montant (${currencySymbol()}) *`}>
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
                    <p style={{ ...HINT, color: 'var(--prj-red)' }}>La retenue par mois dépasse le montant de l'avance.</p>
                  );
                  if (remaining <= 0) return null;
                  const nbLeft = Math.ceil(remaining / monthlyNum);
                  return (
                    <p style={{ ...HINT, color: 'var(--odoo-purple)' }}>
                      Solde restant {money(remaining)} → {nbLeft} paie{nbLeft > 1 ? 's' : ''} de {money(monthlyNum)} max.
                    </p>
                  );
                })()}
              </Field>
              <Field label="Notes">
                <input type="text" value={editNotes} onChange={e => setEditNotes(e.target.value)}
                  placeholder="Motif, accord de remboursement..." className={inputCls} />
              </Field>
            </form>
          </HrModal>
        );
      })()}
    </>
  );
}
