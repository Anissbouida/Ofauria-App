import { useState, useEffect, useMemo, Fragment } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { caisseApi, suppliersApi, expenseCategoriesApi, paymentsApi, invoicesApi } from '../../api/accounting.api';
import { employeesApi } from '../../api/employees.api';
import { purchaseOrdersApi } from '../../api/purchase-orders.api';
import { format, getDaysInMonth } from 'date-fns';
import { fr } from 'date-fns/locale';
import {
  Plus, Pencil, BarChart3,
  X, Download, AlertTriangle, ChevronDown, ChevronRight, Wallet,
  TrendingDown, ClipboardList, ShoppingCart, Receipt, Users,
  Loader2, Coins, Scale,
  ArrowUpRight, ArrowDownRight, Upload, Search,
} from 'lucide-react';
import { notify } from '../../components/ui/InlineNotification';
import LossesTab from './LossesTab';
import CaisseImportModal from './CaisseImportModal';
import CategoryCascadeSelector from '../../components/CategoryCascadeSelector';
import PaymentAlertsWidget from '../../components/PaymentAlertsWidget';
import { useReferentiel } from '../../hooks/useReferentiel';

type AccTab = 'caisse' | 'charges' | 'resume' | 'losses';

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

/**
 * Formatte une date payment_date (colonne DATE PG) en evitant le piege timezone.
 * pg renvoie DATE sous forme de Date object → JSON donne "YYYY-MM-DDT00:00:00.000Z"
 * → `new Date(...)` + `format()` peuvent shifter de +/- 1 jour selon le fuseau
 * du serveur ET du navigateur. On parse directement les premiers 10 caracteres
 * ("YYYY-MM-DD") sans passer par Date, ce qui evite tout shift.
 *
 * @param raw  Date ISO "2026-05-31T00:00:00.000Z" ou "2026-05-31" ou Date object
 * @param fmt  'iso' (defaut: yyyy-MM-dd) ou 'fr' (dd/MM/yyyy)
 */
function fmtPaymentDate(raw: unknown, fmt: 'iso' | 'fr' = 'iso'): string {
  if (!raw) return '';
  const s = String(raw).slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return s; // format inattendu — on retourne tel quel
  if (fmt === 'iso') return s;
  const [y, m, d] = s.split('-');
  return `${d}/${m}/${y}`;
}
function parseLocalDate(s: string) {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
}

interface DayData {
  date: string;
  dayNum: number;
  payments: Record<string, any>[];
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
  rawPayments: Record<string, any>[],
  rawSessions: Record<string, any>[],
  rawSales: Record<string, any>[],
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

  const paymentsByDay = new Map<string, Record<string, any>[]>();
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
    <div className="odoo-scope" style={{ minHeight: '100%' }}>
      {/* Control bar */}
      <div className="odoo-control-bar">
        <div className="odoo-breadcrumb">
          <span>Comptabilité</span>
          <span className="odoo-breadcrumb-separator">/</span>
          <span className="odoo-breadcrumb-current">{allTabs.find(t => t.key === tab)?.label}</span>
        </div>
      </div>

      {/* Tabs */}
      <div className="odoo-tabs">
        {allTabs.map(t => {
          const Icon = t.icon;
          return (
            <button key={t.key} onClick={() => setTab(t.key)}
              className={`odoo-tab ${tab === t.key ? 'active' : ''}`}>
              <Icon size={13} style={{ marginRight: 4 }} /> {t.label}
            </button>
          );
        })}
      </div>

      <div style={{ padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: 16 }}>
        {/* Suivi des echeances fournisseurs (visible sur tous les onglets) */}
        <PaymentAlertsWidget />
        {tab === 'caisse' && <CaisseTab />}
        {tab === 'charges' && <ChargesTab />}
        {tab === 'resume' && <ResumeTab />}
        {tab === 'losses' && <LossesTab />}
      </div>
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
  const [showImportModal, setShowImportModal] = useState(false);

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
      {/* Search panel : period + actions */}
      <div className="odoo-search-panel">
        <select value={month} onChange={e => setMonth(+e.target.value)} className="odoo-filter-dropdown" style={{ minWidth: 120 }}>
          {MONTH_NAMES.map((m, i) => <option key={i} value={i + 1}>{m}</option>)}
        </select>
        <input type="number" value={year} onChange={e => setYear(+e.target.value)}
          className="odoo-filter-dropdown" style={{ width: 80 }} />
        <div style={{ flex: 1 }} />
        <button onClick={() => setShowImportModal(true)} className="odoo-btn-secondary"
          style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          <Upload size={13} /> Importer Excel
        </button>
        <button onClick={handleExport} className="odoo-btn-secondary"
          style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          <Download size={13} /> Exporter
        </button>
      </div>

      {showImportModal && <CaisseImportModal onClose={() => setShowImportModal(false)} />}

      {/* Report line */}
      {data && (data.previousBalance.cashNet !== 0 || data.previousBalance.cardCumul !== 0) && (
        <div className="odoo-alert warning" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16 }}>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
            <ArrowUpRight size={14} /> Report mois précédent
          </span>
          <span style={{ display: 'inline-flex', gap: 16, fontSize: '0.75rem' }}>
            <span>Cash: <strong>{n(data.previousBalance.cashNet)} DH</strong></span>
            <span>Carte: <strong>{n(data.previousBalance.cardCumul)} DH</strong></span>
            <span>Total: <strong>{n(data.previousBalance.cashNet + data.previousBalance.cardCumul)} DH</strong></span>
          </span>
        </div>
      )}

      {/* Stat tiles */}
      <div className="odoo-stat-grid">
        <div className="odoo-stat-card">
          <div className="odoo-stat-card-label"><ShoppingCart size={11} style={{ display: 'inline', marginRight: 4 }} />Ventes du mois</div>
          <div className="odoo-stat-card-value">{n(monthTotals.totalSales)} <span style={{ fontSize: '0.6875rem', color: 'var(--theme-text-muted)', fontWeight: 400 }}>DH</span></div>
          <div className="odoo-stat-card-sub">{monthTotals.saleCount} vente{monthTotals.saleCount > 1 ? 's' : ''}</div>
        </div>
        <div className="odoo-stat-card">
          <div className="odoo-stat-card-label"><Coins size={11} style={{ display: 'inline', marginRight: 4 }} />Recettes</div>
          <div className="odoo-stat-card-value">{n(monthTotals.totalRecettes)} <span style={{ fontSize: '0.6875rem', color: 'var(--theme-text-muted)', fontWeight: 400 }}>DH</span></div>
          <div className="odoo-stat-card-sub">
            Cash {n(monthTotals.cashCaissiere)} · Carte {n(monthTotals.cardReceipts)}
            {monthTotals.entries > 0 && ` · Autres ${n(monthTotals.entries)}`}
          </div>
        </div>
        <div className="odoo-stat-card">
          <div className="odoo-stat-card-label"><Scale size={11} style={{ display: 'inline', marginRight: 4 }} />Écart caisse</div>
          <div className="odoo-stat-card-value" style={{ color: monthTotals.ecart === 0 ? 'var(--theme-text-muted)' : monthTotals.ecart > 0 ? '#28a745' : '#dc3545' }}>
            {monthTotals.ecart > 0 ? '+' : ''}{n(monthTotals.ecart)} <span style={{ fontSize: '0.6875rem', color: 'var(--theme-text-muted)', fontWeight: 400 }}>DH</span>
          </div>
          <div className="odoo-stat-card-sub">Caissière vs Système</div>
        </div>
        <div className="odoo-stat-card">
          <div className="odoo-stat-card-label"><Wallet size={11} style={{ display: 'inline', marginRight: 4 }} />Solde actuel</div>
          <div className="odoo-stat-card-value" style={{ color: monthTotals.solde >= 0 ? '#28a745' : '#dc3545' }}>
            {n(monthTotals.solde)} <span style={{ fontSize: '0.6875rem', color: 'var(--theme-text-muted)', fontWeight: 400 }}>DH</span>
          </div>
          <div className="odoo-stat-card-sub">Cash {n(monthTotals.cashNet)} · Carte {n(monthTotals.cardCumul)}</div>
        </div>
      </div>

      {/* Écart caisse alert */}
      {monthTotals.ecart !== 0 && (
        <div className={`odoo-alert ${monthTotals.ecart > 0 ? 'warning' : 'danger'}`}>
          <AlertTriangle size={13} style={{ display: 'inline', marginRight: 6 }} />
          Écart caisse du mois : <strong>{monthTotals.ecart > 0 ? '+' : ''}{n(monthTotals.ecart)} DH</strong> (Cash caissière vs Cash système)
        </div>
      )}

      {/* Reconciliation alerts — significant daily discrepancies */}
      {(data as Record<string, any>)?.reconciliationAlerts && ((data as Record<string, any>).reconciliationAlerts as { date: string; ecart: number }[]).length > 0 && (
        <div className="odoo-section">
          <div className="odoo-section-header">
            <AlertTriangle size={13} style={{ display: 'inline', marginRight: 6, color: '#dc3545' }} />
            {((data as Record<string, any>).reconciliationAlerts as { date: string; ecart: number }[]).length} jour(s) avec écart caisse significatif (&gt; 5 DH)
          </div>
          <table className="odoo-table" style={{ margin: 0 }}>
            <tbody>
              {((data as Record<string, any>).reconciliationAlerts as { date: string; cashCaissiere: number; cashSysteme: number; ecart: number }[]).map(a => (
                <tr key={a.date}>
                  <td><span className="odoo-status-dot danger" /></td>
                  <td style={{ textTransform: 'capitalize' }}>{format(parseLocalDate(a.date), 'EEEE dd/MM', { locale: fr })}</td>
                  <td style={{ color: 'var(--theme-text-muted)' }}>Caissière {n(a.cashCaissiere)}</td>
                  <td style={{ color: 'var(--theme-text-muted)' }}>Système {n(a.cashSysteme)}</td>
                  <td style={{ textAlign: 'right' }}><span className="odoo-tag odoo-tag-red">{a.ecart > 0 ? '+' : ''}{n(a.ecart)} DH</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Daily sections */}
      {isLoading ? (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '3rem' }}>
          <Loader2 size={20} className="animate-spin" style={{ color: 'var(--theme-text-muted)' }} />
          <span style={{ marginLeft: 8, fontSize: '0.8125rem', color: 'var(--theme-text-muted)' }}>Chargement...</span>
        </div>
      ) : days.length === 0 ? (
        <div style={{ padding: '3rem', textAlign: 'center', color: 'var(--theme-text-muted)' }}>
          <Wallet size={28} style={{ margin: '0 auto 0.5rem', opacity: 0.4 }} />
          <p style={{ fontSize: '0.8125rem' }}>Aucune activité pour ce mois</p>
        </div>
      ) : (
        <div className="odoo-section">
          <div className="odoo-section-header">Journal quotidien</div>
          <table className="odoo-table" style={{ margin: 0 }}>
            <thead>
              <tr>
                <th style={{ width: 20 }}></th>
                <th>Date</th>
                <th style={{ textAlign: 'right' }}>Ventes</th>
                <th style={{ textAlign: 'right' }}>Cash caissière</th>
                <th style={{ textAlign: 'right' }}>Carte</th>
                <th style={{ textAlign: 'right' }}>Écart</th>
                <th style={{ textAlign: 'right' }}>Solde cumulé</th>
              </tr>
            </thead>
            <tbody>
              {days.map(day => {
                const expanded = expandedDays.has(day.dayNum);
                const dateLabel = format(parseLocalDate(day.date), 'EEEE dd MMM', { locale: fr });
                const ecartTagClass = day.ecart === 0 ? 'odoo-tag-grey'
                  : day.ecart > 0 ? 'odoo-tag-green' : 'odoo-tag-red';
                return (
                  <Fragment key={day.dayNum}>
                    <tr onClick={() => toggleDay(day.dayNum)} style={{ cursor: 'pointer' }}>
                      <td style={{ color: 'var(--theme-text-muted)' }}>
                        {expanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
                      </td>
                      <td style={{ textTransform: 'capitalize', fontWeight: 600 }}>{dateLabel}</td>
                      <td style={{ textAlign: 'right' }}>{day.totalSales > 0 ? n(day.totalSales) : <span style={{ color: 'var(--theme-bg-separator)' }}>—</span>}</td>
                      <td style={{ textAlign: 'right' }}>{day.cashCaissiere > 0 ? n(day.cashCaissiere) : <span style={{ color: 'var(--theme-bg-separator)' }}>—</span>}</td>
                      <td style={{ textAlign: 'right' }}>{day.cardReceipt > 0 ? n(day.cardReceipt) : <span style={{ color: 'var(--theme-bg-separator)' }}>—</span>}</td>
                      <td style={{ textAlign: 'right' }}>
                        {day.ecart !== 0 ? <span className={`odoo-tag ${ecartTagClass}`}>{day.ecart > 0 ? '+' : ''}{n(day.ecart)}</span> : <span style={{ color: 'var(--theme-bg-separator)' }}>—</span>}
                      </td>
                      <td style={{ textAlign: 'right', fontWeight: 700, color: day.solde >= 0 ? '#28a745' : '#dc3545' }}>{n(day.solde)}</td>
                    </tr>
                    {expanded && (
                      <tr>
                        <td colSpan={7} style={{ background: 'var(--theme-bg-subtle, rgba(0,0,0,0.02))', padding: '12px 16px' }}>
                          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 12 }}>
                            <div>
                              <div style={{ fontSize: '0.6875rem', textTransform: 'uppercase', color: 'var(--theme-text-muted)', letterSpacing: '0.05em' }}>Cash système</div>
                              <div style={{ fontWeight: 600, fontSize: '0.875rem' }}>{n(day.cashSysteme)} DH</div>
                            </div>
                            <div>
                              <div style={{ fontSize: '0.6875rem', textTransform: 'uppercase', color: 'var(--theme-text-muted)', letterSpacing: '0.05em' }}>Cash caissière</div>
                              <div style={{ fontWeight: 600, fontSize: '0.875rem' }}>{n(day.cashCaissiere)} DH</div>
                            </div>
                            <div>
                              <div style={{ fontSize: '0.6875rem', textTransform: 'uppercase', color: 'var(--theme-text-muted)', letterSpacing: '0.05em' }}>Carte</div>
                              <div style={{ fontWeight: 600, fontSize: '0.875rem' }}>{n(day.cardReceipt)} DH</div>
                            </div>
                            <div>
                              <div style={{ fontSize: '0.6875rem', textTransform: 'uppercase', color: 'var(--theme-text-muted)', letterSpacing: '0.05em' }}>Solde cash</div>
                              <div style={{ fontWeight: 600, fontSize: '0.875rem' }}>{n(day.cashNetCumul)} DH</div>
                            </div>
                            <div>
                              <div style={{ fontSize: '0.6875rem', textTransform: 'uppercase', color: 'var(--theme-text-muted)', letterSpacing: '0.05em' }}>Solde carte</div>
                              <div style={{ fontWeight: 600, fontSize: '0.875rem' }}>{n(day.cardCumul)} DH</div>
                            </div>
                          </div>
                          {day.entries > 0 && day.payments.filter(p => p.type === 'income').length > 0 && (
                            <div style={{ marginTop: 10, paddingTop: 10, borderTop: '1px solid var(--theme-bg-separator)' }}>
                              <div style={{ fontSize: '0.6875rem', textTransform: 'uppercase', color: 'var(--theme-text-muted)', letterSpacing: '0.05em', marginBottom: 4 }}>Autres entrées</div>
                              {day.payments.filter(p => p.type === 'income').map((p, idx) => {
                                const amount = parseFloat(p.amount as string) || 0;
                                return (
                                  <div key={idx} style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.8125rem', padding: '2px 0' }}>
                                    <span style={{ color: 'var(--theme-text-muted)' }}>{(p.description as string) || (p.category_name as string) || 'Revenu'}</span>
                                    <span style={{ fontWeight: 600, color: '#28a745' }}>+{n(amount)} DH</span>
                                  </div>
                                );
                              })}
                            </div>
                          )}
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Monthly recap */}
      {days.length > 0 && (
        <div className="odoo-section">
          <div className="odoo-section-header">
            <BarChart3 size={13} style={{ display: 'inline', marginRight: 6 }} />
            Récap {MONTH_NAMES[month - 1]} {year}
          </div>
          <table className="odoo-table" style={{ margin: 0 }}>
            <tbody>
              <tr>
                <td style={{ color: 'var(--theme-text-muted)' }}>Total Ventes ({monthTotals.saleCount})</td>
                <td style={{ textAlign: 'right', fontWeight: 600 }}>{n(monthTotals.totalSales)} DH</td>
              </tr>
              <tr>
                <td style={{ color: 'var(--theme-text-muted)' }}>Cash Caissière</td>
                <td style={{ textAlign: 'right', fontWeight: 600 }}>{n(monthTotals.cashCaissiere)} DH</td>
              </tr>
              <tr>
                <td style={{ color: 'var(--theme-text-muted)' }}>Carte Encaissée</td>
                <td style={{ textAlign: 'right', fontWeight: 600 }}>{n(monthTotals.cardReceipts)} DH</td>
              </tr>
              {monthTotals.entries > 0 && (
                <tr>
                  <td style={{ color: 'var(--theme-text-muted)' }}>Autres Entrées</td>
                  <td style={{ textAlign: 'right', fontWeight: 600 }}>{n(monthTotals.entries)} DH</td>
                </tr>
              )}
              <tr>
                <td style={{ fontWeight: 600 }}>Total Recettes</td>
                <td style={{ textAlign: 'right', fontWeight: 700, color: '#28a745' }}>{n(monthTotals.totalRecettes)} DH</td>
              </tr>
              {monthTotals.ecart !== 0 && (
                <tr>
                  <td style={{ color: 'var(--theme-text-muted)' }}>Écart Caisse</td>
                  <td style={{ textAlign: 'right', fontWeight: 600, color: monthTotals.ecart > 0 ? '#28a745' : '#dc3545' }}>
                    {monthTotals.ecart > 0 ? '+' : ''}{n(monthTotals.ecart)} DH
                  </td>
                </tr>
              )}
              <tr style={{ borderTop: '2px solid var(--theme-bg-separator)' }}>
                <td style={{ fontWeight: 700, fontSize: '0.9375rem' }}>Solde Final</td>
                <td style={{ textAlign: 'right', fontWeight: 700, fontSize: '1.125rem', color: monthTotals.solde >= 0 ? '#28a745' : '#dc3545' }}>{n(monthTotals.solde)} DH</td>
              </tr>
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

/* ═══════════════════════ CHARGES & DEPENSES TAB ═══════════════════════ */
/* Tout ce qui sort : achats fournisseurs, salaires, depenses diverses */
function ChargesTab() {
  const { entries: paymentMethods, getLabel: getPaymentLabel } = useReferentiel('payment_methods');
  const queryClient = useQueryClient();
  const now = new Date();
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [year, setYear] = useState(now.getFullYear());
  const [showForm, setShowForm] = useState(false);
  const [editingPayment, setEditingPayment] = useState<Record<string, any> | null>(null);
  // Modal de categorisation d'une facture (s'applique a toutes ses lignes)
  const [categorizingInvoice, setCategorizingInvoice] = useState<Record<string, any> | null>(null);
  const [categorizingCategoryId, setCategorizingCategoryId] = useState<string>('');
  const [filterRoot, setFilterRoot] = useState<string>('all');
  const [filterLeaf, setFilterLeaf] = useState<string>('all');
  const [filterMethod, setFilterMethod] = useState<string>('all');
  const [searchTerm, setSearchTerm] = useState<string>('');
  // Plage de dates pour filtrer dans la periode chargee (mois courant par defaut).
  // Format ISO YYYY-MM-DD. Vide = pas de borne sur ce cote.
  const [filterDateFrom, setFilterDateFrom] = useState<string>('');
  const [filterDateTo, setFilterDateTo] = useState<string>('');
  const [sortCol, setSortCol] = useState<string>('date');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  useEffect(() => {
    // Init la cascade categorie a l'ouverture du modal d'edition
    setEditCategoryId(editingPayment ? (editingPayment.category_id as string) || '' : '');
  }, [editingPayment]);

  const dateFrom = `${year}-${String(month).padStart(2, '0')}-01`;
  const lastDay = new Date(year, month, 0).getDate();
  const dateTo = `${year}-${String(month).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;

  const { data: payments = [], isLoading: isLoadingPayments } = useQuery({
    queryKey: ['payments-charges', year, month],
    queryFn: () => paymentsApi.list({ dateFrom, dateTo }),
  });
  // Achats fournisseurs : on lit les lignes des factures INTEGRALEMENT PAYEES
  // (status = 'paid'), datees a la date du dernier paiement (MAX(payments)).
  // Logique tresorerie : la charge apparait quand le cash est sorti, pas a la
  // date facture. Les impayees/partielles ne sont pas la — visibles dans
  // l'onglet "Factures recues" du module Achats.
  const { data: invoiceLines = [], isLoading: isLoadingLines } = useQuery({
    queryKey: ['invoice-line-expenses', year, month],
    queryFn: () => invoicesApi.lineExpenses({ dateFrom, dateTo }),
  });
  const isLoading = isLoadingPayments || isLoadingLines;
  const { data: suppliers = [] } = useQuery({ queryKey: ['suppliers'], queryFn: suppliersApi.list });
  const { data: employees = [] } = useQuery({ queryKey: ['employees'], queryFn: employeesApi.list });
  const { data: categories = [] } = useQuery({ queryKey: ['expense-categories'], queryFn: () => expenseCategoriesApi.list() });
  const { data: eligiblePOs = [] } = useQuery({ queryKey: ['eligible-pos'], queryFn: purchaseOrdersApi.eligible });

  // Form state for new expense
  const [formCategoryId, setFormCategoryId] = useState<string>('');
  const [formPOId, setFormPOId] = useState<string>('');
  // State du modal "Modifier la depense" : cascade categorie controllee
  const [editCategoryId, setEditCategoryId] = useState<string>('');

  // Check if selected category requires a PO (look up the leaf category)
  const selectedCategory = (categories as Record<string, any>[]).find(c => String(c.id) === formCategoryId);
  // ─── BC OBLIGATOIRE — DESACTIVE TEMPORAIREMENT ───────────────────
  // Pour reactiver : passer ENFORCE_PO_REQUIREMENT a true.
  // L'info `categoryRequiresPO` reste calculee pour afficher une banniere
  // d'avertissement sur les categories concernees.
  const ENFORCE_PO_REQUIREMENT = false;
  const categoryRequiresPO = selectedCategory ? (selectedCategory.requires_po as boolean) : false;
  const requiresPO = ENFORCE_PO_REQUIREMENT && categoryRequiresPO;
  const showPOWaivedBanner = !ENFORCE_PO_REQUIREMENT && categoryRequiresPO;

  /**
   * Detection "depense de personnel" : on remonte les parents de la categorie
   * selectionnee jusqu'a la racine (level 1). Si la racine est "Charges de
   * personnel", on bascule le selecteur Fournisseur en selecteur Employe.
   * UUID stable du seed migrations/019.
   */
  const PERSONNEL_ROOT_ID = '10000000-0000-0000-0000-000000000004';
  const isPersonnelCategory = (catId: string | null): boolean => {
    if (!catId) return false;
    const all = categories as Record<string, any>[];
    let current = all.find(c => String(c.id) === catId);
    // Garde-fou contre les boucles dans le graphe categories
    const seen = new Set<string>();
    while (current) {
      const id = String(current.id);
      if (seen.has(id)) return false;
      seen.add(id);
      if (id === PERSONNEL_ROOT_ID) return true;
      if (!current.parent_id) return false;
      current = all.find(c => String(c.id) === String(current!.parent_id));
    }
    return false;
  };
  const isPersonnelExpense = isPersonnelCategory(formCategoryId);

  // Build full path label for display: "Categorie > Sous-cat > Type"
  const getCategoryPath = (catId: string) => {
    const all = categories as Record<string, any>[];
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
  const selectedPO = (eligiblePOs as Record<string, any>[]).find(po => po.id === formPOId);

  const createMutation = useMutation({
    mutationFn: (data: Record<string, any>) => paymentsApi.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['payments-charges'] });
      queryClient.invalidateQueries({ queryKey: ['caisse-register'] });
      notify.success('Dépense enregistrée');
      setShowForm(false);
      setFormCategoryId('');
      setFormPOId('');
    },
    onError: (err: unknown) => {
      const msg = err && typeof err === 'object' && 'response' in err
        ? (err as { response?: { data?: { error?: { message?: string } } } }).response?.data?.error?.message
        : null;
      notify.error(msg || 'Erreur lors de l\'enregistrement');
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Record<string, any> }) => paymentsApi.update(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['payments-charges'] });
      queryClient.invalidateQueries({ queryKey: ['caisse-register'] });
      notify.success('Modifié avec succès');
      setEditingPayment(null);
    },
    onError: (err: unknown) => {
      const msg = err && typeof err === 'object' && 'response' in err
        ? (err as { response?: { data?: { error?: { message?: string } } } }).response?.data?.error?.message
        : null;
      notify.error(msg || 'Erreur lors de la modification');
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => paymentsApi.remove(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['payments-charges'] });
      queryClient.invalidateQueries({ queryKey: ['caisse-register'] });
      notify.success('Supprimé');
    },
  });

  // Categorise une facture en bloc (touche toutes les lignes derivees).
  const updateInvoiceCategoryMutation = useMutation({
    mutationFn: ({ id, categoryId }: { id: string; categoryId: string | null }) =>
      invoicesApi.updateCategory(id, categoryId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['invoice-line-expenses'] });
      notify.success('Facture categorisee');
      setCategorizingInvoice(null);
      setCategorizingCategoryId('');
    },
    onError: () => notify.error('Erreur lors de la categorisation'),
  });

  // Sorties affichees :
  //   - payments hors income et hors invoice (les anciens reglements cheque
  //     ne sont plus la source des achats),
  //   - + 1 ligne par ingredient de facture recue (via invoicesApi.lineExpenses).
  const otherPayments = (payments as Record<string, any>[]).filter(p => p.type !== 'income' && p.type !== 'invoice');
  const outgoing = useMemo(
    () => [...(invoiceLines as Record<string, any>[]), ...otherPayments],
    [invoiceLines, otherPayments]
  );

  const grandTotal = useMemo(() => outgoing.reduce((s, p) => s + (parseFloat(p.amount as string) || 0), 0), [outgoing]);

  // Category tree helpers
  const catMap = useMemo(() => {
    const m: Record<string, any> = {};
    (categories as any[]).forEach(c => { m[String(c.id)] = c; });
    return m;
  }, [categories]);

  const getRootId = (catId: string | null): string | null => {
    if (!catId) return null;
    let c = catMap[catId]; let limit = 4;
    while (c && limit-- > 0) {
      if (c.level === 1) return String(c.id);
      if (!c.parent_id) return null;
      c = catMap[String(c.parent_id)];
    }
    return null;
  };

  const getSubId = (catId: string | null): string | null => {
    if (!catId) return null;
    const c = catMap[catId];
    if (!c) return null;
    if (c.level === 2) return String(c.id);
    if (c.level === 3) { const par = catMap[String(c.parent_id)]; if (par?.level === 2) return String(par.id); }
    return null;
  };

  // Root categories that have payments, sorted by display_order
  const rootCatsWithPayments = useMemo(() => {
    const rootIds = new Set<string>();
    outgoing.forEach(p => { const rid = getRootId(p.category_id as string | null); rootIds.add(rid ?? '__none__'); });
    const roots = (categories as any[])
      .filter(c => c.level === 1 && rootIds.has(String(c.id)))
      .sort((a, b) => (a.display_order || 99) - (b.display_order || 99));
    if (rootIds.has('__none__')) roots.push({ id: '__none__', name: 'Sans catégorie', level: 1, display_order: 999 });
    return roots;
  }, [categories, outgoing]);


  // Top 3 root categories by total for stat cards
  const topCats = useMemo(() => rootCatsWithPayments
    .map(rc => ({
      ...rc,
      total: (outgoing.filter(p => (getRootId(p.category_id as string | null) ?? '__none__') === String(rc.id))
        .reduce((s, p) => s + (parseFloat(p.amount as string) || 0), 0)),
    }))
    .sort((a, b) => b.total - a.total)
    .slice(0, 3),
  [rootCatsWithPayments, outgoing]);

  // Leaf categories available for the current root filter
  const availableLeaves = useMemo(() => {
    const base = filterRoot === 'all' ? outgoing : outgoing.filter(p => (getRootId(p.category_id as string | null) ?? '__none__') === filterRoot);
    const leaves = new Set<string>();
    base.forEach(p => { if (p.category_name) leaves.add(p.category_name as string); });
    return Array.from(leaves).sort();
  }, [outgoing, filterRoot, catMap]);

  // Filtered + sorted rows
  const displayed = useMemo(() => {
    let list = outgoing;
    if (filterRoot !== 'all') list = list.filter(p => (getRootId(p.category_id as string | null) ?? '__none__') === filterRoot);
    if (filterLeaf !== 'all') list = list.filter(p => (p.category_name as string || '') === filterLeaf);
    if (filterMethod !== 'all') list = list.filter(p => (p.payment_method as string || '') === filterMethod);
    // Filtre plage de dates : compare la portion YYYY-MM-DD (ISO lexicographique).
    if (filterDateFrom) list = list.filter(p => String(p.payment_date || '').slice(0, 10) >= filterDateFrom);
    if (filterDateTo) list = list.filter(p => String(p.payment_date || '').slice(0, 10) <= filterDateTo);
    // Recherche texte sur designation/description, beneficiaire, reference, N° facture, categorie
    const q = searchTerm.trim().toLowerCase();
    if (q) {
      list = list.filter(p => {
        const beneficiaire = (p.supplier_name as string) ||
          (p.employee_first_name ? `${p.employee_first_name} ${p.employee_last_name}` : '');
        const rid = getRootId(p.category_id as string | null);
        const rootName = rid ? (catMap[rid]?.name as string || '') : '';
        const fields = [
          p.description as string, p.designation as string,
          p.reference as string, p.invoice_number as string,
          beneficiaire, p.category_name as string, rootName,
        ];
        return fields.some(f => (f || '').toLowerCase().includes(q));
      });
    }
    return [...list].sort((a, b) => {
      let va: any = '', vb: any = '';
      if (sortCol === 'date') { va = a.payment_date; vb = b.payment_date; }
      else if (sortCol === 'cat') { const ra = getRootId(a.category_id as string | null); const rb = getRootId(b.category_id as string | null); va = ra ? catMap[ra]?.name || '' : ''; vb = rb ? catMap[rb]?.name || '' : ''; }
      else if (sortCol === 'type') { va = a.category_name || ''; vb = b.category_name || ''; }
      else if (sortCol === 'amount') { va = parseFloat(a.amount) || 0; vb = parseFloat(b.amount) || 0; }
      else if (sortCol === 'beneficiaire') { va = a.supplier_name || (a.employee_first_name ? `${a.employee_first_name} ${a.employee_last_name}` : ''); vb = b.supplier_name || (b.employee_first_name ? `${b.employee_first_name} ${b.employee_last_name}` : ''); }
      const cmp = va < vb ? -1 : va > vb ? 1 : 0;
      return sortDir === 'asc' ? cmp : -cmp;
    });
  }, [outgoing, filterRoot, filterLeaf, filterMethod, filterDateFrom, filterDateTo, searchTerm, sortCol, sortDir, catMap]);

  const displayedTotal = useMemo(() => displayed.reduce((s, p) => s + (parseFloat(p.amount as string) || 0), 0), [displayed]);

  const toggleSort = (col: string) => { if (sortCol === col) setSortDir(d => d === 'asc' ? 'desc' : 'asc'); else { setSortCol(col); setSortDir('asc'); } };
  const SortIcon = ({ col }: { col: string }) => sortCol === col ? <span style={{ marginLeft: 3, opacity: 0.7, fontSize: '0.625rem' }}>{sortDir === 'asc' ? '▲' : '▼'}</span> : <span style={{ marginLeft: 3, opacity: 0.2, fontSize: '0.625rem' }}>▼</span>;

  const handleExport = () => {
    const rows = displayed.map(p => [
      fmtPaymentDate(p.payment_date, 'fr'),
      (p.reference as string) || '',
      (() => { const rid = getRootId(p.category_id as string | null); return rid ? catMap[rid]?.name || '' : ''; })(),
      (p.category_name as string) || '',
      (p.supplier_name as string) || (p.employee_first_name ? `${p.employee_first_name} ${p.employee_last_name}` : ''),
      (p.designation as string) || '',
      getPaymentLabel(p.payment_method as string) || '',
      (p.description as string) || '',
      n(parseFloat(p.amount as string) || 0),
    ]);
    exportCSV(`charges_${MONTH_NAMES[month - 1]}_${year}.csv`,
      ['DATE', 'REF', 'CATEGORIE', 'SOUS-CATEGORIE', 'BENEFICIAIRE', 'METHODE', 'DESCRIPTION', 'MONTANT (DH)'], rows);
  };


  return (
    <>
      {/* Search panel : period + actions */}
      <div className="odoo-search-panel">
        <select value={month} onChange={e => setMonth(+e.target.value)} className="odoo-filter-dropdown" style={{ minWidth: 120 }}>
          {MONTH_NAMES.map((m, i) => <option key={i} value={i + 1}>{m}</option>)}
        </select>
        <input type="number" value={year} onChange={e => setYear(+e.target.value)}
          className="odoo-filter-dropdown" style={{ width: 80 }} />
        <div style={{ flex: 1 }} />
        <button onClick={handleExport} className="odoo-btn-secondary"
          style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          <Download size={13} /> Exporter
        </button>
        <button onClick={() => setShowForm(true)} className="odoo-btn-primary"
          style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          <Plus size={14} /> Nouvelle dépense
        </button>
      </div>

      {/* Stat tiles: total + top 3 categories */}
      <div className="odoo-stat-grid">
        <div className="odoo-stat-card">
          <div className="odoo-stat-card-label"><ArrowDownRight size={11} style={{ display: 'inline', marginRight: 4 }} />Total sorties</div>
          <div className="odoo-stat-card-value" style={{ color: '#dc3545' }}>{n(grandTotal)} <span style={{ fontSize: '0.6875rem', color: 'var(--theme-text-muted)', fontWeight: 400 }}>DH</span></div>
          <div className="odoo-stat-card-sub">{outgoing.length} opération{outgoing.length > 1 ? 's' : ''}</div>
        </div>
        {topCats.map(tc => (
          <div key={tc.id} className="odoo-stat-card">
            <div className="odoo-stat-card-label">{tc.name}</div>
            <div className="odoo-stat-card-value">{n(tc.total)} <span style={{ fontSize: '0.6875rem', color: 'var(--theme-text-muted)', fontWeight: 400 }}>DH</span></div>
            <div className="odoo-stat-card-sub">{grandTotal > 0 ? Math.round(tc.total / grandTotal * 100) : 0}% du total</div>
          </div>
        ))}
      </div>

      {/* Filter bar : recherche + filtres + reset */}
      <div className="odoo-search-panel" style={{ flexWrap: 'wrap', gap: 6 }}>
        <div style={{ display: 'inline-flex', alignItems: 'center', gap: 4, flex: '1 1 220px', minWidth: 180 }}>
          <Search size={13} style={{ color: 'var(--theme-text-muted)', flexShrink: 0 }} />
          <input type="text"
            placeholder="Rechercher (description, bénéficiaire, réf, catégorie...)"
            value={searchTerm}
            onChange={e => setSearchTerm(e.target.value)}
            className="odoo-search-input"
            style={{ flex: 1, minWidth: 0 }} />
          {searchTerm && (
            <button onClick={() => setSearchTerm('')} title="Effacer la recherche"
              style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 2, color: 'var(--theme-text-muted)', display: 'inline-flex' }}>
              <X size={12} />
            </button>
          )}
        </div>
        <select value={filterRoot} onChange={e => { setFilterRoot(e.target.value); setFilterLeaf('all'); }} className="odoo-filter-dropdown">
          <option value="all">Toutes catégories</option>
          {rootCatsWithPayments.map(rc => <option key={String(rc.id)} value={String(rc.id)}>{rc.name}</option>)}
        </select>
        <select value={filterLeaf} onChange={e => setFilterLeaf(e.target.value)} className="odoo-filter-dropdown">
          <option value="all">Tous types</option>
          {availableLeaves.map(l => <option key={l} value={l}>{l}</option>)}
        </select>
        <select value={filterMethod} onChange={e => setFilterMethod(e.target.value)} className="odoo-filter-dropdown">
          <option value="all">Toutes méthodes</option>
          {paymentMethods.map(m => <option key={m.code} value={m.code}>{m.label}</option>)}
        </select>
        <div style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}
          title="Filtre date : restreint a une plage dans la periode chargee">
          <span style={{ fontSize: '0.7rem', color: 'var(--theme-text-muted)' }}>Du</span>
          <input type="date" value={filterDateFrom}
            onChange={e => setFilterDateFrom(e.target.value)}
            min={dateFrom} max={dateTo}
            className="odoo-filter-dropdown"
            style={{ padding: '4px 6px' }} />
          <span style={{ fontSize: '0.7rem', color: 'var(--theme-text-muted)' }}>au</span>
          <input type="date" value={filterDateTo}
            onChange={e => setFilterDateTo(e.target.value)}
            min={dateFrom} max={dateTo}
            className="odoo-filter-dropdown"
            style={{ padding: '4px 6px' }} />
        </div>
        {(filterRoot !== 'all' || filterLeaf !== 'all' || filterMethod !== 'all' || filterDateFrom || filterDateTo || searchTerm) && (
          <button onClick={() => { setFilterRoot('all'); setFilterLeaf('all'); setFilterMethod('all'); setFilterDateFrom(''); setFilterDateTo(''); setSearchTerm(''); }}
            className="odoo-filter-dropdown" style={{ color: '#dc3545', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
            <X size={11} /> Réinitialiser
          </button>
        )}
        <span style={{ marginLeft: 'auto', fontSize: '0.75rem', color: 'var(--theme-text-muted)', alignSelf: 'center' }}>
          {displayed.length !== outgoing.length ? `${displayed.length} / ${outgoing.length} résultats` : `${displayed.length} résultat${displayed.length > 1 ? 's' : ''}`}
        </span>
      </div>

      {/* Flat table with referentiel columns */}
      {isLoading ? (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '3rem' }}>
          <Loader2 size={20} className="animate-spin" style={{ color: 'var(--theme-text-muted)' }} />
          <span style={{ marginLeft: 8, fontSize: '0.8125rem', color: 'var(--theme-text-muted)' }}>Chargement...</span>
        </div>
      ) : outgoing.length === 0 ? (
        <div style={{ padding: '3rem', textAlign: 'center', color: 'var(--theme-text-muted)' }}>
          <Receipt size={28} style={{ margin: '0 auto 0.5rem', opacity: 0.4 }} />
          <p style={{ fontSize: '0.8125rem' }}>Aucune sortie pour cette période</p>
        </div>
      ) : displayed.length === 0 ? (
        <div style={{ padding: '3rem', textAlign: 'center', color: 'var(--theme-text-muted)' }}>
          <Receipt size={28} style={{ margin: '0 auto 0.5rem', opacity: 0.4 }} />
          <p style={{ fontSize: '0.8125rem' }}>Aucune sortie ne correspond à ces filtres</p>
          <button onClick={() => { setFilterRoot('all'); setFilterLeaf('all'); setFilterMethod('all'); setFilterDateFrom(''); setFilterDateTo(''); setSearchTerm(''); }}
            style={{ marginTop: 8, color: '#0d6efd', background: 'none', border: 'none', cursor: 'pointer', fontSize: '0.75rem', textDecoration: 'underline' }}>
            Réinitialiser les filtres
          </button>
        </div>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table className="odoo-table">
            <thead>
              <tr>
                <th onClick={() => toggleSort('date')} style={{ cursor: 'pointer', userSelect: 'none', whiteSpace: 'nowrap' }}>Date<SortIcon col="date" /></th>
                <th>Désignation</th>
                <th onClick={() => toggleSort('beneficiaire')} style={{ cursor: 'pointer', userSelect: 'none' }}>Bénéficiaire<SortIcon col="beneficiaire" /></th>
                <th onClick={() => toggleSort('cat')} style={{ cursor: 'pointer', userSelect: 'none' }}>Catégorie<SortIcon col="cat" /></th>
                <th onClick={() => toggleSort('type')} style={{ cursor: 'pointer', userSelect: 'none' }}>Type<SortIcon col="type" /></th>
                <th>Méthode</th>
                <th onClick={() => toggleSort('amount')} style={{ cursor: 'pointer', userSelect: 'none', textAlign: 'right' }}>Montant<SortIcon col="amount" /></th>
                <th style={{ textAlign: 'center', width: 72 }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {displayed.map(p => {
                const rootId = getRootId(p.category_id as string | null);
                const rootName = rootId ? catMap[rootId]?.name || '—' : '—';
                const leafName = p.category_name as string || '—';
                const isRootLeaf = rootId && catMap[rootId]?.name === leafName;
                return (
                  <tr key={p.id as string}>
                    <td style={{ color: 'var(--theme-text-muted)', whiteSpace: 'nowrap' }}>{fmtPaymentDate(p.payment_date, 'fr')}</td>
                    <td style={{ color: 'var(--theme-text-muted)', fontStyle: 'italic', maxWidth: 240, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {(p.description as string) || '—'}
                    </td>
                    <td style={{ fontWeight: 500, maxWidth: 130, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {p.supplier_name as string || (p.employee_first_name ? `${p.employee_first_name} ${p.employee_last_name}` : '—')}
                    </td>
                    <td style={{ whiteSpace: 'nowrap' }}>
                      <span style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--theme-text)' }}>{rootName}</span>
                    </td>
                    <td>
                      {!isRootLeaf && leafName !== '—' ? (
                        <span className="odoo-tag odoo-tag-grey">{leafName}</span>
                      ) : <span style={{ color: 'var(--theme-bg-separator)' }}>—</span>}
                    </td>
                    <td style={{ color: 'var(--theme-text-muted)', fontSize: '0.6875rem' }}>{getPaymentLabel(p.payment_method as string)}</td>
                    <td style={{ textAlign: 'right', fontWeight: 700, color: '#dc3545', whiteSpace: 'nowrap' }}>
                      {n(parseFloat(p.amount as string))} <span style={{ fontSize: '0.6875rem', color: 'var(--theme-text-muted)', fontWeight: 400 }}>DH</span>
                    </td>
                    <td style={{ textAlign: 'center' }}>
                      {p.type === 'invoice' ? (
                        <button
                          onClick={() => {
                            setCategorizingInvoice(p);
                            setCategorizingCategoryId((p.category_id as string) || '');
                          }}
                          style={{ padding: 4, border: 'none', background: 'transparent', cursor: 'pointer', color: 'var(--theme-text-muted)' }}
                          title="Categoriser la facture (s'applique a toutes ses lignes)">
                          <Pencil size={13} />
                        </button>
                      ) : p.type !== 'salary' ? (
                        <div style={{ display: 'inline-flex', gap: 4 }}>
                          <button onClick={() => setEditingPayment(p)} style={{ padding: 4, border: 'none', background: 'transparent', cursor: 'pointer', color: 'var(--theme-text-muted)' }} title="Modifier"><Pencil size={13} /></button>
                          <button onClick={() => deleteMutation.mutate(p.id as string)} style={{ padding: 4, border: 'none', background: 'transparent', cursor: 'pointer', color: '#dc3545' }} title="Supprimer"><X size={13} /></button>
                        </div>
                      ) : <span style={{ fontSize: '0.6875rem', color: 'var(--theme-bg-separator)' }}>auto</span>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr style={{ background: 'var(--theme-bg-subtle, rgba(0,0,0,0.03))', borderTop: '2px solid var(--theme-bg-separator)' }}>
                <td colSpan={6} style={{ padding: 12, fontWeight: 600 }}>
                  Total {MONTH_NAMES[month - 1]} {year} ({displayed.length} opération{displayed.length > 1 ? 's' : ''}{displayed.length !== outgoing.length ? ` filtrée${displayed.length > 1 ? 's' : ''}` : ''})
                </td>
                <td style={{ textAlign: 'right', fontWeight: 700, fontSize: '1rem', color: '#dc3545' }}>
                  {n(displayedTotal)} DH
                </td>
                <td></td>
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
              const fd = Object.fromEntries(new FormData(e.currentTarget)) as Record<string, any>;
              fd.amount = parseFloat(fd.amount as string);
              fd.type = 'expense';
              fd.categoryId = formCategoryId || undefined;
              if (requiresPO && formPOId) {
                fd.purchaseOrderId = formPOId;
                if (selectedPO) fd.supplierId = selectedPO.supplier_id as string;
              }
              if (!fd.supplierId) delete fd.supplierId;
              // Pour les depenses de personnel : on a un employeeId au lieu d'un supplierId.
              // Le payload backend (payments.create) supporte deja les deux champs.
              if (isPersonnelExpense) {
                delete fd.supplierId;
                if (!fd.employeeId) delete fd.employeeId;
              } else {
                delete fd.employeeId;
              }
              if (!fd.categoryId) { notify.error('Veuillez sélectionner une catégorie'); return; }
              if (requiresPO && !formPOId) { notify.error('Cette catégorie nécessite un bon de commande'); return; }
              createMutation.mutate(fd);
            }} className="p-5 space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">Categorie *</label>
                <CascadeCategorySelect
                  categories={categories as Record<string, any>[]}
                  value={formCategoryId}
                  onChange={(id) => { setFormCategoryId(id); setFormPOId(''); }}
                />
              </div>

              {showPOWaivedBanner && (
                <div className="bg-blue-50 border border-blue-200 rounded-xl p-3 text-xs text-blue-800">
                  ℹ️ Cette catégorie demande normalement un bon de commande, mais l'obligation est <strong>temporairement désactivée</strong>. Tu peux saisir la dépense directement.
                </div>
              )}
              {requiresPO && (
                <div className="bg-amber-50 border border-amber-200 rounded-xl p-4">
                  <label className="block text-sm font-medium mb-1.5 text-amber-800">
                    <ClipboardList size={14} className="inline mr-1" /> Bon de commande *
                  </label>
                  <select value={formPOId} onChange={e => setFormPOId(e.target.value)}
                    className="w-full px-3 py-2.5 border border-amber-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-amber-500 bg-white" required>
                    <option value="">Sélectionner un BC...</option>
                    {(eligiblePOs as Record<string, any>[]).map(po => (
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
                  {(eligiblePOs as Record<string, any>[]).length === 0 && (
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
                    {paymentMethods.map(m => <option key={m.code} value={m.code}>{m.label}</option>)}
                  </select></div>
                {!requiresPO && !isPersonnelExpense && (
                  <div><label className="block text-sm font-medium text-gray-700 mb-1.5">Fournisseur</label>
                    <select name="supplierId" className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-red-500">
                      <option value="">Aucun</option>
                      {(suppliers as Record<string, any>[]).filter(s => s.is_active).map(s => (
                        <option key={s.id as string} value={s.id as string}>{s.name as string}</option>
                      ))}
                    </select></div>
                )}
                {/* Categorie sous "Charges de personnel" : on affiche le selecteur Employe.
                    Le champ est obligatoire (un salaire/prime doit etre rattache a une ressource). */}
                {!requiresPO && isPersonnelExpense && (
                  <div><label className="block text-sm font-medium text-gray-700 mb-1.5">Ressource / Employé *</label>
                    <select name="employeeId" required className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-red-500">
                      <option value="">Choisir un employé...</option>
                      {(employees as Record<string, any>[])
                        .filter(emp => emp.is_active !== false)
                        .sort((a, b) => String(a.first_name || a.name || '').localeCompare(String(b.first_name || b.name || '')))
                        .map(emp => {
                          const fullName = [emp.first_name, emp.last_name].filter(Boolean).join(' ')
                            || (emp.name as string) || (emp.email as string) || 'Sans nom';
                          const role = emp.role || emp.position;
                          return (
                            <option key={emp.id as string} value={emp.id as string}>
                              {fullName}{role ? ` — ${role}` : ''}
                            </option>
                          );
                        })}
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
              const fd = Object.fromEntries(new FormData(e.currentTarget)) as Record<string, any>;
              fd.amount = parseFloat(fd.amount as string);
              // categoryId est gere par la cascade controllee, pas via FormData
              fd.categoryId = editCategoryId || null;
              updateMutation.mutate({ id: editingPayment.id as string, data: fd });
            }} className="p-5 space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div><label className="block text-sm font-medium text-gray-700 mb-1.5">Montant *</label>
                  <input name="amount" type="number" step="0.01" className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" required
                    defaultValue={parseFloat(editingPayment.amount as string) || 0} /></div>
                <div><label className="block text-sm font-medium text-gray-700 mb-1.5">Date *</label>
                  <input name="paymentDate" type="date" className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" required
                    defaultValue={fmtPaymentDate(editingPayment.payment_date)} /></div>
              </div>

              <div><label className="block text-sm font-medium text-gray-700 mb-1.5">Methode</label>
                <select name="paymentMethod" className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" defaultValue={editingPayment.payment_method as string || 'cash'}>
                  {paymentMethods.map(m => <option key={m.code} value={m.code}>{m.label}</option>)}
                </select></div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">Categorie</label>
                <CategoryCascadeSelector
                  value={editCategoryId}
                  onChange={setEditCategoryId}
                  type="expense"
                />
                {editingPayment.category_id && !editCategoryId && (
                  <p className="text-xs text-amber-600 mt-1">
                    Categorie actuelle : <span className="font-medium">{getCategoryPath(String(editingPayment.category_id))}</span>
                  </p>
                )}
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

      {/* Modal de categorisation d'une facture (impacte toutes ses lignes) */}
      {categorizingInvoice && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl w-full max-w-lg shadow-2xl overflow-hidden">
            <div className="bg-gradient-to-r from-amber-500 to-orange-500 p-5 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-white/20 flex items-center justify-center">
                  <Pencil size={18} className="text-white" />
                </div>
                <div>
                  <h2 className="text-lg font-bold text-white">Catégoriser la facture</h2>
                  <p className="text-xs text-white/80">
                    {(categorizingInvoice.invoice_number as string) || '—'} · {(categorizingInvoice.supplier_name as string) || ''}
                  </p>
                </div>
              </div>
              <button onClick={() => { setCategorizingInvoice(null); setCategorizingCategoryId(''); }} className="p-2 hover:bg-white/20 rounded-xl transition-colors">
                <X size={18} className="text-white" />
              </button>
            </div>
            <form onSubmit={e => {
              e.preventDefault();
              if (!categorizingCategoryId) { notify.error('Sélectionnez une catégorie'); return; }
              updateInvoiceCategoryMutation.mutate({
                id: categorizingInvoice.invoice_id as string,
                categoryId: categorizingCategoryId,
              });
            }} className="p-5 space-y-4">
              <div className="rounded-xl bg-amber-50 border border-amber-200 px-3 py-2 text-xs text-amber-800">
                Cette catégorie s&apos;applique à <strong>toutes les lignes</strong> de la facture (modifie <code>invoices.category_id</code>).
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">Catégorie *</label>
                <CategoryCascadeSelector
                  value={categorizingCategoryId}
                  onChange={setCategorizingCategoryId}
                  type="expense"
                />
                {categorizingInvoice.category_id && (
                  <p className="text-xs text-amber-600 mt-1">
                    Catégorie actuelle : <span className="font-medium">{getCategoryPath(String(categorizingInvoice.category_id))}</span>
                  </p>
                )}
              </div>
              <div className="flex gap-3 justify-end pt-2">
                <button type="button" onClick={() => { setCategorizingInvoice(null); setCategorizingCategoryId(''); }}
                  className="px-5 py-2.5 border border-gray-200 text-gray-700 rounded-xl font-medium hover:bg-gray-50 transition-all text-sm">Annuler</button>
                <button type="submit" disabled={updateInvoiceCategoryMutation.isPending}
                  className="px-5 py-2.5 bg-gradient-to-r from-amber-500 to-orange-500 text-white rounded-xl font-medium shadow-md hover:shadow-lg transition-all text-sm flex items-center gap-2">
                  {updateInvoiceCategoryMutation.isPending && <Loader2 size={14} className="animate-spin" />}
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
      {/* Search panel : period + actions */}
      <div className="odoo-search-panel">
        <select value={month} onChange={e => setMonth(+e.target.value)} className="odoo-filter-dropdown" style={{ minWidth: 120 }}>
          {MONTH_NAMES.map((m, i) => <option key={i} value={i + 1}>{m}</option>)}
        </select>
        <input type="number" value={year} onChange={e => setYear(+e.target.value)}
          className="odoo-filter-dropdown" style={{ width: 80 }} />
        <div style={{ flex: 1 }} />
        <button onClick={handleExport} className="odoo-btn-secondary"
          style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          <Download size={13} /> Exporter
        </button>
      </div>

      {/* Stat tiles */}
      <div className="odoo-stat-grid">
        <div className="odoo-stat-card">
          <div className="odoo-stat-card-label"><ArrowUpRight size={11} style={{ display: 'inline', marginRight: 4 }} />Total entrées</div>
          <div className="odoo-stat-card-value" style={{ color: '#28a745' }}>{n(totals.totalEntrees)} <span style={{ fontSize: '0.6875rem', color: 'var(--theme-text-muted)', fontWeight: 400 }}>DH</span></div>
          <div className="odoo-stat-card-sub">
            Cash {n(totals.cashR)} · Carte {n(totals.cardR)}{totals.entries > 0 && ` · Autres ${n(totals.entries)}`}
          </div>
        </div>
        <div className="odoo-stat-card">
          <div className="odoo-stat-card-label"><ArrowDownRight size={11} style={{ display: 'inline', marginRight: 4 }} />Total sorties</div>
          <div className="odoo-stat-card-value" style={{ color: '#dc3545' }}>{n(totals.exits)} <span style={{ fontSize: '0.6875rem', color: 'var(--theme-text-muted)', fontWeight: 400 }}>DH</span></div>
          <div className="odoo-stat-card-sub">Achats + Salaires + Dépenses</div>
        </div>
        <div className="odoo-stat-card">
          <div className="odoo-stat-card-label"><Scale size={11} style={{ display: 'inline', marginRight: 4 }} />Résultat net du mois</div>
          <div className="odoo-stat-card-value" style={{ color: totals.resultat >= 0 ? '#28a745' : '#dc3545' }}>
            {totals.resultat >= 0 ? '+' : ''}{n(totals.resultat)} <span style={{ fontSize: '0.6875rem', color: 'var(--theme-text-muted)', fontWeight: 400 }}>DH</span>
          </div>
          <div className="odoo-stat-card-sub">Entrées − Sorties</div>
        </div>
        <div className="odoo-stat-card">
          <div className="odoo-stat-card-label"><Wallet size={11} style={{ display: 'inline', marginRight: 4 }} />Solde cumulé</div>
          <div className="odoo-stat-card-value" style={{ color: totals.solde >= 0 ? '#28a745' : '#dc3545' }}>
            {n(totals.solde)} <span style={{ fontSize: '0.6875rem', color: 'var(--theme-text-muted)', fontWeight: 400 }}>DH</span>
          </div>
          <div className="odoo-stat-card-sub">Cash {n(totals.cashNet)} · Carte {n(totals.cardCumul)}</div>
        </div>
      </div>

      {/* Daily grid */}
      {isLoading ? (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '3rem' }}>
          <Loader2 size={20} className="animate-spin" style={{ color: 'var(--theme-text-muted)' }} />
          <span style={{ marginLeft: 8, fontSize: '0.8125rem', color: 'var(--theme-text-muted)' }}>Chargement du résumé...</span>
        </div>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table className="odoo-table">
            <thead>
              <tr>
                <th>Date</th>
                <th style={{ textAlign: 'right' }}>Ventes</th>
                <th style={{ textAlign: 'right' }}>Entrées</th>
                <th style={{ textAlign: 'right' }}>Sorties</th>
                <th style={{ textAlign: 'right' }}>Cash cumul</th>
                <th style={{ textAlign: 'right' }}>Carte cumul</th>
                <th style={{ textAlign: 'right' }}>Solde</th>
              </tr>
            </thead>
            <tbody>
              {allDays.map(d => {
                if (!d) return null;
                const dayEntrees = d.cashCaissiere + d.cardReceipt + d.entries;
                const hasActivity = dayEntrees > 0 || d.exits > 0;
                return (
                  <tr key={d.dayNum} style={{ opacity: hasActivity ? 1 : 0.4 }}>
                    <td style={{ textTransform: 'capitalize' }}>{format(parseLocalDate(d.date), 'dd/MM EEE', { locale: fr })}</td>
                    <td style={{ textAlign: 'right' }}>{d.totalSales > 0 ? <span style={{ fontWeight: 600 }}>{n(d.totalSales)}</span> : <span style={{ color: 'var(--theme-bg-separator)' }}>—</span>}</td>
                    <td style={{ textAlign: 'right', color: dayEntrees > 0 ? '#28a745' : 'var(--theme-bg-separator)' }}>
                      {dayEntrees > 0 ? n(dayEntrees) : '—'}
                    </td>
                    <td style={{ textAlign: 'right', color: d.exits > 0 ? '#dc3545' : 'var(--theme-bg-separator)' }}>
                      {d.exits > 0 ? n(d.exits) : '—'}
                    </td>
                    <td style={{ textAlign: 'right', color: 'var(--theme-text-muted)' }}>{n(d.cashNetCumul)}</td>
                    <td style={{ textAlign: 'right', color: 'var(--theme-text-muted)' }}>{n(d.cardCumul)}</td>
                    <td style={{ textAlign: 'right', fontWeight: 700, color: d.solde >= 0 ? '#28a745' : '#dc3545' }}>{n(d.solde)}</td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr style={{ background: 'var(--theme-bg-subtle, rgba(0,0,0,0.03))', borderTop: '2px solid var(--theme-bg-separator)' }}>
                <td style={{ padding: 12, fontWeight: 700 }}>TOTAL</td>
                <td style={{ textAlign: 'right', fontWeight: 700 }}>{n(totals.sales)}</td>
                <td style={{ textAlign: 'right', fontWeight: 700, color: '#28a745' }}>{n(totals.totalEntrees)}</td>
                <td style={{ textAlign: 'right', fontWeight: 700, color: '#dc3545' }}>{n(totals.exits)}</td>
                <td style={{ textAlign: 'right', fontWeight: 700 }}>{n(totals.cashNet)}</td>
                <td style={{ textAlign: 'right', fontWeight: 700 }}>{n(totals.cardCumul)}</td>
                <td style={{ textAlign: 'right', fontWeight: 700, fontSize: '1rem', color: totals.solde >= 0 ? '#28a745' : '#dc3545' }}>{n(totals.solde)}</td>
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
  categories: Record<string, any>[];
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
    const leafLevel = leaf.level as number;
    if (leafLevel === 3) {
      const parent = categories.find(c => String(c.id) === String(leaf.parent_id));
      if (parent && (parent.level as number) === 2) {
        setSelL2(String(parent.id));
        setSelL1(String(parent.parent_id || ''));
      } else if (parent && (parent.level as number) === 1) {
        setSelL1(String(parent.id));
        setSelL2('');
      }
    } else if (leafLevel === 2) {
      setSelL1(String(leaf.parent_id || ''));
      setSelL2(String(leaf.id));
    } else if (leafLevel === 1) {
      setSelL1(String(leaf.id));
      setSelL2('');
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
      <select value={selL1} onChange={e => {
        const id = e.target.value;
        setSelL1(id);
        setSelL2('');
        // Si L1 n'a ni L2 ni L3 direct, L1 EST la feuille.
        const hasL2 = id && level2.some(c => String(c.parent_id) === id);
        const hasL3Direct = id && level3.some(c => String(c.parent_id) === id);
        onChange(!id ? '' : (hasL2 || hasL3Direct) ? '' : id);
      }} className={cls}>
        <option value="">Categorie...</option>
        {level1.map(c => <option key={String(c.id)} value={String(c.id)}>{String(c.name)}</option>)}
      </select>
      {filteredL2.length > 0 && (
        <select value={selL2} onChange={e => {
          const id = e.target.value;
          setSelL2(id);
          // Si la sous-categorie n'a pas de Type (L3), elle EST la feuille.
          const hasL3 = id && level3.some(c => String(c.parent_id) === id);
          if (!id) {
            const hasL3DirectFromL1 = selL1 && level3.some(c => String(c.parent_id) === selL1);
            onChange(hasL3DirectFromL1 ? '' : selL1);
          } else {
            onChange(hasL3 ? '' : id);
          }
        }} className={cls}>
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
