import { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { caisseApi, suppliersApi, expenseCategoriesApi, invoicesApi, paymentsApi } from '../../api/accounting.api';
import { employeesApi } from '../../api/employees.api';
import { useAuth } from '../../context/AuthContext';
import { format, getDaysInMonth } from 'date-fns';
import { fr } from 'date-fns/locale';
import {
  Plus, Pencil, Truck, FileText, Banknote, BookOpen, BarChart3,
  X, Check, Download, AlertTriangle, ChevronDown, ChevronRight, Wallet, ClipboardList,
} from 'lucide-react';
import toast from 'react-hot-toast';
import PurchaseOrdersTab from './PurchaseOrdersTab';

type AccTab = 'caisse' | 'resume' | 'suppliers' | 'purchase_orders' | 'invoices' | 'payments';

const PAYMENT_METHOD_LABELS: Record<string, string> = { cash: 'Especes', bank: 'Virement', check: 'Cheque', transfer: 'Virement' };
const PAYMENT_TYPE_LABELS: Record<string, string> = { invoice: 'Facture', salary: 'Salaire', expense: 'Depense', income: 'Revenu' };
const INVOICE_STATUS_LABELS: Record<string, string> = { pending: 'En attente', partial: 'Partiel', paid: 'Payee', overdue: 'En retard', cancelled: 'Annulee' };
const INVOICE_STATUS_COLORS: Record<string, string> = {
  pending: 'bg-yellow-100 text-yellow-700', partial: 'bg-blue-100 text-blue-700',
  paid: 'bg-green-100 text-green-700', overdue: 'bg-red-100 text-red-700', cancelled: 'bg-gray-100 text-gray-500',
};
const MONTH_NAMES = ['Janvier', 'Fevrier', 'Mars', 'Avril', 'Mai', 'Juin', 'Juillet', 'Aout', 'Septembre', 'Octobre', 'Novembre', 'Decembre'];

function exportCSV(filename: string, headers: string[], rows: string[][]) {
  const BOM = '\uFEFF';
  const csv = BOM + [headers.join(';'), ...rows.map(r => r.join(';'))].join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}

function n(v: number) { return v.toFixed(2); }
function parseLocalDate(s: string) {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
}

interface DayData {
  date: string;
  dayNum: number;
  payments: Record<string, unknown>[];
  entries: number;
  exits: number;
  cashCaissiere: number;
  cashSysteme: number;
  cardReceipt: number;
  ecart: number;
  totalRecettes: number;
  totalSales: number;
  saleCount: number;
  cashNetCumul: number;
  cardCumul: number;
  solde: number;
}

function buildDailyData(
  rawPayments: Record<string, unknown>[],
  rawSessions: Record<string, unknown>[],
  rawSales: Record<string, unknown>[],
  previousBalance: { cashNet: number; cardCumul: number },
  year: number,
  month: number,
): DayData[] {
  const daysInMonth = getDaysInMonth(new Date(year, month - 1));
  const sessionMap = new Map<string, { cashCaissiere: number; cashSysteme: number; card: number }>();
  for (const s of rawSessions) {
    const d = (s.session_date as string).slice(0, 10);
    sessionMap.set(d, {
      cashCaissiere: parseFloat(s.cash_caissiere as string) || 0,
      cashSysteme: parseFloat(s.cash_systeme as string) || 0,
      card: parseFloat(s.card_revenue as string) || 0,
    });
  }

  const salesMap = new Map<string, { total: number; count: number }>();
  for (const s of rawSales) {
    const d = (s.sale_date as string).slice(0, 10);
    salesMap.set(d, {
      total: parseFloat(s.total_sales as string) || 0,
      count: parseInt(s.sale_count as string) || 0,
    });
  }

  const paymentsByDay = new Map<string, Record<string, unknown>[]>();
  for (const p of rawPayments) {
    const d = (p.payment_date as string).slice(0, 10);
    if (!paymentsByDay.has(d)) paymentsByDay.set(d, []);
    paymentsByDay.get(d)!.push(p);
  }

  let cashNet = previousBalance.cashNet;
  let cardCumul = previousBalance.cardCumul;
  const days: DayData[] = [];

  for (let day = 1; day <= daysInMonth; day++) {
    const dateStr = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    const dayPayments = paymentsByDay.get(dateStr) || [];
    const session = sessionMap.get(dateStr) || { cashCaissiere: 0, cashSysteme: 0, card: 0 };
    const daySales = salesMap.get(dateStr) || { total: 0, count: 0 };

    let entries = 0, exits = 0;
    for (const p of dayPayments) {
      const amount = parseFloat(p.amount as string) || 0;
      if (p.type === 'income') entries += amount;
      else exits += amount;
    }

    cashNet = cashNet + entries + session.cashCaissiere - exits;
    cardCumul = cardCumul + session.card;

    if (dayPayments.length > 0 || session.cashCaissiere > 0 || session.card > 0 || daySales.count > 0) {
      days.push({
        date: dateStr,
        dayNum: day,
        payments: dayPayments,
        entries,
        exits,
        cashCaissiere: session.cashCaissiere,
        cashSysteme: session.cashSysteme,
        cardReceipt: session.card,
        ecart: session.cashCaissiere - daySales.total,
        totalRecettes: session.cashCaissiere + session.card,
        totalSales: daySales.total,
        saleCount: daySales.count,
        cashNetCumul: cashNet,
        cardCumul,
        solde: cashNet + cardCumul,
      });
    }
  }

  return days;
}

export default function AccountingPage() {
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';

  const [tab, setTab] = useState<AccTab>(isAdmin ? 'caisse' : 'suppliers');

  const allTabs: { key: AccTab; label: string; icon: typeof BookOpen; adminOnly?: boolean }[] = [
    { key: 'caisse', label: 'Caisse', icon: Wallet, adminOnly: true },
    { key: 'resume', label: 'Resume', icon: BarChart3, adminOnly: true },
    { key: 'suppliers', label: 'Fournisseurs', icon: Truck },
    { key: 'purchase_orders', label: 'Bons de commande', icon: ClipboardList },
    { key: 'invoices', label: 'Factures', icon: FileText },
    { key: 'payments', label: 'Paiements', icon: Banknote },
  ];

  const tabs = allTabs.filter(t => !t.adminOnly || isAdmin);

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-bakery-chocolate">Comptabilite</h1>

      <div className="flex gap-2 flex-wrap">
        {tabs.map(t => {
          const Icon = t.icon;
          return (
            <button key={t.key} onClick={() => setTab(t.key)}
              className={`flex items-center gap-1.5 px-4 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                tab === t.key ? 'bg-primary-600 text-white' : 'bg-white border border-gray-200 text-gray-600 hover:bg-gray-50'
              }`}>
              <Icon size={16} /> {t.label}
            </button>
          );
        })}
      </div>

      {tab === 'caisse' && <CaisseTab />}
      {tab === 'resume' && <ResumeTab />}
      {tab === 'suppliers' && <SuppliersTab />}
      {tab === 'purchase_orders' && <PurchaseOrdersTab />}
      {tab === 'invoices' && <InvoicesTab />}
      {tab === 'payments' && <PaymentsTab />}
    </div>
  );
}

/* ═══════════════════════ CAISSE TAB ═══════════════════════ */
function CaisseTab() {
  const now = new Date();
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [year, setYear] = useState(now.getFullYear());
  const [expandedDays, setExpandedDays] = useState<Set<number>>(new Set());
  const [showForm, setShowForm] = useState(false);
  const queryClient = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ['caisse-register', year, month],
    queryFn: () => caisseApi.register(year, month),
  });

  const { data: suppliers = [] } = useQuery({ queryKey: ['suppliers'], queryFn: suppliersApi.list });
  const { data: categories = [] } = useQuery({ queryKey: ['expense-categories'], queryFn: expenseCategoriesApi.list });
  const { data: employees = [] } = useQuery({ queryKey: ['employees'], queryFn: employeesApi.list });

  const [paymentType, setPaymentType] = useState('expense');

  const createMutation = useMutation({
    mutationFn: (d: Record<string, unknown>) => paymentsApi.create(d),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['caisse-register'] });
      queryClient.invalidateQueries({ queryKey: ['payments'] });
      toast.success('Operation enregistree');
      setShowForm(false);
    },
    onError: () => toast.error('Erreur'),
  });

  const days = useMemo(() => {
    if (!data) return [];
    return buildDailyData(data.payments, data.sessions, data.sales || [], data.previousBalance, year, month);
  }, [data, year, month]);

  const monthTotals = useMemo(() => {
    let entries = 0, exits = 0, cashCaissiere = 0, cashSysteme = 0, cardReceipts = 0, totalSales = 0, saleCount = 0;
    for (const d of days) {
      entries += d.entries;
      exits += d.exits;
      cashCaissiere += d.cashCaissiere;
      cashSysteme += d.cashSysteme;
      cardReceipts += d.cardReceipt;
      totalSales += d.totalSales;
      saleCount += d.saleCount;
    }
    const lastDay = days[days.length - 1];
    return {
      entries, exits, cashCaissiere, cashSysteme, cardReceipts, totalSales, saleCount,
      ecart: cashCaissiere - cashSysteme,
      totalRecettes: cashCaissiere + cardReceipts,
      cashNet: lastDay?.cashNetCumul || data?.previousBalance?.cashNet || 0,
      cardCumul: lastDay?.cardCumul || data?.previousBalance?.cardCumul || 0,
      solde: lastDay?.solde || ((data?.previousBalance?.cashNet || 0) + (data?.previousBalance?.cardCumul || 0)),
    };
  }, [days, data]);

  const toggleDay = (day: number) => {
    setExpandedDays(prev => {
      const next = new Set(prev);
      if (next.has(day)) next.delete(day); else next.add(day);
      return next;
    });
  };

  const handleExport = () => {
    const rows: string[][] = [];
    for (const d of days) {
      const dateStr = format(parseLocalDate(d.date), 'dd/MM/yyyy');
      rows.push([`LE ${dateStr}`, '', '', '', '']);
      rows.push(['N', 'FOURNISSEUR', 'DESIGNATION', 'ENTREE (DH)', 'SORTIE (DH)']);
      let idx = 1;
      for (const p of d.payments) {
        const amount = parseFloat(p.amount as string) || 0;
        const beneficiary = (p.supplier_name as string) || (p.employee_first_name ? `${p.employee_first_name} ${p.employee_last_name}` : (p.category_name as string) || '');
        rows.push([
          String(idx++),
          beneficiary,
          (p.description as string) || (PAYMENT_TYPE_LABELS[p.type as string] || ''),
          p.type === 'income' ? n(amount) : '',
          p.type !== 'income' ? n(amount) : '',
        ]);
      }
      rows.push(['', 'TOTAL OPERATIONS', '', n(d.entries), n(d.exits)]);
      rows.push(['', 'RECETTES CASH', '', n(d.cashCaissiere), '']);
      rows.push(['', 'RECETTES CARTE', '', n(d.cardReceipt), '']);
      rows.push(['', 'SOLDE FIN JOURNEE', '', n(d.solde), '']);
      rows.push(['', '', '', '', '']);
    }
    rows.push(['', 'TOTAL MOIS', '', n(monthTotals.entries + monthTotals.cashCaissiere), n(monthTotals.exits)]);
    rows.push(['', 'CASH NET CUMULE', '', n(monthTotals.cashNet), '']);
    rows.push(['', 'CARTE CUMULEE', '', n(monthTotals.cardCumul), '']);
    rows.push(['', 'SOLDE', '', n(monthTotals.solde), '']);
    exportCSV(`caisse_${MONTH_NAMES[month - 1]}_${year}.csv`, ['N', 'FOURNISSEUR', 'DESIGNATION', 'ENTREE (DH)', 'SORTIE (DH)'], rows);
  };

  return (
    <>
      {/* Month selector + actions */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <select value={month} onChange={e => setMonth(+e.target.value)} className="input w-auto">
            {MONTH_NAMES.map((m, i) => <option key={i} value={i + 1}>{m}</option>)}
          </select>
          <input type="number" value={year} onChange={e => setYear(+e.target.value)} className="input w-24" />
        </div>
        <div className="flex items-center gap-2">
          <button onClick={handleExport} className="btn-secondary flex items-center gap-2"><Download size={16} /> Exporter</button>
          <button onClick={() => setShowForm(true)} className="btn-primary flex items-center gap-2"><Plus size={18} /> Operation</button>
        </div>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
        <div className="card text-center">
          <p className="text-xs text-gray-500 mb-1">Ventes ({monthTotals.saleCount})</p>
          <p className="text-xl font-bold text-purple-600">{n(monthTotals.totalSales)} DH</p>
        </div>
        <div className="card text-center">
          <p className="text-xs text-gray-500 mb-1">Cash Caissiere</p>
          <p className="text-xl font-bold text-green-600">{n(monthTotals.cashCaissiere)} DH</p>
        </div>
        <div className="card text-center">
          <p className="text-xs text-gray-500 mb-1">Ecart</p>
          <p className={`text-xl font-bold ${monthTotals.ecart === 0 ? 'text-gray-400' : monthTotals.ecart > 0 ? 'text-green-600' : 'text-red-600'}`}>
            {monthTotals.ecart > 0 ? '+' : ''}{n(monthTotals.ecart)} DH
          </p>
        </div>
        <div className="card text-center">
          <p className="text-xs text-gray-500 mb-1">Carte Encaissee</p>
          <p className="text-xl font-bold text-blue-600">{n(monthTotals.cardReceipts)} DH</p>
        </div>
        <div className="card text-center">
          <p className="text-xs text-gray-500 mb-1">Total Sorties</p>
          <p className="text-xl font-bold text-red-600">{n(monthTotals.exits)} DH</p>
        </div>
        <div className="card text-center">
          <p className="text-xs text-gray-500 mb-1">Solde</p>
          <p className={`text-xl font-bold ${monthTotals.solde >= 0 ? 'text-green-600' : 'text-red-600'}`}>{n(monthTotals.solde)} DH</p>
        </div>
      </div>

      {/* Report line */}
      {data && (
        <div className="bg-amber-50 border border-amber-200 rounded-lg px-4 py-2 text-sm flex items-center justify-between">
          <span className="text-amber-800 font-medium">REPORT (Solde mois precedent)</span>
          <span className="font-bold text-amber-900">{n(data.previousBalance.cashNet + data.previousBalance.cardCumul)} DH</span>
        </div>
      )}

      {/* Daily sections */}
      {isLoading ? <p className="text-gray-500">Chargement...</p> : days.length === 0 ? (
        <p className="text-center py-8 text-gray-400">Aucune operation pour ce mois</p>
      ) : (
        <div className="space-y-2">
          {days.map(day => {
            const expanded = expandedDays.has(day.dayNum);
            const dateLabel = format(parseLocalDate(day.date), 'EEEE dd MMMM yyyy', { locale: fr });
            return (
              <div key={day.dayNum} className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
                {/* Day header */}
                <button onClick={() => toggleDay(day.dayNum)}
                  className="w-full flex items-center justify-between px-4 py-3 hover:bg-gray-50 transition-colors">
                  <div className="flex items-center gap-3">
                    {expanded ? <ChevronDown size={16} className="text-gray-400" /> : <ChevronRight size={16} className="text-gray-400" />}
                    <span className="font-semibold text-gray-800 capitalize">{dateLabel}</span>
                    <span className="text-xs text-gray-400">({day.payments.length} operation{day.payments.length > 1 ? 's' : ''})</span>
                  </div>
                  <div className="flex items-center gap-5 text-sm">
                    {day.totalSales > 0 && <span className="text-purple-600">Ventes: {n(day.totalSales)}</span>}
                    {day.cashCaissiere > 0 && <span className="text-green-600">Cash: {n(day.cashCaissiere)}</span>}
                    {day.ecart !== 0 && <span className={`font-medium ${day.ecart > 0 ? 'text-green-600' : 'text-red-600'}`}>Ecart: {day.ecart > 0 ? '+' : ''}{n(day.ecart)}</span>}
                    {day.cardReceipt > 0 && <span className="text-blue-600">Carte: {n(day.cardReceipt)}</span>}
                    {day.exits > 0 && <span className="text-red-600">Sorties: -{n(day.exits)}</span>}
                    <span className={`font-bold ${day.solde >= 0 ? 'text-green-700' : 'text-red-700'}`}>Solde: {n(day.solde)}</span>
                  </div>
                </button>

                {/* Expanded day detail */}
                {expanded && (
                  <div className="border-t border-gray-100">
                    {/* Operations table */}
                    {day.payments.length > 0 && (
                      <table className="w-full text-sm">
                        <thead className="bg-gray-50">
                          <tr>
                            <th className="text-left px-4 py-2 text-gray-500 font-medium w-10">N</th>
                            <th className="text-left px-4 py-2 text-gray-500 font-medium">Fournisseur / Beneficiaire</th>
                            <th className="text-left px-4 py-2 text-gray-500 font-medium">Designation</th>
                            <th className="text-left px-4 py-2 text-gray-500 font-medium w-20">Methode</th>
                            <th className="text-right px-4 py-2 text-gray-500 font-medium w-28">Entree (DH)</th>
                            <th className="text-right px-4 py-2 text-gray-500 font-medium w-28">Sortie (DH)</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-50">
                          {day.payments.map((p, idx) => {
                            const amount = parseFloat(p.amount as string) || 0;
                            const isIncome = p.type === 'income';
                            const beneficiary = (p.supplier_name as string) || (p.employee_first_name ? `${p.employee_first_name} ${p.employee_last_name}` : '');
                            return (
                              <tr key={p.id as string} className="hover:bg-gray-50">
                                <td className="px-4 py-2 text-gray-400">{idx + 1}</td>
                                <td className="px-4 py-2 font-medium text-gray-700">{beneficiary || (p.category_name as string) || '—'}</td>
                                <td className="px-4 py-2 text-gray-500">{(p.description as string) || (PAYMENT_TYPE_LABELS[p.type as string]) || '—'}</td>
                                <td className="px-4 py-2 text-gray-400 text-xs">{PAYMENT_METHOD_LABELS[p.payment_method as string] || ''}</td>
                                <td className="px-4 py-2 text-right font-semibold text-green-600">{isIncome ? n(amount) : ''}</td>
                                <td className="px-4 py-2 text-right font-semibold text-red-600">{!isIncome ? n(amount) : ''}</td>
                              </tr>
                            );
                          })}
                        </tbody>
                        <tfoot className="bg-gray-50 border-t font-semibold text-sm">
                          <tr>
                            <td colSpan={4} className="px-4 py-2 text-gray-600">TOTAL OPERATIONS</td>
                            <td className="px-4 py-2 text-right text-green-700">{day.entries > 0 ? n(day.entries) : ''}</td>
                            <td className="px-4 py-2 text-right text-red-700">{day.exits > 0 ? n(day.exits) : ''}</td>
                          </tr>
                        </tfoot>
                      </table>
                    )}

                    {/* Ventes + Recettes + Solde */}
                    <div className="bg-gradient-to-r from-gray-50 to-white px-4 py-3 space-y-1.5">
                      {day.totalSales > 0 && (
                        <div className="flex items-center justify-between text-sm">
                          <span className="text-gray-500">Ventes du jour ({day.saleCount} vente{day.saleCount > 1 ? 's' : ''})</span>
                          <span className="font-semibold text-purple-600">{n(day.totalSales)} DH</span>
                        </div>
                      )}
                      <div className="flex items-center justify-between text-sm">
                        <span className="text-gray-500">Cash systeme</span>
                        <span className="font-semibold text-gray-600">{n(day.cashSysteme)} DH</span>
                      </div>
                      <div className="flex items-center justify-between text-sm">
                        <span className="text-gray-500">Cash caissiere</span>
                        <span className="font-semibold text-green-600">{n(day.cashCaissiere)} DH</span>
                      </div>
                      <div className="flex items-center justify-between text-sm">
                        <span className="text-gray-500">Ecart</span>
                        <span className={`font-semibold ${day.ecart === 0 ? 'text-gray-400' : day.ecart > 0 ? 'text-green-600' : 'text-red-600'}`}>
                          {day.ecart > 0 ? '+' : ''}{n(day.ecart)} DH
                        </span>
                      </div>
                      <div className="flex items-center justify-between text-sm">
                        <span className="text-gray-500">Carte du jour</span>
                        <span className="font-semibold text-blue-600">{n(day.cardReceipt)} DH</span>
                      </div>
                      <div className="border-t border-gray-200 pt-1.5 flex items-center justify-between text-sm">
                        <span className="text-gray-500">Cash Net Cumule</span>
                        <span className="font-bold text-gray-700">{n(day.cashNetCumul)} DH</span>
                      </div>
                      <div className="flex items-center justify-between text-sm">
                        <span className="text-gray-500">Carte Cumulee</span>
                        <span className="font-bold text-gray-700">{n(day.cardCumul)} DH</span>
                      </div>
                      <div className="border-t border-gray-300 pt-1.5 flex items-center justify-between">
                        <span className="font-bold text-gray-800">SOLDE FIN DE JOURNEE</span>
                        <span className={`text-lg font-bold ${day.solde >= 0 ? 'text-green-700' : 'text-red-700'}`}>{n(day.solde)} DH</span>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Monthly recap */}
      {days.length > 0 && (
        <div className="bg-bakery-chocolate/5 border border-bakery-chocolate/20 rounded-xl p-4 space-y-2">
          <h3 className="font-bold text-bakery-chocolate mb-2">Recap {MONTH_NAMES[month - 1]} {year}</h3>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3 text-sm">
            <div><span className="text-gray-500">Total Ventes ({monthTotals.saleCount}):</span> <span className="font-bold text-purple-700">{n(monthTotals.totalSales)} DH</span></div>
            <div><span className="text-gray-500">Total Entrees:</span> <span className="font-bold text-green-700">{n(monthTotals.entries)} DH</span></div>
            <div><span className="text-gray-500">Total Sorties:</span> <span className="font-bold text-red-700">{n(monthTotals.exits)} DH</span></div>
            <div><span className="text-gray-500">Cash Caissiere:</span> <span className="font-bold">{n(monthTotals.cashCaissiere)} DH</span></div>
            <div><span className="text-gray-500">Carte Encaissee:</span> <span className="font-bold">{n(monthTotals.cardReceipts)} DH</span></div>
            <div><span className="text-gray-500">Solde Final:</span> <span className={`font-bold text-lg ${monthTotals.solde >= 0 ? 'text-green-700' : 'text-red-700'}`}>{n(monthTotals.solde)} DH</span></div>
          </div>
        </div>
      )}

      {/* Add operation modal */}
      {showForm && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl w-full max-w-lg p-6">
            <h2 className="text-xl font-bold mb-4">Nouvelle operation</h2>
            <form onSubmit={e => {
              e.preventDefault();
              const fd = Object.fromEntries(new FormData(e.currentTarget)) as Record<string, unknown>;
              fd.amount = parseFloat(fd.amount as string);
              fd.type = paymentType;
              if (!fd.supplierId) delete fd.supplierId;
              if (!fd.employeeId) delete fd.employeeId;
              if (!fd.categoryId) delete fd.categoryId;
              createMutation.mutate(fd);
            }} className="space-y-4">
              <div><label className="block text-sm font-medium mb-1">Type *</label>
                <div className="flex gap-2">
                  {[
                    { value: 'expense', label: 'Sortie', color: 'red' },
                    { value: 'salary', label: 'Salaire', color: 'orange' },
                    { value: 'income', label: 'Entree', color: 'green' },
                  ].map(t => (
                    <button key={t.value} type="button" onClick={() => setPaymentType(t.value)}
                      className={`flex-1 py-2 rounded-lg text-sm font-medium transition-colors ${
                        paymentType === t.value
                          ? t.color === 'red' ? 'bg-red-100 text-red-700 ring-2 ring-red-300'
                            : t.color === 'orange' ? 'bg-orange-100 text-orange-700 ring-2 ring-orange-300'
                            : 'bg-green-100 text-green-700 ring-2 ring-green-300'
                          : 'bg-gray-50 text-gray-500'
                      }`}>
                      {t.label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div><label className="block text-sm font-medium mb-1">Montant *</label><input name="amount" type="number" step="0.01" className="input" required /></div>
                <div><label className="block text-sm font-medium mb-1">Date *</label><input name="paymentDate" type="date" className="input" required defaultValue={format(new Date(), 'yyyy-MM-dd')} /></div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div><label className="block text-sm font-medium mb-1">Methode</label>
                  <select name="paymentMethod" className="input">
                    <option value="cash">Especes</option><option value="bank">Virement</option><option value="check">Cheque</option>
                  </select></div>
                <div><label className="block text-sm font-medium mb-1">Categorie</label>
                  <select name="categoryId" className="input">
                    <option value="">Choisir...</option>
                    {(categories as Record<string, unknown>[])
                      .filter(c => paymentType === 'income' ? c.type === 'income' : c.type === 'expense')
                      .map(c => <option key={c.id as string} value={c.id as string}>{c.name as string}</option>)}
                  </select></div>
              </div>

              {(paymentType === 'expense' || paymentType === 'invoice') && (
                <div><label className="block text-sm font-medium mb-1">Fournisseur</label>
                  <select name="supplierId" className="input">
                    <option value="">Aucun</option>
                    {(suppliers as Record<string, unknown>[]).filter(s => s.is_active).map(s => (
                      <option key={s.id as string} value={s.id as string}>{s.name as string}</option>
                    ))}
                  </select></div>
              )}

              {paymentType === 'salary' && (
                <div><label className="block text-sm font-medium mb-1">Employe</label>
                  <select name="employeeId" className="input">
                    <option value="">Choisir...</option>
                    {(employees as Record<string, unknown>[]).filter(e => e.is_active).map(e => (
                      <option key={e.id as string} value={e.id as string}>{e.first_name as string} {e.last_name as string}</option>
                    ))}
                  </select></div>
              )}

              <div><label className="block text-sm font-medium mb-1">Description</label><textarea name="description" rows={2} className="input" /></div>
              <div><label className="block text-sm font-medium mb-1">Reference</label><input name="reference" className="input" /></div>

              <div className="flex gap-3 justify-end">
                <button type="button" onClick={() => setShowForm(false)} className="btn-secondary">Annuler</button>
                <button type="submit" disabled={createMutation.isPending} className="btn-primary">Enregistrer</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}

/* ═══════════════════════ RESUME TAB ═══════════════════════ */
function ResumeTab() {
  const now = new Date();
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [year, setYear] = useState(now.getFullYear());

  const { data, isLoading } = useQuery({
    queryKey: ['caisse-register', year, month],
    queryFn: () => caisseApi.register(year, month),
  });

  const days = useMemo(() => {
    if (!data) return [];
    return buildDailyData(data.payments, data.sessions, data.sales || [], data.previousBalance, year, month);
  }, [data, year, month]);

  // Build full month grid (all days, even empty ones)
  const allDays = useMemo(() => {
    const daysInMonth = getDaysInMonth(new Date(year, month - 1));
    const dayMap = new Map(days.map(d => [d.dayNum, d]));
    const result: (DayData | null)[] = [];
    let lastCashNet = data?.previousBalance?.cashNet || 0;
    let lastCardCumul = data?.previousBalance?.cardCumul || 0;
    let lastSolde = lastCashNet + lastCardCumul;

    for (let d = 1; d <= daysInMonth; d++) {
      const day = dayMap.get(d);
      if (day) {
        lastCashNet = day.cashNetCumul;
        lastCardCumul = day.cardCumul;
        lastSolde = day.solde;
        result.push(day);
      } else {
        result.push({
          date: `${year}-${String(month).padStart(2, '0')}-${String(d).padStart(2, '0')}`,
          dayNum: d,
          payments: [],
          entries: 0, exits: 0,
          cashCaissiere: 0, cashSysteme: 0, cardReceipt: 0, ecart: 0, totalRecettes: 0,
          totalSales: 0, saleCount: 0,
          cashNetCumul: lastCashNet, cardCumul: lastCardCumul, solde: lastSolde,
        });
      }
    }
    return result;
  }, [days, data, year, month]);

  const totals = useMemo(() => {
    let entries = 0, exits = 0, cashR = 0, cardR = 0, sales = 0, salesCount = 0;
    for (const d of days) {
      entries += d.entries; exits += d.exits;
      cashR += d.cashCaissiere; cardR += d.cardReceipt;
      sales += d.totalSales; salesCount += d.saleCount;
    }
    const last = allDays[allDays.length - 1];
    return { entries, exits, cashR, cardR, sales, salesCount, recettes: cashR + cardR, cashNet: last?.cashNetCumul || 0, cardCumul: last?.cardCumul || 0, solde: last?.solde || 0 };
  }, [days, allDays]);

  const handleExport = () => {
    exportCSV(`resume_${MONTH_NAMES[month - 1]}_${year}.csv`,
      ['DATE', 'VENTES', 'ENTREES', 'SORTIES', 'CASH JOUR', 'CARTE JOUR', 'RECETTES', 'CASH NET', 'CUM CARTE', 'SOLDE'],
      allDays.filter(d => d !== null).map(d => [
        format(parseLocalDate(d!.date), 'dd/MM/yyyy'),
        n(d!.totalSales), n(d!.entries), n(d!.exits),
        n(d!.cashCaissiere), n(d!.cardReceipt), n(d!.totalRecettes),
        n(d!.cashNetCumul), n(d!.cardCumul), n(d!.solde),
      ])
    );
  };

  return (
    <>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <select value={month} onChange={e => setMonth(+e.target.value)} className="input w-auto">
            {MONTH_NAMES.map((m, i) => <option key={i} value={i + 1}>{m}</option>)}
          </select>
          <input type="number" value={year} onChange={e => setYear(+e.target.value)} className="input w-24" />
        </div>
        <button onClick={handleExport} className="btn-secondary flex items-center gap-2"><Download size={16} /> Exporter</button>
      </div>

      {isLoading ? <p className="text-gray-500">Chargement...</p> : (
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b">
              <tr>
                <th className="text-left px-3 py-3 font-medium text-gray-500">Date</th>
                <th className="text-right px-3 py-3 font-medium text-purple-600">Ventes</th>
                <th className="text-right px-3 py-3 font-medium text-gray-500">Entrees</th>
                <th className="text-right px-3 py-3 font-medium text-gray-500">Sorties</th>
                <th className="text-right px-3 py-3 font-medium text-green-600">Cash Jour</th>
                <th className="text-right px-3 py-3 font-medium text-blue-600">Carte Jour</th>
                <th className="text-right px-3 py-3 font-medium text-gray-500">Recettes</th>
                <th className="text-right px-3 py-3 font-medium text-gray-700 bg-green-50">Cash Net</th>
                <th className="text-right px-3 py-3 font-medium text-gray-700 bg-blue-50">Cum. Carte</th>
                <th className="text-right px-3 py-3 font-bold text-gray-800 bg-yellow-50">Solde</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {allDays.map(d => {
                if (!d) return null;
                const hasActivity = d.entries > 0 || d.exits > 0 || d.cashCaissiere > 0 || d.cardReceipt > 0;
                return (
                  <tr key={d.dayNum} className={hasActivity ? 'hover:bg-gray-50' : 'text-gray-300'}>
                    <td className="px-3 py-2 font-medium">{format(parseLocalDate(d.date), 'dd/MM')}</td>
                    <td className="px-3 py-2 text-right">{d.totalSales > 0 ? <span className="text-purple-600 font-medium">{n(d.totalSales)}</span> : '—'}</td>
                    <td className="px-3 py-2 text-right">{d.entries > 0 ? <span className="text-green-600">{n(d.entries)}</span> : '—'}</td>
                    <td className="px-3 py-2 text-right">{d.exits > 0 ? <span className="text-red-600">{n(d.exits)}</span> : '—'}</td>
                    <td className="px-3 py-2 text-right">{d.cashCaissiere > 0 ? <span className="text-green-600">{n(d.cashCaissiere)}</span> : '—'}</td>
                    <td className="px-3 py-2 text-right">{d.cardReceipt > 0 ? <span className="text-blue-600">{n(d.cardReceipt)}</span> : '—'}</td>
                    <td className="px-3 py-2 text-right">{d.totalRecettes > 0 ? n(d.totalRecettes) : '—'}</td>
                    <td className="px-3 py-2 text-right bg-green-50/50 font-medium">{n(d.cashNetCumul)}</td>
                    <td className="px-3 py-2 text-right bg-blue-50/50 font-medium">{n(d.cardCumul)}</td>
                    <td className={`px-3 py-2 text-right bg-yellow-50/50 font-bold ${d.solde >= 0 ? 'text-green-700' : 'text-red-700'}`}>{n(d.solde)}</td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot className="bg-gray-100 border-t-2 border-gray-300 font-bold text-sm">
              <tr>
                <td className="px-3 py-3">TOTAL</td>
                <td className="px-3 py-3 text-right text-purple-700">{n(totals.sales)}</td>
                <td className="px-3 py-3 text-right text-green-700">{n(totals.entries)}</td>
                <td className="px-3 py-3 text-right text-red-700">{n(totals.exits)}</td>
                <td className="px-3 py-3 text-right text-green-700">{n(totals.cashR)}</td>
                <td className="px-3 py-3 text-right text-blue-700">{n(totals.cardR)}</td>
                <td className="px-3 py-3 text-right">{n(totals.recettes)}</td>
                <td className="px-3 py-3 text-right bg-green-50">{n(totals.cashNet)}</td>
                <td className="px-3 py-3 text-right bg-blue-50">{n(totals.cardCumul)}</td>
                <td className={`px-3 py-3 text-right bg-yellow-50 text-lg ${totals.solde >= 0 ? 'text-green-700' : 'text-red-700'}`}>{n(totals.solde)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </>
  );
}

/* ═══════════════════════ SUPPLIERS TAB ═══════════════════════ */
function SuppliersTab() {
  const queryClient = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<Record<string, unknown> | null>(null);

  const { data: suppliers = [], isLoading } = useQuery({ queryKey: ['suppliers'], queryFn: suppliersApi.list });

  const saveMutation = useMutation({
    mutationFn: (data: Record<string, unknown>) =>
      editing ? suppliersApi.update(editing.id as string, data) : suppliersApi.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['suppliers'] });
      toast.success(editing ? 'Fournisseur modifie' : 'Fournisseur ajoute');
      setShowForm(false); setEditing(null);
    },
    onError: () => toast.error('Erreur'),
  });

  return (
    <>
      <div className="flex justify-end">
        <button onClick={() => { setEditing(null); setShowForm(true); }} className="btn-primary flex items-center gap-2">
          <Plus size={18} /> Ajouter un fournisseur
        </button>
      </div>

      {isLoading ? <p className="text-gray-500">Chargement...</p> : (
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b">
              <tr>
                <th className="text-left px-4 py-3 font-medium text-gray-500">Fournisseur</th>
                <th className="text-left px-4 py-3 font-medium text-gray-500">Contact</th>
                <th className="text-left px-4 py-3 font-medium text-gray-500">Telephone</th>
                <th className="text-left px-4 py-3 font-medium text-gray-500">Ville</th>
                <th className="text-left px-4 py-3 font-medium text-gray-500">ICE</th>
                <th className="text-center px-4 py-3 font-medium text-gray-500">Statut</th>
                <th className="text-center px-4 py-3 font-medium text-gray-500">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {(suppliers as Record<string, unknown>[]).map(s => (
                <tr key={s.id as string} className="hover:bg-gray-50">
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <div className="w-8 h-8 rounded-full bg-blue-100 flex items-center justify-center text-blue-600">
                        <Truck size={14} />
                      </div>
                      <span className="font-medium">{s.name as string}</span>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-gray-500">{s.contact_name as string || '—'}</td>
                  <td className="px-4 py-3 text-gray-500">{s.phone as string || '—'}</td>
                  <td className="px-4 py-3 text-gray-500">{s.city as string || '—'}</td>
                  <td className="px-4 py-3 text-gray-400 font-mono text-xs">{s.ice as string || '—'}</td>
                  <td className="px-4 py-3 text-center">
                    <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${s.is_active ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
                      {s.is_active ? 'Actif' : 'Inactif'}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-center">
                    <button onClick={() => { setEditing(s); setShowForm(true); }} className="p-1.5 hover:bg-gray-100 rounded text-gray-400">
                      <Pencil size={15} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {(suppliers as Record<string, unknown>[]).length === 0 && <p className="text-center py-8 text-gray-400">Aucun fournisseur</p>}
        </div>
      )}

      {showForm && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl w-full max-w-lg p-6">
            <h2 className="text-xl font-bold mb-4">{editing ? 'Modifier le fournisseur' : 'Nouveau fournisseur'}</h2>
            <form onSubmit={e => {
              e.preventDefault();
              saveMutation.mutate(Object.fromEntries(new FormData(e.currentTarget)));
            }} className="space-y-4">
              <div><label className="block text-sm font-medium mb-1">Nom *</label><input name="name" defaultValue={editing?.name as string} className="input" required /></div>
              <div className="grid grid-cols-2 gap-4">
                <div><label className="block text-sm font-medium mb-1">Contact</label><input name="contactName" defaultValue={editing?.contact_name as string} className="input" /></div>
                <div><label className="block text-sm font-medium mb-1">Telephone</label><input name="phone" defaultValue={editing?.phone as string} className="input" /></div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div><label className="block text-sm font-medium mb-1">Email</label><input name="email" type="email" defaultValue={editing?.email as string} className="input" /></div>
                <div><label className="block text-sm font-medium mb-1">Ville</label><input name="city" defaultValue={editing?.city as string} className="input" /></div>
              </div>
              <div><label className="block text-sm font-medium mb-1">Adresse</label><input name="address" defaultValue={editing?.address as string} className="input" /></div>
              <div><label className="block text-sm font-medium mb-1">ICE</label><input name="ice" defaultValue={editing?.ice as string} className="input" /></div>
              <div><label className="block text-sm font-medium mb-1">Notes</label><textarea name="notes" rows={2} defaultValue={editing?.notes as string} className="input" /></div>
              <div className="flex gap-3 justify-end">
                <button type="button" onClick={() => { setShowForm(false); setEditing(null); }} className="btn-secondary">Annuler</button>
                <button type="submit" disabled={saveMutation.isPending} className="btn-primary">Enregistrer</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}

/* ═══════════════════════ INVOICES TAB ═══════════════════════ */
function InvoicesTab() {
  const queryClient = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [showPayForm, setShowPayForm] = useState<Record<string, unknown> | null>(null);
  const [statusFilter, setStatusFilter] = useState('');

  const { data: invoices = [], isLoading } = useQuery({
    queryKey: ['invoices', statusFilter],
    queryFn: () => invoicesApi.list(statusFilter ? { status: statusFilter } : {}),
  });
  const { data: suppliers = [] } = useQuery({ queryKey: ['suppliers'], queryFn: suppliersApi.list });
  const { data: categories = [] } = useQuery({ queryKey: ['expense-categories'], queryFn: expenseCategoriesApi.list });

  const createMutation = useMutation({
    mutationFn: (data: Record<string, unknown>) => invoicesApi.create(data),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['invoices'] }); toast.success('Facture ajoutee'); setShowForm(false); },
    onError: () => toast.error('Erreur'),
  });

  const cancelMutation = useMutation({
    mutationFn: (id: string) => invoicesApi.cancel(id),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['invoices'] }); toast.success('Facture annulee'); },
  });

  const payMutation = useMutation({
    mutationFn: (data: Record<string, unknown>) => paymentsApi.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['invoices'] });
      queryClient.invalidateQueries({ queryKey: ['payments'] });
      queryClient.invalidateQueries({ queryKey: ['caisse-register'] });
      toast.success('Paiement enregistre');
      setShowPayForm(null);
    },
    onError: () => toast.error('Erreur'),
  });

  const totalPending = (invoices as Record<string, unknown>[])
    .filter(inv => inv.status !== 'paid' && inv.status !== 'cancelled')
    .reduce((sum, inv) => sum + parseFloat(inv.total_amount as string) - parseFloat(inv.paid_amount as string), 0);

  return (
    <>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)} className="input w-auto">
            <option value="">Tous les statuts</option>
            <option value="pending">En attente</option>
            <option value="partial">Partiel</option>
            <option value="paid">Payee</option>
            <option value="overdue">En retard</option>
          </select>
          {totalPending > 0 && (
            <div className="flex items-center gap-1.5 text-sm text-red-600 bg-red-50 px-3 py-1.5 rounded-lg">
              <AlertTriangle size={14} /> Reste a payer: <span className="font-bold">{totalPending.toFixed(2)} DH</span>
            </div>
          )}
        </div>
        <button onClick={() => setShowForm(true)} className="btn-primary flex items-center gap-2">
          <Plus size={18} /> Nouvelle facture
        </button>
      </div>

      {isLoading ? <p className="text-gray-500">Chargement...</p> : (
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b">
              <tr>
                <th className="text-left px-4 py-3 font-medium text-gray-500">N Facture</th>
                <th className="text-left px-4 py-3 font-medium text-gray-500">Fournisseur</th>
                <th className="text-left px-4 py-3 font-medium text-gray-500">Categorie</th>
                <th className="text-left px-4 py-3 font-medium text-gray-500">Date</th>
                <th className="text-right px-4 py-3 font-medium text-gray-500">Montant TTC</th>
                <th className="text-right px-4 py-3 font-medium text-gray-500">Paye</th>
                <th className="text-right px-4 py-3 font-medium text-gray-500">Reste</th>
                <th className="text-center px-4 py-3 font-medium text-gray-500">Statut</th>
                <th className="text-center px-4 py-3 font-medium text-gray-500">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {(invoices as Record<string, unknown>[]).map(inv => {
                const total = parseFloat(inv.total_amount as string);
                const paid = parseFloat(inv.paid_amount as string);
                const remaining = total - paid;
                return (
                  <tr key={inv.id as string} className="hover:bg-gray-50">
                    <td className="px-4 py-3 font-mono font-medium">{inv.invoice_number as string}</td>
                    <td className="px-4 py-3">{inv.supplier_name as string}</td>
                    <td className="px-4 py-3 text-gray-500">{inv.category_name as string || '—'}</td>
                    <td className="px-4 py-3 text-gray-500">{format(new Date(inv.invoice_date as string), 'dd/MM/yyyy')}</td>
                    <td className="px-4 py-3 text-right font-semibold">{total.toFixed(2)} DH</td>
                    <td className="px-4 py-3 text-right text-green-600">{paid.toFixed(2)} DH</td>
                    <td className="px-4 py-3 text-right">
                      {remaining > 0 ? <span className="text-red-600 font-semibold">{remaining.toFixed(2)} DH</span> : <span className="text-gray-400">0.00</span>}
                    </td>
                    <td className="px-4 py-3 text-center">
                      <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${INVOICE_STATUS_COLORS[inv.status as string]}`}>
                        {INVOICE_STATUS_LABELS[inv.status as string]}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-center">
                      <div className="flex items-center justify-center gap-1">
                        {inv.status !== 'paid' && inv.status !== 'cancelled' && (
                          <button onClick={() => setShowPayForm(inv)}
                            className="px-2 py-1 rounded text-xs font-medium bg-green-50 text-green-700 hover:bg-green-100">
                            Payer
                          </button>
                        )}
                        {inv.status !== 'cancelled' && inv.status !== 'paid' && (
                          <button onClick={() => cancelMutation.mutate(inv.id as string)}
                            className="p-1.5 hover:bg-red-50 rounded text-red-400 hover:text-red-600">
                            <X size={14} />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {(invoices as Record<string, unknown>[]).length === 0 && <p className="text-center py-8 text-gray-400">Aucune facture</p>}
        </div>
      )}

      {showForm && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl w-full max-w-lg p-6">
            <h2 className="text-xl font-bold mb-4">Nouvelle facture</h2>
            <form onSubmit={e => {
              e.preventDefault();
              const fd = Object.fromEntries(new FormData(e.currentTarget)) as Record<string, unknown>;
              fd.amount = parseFloat(fd.amount as string) || 0;
              fd.taxAmount = parseFloat(fd.taxAmount as string) || 0;
              fd.totalAmount = (fd.amount as number) + (fd.taxAmount as number);
              createMutation.mutate(fd);
            }} className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div><label className="block text-sm font-medium mb-1">N Facture *</label><input name="invoiceNumber" className="input" required /></div>
                <div><label className="block text-sm font-medium mb-1">Date *</label><input name="invoiceDate" type="date" className="input" required defaultValue={format(new Date(), 'yyyy-MM-dd')} /></div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div><label className="block text-sm font-medium mb-1">Fournisseur *</label>
                  <select name="supplierId" className="input" required>
                    <option value="">Choisir...</option>
                    {(suppliers as Record<string, unknown>[]).filter(s => s.is_active).map(s => (
                      <option key={s.id as string} value={s.id as string}>{s.name as string}</option>
                    ))}
                  </select></div>
                <div><label className="block text-sm font-medium mb-1">Categorie</label>
                  <select name="categoryId" className="input">
                    <option value="">Choisir...</option>
                    {(categories as Record<string, unknown>[]).filter(c => c.type === 'expense').map(c => (
                      <option key={c.id as string} value={c.id as string}>{c.name as string}</option>
                    ))}
                  </select></div>
              </div>
              <div className="grid grid-cols-3 gap-4">
                <div><label className="block text-sm font-medium mb-1">Montant HT *</label><input name="amount" type="number" step="0.01" className="input" required /></div>
                <div><label className="block text-sm font-medium mb-1">TVA</label><input name="taxAmount" type="number" step="0.01" defaultValue="0" className="input" /></div>
                <div><label className="block text-sm font-medium mb-1">Echeance</label><input name="dueDate" type="date" className="input" /></div>
              </div>
              <div><label className="block text-sm font-medium mb-1">Notes</label><textarea name="notes" rows={2} className="input" /></div>
              <div className="flex gap-3 justify-end">
                <button type="button" onClick={() => setShowForm(false)} className="btn-secondary">Annuler</button>
                <button type="submit" disabled={createMutation.isPending} className="btn-primary">Enregistrer</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {showPayForm && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl w-full max-w-sm p-6">
            <h2 className="text-lg font-bold mb-2">Payer la facture {showPayForm.invoice_number as string}</h2>
            <p className="text-sm text-gray-500 mb-4">
              Reste a payer: <span className="font-bold text-red-600">
                {(parseFloat(showPayForm.total_amount as string) - parseFloat(showPayForm.paid_amount as string)).toFixed(2)} DH
              </span>
            </p>
            <form onSubmit={e => {
              e.preventDefault();
              const fd = Object.fromEntries(new FormData(e.currentTarget)) as Record<string, unknown>;
              fd.amount = parseFloat(fd.amount as string);
              fd.type = 'invoice';
              fd.invoiceId = showPayForm.id;
              fd.supplierId = showPayForm.supplier_id;
              fd.categoryId = showPayForm.category_id || undefined;
              fd.description = `Paiement facture ${showPayForm.invoice_number}`;
              payMutation.mutate(fd);
            }} className="space-y-4">
              <div><label className="block text-sm font-medium mb-1">Montant *</label>
                <input name="amount" type="number" step="0.01" className="input" required
                  defaultValue={(parseFloat(showPayForm.total_amount as string) - parseFloat(showPayForm.paid_amount as string)).toFixed(2)} /></div>
              <div className="grid grid-cols-2 gap-4">
                <div><label className="block text-sm font-medium mb-1">Methode</label>
                  <select name="paymentMethod" className="input">
                    <option value="cash">Especes</option><option value="bank">Virement</option><option value="check">Cheque</option>
                  </select></div>
                <div><label className="block text-sm font-medium mb-1">Date</label>
                  <input name="paymentDate" type="date" className="input" defaultValue={format(new Date(), 'yyyy-MM-dd')} required /></div>
              </div>
              <div className="flex gap-3 justify-end">
                <button type="button" onClick={() => setShowPayForm(null)} className="btn-secondary">Annuler</button>
                <button type="submit" disabled={payMutation.isPending} className="btn-primary flex items-center gap-2">
                  <Check size={16} /> Payer
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}

/* ═══════════════════════ PAYMENTS TAB ═══════════════════════ */
function PaymentsTab() {
  const queryClient = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [paymentType, setPaymentType] = useState('expense');

  const { data: payments = [], isLoading } = useQuery({
    queryKey: ['payments-all'],
    queryFn: () => paymentsApi.list(),
  });
  const { data: suppliers = [] } = useQuery({ queryKey: ['suppliers'], queryFn: suppliersApi.list });
  const { data: categories = [] } = useQuery({ queryKey: ['expense-categories'], queryFn: expenseCategoriesApi.list });
  const { data: employees = [] } = useQuery({ queryKey: ['employees'], queryFn: employeesApi.list });

  const createMutation = useMutation({
    mutationFn: (data: Record<string, unknown>) => paymentsApi.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['payments'] });
      queryClient.invalidateQueries({ queryKey: ['caisse-register'] });
      toast.success('Paiement enregistre');
      setShowForm(false);
    },
    onError: () => toast.error('Erreur'),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => paymentsApi.remove(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['payments'] });
      queryClient.invalidateQueries({ queryKey: ['caisse-register'] });
      toast.success('Supprime');
    },
  });

  return (
    <>
      <div className="flex justify-end">
        <button onClick={() => setShowForm(true)} className="btn-primary flex items-center gap-2">
          <Plus size={18} /> Nouveau paiement
        </button>
      </div>

      {isLoading ? <p className="text-gray-500">Chargement...</p> : (
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b">
              <tr>
                <th className="text-left px-4 py-3 font-medium text-gray-500">Date</th>
                <th className="text-left px-4 py-3 font-medium text-gray-500">Ref.</th>
                <th className="text-left px-4 py-3 font-medium text-gray-500">Type</th>
                <th className="text-left px-4 py-3 font-medium text-gray-500">Categorie</th>
                <th className="text-left px-4 py-3 font-medium text-gray-500">Beneficiaire</th>
                <th className="text-left px-4 py-3 font-medium text-gray-500">Methode</th>
                <th className="text-right px-4 py-3 font-medium text-gray-500">Montant</th>
                <th className="text-center px-4 py-3 font-medium text-gray-500">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {(payments as Record<string, unknown>[]).map(p => (
                <tr key={p.id as string} className="hover:bg-gray-50">
                  <td className="px-4 py-3 text-gray-500">{format(new Date(p.payment_date as string), 'dd/MM/yyyy')}</td>
                  <td className="px-4 py-3 font-mono text-xs text-gray-400">{p.reference as string || '—'}</td>
                  <td className="px-4 py-3">
                    <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                      p.type === 'income' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'
                    }`}>
                      {PAYMENT_TYPE_LABELS[p.type as string] || p.type}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-gray-500">{p.category_name as string || '—'}</td>
                  <td className="px-4 py-3">
                    {p.supplier_name as string || (p.employee_first_name ? `${p.employee_first_name} ${p.employee_last_name}` : p.description as string || '—')}
                  </td>
                  <td className="px-4 py-3 text-gray-500">{PAYMENT_METHOD_LABELS[p.payment_method as string]}</td>
                  <td className={`px-4 py-3 text-right font-semibold ${p.type === 'income' ? 'text-green-600' : 'text-red-600'}`}>
                    {parseFloat(p.amount as string).toFixed(2)} DH
                  </td>
                  <td className="px-4 py-3 text-center">
                    <button onClick={() => deleteMutation.mutate(p.id as string)}
                      className="p-1.5 hover:bg-red-50 rounded text-red-400 hover:text-red-600">
                      <X size={14} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {(payments as Record<string, unknown>[]).length === 0 && <p className="text-center py-8 text-gray-400">Aucun paiement</p>}
        </div>
      )}

      {showForm && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl w-full max-w-lg p-6">
            <h2 className="text-xl font-bold mb-4">Nouveau paiement</h2>
            <form onSubmit={e => {
              e.preventDefault();
              const fd = Object.fromEntries(new FormData(e.currentTarget)) as Record<string, unknown>;
              fd.amount = parseFloat(fd.amount as string);
              fd.type = paymentType;
              if (!fd.supplierId) delete fd.supplierId;
              if (!fd.employeeId) delete fd.employeeId;
              if (!fd.categoryId) delete fd.categoryId;
              createMutation.mutate(fd);
            }} className="space-y-4">
              <div><label className="block text-sm font-medium mb-1">Type *</label>
                <div className="flex gap-2">
                  {[
                    { value: 'expense', label: 'Depense', color: 'red' },
                    { value: 'salary', label: 'Salaire', color: 'orange' },
                    { value: 'income', label: 'Revenu', color: 'green' },
                  ].map(t => (
                    <button key={t.value} type="button" onClick={() => setPaymentType(t.value)}
                      className={`flex-1 py-2 rounded-lg text-sm font-medium transition-colors ${
                        paymentType === t.value
                          ? t.color === 'red' ? 'bg-red-100 text-red-700 ring-2 ring-red-300'
                            : t.color === 'orange' ? 'bg-orange-100 text-orange-700 ring-2 ring-orange-300'
                            : 'bg-green-100 text-green-700 ring-2 ring-green-300'
                          : 'bg-gray-50 text-gray-500'
                      }`}>
                      {t.label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div><label className="block text-sm font-medium mb-1">Montant *</label><input name="amount" type="number" step="0.01" className="input" required /></div>
                <div><label className="block text-sm font-medium mb-1">Date *</label><input name="paymentDate" type="date" className="input" required defaultValue={format(new Date(), 'yyyy-MM-dd')} /></div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div><label className="block text-sm font-medium mb-1">Methode</label>
                  <select name="paymentMethod" className="input">
                    <option value="cash">Especes</option><option value="bank">Virement</option><option value="check">Cheque</option>
                  </select></div>
                <div><label className="block text-sm font-medium mb-1">Categorie</label>
                  <select name="categoryId" className="input">
                    <option value="">Choisir...</option>
                    {(categories as Record<string, unknown>[])
                      .filter(c => paymentType === 'income' ? c.type === 'income' : c.type === 'expense')
                      .map(c => <option key={c.id as string} value={c.id as string}>{c.name as string}</option>)}
                  </select></div>
              </div>

              {paymentType === 'expense' && (
                <div><label className="block text-sm font-medium mb-1">Fournisseur</label>
                  <select name="supplierId" className="input">
                    <option value="">Aucun</option>
                    {(suppliers as Record<string, unknown>[]).filter(s => s.is_active).map(s => (
                      <option key={s.id as string} value={s.id as string}>{s.name as string}</option>
                    ))}
                  </select></div>
              )}

              {paymentType === 'salary' && (
                <div><label className="block text-sm font-medium mb-1">Employe</label>
                  <select name="employeeId" className="input">
                    <option value="">Choisir...</option>
                    {(employees as Record<string, unknown>[]).filter(e => e.is_active).map(e => (
                      <option key={e.id as string} value={e.id as string}>{e.first_name as string} {e.last_name as string}</option>
                    ))}
                  </select></div>
              )}

              <div><label className="block text-sm font-medium mb-1">Reference</label><input name="reference" className="input" /></div>
              <div><label className="block text-sm font-medium mb-1">Description</label><textarea name="description" rows={2} className="input" /></div>

              <div className="flex gap-3 justify-end">
                <button type="button" onClick={() => setShowForm(false)} className="btn-secondary">Annuler</button>
                <button type="submit" disabled={createMutation.isPending} className="btn-primary">Enregistrer</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
