import { Fragment, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { employeesApi, advancesApi } from '../../../api/employees.api';
import { useReferentiel } from '../../../hooks/useReferentiel';
import { format } from 'date-fns';
import {
  Plus, Pencil, Users, Check, X, ChevronDown, ChevronUp, Trash2, RotateCcw, HandCoins,
} from 'lucide-react';
import { notify } from '../../../components/ui/InlineNotification';
import { useAuth } from '../../../context/AuthContext';
import { MONTH_NAMES, isoDate } from '../shared';

/* ═══════════════════════ ADVANCES TAB (avances sur salaire) ═══════════════════════ */
export default function AdvancesTab({ queryClient }: { queryClient: ReturnType<typeof useQueryClient> }) {
  const [showForm, setShowForm] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [statusFilter, setStatusFilter] = useState<'open' | 'all'>('open');
  // Champs controles du formulaire d'octroi (pour l'apercu d'etalement en direct)
  const [formAmount, setFormAmount] = useState('');
  const [formMonthly, setFormMonthly] = useState('');
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

  const STATUS_META: Record<string, { label: string; cls: string }> = {
    open: { label: 'En cours', cls: 'odoo-tag-orange' },
    partial: { label: 'Partiel', cls: 'odoo-tag-purple' },
    repaid: { label: 'Soldée', cls: 'odoo-tag-green' },
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
      <div className="odoo-search-panel" style={{ justifyContent: 'space-between' }}>
        <div className="odoo-view-switcher">
          <button onClick={() => setStatusFilter('open')} className={statusFilter === 'open' ? 'active' : ''}>En cours</button>
          <button onClick={() => setStatusFilter('all')} className={statusFilter === 'all' ? 'active' : ''}>Toutes</button>
        </div>
        <button onClick={() => { setFormAmount(''); setFormMonthly(''); setShowForm(true); }} className="odoo-btn-primary"
          style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
          <Plus size={13} /> Accorder une avance
        </button>
      </div>

      {/* Stat tiles */}
      <div className="odoo-stat-grid">
        <div className="odoo-stat-card">
          <div className="odoo-stat-card-label"><HandCoins size={11} style={{ display: 'inline', marginRight: 4 }} />Avances en cours</div>
          <div className="odoo-stat-card-value" style={{ color: totalOutstanding > 0 ? '#b85d1a' : undefined }}>
            {totalOutstanding.toFixed(2)} <span style={{ fontSize: '0.6875rem', color: 'var(--odoo-text-muted)', fontWeight: 400 }}>DH</span>
          </div>
          <div className="odoo-stat-card-sub">à récupérer sur les paies</div>
        </div>
        <div className="odoo-stat-card">
          <div className="odoo-stat-card-label"><Users size={11} style={{ display: 'inline', marginRight: 4 }} />Employés concernés</div>
          <div className="odoo-stat-card-value">{employeesConcerned}</div>
        </div>
        <div className="odoo-stat-card">
          <div className="odoo-stat-card-label">Total accordé{statusFilter === 'open' ? ' (en cours)' : ''}</div>
          <div className="odoo-stat-card-value">{totalGranted.toFixed(2)} <span style={{ fontSize: '0.6875rem', color: 'var(--odoo-text-muted)', fontWeight: 400 }}>DH</span></div>
        </div>
        <div className="odoo-stat-card">
          <div className="odoo-stat-card-label">Déjà remboursé</div>
          <div className="odoo-stat-card-value" style={{ color: totalRepaid > 0 ? '#28a745' : undefined }}>
            {totalRepaid.toFixed(2)} <span style={{ fontSize: '0.6875rem', color: 'var(--odoo-text-muted)', fontWeight: 400 }}>DH</span>
          </div>
        </div>
      </div>

      {isLoading ? (
        <p style={{ color: 'var(--odoo-text-muted)', fontSize: '0.8125rem' }}>Chargement...</p>
      ) : rows.length === 0 ? (
        <div style={{ padding: '3rem', textAlign: 'center', color: 'var(--odoo-text-muted)' }}>
          <HandCoins size={28} style={{ margin: '0 auto 0.5rem', opacity: 0.4 }} />
          <p style={{ fontSize: '0.8125rem' }}>
            {statusFilter === 'open' ? 'Aucune avance en cours.' : 'Aucune avance enregistrée.'}
          </p>
          <p style={{ fontSize: '0.75rem', marginTop: 4 }}>La retenue se fait automatiquement au moment de payer le salaire (onglet Paie).</p>
        </div>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table className="odoo-table">
            <thead>
              <tr>
                <th style={{ width: 20 }}></th>
                <th>Employé</th>
                <th>Date</th>
                <th style={{ textAlign: 'right' }}>Montant</th>
                <th style={{ textAlign: 'right' }}>Remboursé</th>
                <th style={{ textAlign: 'right', background: '#fdf3e7', color: '#b85d1a' }}>Solde</th>
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
                      <td style={{ textAlign: 'right', color: '#28a745' }}>{(pn(a.amount) - pn(a.remaining_amount)).toFixed(2)}</td>
                      <td style={{ textAlign: 'right', fontWeight: 700, color: '#b85d1a', background: '#fdf3e7' }}>{pn(a.remaining_amount).toFixed(2)}</td>
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
                      <td style={{ textAlign: 'center' }}><span className={`odoo-tag ${meta.cls}`}>{meta.label}</span></td>
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
                              <button onClick={ev => {
                                ev.stopPropagation();
                                if (confirm(`Supprimer l'avance de ${pn(a.amount).toFixed(2)} DH pour ${a.first_name} ${a.last_name} ?\n\nLe décaissement lié sera annulé (écriture comptable reversée).`)) {
                                  deleteMutation.mutate(a.id as string);
                                }
                              }} className="odoo-pager-btn" title="Supprimer (aucun remboursement)" style={{ color: '#dc3545' }}>
                                <Trash2 size={12} />
                              </button>
                            )}
                          </div>
                        )}
                      </td>
                    </tr>
                    {isExpanded && reps.map(r => (
                      <tr key={r.id as string} style={{ background: 'var(--odoo-bg-alt)' }}>
                        <td></td>
                        <td colSpan={3} style={{ paddingLeft: 28, fontSize: '0.75rem', color: 'var(--odoo-text-muted)' }}>
                          <RotateCcw size={10} style={{ display: 'inline', marginRight: 4 }} />
                          {repaymentLabel(r)}
                        </td>
                        <td style={{ textAlign: 'right', fontSize: '0.75rem', color: '#28a745' }}>+ {pn(r.amount).toFixed(2)}</td>
                        <td colSpan={5} style={{ fontSize: '0.6875rem', color: 'var(--odoo-text-light)' }}>{r.repaymentDate as string}</td>
                      </tr>
                    ))}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <div style={{ fontSize: '0.6875rem', color: 'var(--odoo-text-muted)' }}>
        L'avance sort de la caisse au moment de l'octroi (visible dans Caisse et la trésorerie) mais n'est pas une charge :
        c'est une créance sur l'employé (compte 3431). La charge salaire est reconnue au fil des retenues, proposées automatiquement au paiement de la paie.
      </div>

      {/* ─── Grant advance modal ─── */}
      {showForm && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" onClick={() => setShowForm(false)}>
          <div className="bg-white rounded-2xl w-full max-w-md shadow-2xl" onClick={ev => ev.stopPropagation()}>
            <div className="bg-gradient-to-r from-teal-600 to-cyan-600 text-white p-5 rounded-t-2xl flex items-center justify-between">
              <h2 className="text-lg font-bold">Accorder une avance</h2>
              <button onClick={() => setShowForm(false)} className="w-8 h-8 bg-white/20 hover:bg-white/30 rounded-lg flex items-center justify-center">
                <X size={16} />
              </button>
            </div>
            <form onSubmit={e => {
              e.preventDefault();
              const fd = Object.fromEntries(new FormData(e.currentTarget)) as Record<string, any>;
              if (!fd.employeeId) { notify.error('Sélectionnez un employé'); return; }
              const amount = parseFloat(fd.amount as string);
              if (!amount || amount <= 0) { notify.error('Montant invalide'); return; }
              const monthly = parseFloat(formMonthly) || 0;
              if (formMonthly && (monthly <= 0 || monthly > amount)) {
                notify.error('La retenue par mois doit être comprise entre 0 et le montant de l\'avance');
                return;
              }
              createMutation.mutate({
                employeeId: fd.employeeId, amount,
                paymentMethod: fd.paymentMethod || 'cash',
                advanceDate: fd.advanceDate || undefined,
                notes: fd.notes || undefined,
                monthlyDeduction: monthly > 0 ? monthly : undefined,
              });
            }} className="p-5 space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">Employé *</label>
                <select name="employeeId" required
                  className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-teal-500">
                  <option value="">Sélectionner...</option>
                  {(employees as Record<string, any>[]).filter(e2 => e2.is_active).map(e2 => (
                    <option key={e2.id as string} value={e2.id as string}>{e2.first_name as string} {e2.last_name as string}</option>
                  ))}
                </select>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1.5">Montant (DH) *</label>
                  <input name="amount" type="number" step="0.01" min="0.01" required
                    value={formAmount} onChange={e => setFormAmount(e.target.value)}
                    className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-teal-500" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1.5">Date *</label>
                  <input name="advanceDate" type="date" required defaultValue={format(new Date(), 'yyyy-MM-dd')}
                    className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-teal-500" />
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">Mode de paiement</label>
                <select name="paymentMethod" className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-teal-500">
                  {paymentMethods.length > 0
                    ? paymentMethods.map(m => <option key={m.code} value={m.code}>{m.label}</option>)
                    : <><option value="cash">Espèces</option><option value="bank">Virement</option></>}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">
                  Retenue par mois (optionnel)
                </label>
                <input type="number" step="0.01" min="0.01" placeholder="Vide = tout retenir à la prochaine paie"
                  value={formMonthly} onChange={e => setFormMonthly(e.target.value)}
                  className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-teal-500" />
                {(() => {
                  const amountNum = parseFloat(formAmount) || 0;
                  const monthlyNum = parseFloat(formMonthly) || 0;
                  if (amountNum <= 0 || monthlyNum <= 0) return (
                    <p className="text-xs text-gray-400 mt-1">Le système proposera ce montant à chaque paie jusqu'au solde de l'avance (modifiable au moment du paiement).</p>
                  );
                  if (monthlyNum > amountNum) return (
                    <p className="text-xs text-red-600 mt-1">La retenue par mois dépasse le montant de l'avance.</p>
                  );
                  const nbMonths = Math.ceil(amountNum / monthlyNum);
                  const lastAmount = Math.round((amountNum - monthlyNum * (nbMonths - 1)) * 100) / 100;
                  return (
                    <p className="text-xs text-teal-700 mt-1">
                      Étalement : {nbMonths} paie{nbMonths > 1 ? 's' : ''} — {nbMonths > 1 ? `${nbMonths - 1} × ${monthlyNum.toFixed(2)} DH` : `${monthlyNum.toFixed(2)} DH`}
                      {lastAmount !== monthlyNum && nbMonths > 1 ? ` + 1 × ${lastAmount.toFixed(2)} DH` : ''}
                    </p>
                  );
                })()}
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">Notes</label>
                <input name="notes" type="text" placeholder="Motif, accord de remboursement..."
                  className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-teal-500" />
              </div>
              <button type="submit" disabled={createMutation.isPending}
                className="w-full py-3 bg-teal-600 hover:bg-teal-700 disabled:opacity-50 text-white rounded-xl font-medium flex items-center justify-center gap-2 transition-colors">
                <HandCoins size={16} /> {createMutation.isPending ? 'Enregistrement...' : 'Accorder l\'avance'}
              </button>
            </form>
          </div>
        </div>
      )}

      {/* ─── Edit advance modal (admin) ─── */}
      {editingAdvance && (() => {
        const hasReps = ((editingAdvance.repayments || []) as Record<string, any>[]).length > 0;
        const remaining = pn(editingAdvance.remaining_amount);
        return (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" onClick={() => setEditingAdvance(null)}>
            <div className="bg-white rounded-2xl w-full max-w-md shadow-2xl" onClick={ev => ev.stopPropagation()}>
              <div className="bg-gradient-to-r from-blue-600 to-indigo-600 text-white p-5 rounded-t-2xl flex items-center justify-between">
                <div>
                  <h2 className="text-lg font-bold">Modifier l'avance</h2>
                  <p className="text-blue-100 text-sm">{editingAdvance.first_name as string} {editingAdvance.last_name as string}</p>
                </div>
                <button onClick={() => setEditingAdvance(null)} className="w-8 h-8 bg-white/20 hover:bg-white/30 rounded-lg flex items-center justify-center">
                  <X size={16} />
                </button>
              </div>
              <form onSubmit={e => {
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
              }} className="p-5 space-y-4">
                {hasReps && (
                  <div className="bg-blue-50 border border-blue-200 rounded-xl p-3 text-xs text-blue-800">
                    Des retenues ont déjà été imputées sur cette avance : le montant, la date et le mode ne sont plus modifiables.
                    Le plan de retenue et les notes restent ajustables — les prochaines paies suivront le nouveau plan.
                  </div>
                )}
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1.5">Montant (DH) *</label>
                    <input type="number" step="0.01" min="0.01" required disabled={hasReps}
                      value={editAmount} onChange={e => setEditAmount(e.target.value)}
                      className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-100 disabled:text-gray-400 disabled:cursor-not-allowed" />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1.5">Date</label>
                    <input type="date" disabled={hasReps} value={editDate} onChange={e => setEditDate(e.target.value)}
                      className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-100 disabled:text-gray-400 disabled:cursor-not-allowed" />
                  </div>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1.5">Mode de paiement</label>
                  <select disabled={hasReps} value={editMethod} onChange={e => setEditMethod(e.target.value)}
                    className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-100 disabled:text-gray-400 disabled:cursor-not-allowed">
                    {paymentMethods.length > 0
                      ? paymentMethods.map(m => <option key={m.code} value={m.code}>{m.label}</option>)
                      : <><option value="cash">Espèces</option><option value="bank">Virement</option></>}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1.5">Retenue par mois (vide = tout à la prochaine paie)</label>
                  <input type="number" step="0.01" min="0.01" placeholder="Vide = tout retenir à la prochaine paie"
                    value={editMonthly} onChange={e => setEditMonthly(e.target.value)}
                    className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                  {(() => {
                    const monthlyNum = parseFloat(editMonthly) || 0;
                    if (monthlyNum <= 0) return (
                      <p className="text-xs text-gray-400 mt-1">Sans plan, tout le solde ({remaining.toFixed(2)} DH) sera proposé à la prochaine paie.</p>
                    );
                    const refAmount = hasReps ? pn(editingAdvance.amount) : (parseFloat(editAmount) || 0);
                    if (monthlyNum > refAmount) return (
                      <p className="text-xs text-red-600 mt-1">La retenue par mois dépasse le montant de l'avance.</p>
                    );
                    if (remaining <= 0) return null;
                    const nbLeft = Math.ceil(remaining / monthlyNum);
                    return (
                      <p className="text-xs text-blue-700 mt-1">
                        Solde restant {remaining.toFixed(2)} DH → {nbLeft} paie{nbLeft > 1 ? 's' : ''} de {monthlyNum.toFixed(2)} DH max.
                      </p>
                    );
                  })()}
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1.5">Notes</label>
                  <input type="text" value={editNotes} onChange={e => setEditNotes(e.target.value)}
                    placeholder="Motif, accord de remboursement..."
                    className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                </div>
                <button type="submit" disabled={updateMutation.isPending}
                  className="w-full py-3 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white rounded-xl font-medium flex items-center justify-center gap-2 transition-colors">
                  <Check size={16} /> {updateMutation.isPending ? 'Enregistrement...' : 'Enregistrer les modifications'}
                </button>
              </form>
            </div>
          </div>
        );
      })()}
    </>
  );
}
