import { useState, useEffect, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { caisseApi, suppliersApi, expenseCategoriesApi, paymentsApi } from '../../api/accounting.api';
import { purchaseOrdersApi } from '../../api/purchase-orders.api';
import { useAuth } from '../../context/AuthContext';
import { format, getDaysInMonth } from 'date-fns';
import { fr } from 'date-fns/locale';
import {
  Plus, Pencil, Banknote, BarChart3,
  X, Check, Download, AlertTriangle, ChevronDown, ChevronRight, Wallet,
  TrendingDown, ClipboardList, ShoppingCart, Receipt, Users,
  Loader2, Calculator, CreditCard, Coins, Scale,
  ArrowUpRight, ArrowDownRight,
} from 'lucide-react';
import toast from 'react-hot-toast';
import LossesTab from './LossesTab';

type AccTab = 'caisse' | 'charges' | 'resume' | 'losses';

const PAYMENT_METHOD_LABELS: Record<string, string> = { cash: 'Espèces', bank: 'Virement', check: 'Chèque', transfer: 'Virement' };
const PAYMENT_TYPE_LABELS: Record<string, string> = { invoice: 'Facture', salary: 'Salaire', expense: 'Dépense', income: 'Revenu' };
const INVOICE_STATUS_LABELS: Record<string, string> = { pending: 'En attente', partial: 'Partiel', paid: 'Payée', overdue: 'En retard', cancelled: 'Annulée' };
const INVOICE_STATUS_COLORS: Record<string, string> = {
  pending: 'bg-yellow-100 text-yellow-700', partial: 'bg-blue-100 text-blue-700',
  paid: 'bg-green-100 text-green-700', overdue: 'bg-red-100 text-red-700', cancelled: 'bg-gray-100 text-gray-500',
};
const MONTH_NAMES = ['Janvier', 'Février', 'Mars', 'Avril', 'Mai', 'Juin', 'Juillet', 'Août', 'Septembre', 'Octobre', 'Novembre', 'Décembre'];

function exportCSV(filename: string, headers: string[], rows: string[][]) {
  const BOM = '\uFEFF';
  const csv = BOM + [headers.join(';'), ...rows.map(r => r.join(';'))].join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  // Compatible web et mobile (Capacitor)
  const a = document.createElement('a');
  a.href = url; a.download = filename; a.target = '_blank'; a.rel = 'noopener';
  document.body.appendChild(a); a.click();
  setTimeout(() => { a.remove(); URL.revokeObjectURL(url); }, 1000);
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

    // Cash système = ventes cash reelles (source de verite = table sales)
    const cashSysteme = daySales.cashSales;
    // Carte = ventes carte reelles
    const cardReceipt = daySales.cardSales;
    // Cash caissière = total des ventes (cash + carte) = ce que la caissiere a encaisse
    const hasSession = sessionMap.has(dateStr);
    const cashCaissiere = hasSession
      ? (session.cashCaissiere) // actual_amount saisi par la caissiere
      : (cashSysteme + cardReceipt); // fallback: total ventes

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
        ecart: cashCaissiere - (cashSysteme + cardReceipt),
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
  const [tab, setTab] = useState<AccTab>('caisse');

  const allTabs: { key: AccTab; label: string; icon: typeof Wallet }[] = [
    { key: 'caisse', label: 'Caisse', icon: Wallet },
    { key: 'charges', label: 'Charges & Dépenses', icon: TrendingDown },
    { key: 'resume', label: 'Résumé', icon: BarChart3 },
    { key: 'losses', label: 'Pertes', icon: AlertTriangle },
  ];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="bg-gradient-to-br from-slate-700 to-slate-800 rounded-2xl p-6 text-white shadow-lg relative overflow-hidden">
        <div className="absolute inset-0 opacity-10">
          <div className="absolute -top-10 -right-10 w-40 h-40 bg-white rounded-full" />
          <div className="absolute -bottom-10 -left-10 w-32 h-32 bg-white rounded-full" />
        </div>
        <div className="relative flex items-center gap-4">
          <div className="w-12 h-12 rounded-xl bg-white/20 flex items-center justify-center">
            <Calculator size={24} />
          </div>
          <div>
            <h1 className="text-2xl font-bold">Comptabilité</h1>
            <p className="text-slate-300 text-sm mt-0.5">Gestion financière et trésorerie</p>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-2">
        <div className="flex gap-1 overflow-x-auto">
          {allTabs.map(t => {
            const Icon = t.icon;
            return (
              <button key={t.key} onClick={() => setTab(t.key)}
                className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-medium transition-all whitespace-nowrap ${
                  tab === t.key
                    ? 'bg-slate-700 text-white shadow-md'
                    : 'text-gray-500 hover:bg-gray-50 hover:text-gray-700'
                }`}>
                <Icon size={16} /> {t.label}
              </button>
            );
          })}
        </div>
      </div>

      {tab === 'caisse' && <CaisseTab />}
      {tab === 'charges' && <ChargesTab />}
      {tab === 'resume' && <ResumeTab />}
      {tab === 'losses' && <LossesTab />}
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
      ecart: cashCaissiere - (cashSysteme + cardReceipts),
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
      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-3 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <select value={month} onChange={e => setMonth(+e.target.value)} className="px-3 py-2 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-slate-500 w-auto">
            {MONTH_NAMES.map((m, i) => <option key={i} value={i + 1}>{m}</option>)}
          </select>
          <input type="number" value={year} onChange={e => setYear(+e.target.value)} className="px-3 py-2 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-slate-500 w-24" />
        </div>
        <button onClick={handleExport} className="px-4 py-2 bg-white border border-gray-200 text-gray-700 rounded-xl font-medium hover:bg-gray-50 transition-all flex items-center gap-2 text-sm shadow-sm">
          <Download size={14} /> Exporter
        </button>
      </div>

      {/* Report line */}
      {data && (data.previousBalance.cashNet !== 0 || data.previousBalance.cardCumul !== 0) && (
        <div className="bg-gradient-to-r from-amber-50 to-orange-50 border border-amber-200 rounded-2xl px-5 py-3.5 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-amber-100 flex items-center justify-center">
              <ArrowUpRight size={16} className="text-amber-600" />
            </div>
            <span className="text-amber-800 font-medium text-sm">Report mois précédent</span>
          </div>
          <div className="flex items-center gap-4 text-sm">
            <span className="text-gray-600">Cash: <span className="font-bold text-amber-900">{n(data.previousBalance.cashNet)} DH</span></span>
            <span className="text-gray-600">Carte: <span className="font-bold text-amber-900">{n(data.previousBalance.cardCumul)} DH</span></span>
            <span className="text-gray-600">Total: <span className="font-bold text-amber-900 text-base">{n(data.previousBalance.cashNet + data.previousBalance.cardCumul)} DH</span></span>
          </div>
        </div>
      )}

      {/* Summary cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-4 overflow-hidden relative">
          <div className="flex items-center gap-2.5 mb-2">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-purple-500 to-violet-500 flex items-center justify-center">
              <ShoppingCart size={16} className="text-white" />
            </div>
            <p className="text-xs text-gray-500 uppercase tracking-wide font-medium">Ventes du mois</p>
          </div>
          <p className="text-2xl font-bold text-purple-700">{n(monthTotals.totalSales)} <span className="text-sm font-normal text-gray-400">DH</span></p>
          <p className="text-xs text-gray-400 mt-1">{monthTotals.saleCount} vente{monthTotals.saleCount > 1 ? 's' : ''}</p>
        </div>
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-4 overflow-hidden relative">
          <div className="flex items-center gap-2.5 mb-2">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-emerald-500 to-green-500 flex items-center justify-center">
              <Coins size={16} className="text-white" />
            </div>
            <p className="text-xs text-gray-500 uppercase tracking-wide font-medium">Recettes</p>
          </div>
          <p className="text-2xl font-bold text-emerald-700">{n(monthTotals.totalRecettes)} <span className="text-sm font-normal text-gray-400">DH</span></p>
          <div className="flex gap-3 text-xs text-gray-400 mt-1">
            <span>Cash: {n(monthTotals.cashCaissiere)}</span>
            <span>Carte: {n(monthTotals.cardReceipts)}</span>
            {monthTotals.entries > 0 && <span>Autres: {n(monthTotals.entries)}</span>}
          </div>
        </div>
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-4 overflow-hidden relative">
          <div className="flex items-center gap-2.5 mb-2">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-blue-500 to-indigo-500 flex items-center justify-center">
              <Scale size={16} className="text-white" />
            </div>
            <p className="text-xs text-gray-500 uppercase tracking-wide font-medium">Écart caisse</p>
          </div>
          <p className={`text-2xl font-bold ${monthTotals.ecart === 0 ? 'text-gray-400' : monthTotals.ecart > 0 ? 'text-emerald-600' : 'text-red-600'}`}>
            {monthTotals.ecart > 0 ? '+' : ''}{n(monthTotals.ecart)} <span className="text-sm font-normal text-gray-400">DH</span>
          </p>
          <p className="text-xs text-gray-400 mt-1">Caissière vs Système</p>
        </div>
        <div className={`rounded-2xl shadow-sm border p-4 overflow-hidden relative ${monthTotals.solde >= 0 ? 'bg-gradient-to-br from-emerald-50 to-green-50 border-emerald-200' : 'bg-gradient-to-br from-red-50 to-orange-50 border-red-200'}`}>
          <div className="flex items-center gap-2.5 mb-2">
            <div className={`w-9 h-9 rounded-xl flex items-center justify-center ${monthTotals.solde >= 0 ? 'bg-gradient-to-br from-emerald-500 to-green-600' : 'bg-gradient-to-br from-red-500 to-red-600'}`}>
              <Wallet size={16} className="text-white" />
            </div>
            <p className="text-xs text-gray-500 uppercase tracking-wide font-medium">Solde actuel</p>
          </div>
          <p className={`text-2xl font-bold ${monthTotals.solde >= 0 ? 'text-emerald-700' : 'text-red-700'}`}>{n(monthTotals.solde)} <span className="text-sm font-normal text-gray-400">DH</span></p>
          <div className="flex gap-3 text-xs text-gray-400 mt-1">
            <span>Cash: {n(monthTotals.cashNet)}</span>
            <span>Carte: {n(monthTotals.cardCumul)}</span>
          </div>
        </div>
      </div>

      {/* Écart caisse alert */}
      {monthTotals.ecart !== 0 && (
        <div className={`flex items-center gap-3 px-4 py-3 rounded-2xl text-sm ${monthTotals.ecart > 0 ? 'bg-emerald-50 border border-emerald-200 text-emerald-800' : 'bg-red-50 border border-red-200 text-red-800'}`}>
          <div className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 ${monthTotals.ecart > 0 ? 'bg-emerald-100' : 'bg-red-100'}`}>
            <AlertTriangle size={16} />
          </div>
          <span>Écart caisse du mois : <span className="font-bold">{monthTotals.ecart > 0 ? '+' : ''}{n(monthTotals.ecart)} DH</span> (Cash caissière vs Cash système)</span>
        </div>
      )}

      {/* Daily sections */}
      {isLoading ? (
        <div className="flex items-center justify-center h-32">
          <div className="flex flex-col items-center gap-3">
            <Loader2 size={28} className="animate-spin text-slate-500" />
            <span className="text-gray-500 text-sm">Chargement...</span>
          </div>
        </div>
      ) : days.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-12">
          <div className="w-14 h-14 rounded-2xl bg-gray-100 flex items-center justify-center mb-3">
            <Wallet size={28} className="text-gray-400" />
          </div>
          <p className="text-gray-500">Aucune activité pour ce mois</p>
        </div>
      ) : (
        <div className="space-y-2">
          {days.map(day => {
            const expanded = expandedDays.has(day.dayNum);
            const dateLabel = format(parseLocalDate(day.date), 'EEEE dd MMMM yyyy', { locale: fr });
            const dayRecettes = day.cashCaissiere + day.cardReceipt + day.entries;
            return (
              <div key={day.dayNum} className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
                {/* Day header */}
                <button onClick={() => toggleDay(day.dayNum)}
                  className="w-full flex items-center justify-between px-5 py-3.5 hover:bg-gray-50 transition-colors">
                  <div className="flex items-center gap-3">
                    {expanded ? <ChevronDown size={16} className="text-slate-400" /> : <ChevronRight size={16} className="text-slate-400" />}
                    <span className="font-semibold text-gray-800 capitalize">{dateLabel}</span>
                  </div>
                  <div className="flex items-center gap-3 text-xs">
                    {day.totalSales > 0 && <span className="bg-purple-50 text-purple-700 px-2.5 py-1 rounded-lg font-medium">{day.saleCount} vente{day.saleCount > 1 ? 's' : ''}</span>}
                    {dayRecettes > 0 && <span className="bg-emerald-50 text-emerald-700 px-2.5 py-1 rounded-lg font-medium">+{n(dayRecettes)}</span>}
                    <span className={`px-2.5 py-1 rounded-lg font-bold ${day.solde >= 0 ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-700'}`}>{n(day.solde)}</span>
                  </div>
                </button>

                {/* Expanded day detail — entries only */}
                {expanded && (
                  <div className="border-t border-gray-100 px-5 py-4 space-y-3">
                    {/* Ventes */}
                    {day.totalSales > 0 && (
                      <div className="bg-gradient-to-r from-purple-50 to-violet-50 rounded-xl p-4 flex items-center justify-between">
                        <div className="flex items-center gap-2.5">
                          <div className="w-8 h-8 rounded-lg bg-purple-100 flex items-center justify-center">
                            <ShoppingCart size={14} className="text-purple-600" />
                          </div>
                          <span className="text-sm font-medium text-purple-800">Ventes du jour ({day.saleCount})</span>
                        </div>
                        <span className="font-bold text-purple-700 text-lg">{n(day.totalSales)} DH</span>
                      </div>
                    )}

                    {/* Recettes caisse */}
                    {(day.cashCaissiere > 0 || day.cardReceipt > 0) && (
                      <div className="bg-gradient-to-r from-emerald-50 to-green-50 rounded-xl p-4 space-y-3">
                        <p className="text-xs font-semibold text-emerald-700 uppercase tracking-wide">Recettes encaissées</p>
                        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
                          <div className="bg-white/60 rounded-lg p-2.5 text-center">
                            <p className="text-[10px] text-gray-400 uppercase">Cash système</p>
                            <p className="font-bold text-gray-700">{n(day.cashSysteme)} DH</p>
                          </div>
                          <div className="bg-white/60 rounded-lg p-2.5 text-center">
                            <p className="text-[10px] text-gray-400 uppercase">Cash caissière</p>
                            <p className="font-bold text-emerald-700">{n(day.cashCaissiere)} DH</p>
                          </div>
                          <div className="bg-white/60 rounded-lg p-2.5 text-center">
                            <p className="text-[10px] text-gray-400 uppercase">Carte</p>
                            <p className="font-bold text-blue-600">{n(day.cardReceipt)} DH</p>
                          </div>
                          <div className="bg-white/60 rounded-lg p-2.5 text-center">
                            <p className="text-[10px] text-gray-400 uppercase">Ecart</p>
                            <p className={`font-bold ${day.ecart === 0 ? 'text-gray-400' : day.ecart > 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                              {day.ecart > 0 ? '+' : ''}{n(day.ecart)} DH
                            </p>
                          </div>
                        </div>
                      </div>
                    )}

                    {/* Autres entrées (type income) */}
                    {day.entries > 0 && (
                      <div className="bg-gradient-to-r from-blue-50 to-indigo-50 rounded-xl p-4">
                        <p className="text-xs font-semibold text-blue-700 uppercase tracking-wide mb-2">Autres entrées</p>
                        {day.payments.filter(p => p.type === 'income').map((p, idx) => {
                          const amount = parseFloat(p.amount as string) || 0;
                          return (
                            <div key={idx} className="flex items-center justify-between text-sm py-1.5">
                              <span className="text-gray-600">{(p.description as string) || (p.category_name as string) || 'Revenu'}</span>
                              <span className="font-bold text-emerald-600">+{n(amount)} DH</span>
                            </div>
                          );
                        })}
                      </div>
                    )}

                    {/* Solde cumulé */}
                    <div className={`rounded-xl p-4 ${day.solde >= 0 ? 'bg-gradient-to-r from-emerald-50 to-green-50' : 'bg-gradient-to-r from-red-50 to-orange-50'}`}>
                      <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">Solde cumulé</p>
                      <div className="grid grid-cols-3 gap-3 text-sm">
                        <div className="bg-white/60 rounded-lg p-2.5 text-center">
                          <p className="text-[10px] text-gray-400 uppercase">Cash</p>
                          <p className="font-bold text-gray-700">{n(day.cashNetCumul)} DH</p>
                        </div>
                        <div className="bg-white/60 rounded-lg p-2.5 text-center">
                          <p className="text-[10px] text-gray-400 uppercase">Carte</p>
                          <p className="font-bold text-gray-700">{n(day.cardCumul)} DH</p>
                        </div>
                        <div className="bg-white/60 rounded-lg p-2.5 text-center">
                          <p className="text-[10px] text-gray-400 uppercase">Total</p>
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
        <div className="bg-white border border-gray-100 rounded-2xl shadow-sm overflow-hidden">
          <div className="bg-gradient-to-r from-slate-700 to-slate-800 px-5 py-4 flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-white/20 flex items-center justify-center">
              <BarChart3 size={18} className="text-white" />
            </div>
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
                  <td className="py-2 text-gray-500">Carte Encaissée</td>
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
  const { data: categories = [] } = useQuery({ queryKey: ['expense-categories'], queryFn: () => expenseCategoriesApi.list() });
  const { data: eligiblePOs = [] } = useQuery({ queryKey: ['eligible-pos'], queryFn: purchaseOrdersApi.eligible });

  // Form state for new expense
  const [formCategoryId, setFormCategoryId] = useState<string>('');
  const [formPOId, setFormPOId] = useState<string>('');

  // Check if selected category requires a PO (look up the leaf category)
  const selectedCategory = (categories as Record<string, unknown>[]).find(c => String(c.id) === formCategoryId);
  const requiresPO = selectedCategory ? (selectedCategory.requires_po as boolean) : false;

  // Build full path label for display: "Categorie > Sous-cat > Type"
  const getCategoryPath = (catId: string) => {
    const all = categories as Record<string, unknown>[];
    const cat = all.find(c => String(c.id) === catId);
    if (!cat) return '';
    const parts: string[] = [String(cat.name)];
    let current = cat;
    while (current.parent_id) {
      const parent = all.find(c => String(c.id) === String(current.parent_id));
      if (parent) { parts.unshift(String(parent.name)); current = parent; }
      else break;
    }
    return parts.join(' > ');
  };

  // Auto-fill from selected PO
  const selectedPO = (eligiblePOs as Record<string, unknown>[]).find(po => po.id === formPOId);

  const createMutation = useMutation({
    mutationFn: (data: Record<string, unknown>) => paymentsApi.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['payments-charges'] });
      queryClient.invalidateQueries({ queryKey: ['caisse-register'] });
      toast.success('Dépense enregistrée');
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
      toast.success('Modifié avec succès');
      setEditingPayment(null);
    },
    onError: () => toast.error('Erreur lors de la modification'),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => paymentsApi.remove(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['payments-charges'] });
      queryClient.invalidateQueries({ queryKey: ['caisse-register'] });
      toast.success('Supprimé');
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
      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-3 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <select value={month} onChange={e => setMonth(+e.target.value)} className="px-3 py-2 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-slate-500 w-auto">
            {MONTH_NAMES.map((m, i) => <option key={i} value={i + 1}>{m}</option>)}
          </select>
          <input type="number" value={year} onChange={e => setYear(+e.target.value)} className="px-3 py-2 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-slate-500 w-24" />
        </div>
        <div className="flex items-center gap-2">
          <button onClick={handleExport} className="px-4 py-2 bg-white border border-gray-200 text-gray-700 rounded-xl font-medium hover:bg-gray-50 transition-all flex items-center gap-2 text-sm shadow-sm">
            <Download size={14} /> Exporter
          </button>
          <button onClick={() => setShowForm(true)} className="px-4 py-2 bg-gradient-to-r from-red-500 to-rose-500 text-white rounded-xl font-medium shadow-md hover:shadow-lg transition-all flex items-center gap-2 text-sm">
            <Plus size={16} /> Nouvelle dépense
          </button>
        </div>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-4">
          <div className="flex items-center gap-2.5 mb-2">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-red-500 to-rose-500 flex items-center justify-center">
              <ArrowDownRight size={16} className="text-white" />
            </div>
            <p className="text-xs text-gray-500 uppercase tracking-wide font-medium">Total sorties</p>
          </div>
          <p className="text-2xl font-bold text-red-700">{n(totals.total)} <span className="text-sm font-normal text-gray-400">DH</span></p>
          <p className="text-xs text-gray-400 mt-1">{outgoing.length} opération{outgoing.length > 1 ? 's' : ''}</p>
        </div>
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-4">
          <div className="flex items-center gap-2.5 mb-2">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-orange-500 to-amber-500 flex items-center justify-center">
              <ShoppingCart size={16} className="text-white" />
            </div>
            <p className="text-xs text-gray-500 uppercase tracking-wide font-medium">Achats</p>
          </div>
          <p className="text-2xl font-bold text-orange-700">{n(totals.invoiceTotal)} <span className="text-sm font-normal text-gray-400">DH</span></p>
          <p className="text-xs text-gray-400 mt-1">{invoicePayments.length} facture{invoicePayments.length > 1 ? 's' : ''}</p>
        </div>
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-4">
          <div className="flex items-center gap-2.5 mb-2">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-purple-500 to-violet-500 flex items-center justify-center">
              <Users size={16} className="text-white" />
            </div>
            <p className="text-xs text-gray-500 uppercase tracking-wide font-medium">Salaires</p>
          </div>
          <p className="text-2xl font-bold text-purple-700">{n(totals.salaryTotal)} <span className="text-sm font-normal text-gray-400">DH</span></p>
          <p className="text-xs text-gray-400 mt-1">{salaryPayments.length} employe{salaryPayments.length > 1 ? 's' : ''}</p>
        </div>
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-4">
          <div className="flex items-center gap-2.5 mb-2">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-gray-500 to-slate-500 flex items-center justify-center">
              <Receipt size={16} className="text-white" />
            </div>
            <p className="text-xs text-gray-500 uppercase tracking-wide font-medium">Autres</p>
          </div>
          <p className="text-2xl font-bold text-gray-700">{n(totals.expenseTotal)} <span className="text-sm font-normal text-gray-400">DH</span></p>
          <p className="text-xs text-gray-400 mt-1">{expensePayments.length} dépense{expensePayments.length > 1 ? 's' : ''}</p>
        </div>
      </div>

      {/* Filter tabs */}
      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-2 flex flex-wrap items-center gap-1">
        <div className="flex gap-1 bg-gray-50 rounded-xl p-1 flex-1">
          {[
            { key: 'all', label: 'Tout', count: outgoing.length },
            { key: 'invoice', label: 'Achats', count: invoicePayments.length },
            { key: 'salary', label: 'Salaires', count: salaryPayments.length },
            { key: 'expense', label: 'Depenses', count: expensePayments.length },
          ].map(f => (
            <button key={f.key} onClick={() => { setTypeFilter(f.key); setCategoryFilter('all'); }}
              className={`px-3 py-2 rounded-lg text-xs font-medium transition-all flex items-center gap-1.5 ${
                typeFilter === f.key ? 'bg-white text-red-700 shadow-sm' : 'text-gray-500 hover:text-gray-700'
              }`}>
              {f.label}
              {f.count > 0 && (
                <span className={`px-1.5 py-0.5 rounded-full text-[10px] font-bold ${
                  typeFilter === f.key ? 'bg-red-100 text-red-600' : 'bg-gray-200 text-gray-500'
                }`}>{f.count}</span>
              )}
            </button>
          ))}
        </div>
        {availableCategories.length > 1 && (
          <select value={categoryFilter} onChange={e => setCategoryFilter(e.target.value)}
            className="px-3 py-2 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-slate-500 w-auto ml-2">
            <option value="all">Toutes categories ({typeFiltered.length})</option>
            {availableCategories.map(c => (
              <option key={c} value={c}>{c} ({typeFiltered.filter(p => (p.category_name as string) === c).length})</option>
            ))}
          </select>
        )}
      </div>

      {/* Expenses table */}
      {isLoading ? (
        <div className="flex flex-col items-center justify-center py-16">
          <Loader2 className="animate-spin text-red-400 mb-3" size={32} />
          <p className="text-sm text-gray-400">Chargement des sorties...</p>
        </div>
      ) : displayed.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16">
          <div className="w-16 h-16 rounded-2xl bg-gray-100 flex items-center justify-center mb-4">
            <Receipt size={28} className="text-gray-300" />
          </div>
          <p className="text-gray-400 font-medium">Aucune sortie pour cette période</p>
        </div>
      ) : (
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gradient-to-r from-slate-50 to-gray-50 border-b border-gray-200">
                <th className="text-left px-4 py-3 text-xs font-semibold text-gray-600 uppercase tracking-wide">Date</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-gray-600 uppercase tracking-wide">Ref.</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-gray-600 uppercase tracking-wide">Type</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-gray-600 uppercase tracking-wide">Categorie</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-gray-600 uppercase tracking-wide">Beneficiaire</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-gray-600 uppercase tracking-wide">BC</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-gray-600 uppercase tracking-wide">Methode</th>
                <th className="text-right px-4 py-3 text-xs font-semibold text-gray-600 uppercase tracking-wide">Montant</th>
                <th className="text-center px-4 py-3 text-xs font-semibold text-gray-600 uppercase tracking-wide">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {displayed.map(p => {
                const typeColor = p.type === 'invoice' ? 'bg-orange-100 text-orange-700'
                  : p.type === 'salary' ? 'bg-purple-100 text-purple-700'
                  : 'bg-gray-100 text-gray-700';
                return (
                  <tr key={p.id as string} className="hover:bg-gray-50/50 transition-colors">
                    <td className="px-4 py-3 text-gray-500">{format(new Date(p.payment_date as string), 'dd/MM/yyyy')}</td>
                    <td className="px-4 py-3 font-mono text-xs text-gray-400">{p.reference as string || '—'}</td>
                    <td className="px-4 py-3">
                      <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${typeColor}`}>
                        {PAYMENT_TYPE_LABELS[p.type as string] || p.type}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-gray-500">{p.category_name as string || '—'}</td>
                    <td className="px-4 py-3 font-medium text-gray-700">
                      {p.supplier_name as string || (p.employee_first_name ? `${p.employee_first_name} ${p.employee_last_name}` : p.description as string || '—')}
                    </td>
                    <td className="px-4 py-3">
                      {p.purchase_order_number ? (
                        <span className="px-2 py-0.5 rounded-lg bg-blue-50 text-blue-700 text-xs font-mono">{p.purchase_order_number as string}</span>
                      ) : <span className="text-gray-300">—</span>}
                    </td>
                    <td className="px-4 py-3 text-gray-500 text-xs">{PAYMENT_METHOD_LABELS[p.payment_method as string]}</td>
                    <td className="px-4 py-3 text-right font-bold text-red-600">{n(parseFloat(p.amount as string))} <span className="text-xs font-normal text-gray-400">DH</span></td>
                    <td className="px-4 py-3 text-center">
                      {p.type !== 'salary' ? (
                        <div className="flex items-center justify-center gap-1">
                          <button onClick={() => setEditingPayment(p)}
                            className="p-1.5 hover:bg-blue-50 rounded-lg text-blue-400 hover:text-blue-600 transition-colors">
                            <Pencil size={14} />
                          </button>
                          <button onClick={() => deleteMutation.mutate(p.id as string)}
                            className="p-1.5 hover:bg-red-50 rounded-lg text-red-400 hover:text-red-600 transition-colors">
                            <X size={14} />
                          </button>
                        </div>
                      ) : <span className="text-[10px] text-gray-300">auto</span>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr className="bg-gradient-to-r from-red-500 to-rose-500 text-white">
                <td colSpan={7} className="px-4 py-3 font-medium rounded-bl-2xl">Total ({displayed.length} opération{displayed.length > 1 ? 's' : ''})</td>
                <td className="px-4 py-3 text-right text-lg font-bold">{n(displayed.reduce((s, p) => s + (parseFloat(p.amount as string) || 0), 0))} DH</td>
                <td className="rounded-br-2xl"></td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}

      {/* Add expense modal */}
      {showForm && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl w-full max-w-lg shadow-2xl overflow-hidden">
            <div className="bg-gradient-to-r from-red-500 to-rose-500 p-5 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-white/20 flex items-center justify-center">
                  <Plus size={20} className="text-white" />
                </div>
                <h2 className="text-lg font-bold text-white">Nouvelle dépense</h2>
              </div>
              <button onClick={() => { setShowForm(false); setFormCategoryId(''); setFormPOId(''); }} className="p-2 hover:bg-white/20 rounded-xl transition-colors">
                <X size={18} className="text-white" />
              </button>
            </div>
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
              if (!fd.categoryId) { toast.error('Veuillez sélectionner une catégorie'); return; }
              if (requiresPO && !formPOId) { toast.error('Cette catégorie nécessite un bon de commande'); return; }
              createMutation.mutate(fd);
            }} className="p-5 space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">Categorie *</label>
                <CascadeCategorySelect
                  categories={categories as Record<string, unknown>[]}
                  value={formCategoryId}
                  onChange={(id) => { setFormCategoryId(id); setFormPOId(''); }}
                />
              </div>

              {requiresPO && (
                <div className="bg-amber-50 border border-amber-200 rounded-xl p-4">
                  <label className="block text-sm font-medium mb-1.5 text-amber-800">
                    <ClipboardList size={14} className="inline mr-1" /> Bon de commande *
                  </label>
                  <select value={formPOId} onChange={e => setFormPOId(e.target.value)}
                    className="w-full px-3 py-2.5 border border-amber-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-amber-500 bg-white" required>
                    <option value="">Sélectionner un BC...</option>
                    {(eligiblePOs as Record<string, unknown>[]).map(po => (
                      <option key={po.id as string} value={po.id as string}>
                        {po.order_number as string} — {po.supplier_name as string} — {n(parseFloat(po.total_amount as string) || 0)} DH
                      </option>
                    ))}
                  </select>
                  {selectedPO && (
                    <p className="text-xs text-amber-700 mt-2">
                      Fournisseur: <strong>{selectedPO.supplier_name as string}</strong> | Montant BC: <strong>{n(parseFloat(selectedPO.total_amount as string) || 0)} DH</strong>
                    </p>
                  )}
                  {(eligiblePOs as Record<string, unknown>[]).length === 0 && (
                    <p className="text-xs text-red-600 mt-2">
                      Aucun bon de commande disponible. Créez d'abord un BC dans l'onglet Bons de commande.
                    </p>
                  )}
                </div>
              )}

              <div className="grid grid-cols-2 gap-4">
                <div><label className="block text-sm font-medium text-gray-700 mb-1.5">Montant *</label>
                  <input name="amount" type="number" step="0.01" className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-red-500" required
                    defaultValue={selectedPO ? parseFloat(selectedPO.total_amount as string) || '' : ''} key={formPOId} /></div>
                <div><label className="block text-sm font-medium text-gray-700 mb-1.5">Date *</label>
                  <input name="paymentDate" type="date" className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-red-500" required defaultValue={format(new Date(), 'yyyy-MM-dd')} /></div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div><label className="block text-sm font-medium text-gray-700 mb-1.5">Methode</label>
                  <select name="paymentMethod" className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-red-500">
                    <option value="cash">Especes</option><option value="bank">Virement</option><option value="check">Cheque</option>
                  </select></div>
                {!requiresPO && (
                  <div><label className="block text-sm font-medium text-gray-700 mb-1.5">Fournisseur</label>
                    <select name="supplierId" className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-red-500">
                      <option value="">Aucun</option>
                      {(suppliers as Record<string, unknown>[]).filter(s => s.is_active).map(s => (
                        <option key={s.id as string} value={s.id as string}>{s.name as string}</option>
                      ))}
                    </select></div>
                )}
              </div>

              <div><label className="block text-sm font-medium text-gray-700 mb-1.5">Description</label>
                <textarea name="description" rows={2} className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-red-500" /></div>

              <div className="flex gap-3 justify-end pt-2">
                <button type="button" onClick={() => { setShowForm(false); setFormCategoryId(''); setFormPOId(''); }}
                  className="px-5 py-2.5 border border-gray-200 text-gray-700 rounded-xl font-medium hover:bg-gray-50 transition-all text-sm">Annuler</button>
                <button type="submit" disabled={createMutation.isPending}
                  className="px-5 py-2.5 bg-gradient-to-r from-red-500 to-rose-500 text-white rounded-xl font-medium shadow-md hover:shadow-lg transition-all text-sm flex items-center gap-2">
                  {createMutation.isPending && <Loader2 size={14} className="animate-spin" />}
                  Enregistrer
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Edit expense modal */}
      {editingPayment && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl w-full max-w-lg shadow-2xl overflow-hidden">
            <div className="bg-gradient-to-r from-blue-500 to-indigo-500 p-5 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-white/20 flex items-center justify-center">
                  <Pencil size={18} className="text-white" />
                </div>
                <h2 className="text-lg font-bold text-white">Modifier la depense</h2>
              </div>
              <button onClick={() => setEditingPayment(null)} className="p-2 hover:bg-white/20 rounded-xl transition-colors">
                <X size={18} className="text-white" />
              </button>
            </div>
            <form onSubmit={e => {
              e.preventDefault();
              const fd = Object.fromEntries(new FormData(e.currentTarget)) as Record<string, unknown>;
              fd.amount = parseFloat(fd.amount as string);
              if (!fd.categoryId) fd.categoryId = null;
              updateMutation.mutate({ id: editingPayment.id as string, data: fd });
            }} className="p-5 space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div><label className="block text-sm font-medium text-gray-700 mb-1.5">Montant *</label>
                  <input name="amount" type="number" step="0.01" className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" required
                    defaultValue={parseFloat(editingPayment.amount as string) || 0} /></div>
                <div><label className="block text-sm font-medium text-gray-700 mb-1.5">Date *</label>
                  <input name="paymentDate" type="date" className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" required
                    defaultValue={format(new Date(editingPayment.payment_date as string), 'yyyy-MM-dd')} /></div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div><label className="block text-sm font-medium text-gray-700 mb-1.5">Methode</label>
                  <select name="paymentMethod" className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" defaultValue={editingPayment.payment_method as string || 'cash'}>
                    <option value="cash">Especes</option><option value="bank">Virement</option><option value="check">Cheque</option>
                  </select></div>
                <div><label className="block text-sm font-medium text-gray-700 mb-1.5">Categorie</label>
                  <select name="categoryId" className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" defaultValue={editingPayment.category_id as string || ''}>
                    <option value="">Choisir...</option>
                    {(categories as Record<string, unknown>[])
                      .filter(c => (c.level as number) === 3 || (!(categories as Record<string, unknown>[]).some(ch => String(ch.parent_id) === String(c.id))))
                      .map(c => <option key={String(c.id)} value={String(c.id)}>{getCategoryPath(String(c.id))}</option>)}
                  </select></div>
              </div>

              <div><label className="block text-sm font-medium text-gray-700 mb-1.5">Description</label>
                <textarea name="description" rows={2} className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  defaultValue={editingPayment.description as string || ''} /></div>

              <div className="flex gap-3 justify-end pt-2">
                <button type="button" onClick={() => setEditingPayment(null)}
                  className="px-5 py-2.5 border border-gray-200 text-gray-700 rounded-xl font-medium hover:bg-gray-50 transition-all text-sm">Annuler</button>
                <button type="submit" disabled={updateMutation.isPending}
                  className="px-5 py-2.5 bg-gradient-to-r from-blue-500 to-indigo-500 text-white rounded-xl font-medium shadow-md hover:shadow-lg transition-all text-sm flex items-center gap-2">
                  {updateMutation.isPending && <Loader2 size={14} className="animate-spin" />}
                  Enregistrer
                </button>
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
      {/* Month selector + export */}
      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-3 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <select value={month} onChange={e => setMonth(+e.target.value)} className="px-3 py-2 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-slate-500 w-auto">
            {MONTH_NAMES.map((m, i) => <option key={i} value={i + 1}>{m}</option>)}
          </select>
          <input type="number" value={year} onChange={e => setYear(+e.target.value)} className="px-3 py-2 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-slate-500 w-24" />
        </div>
        <button onClick={handleExport} className="px-4 py-2 bg-white border border-gray-200 text-gray-700 rounded-xl font-medium hover:bg-gray-50 transition-all flex items-center gap-2 text-sm shadow-sm">
          <Download size={14} /> Exporter
        </button>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-4">
          <div className="flex items-center gap-2.5 mb-2">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-emerald-500 to-green-500 flex items-center justify-center">
              <ArrowUpRight size={16} className="text-white" />
            </div>
            <p className="text-xs text-gray-500 uppercase tracking-wide font-medium">Total entrees</p>
          </div>
          <p className="text-2xl font-bold text-emerald-700">{n(totals.totalEntrees)} <span className="text-sm font-normal text-gray-400">DH</span></p>
          <div className="flex gap-3 text-xs text-gray-400 mt-1.5">
            <span>Cash: {n(totals.cashR)}</span>
            <span>Carte: {n(totals.cardR)}</span>
            {totals.entries > 0 && <span>Autres: {n(totals.entries)}</span>}
          </div>
        </div>
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-4">
          <div className="flex items-center gap-2.5 mb-2">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-red-500 to-rose-500 flex items-center justify-center">
              <ArrowDownRight size={16} className="text-white" />
            </div>
            <p className="text-xs text-gray-500 uppercase tracking-wide font-medium">Total sorties</p>
          </div>
          <p className="text-2xl font-bold text-red-700">{n(totals.exits)} <span className="text-sm font-normal text-gray-400">DH</span></p>
          <p className="text-xs text-gray-400 mt-1.5">Achats + Salaires + Depenses</p>
        </div>
        <div className={`bg-white rounded-2xl shadow-sm border p-4 ${totals.resultat >= 0 ? 'border-emerald-200 bg-emerald-50/30' : 'border-red-200 bg-red-50/30'}`}>
          <div className="flex items-center gap-2.5 mb-2">
            <div className={`w-9 h-9 rounded-xl flex items-center justify-center ${totals.resultat >= 0 ? 'bg-gradient-to-br from-emerald-500 to-teal-500' : 'bg-gradient-to-br from-red-500 to-rose-500'}`}>
              <Scale size={16} className="text-white" />
            </div>
            <p className="text-xs text-gray-500 uppercase tracking-wide font-medium">Resultat net du mois</p>
          </div>
          <p className={`text-2xl font-bold ${totals.resultat >= 0 ? 'text-emerald-700' : 'text-red-700'}`}>
            {totals.resultat >= 0 ? '+' : ''}{n(totals.resultat)} <span className="text-sm font-normal text-gray-400">DH</span>
          </p>
          <p className="text-xs text-gray-400 mt-1.5">Entrees - Sorties</p>
        </div>
      </div>

      {/* Solde cumulé banner */}
      <div className={`rounded-2xl p-4 ${totals.solde >= 0 ? 'bg-gradient-to-r from-emerald-500 to-teal-500' : 'bg-gradient-to-r from-red-500 to-rose-500'}`}>
        <div className="flex items-center justify-between text-white">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-white/20 flex items-center justify-center">
              <Wallet size={18} className="text-white" />
            </div>
            <span className="font-medium">Solde cumulé (depuis le debut)</span>
          </div>
          <div className="flex items-center gap-6">
            <div className="text-center">
              <p className="text-xs text-white/70">Cash</p>
              <p className="font-bold">{n(totals.cashNet)} DH</p>
            </div>
            <div className="text-center">
              <p className="text-xs text-white/70">Carte</p>
              <p className="font-bold">{n(totals.cardCumul)} DH</p>
            </div>
            <div className="text-center bg-white/20 rounded-xl px-4 py-2">
              <p className="text-xs text-white/70">Total</p>
              <p className="font-bold text-lg">{n(totals.solde)} DH</p>
            </div>
          </div>
        </div>
      </div>

      {/* Daily grid */}
      {isLoading ? (
        <div className="flex flex-col items-center justify-center py-16">
          <Loader2 className="animate-spin text-slate-400 mb-3" size={32} />
          <p className="text-sm text-gray-400">Chargement du resume...</p>
        </div>
      ) : (
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gradient-to-r from-slate-50 to-gray-50 border-b border-gray-200">
                <th className="text-left px-4 py-3 font-semibold text-gray-600 text-xs uppercase tracking-wide">Date</th>
                <th className="text-right px-4 py-3 font-semibold text-purple-600 text-xs uppercase tracking-wide">Ventes</th>
                <th className="text-right px-4 py-3 font-semibold text-emerald-600 text-xs uppercase tracking-wide">Entrees</th>
                <th className="text-right px-4 py-3 font-semibold text-red-600 text-xs uppercase tracking-wide">Sorties</th>
                <th className="text-right px-4 py-3 font-semibold text-gray-700 text-xs uppercase tracking-wide bg-emerald-50/50">Cash</th>
                <th className="text-right px-4 py-3 font-semibold text-gray-700 text-xs uppercase tracking-wide bg-blue-50/50">Carte</th>
                <th className="text-right px-4 py-3 font-bold text-gray-800 text-xs uppercase tracking-wide bg-amber-50/50">Solde</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {allDays.map(d => {
                if (!d) return null;
                const dayEntrees = d.cashCaissiere + d.cardReceipt + d.entries;
                const hasActivity = dayEntrees > 0 || d.exits > 0;
                return (
                  <tr key={d.dayNum} className={`transition-colors ${hasActivity ? 'hover:bg-gray-50' : 'text-gray-300'}`}>
                    <td className="px-4 py-2.5 font-medium">{format(parseLocalDate(d.date), 'dd/MM EEE', { locale: fr })}</td>
                    <td className="px-4 py-2.5 text-right">{d.totalSales > 0 ? <span className="text-purple-600 font-semibold">{n(d.totalSales)}</span> : <span className="text-gray-200">—</span>}</td>
                    <td className="px-4 py-2.5 text-right">{dayEntrees > 0 ? <span className="text-emerald-600 font-semibold">{n(dayEntrees)}</span> : <span className="text-gray-200">—</span>}</td>
                    <td className="px-4 py-2.5 text-right">{d.exits > 0 ? <span className="text-red-600 font-semibold">{n(d.exits)}</span> : <span className="text-gray-200">—</span>}</td>
                    <td className="px-4 py-2.5 text-right bg-emerald-50/30 font-medium">{n(d.cashNetCumul)}</td>
                    <td className="px-4 py-2.5 text-right bg-blue-50/30 font-medium">{n(d.cardCumul)}</td>
                    <td className={`px-4 py-2.5 text-right bg-amber-50/30 font-bold ${d.solde >= 0 ? 'text-emerald-700' : 'text-red-700'}`}>{n(d.solde)}</td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr className="bg-gradient-to-r from-slate-100 to-gray-100 border-t-2 border-gray-200 font-bold text-sm">
                <td className="px-4 py-3 text-gray-700">TOTAL</td>
                <td className="px-4 py-3 text-right text-purple-700">{n(totals.sales)}</td>
                <td className="px-4 py-3 text-right text-emerald-700">{n(totals.totalEntrees)}</td>
                <td className="px-4 py-3 text-right text-red-700">{n(totals.exits)}</td>
                <td className="px-4 py-3 text-right bg-emerald-50">{n(totals.cashNet)}</td>
                <td className="px-4 py-3 text-right bg-blue-50">{n(totals.cardCumul)}</td>
                <td className={`px-4 py-3 text-right bg-amber-50 text-lg ${totals.solde >= 0 ? 'text-emerald-700' : 'text-red-700'}`}>{n(totals.solde)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </>
  );
}

/* ============ CASCADE CATEGORY SELECTOR ============ */

function CascadeCategorySelect({
  categories, value, onChange,
}: {
  categories: Record<string, unknown>[];
  value: string;
  onChange: (id: string) => void;
}) {
  const level1 = useMemo(() => categories.filter(c => (c.level as number) === 1), [categories]);
  const level2 = useMemo(() => categories.filter(c => (c.level as number) === 2), [categories]);
  const level3 = useMemo(() => categories.filter(c => (c.level as number) === 3), [categories]);

  const [selL1, setSelL1] = useState('');
  const [selL2, setSelL2] = useState('');

  // Resolve ancestors from current value
  useEffect(() => {
    if (!value || categories.length === 0) return;
    const leaf = categories.find(c => String(c.id) === value);
    if (!leaf) return;
    if ((leaf.level as number) === 3) {
      const parent = categories.find(c => String(c.id) === String(leaf.parent_id));
      if (parent && (parent.level as number) === 2) {
        setSelL2(String(parent.id));
        setSelL1(String(parent.parent_id || ''));
      } else if (parent && (parent.level as number) === 1) {
        setSelL1(String(parent.id));
        setSelL2('');
      }
    }
  }, [value, categories]);

  const filteredL2 = useMemo(() => selL1 ? level2.filter(c => String(c.parent_id) === selL1) : [], [selL1, level2]);
  const filteredL3 = useMemo(() => {
    if (selL2) return level3.filter(c => String(c.parent_id) === selL2);
    if (selL1) return level3.filter(c => String(c.parent_id) === selL1);
    return [];
  }, [selL1, selL2, level3]);

  const cls = 'w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-red-500 focus:border-transparent';

  return (
    <div className="space-y-2">
      <select value={selL1} onChange={e => { setSelL1(e.target.value); setSelL2(''); onChange(''); }} className={cls}>
        <option value="">Categorie...</option>
        {level1.map(c => <option key={String(c.id)} value={String(c.id)}>{String(c.name)}</option>)}
      </select>
      {filteredL2.length > 0 && (
        <select value={selL2} onChange={e => { setSelL2(e.target.value); onChange(''); }} className={cls}>
          <option value="">Sous-categorie...</option>
          {filteredL2.map(c => <option key={String(c.id)} value={String(c.id)}>{String(c.name)}</option>)}
        </select>
      )}
      {filteredL3.length > 0 && (
        <select value={value} onChange={e => onChange(e.target.value)} className={cls} required>
          <option value="">Type...</option>
          {filteredL3.map(c => (
            <option key={String(c.id)} value={String(c.id)}>
              {String(c.name)}{Boolean(c.requires_po) ? ' (BC requis)' : ''}
            </option>
          ))}
        </select>
      )}
    </div>
  );
}
