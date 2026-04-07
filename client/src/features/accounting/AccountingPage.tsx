import { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { caisseApi, suppliersApi, expenseCategoriesApi, invoicesApi, paymentsApi } from '../../api/accounting.api';
import { purchaseOrdersApi } from '../../api/purchase-orders.api';
import { useAuth } from '../../context/AuthContext';
import { format, getDaysInMonth } from 'date-fns';
import { fr } from 'date-fns/locale';
import {
  Plus, Pencil, Truck, FileText, Banknote, BookOpen, BarChart3,
  X, Check, Download, AlertTriangle, ChevronDown, ChevronRight, Wallet, ClipboardList,
  TrendingDown, Users, ShoppingCart, Receipt, Paperclip, Eye, Trash2, Upload,
} from 'lucide-react';
import toast from 'react-hot-toast';
import PurchaseOrdersTab from './PurchaseOrdersTab';

type AccTab = 'caisse' | 'charges' | 'resume' | 'suppliers' | 'purchase_orders' | 'invoices';

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

function n(v: number) { return v.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
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

  const salesMap = new Map<string, { total: number; count: number; cashSales: number; cardSales: number }>();
  for (const s of rawSales) {
    const d = (s.sale_date as string).slice(0, 10);
    salesMap.set(d, {
      total: parseFloat(s.total_sales as string) || 0,
      count: parseInt(s.sale_count as string) || 0,
      cashSales: parseFloat(s.cash_sales as string) || 0,
      cardSales: parseFloat(s.card_sales as string) || 0,
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
    const daySales = salesMap.get(dateStr) || { total: 0, count: 0, cashSales: 0, cardSales: 0 };

    // Cash systeme = ventes cash reelles (source de verite = table sales)
    const cashSysteme = daySales.cashSales;
    // Carte = ventes carte reelles
    const cardReceipt = daySales.cardSales;
    // Cash caissiere = montant declare physiquement (source = sessions)
    // Si pas de session, on considere que caissiere = systeme
    const hasSession = sessionMap.has(dateStr);
    const cashCaissiere = hasSession ? session.cashCaissiere : cashSysteme;

    let entries = 0, exits = 0;
    let cashEntries = 0, bankEntries = 0, cashExits = 0, bankExits = 0;
    for (const p of dayPayments) {
      const amount = parseFloat(p.amount as string) || 0;
      const isCash = (p.payment_method as string) === 'cash';
      if (p.type === 'income') {
        entries += amount;
        if (isCash) cashEntries += amount; else bankEntries += amount;
      } else {
        exits += amount;
        if (isCash) cashExits += amount; else bankExits += amount;
      }
    }

    cashNet = cashNet + cashEntries + cashCaissiere - cashExits;
    cardCumul = cardCumul + cardReceipt + bankEntries - bankExits;

    if (dayPayments.length > 0 || cashCaissiere > 0 || cardReceipt > 0 || daySales.count > 0) {
      days.push({
        date: dateStr,
        dayNum: day,
        payments: dayPayments,
        entries,
        exits,
        cashCaissiere,
        cashSysteme,
        cardReceipt,
        ecart: cashCaissiere - cashSysteme,
        totalRecettes: cashCaissiere + cardReceipt,
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
  const isManager = user?.role === 'manager';
  const [tab, setTab] = useState<AccTab>(isAdmin || isManager ? 'caisse' : 'suppliers');

  const allTabs: { key: AccTab; label: string; icon: typeof BookOpen; adminOnly?: boolean }[] = [
    { key: 'caisse', label: 'Caisse', icon: Wallet },
    { key: 'charges', label: 'Charges & Depenses', icon: TrendingDown },
    { key: 'resume', label: 'Resume', icon: BarChart3 },
    { key: 'suppliers', label: 'Fournisseurs', icon: Truck },
    { key: 'purchase_orders', label: 'Bons de commande', icon: ClipboardList },
    { key: 'invoices', label: 'Factures', icon: FileText },
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
      {tab === 'charges' && <ChargesTab />}
      {tab === 'resume' && <ResumeTab />}
      {tab === 'suppliers' && <SuppliersTab />}
      {tab === 'purchase_orders' && <PurchaseOrdersTab />}
      {tab === 'invoices' && <InvoicesTab />}
    </div>
  );
}

/* ═══════════════════════ CAISSE TAB ═══════════════════════ */
/* Tresorerie pure : uniquement les entrees + solde cumule */
function CaisseTab() {
  const now = new Date();
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [year, setYear] = useState(now.getFullYear());
  const [expandedDays, setExpandedDays] = useState<Set<number>>(new Set());

  const { data, isLoading } = useQuery({
    queryKey: ['caisse-register', year, month],
    queryFn: () => caisseApi.register(year, month),
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
      totalRecettes: cashCaissiere + cardReceipts + entries,
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
      rows.push([`LE ${dateStr}`, '', '', '']);
      rows.push(['', 'VENTES', `${d.saleCount} ventes`, n(d.totalSales)]);
      rows.push(['', 'CASH CAISSIERE', '', n(d.cashCaissiere)]);
      rows.push(['', 'CASH SYSTEME', '', n(d.cashSysteme)]);
      rows.push(['', 'CARTE', '', n(d.cardReceipt)]);
      if (d.entries > 0) rows.push(['', 'AUTRES ENTREES', '', n(d.entries)]);
      rows.push(['', 'ECART CAISSE', '', n(d.ecart)]);
      rows.push(['', 'SOLDE CUMULE', '', n(d.solde)]);
      rows.push(['', '', '', '']);
    }
    rows.push(['', 'TOTAL RECETTES MOIS', '', n(monthTotals.totalRecettes)]);
    rows.push(['', 'SOLDE FINAL', '', n(monthTotals.solde)]);
    exportCSV(`caisse_${MONTH_NAMES[month - 1]}_${year}.csv`, ['', 'LIBELLE', 'DETAIL', 'MONTANT (DH)'], rows);
  };

  return (
    <>
      {/* Month selector + export */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <select value={month} onChange={e => setMonth(+e.target.value)} className="input w-auto">
            {MONTH_NAMES.map((m, i) => <option key={i} value={i + 1}>{m}</option>)}
          </select>
          <input type="number" value={year} onChange={e => setYear(+e.target.value)} className="input w-24" />
        </div>
        <button onClick={handleExport} className="btn-secondary flex items-center gap-2"><Download size={16} /> Exporter</button>
      </div>

      {/* Report line */}
      {data && (data.previousBalance.cashNet !== 0 || data.previousBalance.cardCumul !== 0) && (
        <div className="bg-amber-50 border border-amber-200 rounded-lg px-4 py-3 flex items-center justify-between">
          <span className="text-amber-800 font-medium text-sm">Report mois precedent</span>
          <div className="flex items-center gap-4 text-sm">
            <span className="text-gray-600">Cash: <span className="font-bold text-amber-900">{n(data.previousBalance.cashNet)} DH</span></span>
            <span className="text-gray-600">Carte: <span className="font-bold text-amber-900">{n(data.previousBalance.cardCumul)} DH</span></span>
            <span className="text-gray-600">Total: <span className="font-bold text-amber-900 text-base">{n(data.previousBalance.cashNet + data.previousBalance.cardCumul)} DH</span></span>
          </div>
        </div>
      )}

      {/* Summary cards — entries only */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="card p-4 border-l-4 border-l-purple-500">
          <p className="text-xs text-gray-500 uppercase tracking-wide">Ventes du mois</p>
          <p className="text-2xl font-bold text-purple-700 mt-1">{n(monthTotals.totalSales)} <span className="text-sm font-normal">DH</span></p>
          <p className="text-xs text-gray-400 mt-1">{monthTotals.saleCount} vente{monthTotals.saleCount > 1 ? 's' : ''}</p>
        </div>
        <div className="card p-4 border-l-4 border-l-green-500">
          <p className="text-xs text-gray-500 uppercase tracking-wide">Recettes encaissees</p>
          <p className="text-2xl font-bold text-green-700 mt-1">{n(monthTotals.totalRecettes)} <span className="text-sm font-normal">DH</span></p>
          <div className="flex gap-3 text-xs text-gray-400 mt-1">
            <span>Cash: {n(monthTotals.cashCaissiere)}</span>
            <span>Carte: {n(monthTotals.cardReceipts)}</span>
            {monthTotals.entries > 0 && <span>Autres: {n(monthTotals.entries)}</span>}
          </div>
        </div>
        <div className="card p-4 border-l-4 border-l-blue-500">
          <p className="text-xs text-gray-500 uppercase tracking-wide">Ecart caisse</p>
          <p className={`text-2xl font-bold mt-1 ${monthTotals.ecart === 0 ? 'text-gray-400' : monthTotals.ecart > 0 ? 'text-green-600' : 'text-red-600'}`}>
            {monthTotals.ecart > 0 ? '+' : ''}{n(monthTotals.ecart)} <span className="text-sm font-normal">DH</span>
          </p>
          <p className="text-xs text-gray-400 mt-1">Caissiere vs Systeme</p>
        </div>
        <div className={`card p-4 border-l-4 ${monthTotals.solde >= 0 ? 'border-l-emerald-500 bg-emerald-50/50' : 'border-l-red-500 bg-red-50/50'}`}>
          <p className="text-xs text-gray-500 uppercase tracking-wide">Solde actuel</p>
          <p className={`text-2xl font-bold mt-1 ${monthTotals.solde >= 0 ? 'text-emerald-700' : 'text-red-700'}`}>{n(monthTotals.solde)} <span className="text-sm font-normal">DH</span></p>
          <div className="flex gap-3 text-xs text-gray-400 mt-1">
            <span>Cash: {n(monthTotals.cashNet)}</span>
            <span>Carte: {n(monthTotals.cardCumul)}</span>
          </div>
        </div>
      </div>

      {/* Ecart caisse alert */}
      {monthTotals.ecart !== 0 && (
        <div className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm ${monthTotals.ecart > 0 ? 'bg-green-50 border border-green-200 text-green-800' : 'bg-red-50 border border-red-200 text-red-800'}`}>
          <AlertTriangle size={16} />
          <span>Ecart caisse du mois : <span className="font-bold">{monthTotals.ecart > 0 ? '+' : ''}{n(monthTotals.ecart)} DH</span> (Cash caissiere vs Cash systeme)</span>
        </div>
      )}

      {/* Daily sections — entries only */}
      {isLoading ? <p className="text-gray-500">Chargement...</p> : days.length === 0 ? (
        <p className="text-center py-8 text-gray-400">Aucune activite pour ce mois</p>
      ) : (
        <div className="space-y-2">
          {days.map(day => {
            const expanded = expandedDays.has(day.dayNum);
            const dateLabel = format(parseLocalDate(day.date), 'EEEE dd MMMM yyyy', { locale: fr });
            const dayRecettes = day.cashCaissiere + day.cardReceipt + day.entries;
            return (
              <div key={day.dayNum} className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
                {/* Day header */}
                <button onClick={() => toggleDay(day.dayNum)}
                  className="w-full flex items-center justify-between px-4 py-3 hover:bg-gray-50 transition-colors">
                  <div className="flex items-center gap-3">
                    {expanded ? <ChevronDown size={16} className="text-gray-400" /> : <ChevronRight size={16} className="text-gray-400" />}
                    <span className="font-semibold text-gray-800 capitalize">{dateLabel}</span>
                  </div>
                  <div className="flex items-center gap-4 text-xs">
                    {day.totalSales > 0 && <span className="bg-purple-50 text-purple-700 px-2 py-1 rounded font-medium">{day.saleCount} vente{day.saleCount > 1 ? 's' : ''}</span>}
                    {dayRecettes > 0 && <span className="bg-green-50 text-green-700 px-2 py-1 rounded font-medium">+{n(dayRecettes)}</span>}
                    <span className={`px-2 py-1 rounded font-bold ${day.solde >= 0 ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-700'}`}>{n(day.solde)}</span>
                  </div>
                </button>

                {/* Expanded day detail — entries only */}
                {expanded && (
                  <div className="border-t border-gray-100 px-4 py-3 space-y-3">
                    {/* Ventes */}
                    {day.totalSales > 0 && (
                      <div className="bg-purple-50 rounded-lg p-3">
                        <div className="flex items-center justify-between">
                          <span className="text-sm font-medium text-purple-800">Ventes du jour ({day.saleCount})</span>
                          <span className="font-bold text-purple-700">{n(day.totalSales)} DH</span>
                        </div>
                      </div>
                    )}

                    {/* Recettes caisse */}
                    {(day.cashCaissiere > 0 || day.cardReceipt > 0) && (
                      <div className="bg-green-50 rounded-lg p-3 space-y-2">
                        <p className="text-xs font-medium text-green-700 uppercase tracking-wide">Recettes encaissees</p>
                        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
                          <div className="flex justify-between">
                            <span className="text-gray-600">Cash systeme</span>
                            <span className="font-medium">{n(day.cashSysteme)} DH</span>
                          </div>
                          <div className="flex justify-between">
                            <span className="text-gray-600">Cash caissiere</span>
                            <span className="font-medium text-green-700">{n(day.cashCaissiere)} DH</span>
                          </div>
                          <div className="flex justify-between">
                            <span className="text-gray-600">Carte</span>
                            <span className="font-medium text-blue-600">{n(day.cardReceipt)} DH</span>
                          </div>
                          <div className="flex justify-between">
                            <span className="text-gray-600">Ecart</span>
                            <span className={`font-medium ${day.ecart === 0 ? 'text-gray-400' : day.ecart > 0 ? 'text-green-600' : 'text-red-600'}`}>
                              {day.ecart > 0 ? '+' : ''}{n(day.ecart)} DH
                            </span>
                          </div>
                        </div>
                      </div>
                    )}

                    {/* Autres entrees (type income) */}
                    {day.entries > 0 && (
                      <div className="bg-blue-50 rounded-lg p-3">
                        <p className="text-xs font-medium text-blue-700 uppercase tracking-wide mb-2">Autres entrees</p>
                        {day.payments.filter(p => p.type === 'income').map((p, idx) => {
                          const amount = parseFloat(p.amount as string) || 0;
                          return (
                            <div key={idx} className="flex items-center justify-between text-sm py-1">
                              <span className="text-gray-600">{(p.description as string) || (p.category_name as string) || 'Revenu'}</span>
                              <span className="font-medium text-green-600">+{n(amount)} DH</span>
                            </div>
                          );
                        })}
                      </div>
                    )}

                    {/* Solde cumule */}
                    <div className={`rounded-lg p-3 ${day.solde >= 0 ? 'bg-emerald-50' : 'bg-red-50'}`}>
                      <p className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-2">Solde cumule</p>
                      <div className="grid grid-cols-3 gap-2 text-sm">
                        <div className="text-center">
                          <p className="text-xs text-gray-500">Cash</p>
                          <p className="font-bold text-gray-700">{n(day.cashNetCumul)} DH</p>
                        </div>
                        <div className="text-center">
                          <p className="text-xs text-gray-500">Carte</p>
                          <p className="font-bold text-gray-700">{n(day.cardCumul)} DH</p>
                        </div>
                        <div className="text-center">
                          <p className="text-xs text-gray-500">Total</p>
                          <p className={`font-bold text-lg ${day.solde >= 0 ? 'text-emerald-700' : 'text-red-700'}`}>{n(day.solde)} DH</p>
                        </div>
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
        <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
          <div className="bg-bakery-chocolate px-4 py-3">
            <h3 className="font-bold text-white">Recap {MONTH_NAMES[month - 1]} {year}</h3>
          </div>
          <div className="p-4">
            <table className="w-full text-sm">
              <tbody className="divide-y divide-gray-100">
                <tr>
                  <td className="py-2 text-gray-500">Total Ventes ({monthTotals.saleCount})</td>
                  <td className="py-2 text-right font-bold text-purple-700">{n(monthTotals.totalSales)} DH</td>
                </tr>
                <tr>
                  <td className="py-2 text-gray-500">Cash Caissiere</td>
                  <td className="py-2 text-right font-bold text-green-700">{n(monthTotals.cashCaissiere)} DH</td>
                </tr>
                <tr>
                  <td className="py-2 text-gray-500">Carte Encaissee</td>
                  <td className="py-2 text-right font-bold text-blue-700">{n(monthTotals.cardReceipts)} DH</td>
                </tr>
                {monthTotals.entries > 0 && (
                  <tr>
                    <td className="py-2 text-gray-500">Autres Entrees</td>
                    <td className="py-2 text-right font-bold text-green-700">{n(monthTotals.entries)} DH</td>
                  </tr>
                )}
                <tr>
                  <td className="py-2 text-gray-500 font-medium">Total Recettes</td>
                  <td className="py-2 text-right font-bold text-green-700 text-base">{n(monthTotals.totalRecettes)} DH</td>
                </tr>
                {monthTotals.ecart !== 0 && (
                  <tr>
                    <td className="py-2 text-gray-500">Ecart Caisse</td>
                    <td className={`py-2 text-right font-bold ${monthTotals.ecart > 0 ? 'text-green-600' : 'text-red-600'}`}>{monthTotals.ecart > 0 ? '+' : ''}{n(monthTotals.ecart)} DH</td>
                  </tr>
                )}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-gray-300">
                  <td className="py-3 font-bold text-gray-800 text-base">Solde Final</td>
                  <td className={`py-3 text-right font-bold text-xl ${monthTotals.solde >= 0 ? 'text-emerald-700' : 'text-red-700'}`}>{n(monthTotals.solde)} DH</td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
      )}
    </>
  );
}

/* ═══════════════════════ CHARGES & DEPENSES TAB ═══════════════════════ */
/* Tout ce qui sort : achats fournisseurs, salaires, depenses diverses */
function ChargesTab() {
  const queryClient = useQueryClient();
  const now = new Date();
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [year, setYear] = useState(now.getFullYear());
  const [showForm, setShowForm] = useState(false);
  const [editingPayment, setEditingPayment] = useState<Record<string, unknown> | null>(null);
  const [typeFilter, setTypeFilter] = useState<string>('all');
  const [categoryFilter, setCategoryFilter] = useState<string>('all');

  const dateFrom = `${year}-${String(month).padStart(2, '0')}-01`;
  const lastDay = new Date(year, month, 0).getDate();
  const dateTo = `${year}-${String(month).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;

  const { data: payments = [], isLoading } = useQuery({
    queryKey: ['payments-charges', year, month],
    queryFn: () => paymentsApi.list({ dateFrom, dateTo }),
  });
  const { data: suppliers = [] } = useQuery({ queryKey: ['suppliers'], queryFn: suppliersApi.list });
  const { data: categories = [] } = useQuery({ queryKey: ['expense-categories'], queryFn: expenseCategoriesApi.list });
  const { data: eligiblePOs = [] } = useQuery({ queryKey: ['eligible-pos'], queryFn: purchaseOrdersApi.eligible });

  // Form state for new expense
  const [formCategoryId, setFormCategoryId] = useState<string>('');
  const [formPOId, setFormPOId] = useState<string>('');

  // Check if selected category requires a PO
  const selectedCategory = (categories as Record<string, unknown>[]).find(c => c.id === formCategoryId);
  const requiresPO = selectedCategory ? (selectedCategory.requires_po as boolean) : false;

  // Auto-fill from selected PO
  const selectedPO = (eligiblePOs as Record<string, unknown>[]).find(po => po.id === formPOId);

  const createMutation = useMutation({
    mutationFn: (data: Record<string, unknown>) => paymentsApi.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['payments-charges'] });
      queryClient.invalidateQueries({ queryKey: ['caisse-register'] });
      toast.success('Depense enregistree');
      setShowForm(false);
      setFormCategoryId('');
      setFormPOId('');
    },
    onError: () => toast.error('Erreur'),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Record<string, unknown> }) => paymentsApi.update(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['payments-charges'] });
      queryClient.invalidateQueries({ queryKey: ['caisse-register'] });
      toast.success('Modifie avec succes');
      setEditingPayment(null);
    },
    onError: () => toast.error('Erreur lors de la modification'),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => paymentsApi.remove(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['payments-charges'] });
      queryClient.invalidateQueries({ queryKey: ['caisse-register'] });
      toast.success('Supprime');
    },
  });

  // Only outgoing payments (not income)
  const outgoing = (payments as Record<string, unknown>[]).filter(p => p.type !== 'income');

  // Group by type
  const invoicePayments = outgoing.filter(p => p.type === 'invoice');
  const salaryPayments = outgoing.filter(p => p.type === 'salary');
  const expensePayments = outgoing.filter(p => p.type === 'expense');

  const totals = useMemo(() => {
    const invoiceTotal = invoicePayments.reduce((s, p) => s + (parseFloat(p.amount as string) || 0), 0);
    const salaryTotal = salaryPayments.reduce((s, p) => s + (parseFloat(p.amount as string) || 0), 0);
    const expenseTotal = expensePayments.reduce((s, p) => s + (parseFloat(p.amount as string) || 0), 0);
    return { invoiceTotal, salaryTotal, expenseTotal, total: invoiceTotal + salaryTotal + expenseTotal };
  }, [invoicePayments, salaryPayments, expensePayments]);

  // Filter displayed payments
  const typeFiltered = typeFilter === 'all' ? outgoing
    : typeFilter === 'invoice' ? invoicePayments
    : typeFilter === 'salary' ? salaryPayments
    : expensePayments;
  const displayed = categoryFilter === 'all' ? typeFiltered
    : typeFiltered.filter(p => (p.category_name as string || '') === categoryFilter);

  // Unique categories from current type-filtered list for the dropdown
  const availableCategories = useMemo(() => {
    const cats = new Set<string>();
    typeFiltered.forEach(p => { if (p.category_name) cats.add(p.category_name as string); });
    return Array.from(cats).sort();
  }, [typeFiltered]);

  const handleExport = () => {
    const rows = displayed.map(p => [
      format(new Date(p.payment_date as string), 'dd/MM/yyyy'),
      (p.reference as string) || '',
      PAYMENT_TYPE_LABELS[p.type as string] || '',
      (p.category_name as string) || '',
      (p.supplier_name as string) || (p.employee_first_name ? `${p.employee_first_name} ${p.employee_last_name}` : ''),
      PAYMENT_METHOD_LABELS[p.payment_method as string] || '',
      (p.description as string) || '',
      n(parseFloat(p.amount as string) || 0),
    ]);
    exportCSV(`charges_${MONTH_NAMES[month - 1]}_${year}.csv`,
      ['DATE', 'REF', 'TYPE', 'CATEGORIE', 'BENEFICIAIRE', 'METHODE', 'DESCRIPTION', 'MONTANT (DH)'], rows);
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
          <button onClick={() => setShowForm(true)} className="btn-primary flex items-center gap-2"><Plus size={18} /> Nouvelle depense</button>
        </div>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="card p-4 border-l-4 border-l-red-500">
          <p className="text-xs text-gray-500 uppercase tracking-wide">Total sorties</p>
          <p className="text-2xl font-bold text-red-700 mt-1">{n(totals.total)} <span className="text-sm font-normal">DH</span></p>
          <p className="text-xs text-gray-400 mt-1">{outgoing.length} operation{outgoing.length > 1 ? 's' : ''}</p>
        </div>
        <div className="card p-4 border-l-4 border-l-orange-500">
          <div className="flex items-center gap-2">
            <ShoppingCart size={14} className="text-orange-500" />
            <p className="text-xs text-gray-500 uppercase tracking-wide">Achats fournisseurs</p>
          </div>
          <p className="text-2xl font-bold text-orange-700 mt-1">{n(totals.invoiceTotal)} <span className="text-sm font-normal">DH</span></p>
          <p className="text-xs text-gray-400 mt-1">{invoicePayments.length} facture{invoicePayments.length > 1 ? 's' : ''}</p>
        </div>
        <div className="card p-4 border-l-4 border-l-purple-500">
          <div className="flex items-center gap-2">
            <Users size={14} className="text-purple-500" />
            <p className="text-xs text-gray-500 uppercase tracking-wide">Salaires</p>
          </div>
          <p className="text-2xl font-bold text-purple-700 mt-1">{n(totals.salaryTotal)} <span className="text-sm font-normal">DH</span></p>
          <p className="text-xs text-gray-400 mt-1">{salaryPayments.length} employe{salaryPayments.length > 1 ? 's' : ''}</p>
        </div>
        <div className="card p-4 border-l-4 border-l-gray-500">
          <div className="flex items-center gap-2">
            <Receipt size={14} className="text-gray-500" />
            <p className="text-xs text-gray-500 uppercase tracking-wide">Autres depenses</p>
          </div>
          <p className="text-2xl font-bold text-gray-700 mt-1">{n(totals.expenseTotal)} <span className="text-sm font-normal">DH</span></p>
          <p className="text-xs text-gray-400 mt-1">{expensePayments.length} depense{expensePayments.length > 1 ? 's' : ''}</p>
        </div>
      </div>

      {/* Filter tabs */}
      <div className="flex flex-wrap items-center gap-2">
        {[
          { key: 'all', label: 'Tout', count: outgoing.length },
          { key: 'invoice', label: 'Achats', count: invoicePayments.length },
          { key: 'salary', label: 'Salaires', count: salaryPayments.length },
          { key: 'expense', label: 'Depenses', count: expensePayments.length },
        ].map(f => (
          <button key={f.key} onClick={() => { setTypeFilter(f.key); setCategoryFilter('all'); }}
            className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
              typeFilter === f.key ? 'bg-red-100 text-red-700 ring-1 ring-red-300' : 'bg-gray-50 text-gray-500 hover:bg-gray-100'
            }`}>
            {f.label} {f.count > 0 && <span className="ml-1 text-xs opacity-60">({f.count})</span>}
          </button>
        ))}
        {availableCategories.length > 1 && (
          <select value={categoryFilter} onChange={e => setCategoryFilter(e.target.value)}
            className="input w-auto text-sm ml-auto">
            <option value="all">Toutes categories ({typeFiltered.length})</option>
            {availableCategories.map(c => (
              <option key={c} value={c}>{c} ({typeFiltered.filter(p => (p.category_name as string) === c).length})</option>
            ))}
          </select>
        )}
      </div>

      {/* Table */}
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
                <th className="text-left px-4 py-3 font-medium text-gray-500">BC</th>
                <th className="text-left px-4 py-3 font-medium text-gray-500">Methode</th>
                <th className="text-right px-4 py-3 font-medium text-gray-500">Montant</th>
                <th className="text-center px-4 py-3 font-medium text-gray-500">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {displayed.map(p => {
                const typeColor = p.type === 'invoice' ? 'bg-orange-100 text-orange-700'
                  : p.type === 'salary' ? 'bg-purple-100 text-purple-700'
                  : 'bg-gray-100 text-gray-700';
                return (
                  <tr key={p.id as string} className="hover:bg-gray-50">
                    <td className="px-4 py-3 text-gray-500">{format(new Date(p.payment_date as string), 'dd/MM/yyyy')}</td>
                    <td className="px-4 py-3 font-mono text-xs text-gray-400">{p.reference as string || '—'}</td>
                    <td className="px-4 py-3">
                      <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${typeColor}`}>
                        {PAYMENT_TYPE_LABELS[p.type as string] || p.type}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-gray-500">{p.category_name as string || '—'}</td>
                    <td className="px-4 py-3 font-medium text-gray-700">
                      {p.supplier_name as string || (p.employee_first_name ? `${p.employee_first_name} ${p.employee_last_name}` : p.description as string || '—')}
                    </td>
                    <td className="px-4 py-3">
                      {p.purchase_order_number ? (
                        <span className="px-2 py-0.5 rounded bg-blue-50 text-blue-700 text-xs font-mono">{p.purchase_order_number as string}</span>
                      ) : <span className="text-gray-300">—</span>}
                    </td>
                    <td className="px-4 py-3 text-gray-500">{PAYMENT_METHOD_LABELS[p.payment_method as string]}</td>
                    <td className="px-4 py-3 text-right font-semibold text-red-600">{n(parseFloat(p.amount as string))} DH</td>
                    <td className="px-4 py-3 text-center">
                      {p.type !== 'salary' ? (
                        <div className="flex items-center justify-center gap-1">
                          <button onClick={() => setEditingPayment(p)}
                            className="p-1.5 hover:bg-blue-50 rounded text-blue-400 hover:text-blue-600">
                            <Pencil size={14} />
                          </button>
                          <button onClick={() => deleteMutation.mutate(p.id as string)}
                            className="p-1.5 hover:bg-red-50 rounded text-red-400 hover:text-red-600">
                            <X size={14} />
                          </button>
                        </div>
                      ) : <span className="text-xs text-gray-300">auto</span>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
            {displayed.length > 0 && (
              <tfoot className="bg-gray-50 border-t font-semibold">
                <tr>
                  <td colSpan={7} className="px-4 py-3 text-gray-600">TOTAL</td>
                  <td className="px-4 py-3 text-right text-red-700">{n(displayed.reduce((s, p) => s + (parseFloat(p.amount as string) || 0), 0))} DH</td>
                  <td></td>
                </tr>
              </tfoot>
            )}
          </table>
          {displayed.length === 0 && <p className="text-center py-8 text-gray-400">Aucune sortie pour cette periode</p>}
        </div>
      )}

      {/* Add expense modal */}
      {showForm && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl w-full max-w-lg p-6">
            <h2 className="text-xl font-bold mb-4">Nouvelle depense</h2>
            <form onSubmit={e => {
              e.preventDefault();
              const fd = Object.fromEntries(new FormData(e.currentTarget)) as Record<string, unknown>;
              fd.amount = parseFloat(fd.amount as string);
              fd.type = 'expense';
              fd.categoryId = formCategoryId || undefined;
              if (requiresPO && formPOId) {
                fd.purchaseOrderId = formPOId;
                if (selectedPO) fd.supplierId = selectedPO.supplier_id as string;
              }
              if (!fd.supplierId) delete fd.supplierId;
              if (!fd.categoryId) { toast.error('Veuillez selectionner une categorie'); return; }
              if (requiresPO && !formPOId) { toast.error('Cette categorie necessite un bon de commande'); return; }
              createMutation.mutate(fd);
            }} className="space-y-4">
              {/* Categorie en premier - determine si BC requis */}
              <div>
                <label className="block text-sm font-medium mb-1">Categorie *</label>
                <select value={formCategoryId} onChange={e => { setFormCategoryId(e.target.value); setFormPOId(''); }}
                  className="input" required>
                  <option value="">Choisir une categorie...</option>
                  {(categories as Record<string, unknown>[])
                    .filter(c => c.type === 'expense')
                    .map(c => (
                      <option key={c.id as string} value={c.id as string}>
                        {c.name as string} {(c.requires_po as boolean) ? '(BC requis)' : ''}
                      </option>
                    ))}
                </select>
              </div>

              {/* Bon de commande - affiché uniquement si la catégorie l'exige */}
              {requiresPO && (
                <div className="bg-amber-50 border border-amber-200 rounded-lg p-3">
                  <label className="block text-sm font-medium mb-1 text-amber-800">
                    <ClipboardList size={14} className="inline mr-1" /> Bon de commande *
                  </label>
                  <select value={formPOId} onChange={e => setFormPOId(e.target.value)}
                    className="input" required>
                    <option value="">Selectionner un BC...</option>
                    {(eligiblePOs as Record<string, unknown>[]).map(po => (
                      <option key={po.id as string} value={po.id as string}>
                        {po.order_number as string} — {po.supplier_name as string} — {n(parseFloat(po.total_amount as string) || 0)} DH
                      </option>
                    ))}
                  </select>
                  {selectedPO && (
                    <p className="text-xs text-amber-700 mt-1">
                      Fournisseur: <strong>{selectedPO.supplier_name as string}</strong> | Montant BC: <strong>{n(parseFloat(selectedPO.total_amount as string) || 0)} DH</strong>
                    </p>
                  )}
                  {(eligiblePOs as Record<string, unknown>[]).length === 0 && (
                    <p className="text-xs text-red-600 mt-1">
                      Aucun bon de commande disponible. Creez d'abord un BC dans l'onglet Bons de commande.
                    </p>
                  )}
                </div>
              )}

              <div className="grid grid-cols-2 gap-4">
                <div><label className="block text-sm font-medium mb-1">Montant *</label>
                  <input name="amount" type="number" step="0.01" className="input" required
                    defaultValue={selectedPO ? parseFloat(selectedPO.total_amount as string) || '' : ''} key={formPOId} /></div>
                <div><label className="block text-sm font-medium mb-1">Date *</label>
                  <input name="paymentDate" type="date" className="input" required defaultValue={format(new Date(), 'yyyy-MM-dd')} /></div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div><label className="block text-sm font-medium mb-1">Methode</label>
                  <select name="paymentMethod" className="input">
                    <option value="cash">Especes</option><option value="bank">Virement</option><option value="check">Cheque</option>
                  </select></div>
                {!requiresPO && (
                  <div><label className="block text-sm font-medium mb-1">Fournisseur</label>
                    <select name="supplierId" className="input">
                      <option value="">Aucun</option>
                      {(suppliers as Record<string, unknown>[]).filter(s => s.is_active).map(s => (
                        <option key={s.id as string} value={s.id as string}>{s.name as string}</option>
                      ))}
                    </select></div>
                )}
              </div>

              <div><label className="block text-sm font-medium mb-1">Description</label><textarea name="description" rows={2} className="input" /></div>

              <div className="flex gap-3 justify-end">
                <button type="button" onClick={() => { setShowForm(false); setFormCategoryId(''); setFormPOId(''); }} className="btn-secondary">Annuler</button>
                <button type="submit" disabled={createMutation.isPending} className="btn-primary">Enregistrer</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Edit expense modal */}
      {editingPayment && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl w-full max-w-lg p-6">
            <h2 className="text-xl font-bold mb-4">Modifier la depense</h2>
            <form onSubmit={e => {
              e.preventDefault();
              const fd = Object.fromEntries(new FormData(e.currentTarget)) as Record<string, unknown>;
              fd.amount = parseFloat(fd.amount as string);
              if (!fd.categoryId) fd.categoryId = null;
              updateMutation.mutate({ id: editingPayment.id as string, data: fd });
            }} className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div><label className="block text-sm font-medium mb-1">Montant *</label>
                  <input name="amount" type="number" step="0.01" className="input" required
                    defaultValue={parseFloat(editingPayment.amount as string) || 0} /></div>
                <div><label className="block text-sm font-medium mb-1">Date *</label>
                  <input name="paymentDate" type="date" className="input" required
                    defaultValue={format(new Date(editingPayment.payment_date as string), 'yyyy-MM-dd')} /></div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div><label className="block text-sm font-medium mb-1">Methode</label>
                  <select name="paymentMethod" className="input" defaultValue={editingPayment.payment_method as string || 'cash'}>
                    <option value="cash">Especes</option><option value="bank">Virement</option><option value="check">Cheque</option>
                  </select></div>
                <div><label className="block text-sm font-medium mb-1">Categorie</label>
                  <select name="categoryId" className="input" defaultValue={editingPayment.category_id as string || ''}>
                    <option value="">Choisir...</option>
                    {(categories as Record<string, unknown>[])
                      .filter(c => c.type === 'expense')
                      .map(c => <option key={c.id as string} value={c.id as string}>{c.name as string}</option>)}
                  </select></div>
              </div>

              <div><label className="block text-sm font-medium mb-1">Description</label>
                <textarea name="description" rows={2} className="input"
                  defaultValue={editingPayment.description as string || ''} /></div>

              <div className="flex gap-3 justify-end">
                <button type="button" onClick={() => setEditingPayment(null)} className="btn-secondary">Annuler</button>
                <button type="submit" disabled={updateMutation.isPending} className="btn-primary">Enregistrer</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}

/* ═══════════════════════ RESUME TAB ═══════════════════════ */
/* Vue consolidee : entrees vs sorties avec resultat net */
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
    const totalEntrees = cashR + cardR + entries;
    const resultat = totalEntrees - exits;
    return { entries, exits, cashR, cardR, sales, salesCount, recettes: cashR + cardR, totalEntrees, resultat, cashNet: last?.cashNetCumul || 0, cardCumul: last?.cardCumul || 0, solde: last?.solde || 0 };
  }, [days, allDays]);

  const handleExport = () => {
    exportCSV(`resume_${MONTH_NAMES[month - 1]}_${year}.csv`,
      ['DATE', 'VENTES', 'ENTREES', 'SORTIES', 'CASH', 'CARTE', 'SOLDE'],
      allDays.filter(d => d !== null).map(d => [
        format(parseLocalDate(d!.date), 'dd/MM/yyyy'),
        n(d!.totalSales), n(d!.cashCaissiere + d!.cardReceipt + d!.entries), n(d!.exits),
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

      {/* Summary: Entrees vs Sorties = Resultat */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="card p-5 border-l-4 border-l-green-500">
          <p className="text-xs text-gray-500 uppercase tracking-wide">Total entrees</p>
          <p className="text-2xl font-bold text-green-700 mt-1">{n(totals.totalEntrees)} <span className="text-sm font-normal">DH</span></p>
          <div className="flex gap-3 text-xs text-gray-400 mt-2">
            <span>Cash: {n(totals.cashR)}</span>
            <span>Carte: {n(totals.cardR)}</span>
            {totals.entries > 0 && <span>Autres: {n(totals.entries)}</span>}
          </div>
        </div>
        <div className="card p-5 border-l-4 border-l-red-500">
          <p className="text-xs text-gray-500 uppercase tracking-wide">Total sorties</p>
          <p className="text-2xl font-bold text-red-700 mt-1">{n(totals.exits)} <span className="text-sm font-normal">DH</span></p>
          <p className="text-xs text-gray-400 mt-2">Achats + Salaires + Depenses</p>
        </div>
        <div className={`card p-5 border-l-4 ${totals.resultat >= 0 ? 'border-l-emerald-500 bg-emerald-50/50' : 'border-l-red-500 bg-red-50/50'}`}>
          <p className="text-xs text-gray-500 uppercase tracking-wide">Resultat net du mois</p>
          <p className={`text-2xl font-bold mt-1 ${totals.resultat >= 0 ? 'text-emerald-700' : 'text-red-700'}`}>
            {totals.resultat >= 0 ? '+' : ''}{n(totals.resultat)} <span className="text-sm font-normal">DH</span>
          </p>
          <p className="text-xs text-gray-400 mt-2">Entrees - Sorties</p>
        </div>
      </div>

      {/* Solde cumule */}
      <div className={`rounded-xl p-4 ${totals.solde >= 0 ? 'bg-emerald-50 border border-emerald-200' : 'bg-red-50 border border-red-200'}`}>
        <div className="flex items-center justify-between">
          <span className="font-medium text-gray-700">Solde cumule (depuis le debut)</span>
          <div className="flex items-center gap-6">
            <span className="text-sm text-gray-500">Cash: <span className="font-bold text-gray-700">{n(totals.cashNet)} DH</span></span>
            <span className="text-sm text-gray-500">Carte: <span className="font-bold text-gray-700">{n(totals.cardCumul)} DH</span></span>
            <span className={`font-bold text-xl ${totals.solde >= 0 ? 'text-emerald-700' : 'text-red-700'}`}>{n(totals.solde)} DH</span>
          </div>
        </div>
      </div>

      {/* Daily grid */}
      {isLoading ? <p className="text-gray-500">Chargement...</p> : (
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b">
              <tr>
                <th className="text-left px-3 py-3 font-medium text-gray-500">Date</th>
                <th className="text-right px-3 py-3 font-medium text-purple-600">Ventes</th>
                <th className="text-right px-3 py-3 font-medium text-green-600">Entrees</th>
                <th className="text-right px-3 py-3 font-medium text-red-600">Sorties</th>
                <th className="text-right px-3 py-3 font-medium text-gray-700 bg-green-50">Cash</th>
                <th className="text-right px-3 py-3 font-medium text-gray-700 bg-blue-50">Carte</th>
                <th className="text-right px-3 py-3 font-bold text-gray-800 bg-yellow-50">Solde</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {allDays.map(d => {
                if (!d) return null;
                const dayEntrees = d.cashCaissiere + d.cardReceipt + d.entries;
                const hasActivity = dayEntrees > 0 || d.exits > 0;
                return (
                  <tr key={d.dayNum} className={hasActivity ? 'hover:bg-gray-50' : 'text-gray-300'}>
                    <td className="px-3 py-2 font-medium">{format(parseLocalDate(d.date), 'dd/MM EEE', { locale: fr })}</td>
                    <td className="px-3 py-2 text-right">{d.totalSales > 0 ? <span className="text-purple-600 font-medium">{n(d.totalSales)}</span> : '—'}</td>
                    <td className="px-3 py-2 text-right">{dayEntrees > 0 ? <span className="text-green-600 font-medium">{n(dayEntrees)}</span> : '—'}</td>
                    <td className="px-3 py-2 text-right">{d.exits > 0 ? <span className="text-red-600 font-medium">{n(d.exits)}</span> : '—'}</td>
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
                <td className="px-3 py-3 text-right text-green-700">{n(totals.totalEntrees)}</td>
                <td className="px-3 py-3 text-right text-red-700">{n(totals.exits)}</td>
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
      queryClient.invalidateQueries({ queryKey: ['payments-charges'] });
      queryClient.invalidateQueries({ queryKey: ['caisse-register'] });
      toast.success('Paiement enregistre');
      setShowPayForm(null);
    },
    onError: () => toast.error('Erreur'),
  });

  const attachMutation = useMutation({
    mutationFn: ({ id, file }: { id: string; file: File }) => invoicesApi.uploadAttachment(id, file),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['invoices'] });
      toast.success('Facture jointe avec succes');
    },
    onError: () => toast.error('Erreur lors de l\'envoi du fichier'),
  });

  const removeAttachMutation = useMutation({
    mutationFn: (id: string) => invoicesApi.removeAttachment(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['invoices'] });
      toast.success('Piece jointe supprimee');
    },
  });

  const handleAttachFile = (invoiceId: string) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.pdf,.png,.jpg,.jpeg,.webp';
    input.onchange = (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (file) attachMutation.mutate({ id: invoiceId, file });
    };
    input.click();
  };

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
              <AlertTriangle size={14} /> Reste a payer: <span className="font-bold">{n(totalPending)} DH</span>
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
                <th className="text-center px-4 py-3 font-medium text-gray-500">Piece jointe</th>
                <th className="text-center px-4 py-3 font-medium text-gray-500">Statut</th>
                <th className="text-center px-4 py-3 font-medium text-gray-500">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {(invoices as Record<string, unknown>[]).map(inv => {
                const total = parseFloat(inv.total_amount as string);
                const paid = parseFloat(inv.paid_amount as string);
                const remaining = total - paid;
                const hasAttachment = !!(inv.attachment_url as string);
                return (
                  <tr key={inv.id as string} className="hover:bg-gray-50">
                    <td className="px-4 py-3 font-mono font-medium">{inv.invoice_number as string}</td>
                    <td className="px-4 py-3">{inv.supplier_name as string}</td>
                    <td className="px-4 py-3 text-gray-500">{inv.category_name as string || '—'}</td>
                    <td className="px-4 py-3 text-gray-500">{format(new Date(inv.invoice_date as string), 'dd/MM/yyyy')}</td>
                    <td className="px-4 py-3 text-right font-semibold">{n(total)} DH</td>
                    <td className="px-4 py-3 text-right text-green-600">{n(paid)} DH</td>
                    <td className="px-4 py-3 text-right">
                      {remaining > 0 ? <span className="text-red-600 font-semibold">{n(remaining)} DH</span> : <span className="text-gray-400">0,00</span>}
                    </td>
                    <td className="px-4 py-3 text-center">
                      {hasAttachment ? (
                        <div className="flex items-center justify-center gap-1">
                          <a href={inv.attachment_url as string} target="_blank" rel="noopener noreferrer"
                            className="p-1.5 hover:bg-blue-50 rounded text-blue-500 hover:text-blue-700" title="Voir la facture">
                            <Eye size={14} />
                          </a>
                          <button onClick={() => removeAttachMutation.mutate(inv.id as string)}
                            className="p-1.5 hover:bg-red-50 rounded text-red-400 hover:text-red-600" title="Supprimer la piece jointe">
                            <Trash2 size={14} />
                          </button>
                        </div>
                      ) : (
                        <button onClick={() => handleAttachFile(inv.id as string)}
                          className="p-1.5 hover:bg-gray-100 rounded text-gray-400 hover:text-gray-600" title="Joindre une facture">
                          <Paperclip size={14} />
                        </button>
                      )}
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
                {n(parseFloat(showPayForm.total_amount as string) - parseFloat(showPayForm.paid_amount as string))} DH
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
