import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { AlertTriangle, CalendarClock, CheckCircle2, FileText } from 'lucide-react';
import { invoicesApi } from '../api/accounting.api';

const PAYMENT_MODE_LABELS: Record<string, string> = {
  cash: 'Espèces', check: 'Chèque', transfer: 'Virement', traite: 'Traite',
};

const STATUS_LABELS: Record<string, string> = {
  pending: 'Non réglée',
  partial: 'Partiellement réglée',
  overdue: 'En retard',
  disputed: 'En litige',
  check_pending: 'À encaisser',
};

/**
 * Widget recapitulatif des echeances fournisseurs a <= 7j :
 *   - factures recues non finalisees (pending/partial/overdue/disputed)
 *   - cheques/traites emis non encaisses dont l'echeance approche (kind='check')
 *
 * - Refetch automatique toutes les 60s pour rester en temps reel.
 * - Affiche un etat vide informatif quand il n'y a pas d'alerte (utile pour
 *   confirmer que le suivi est en place et qu'aucune facture n'est en retard).
 *
 * Props :
 *   - days       : fenetre d'alerte en jours (defaut 7)
 *   - compact    : version plus dense (utilisee dans le dashboard) ; le widget
 *                  reste compact quand il y a 0 alerte pour ne pas occuper trop
 *                  de place.
 *   - hideWhenEmpty : si true, ne rend rien quand il n'y a pas d'alerte.
 */
export default function PaymentAlertsWidget({
  days = 7,
  hideWhenEmpty = false,
  compact = false,
}: {
  days?: number;
  hideWhenEmpty?: boolean;
  compact?: boolean;
}) {
  const navigate = useNavigate();
  const { data = [], isLoading, isError } = useQuery({
    queryKey: ['invoice-payment-alerts', days],
    queryFn: () => invoicesApi.paymentAlerts(days),
    refetchInterval: 60000,
  });
  const alerts = data as Array<Record<string, any>>;

  if (isLoading) {
    if (hideWhenEmpty) return null;
    return (
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm px-4 py-3 text-xs text-gray-400">
        Chargement des échéances…
      </div>
    );
  }
  if (isError) {
    if (hideWhenEmpty) return null;
    return (
      <div className="bg-yellow-50 border border-yellow-200 rounded-2xl px-4 py-3 text-xs text-yellow-700">
        Suivi des échéances indisponible (le serveur n'est peut-être pas à jour ; relance-le après la migration 137).
      </div>
    );
  }

  const count = alerts.length;
  const invoiceCount = alerts.filter(a => a.kind !== 'check').length;
  const checkCount = count - invoiceCount;
  const overdueCount = alerts.filter(a => a.is_overdue).length;
  const totalDue = alerts.reduce((s, a) => s + parseFloat((a.remaining_amount as string) || '0'), 0);

  if (count === 0) {
    if (hideWhenEmpty) return null;
    return (
      <div className="bg-white rounded-2xl border border-emerald-100 shadow-sm px-4 py-3 flex items-center gap-3">
        <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-emerald-500 to-teal-600 flex items-center justify-center shadow-sm">
          <CheckCircle2 size={16} className="text-white" />
        </div>
        <div>
          <p className="text-xs font-bold text-emerald-800 uppercase tracking-wider">
            Échéances fournisseurs (≤ {days} jours)
          </p>
          <p className="text-[11px] text-emerald-600">
            Aucune facture à honorer ni chèque à encaisser dans la fenêtre.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-2xl border border-red-100 shadow-sm overflow-hidden">
      <div className="px-4 py-3 bg-gradient-to-r from-red-50 to-orange-50 border-b border-red-100 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-red-500 to-rose-600 flex items-center justify-center shadow-sm">
            <CalendarClock size={16} className="text-white" />
          </div>
          <div>
            <p className="text-xs font-bold text-red-800 uppercase tracking-wider">
              Échéances fournisseurs (≤ {days} jours)
            </p>
            <p className="text-[11px] text-red-600">
              {invoiceCount > 0 && `${invoiceCount} facture${invoiceCount > 1 ? 's' : ''} à honorer`}
              {invoiceCount > 0 && checkCount > 0 && ' · '}
              {checkCount > 0 && `${checkCount} chèque${checkCount > 1 ? 's' : ''}/traite${checkCount > 1 ? 's' : ''} à encaisser`}
              {overdueCount > 0 && ` · ${overdueCount} en retard`}
              {' · À décaisser : '}{totalDue.toFixed(2)} DH
            </p>
          </div>
        </div>
        <button onClick={() => navigate('/purchasing')}
          className="text-[11px] font-semibold text-red-700 hover:text-red-900 underline">
          Voir tout
        </button>
      </div>
      <div className={`divide-y divide-gray-50 overflow-auto ${compact ? 'max-h-80' : 'max-h-[28rem]'}`}>
        {alerts.slice(0, compact ? 8 : 50).map(a => {
          const days = parseInt(String(a.days_until_due ?? 0));
          const isOverdue = !!a.is_overdue;
          const isCheck = a.kind === 'check';
          const remaining = parseFloat((a.remaining_amount as string) || '0');
          const title = isCheck
            ? `${PAYMENT_MODE_LABELS[a.expected_payment_mode as string] || 'Chèque'} n°${(a.check_number as string) || '?'}`
            : (a.invoice_number as string);
          return (
            <div key={`${a.kind as string}-${a.id as string}`}
              onClick={() => navigate(isCheck ? '/accounting' : '/purchasing')}
              className="px-4 py-2.5 flex items-center gap-3 hover:bg-gray-50 cursor-pointer">
              {isCheck
                ? <FileText size={14} className={isOverdue ? 'text-red-600' : 'text-amber-500'} />
                : <AlertTriangle size={14} className={isOverdue ? 'text-red-600' : 'text-orange-500'} />}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-sm font-mono font-semibold text-gray-800">{title}</span>
                  <span className="text-xs text-gray-500 truncate">
                    — {(a.supplier_name as string) || 'Fournisseur ?'}
                    {isCheck && a.invoice_number ? ` (fact. ${a.invoice_number as string})` : ''}
                  </span>
                </div>
                <div className="flex items-center gap-2 text-[11px] text-gray-500 mt-0.5">
                  <span>{isCheck ? 'Encaissement' : 'Échéance'} : {a.due_date ? new Date(a.due_date as string).toLocaleDateString('fr-FR') : '—'}</span>
                  <span>·</span>
                  <span className={isOverdue ? 'text-red-600 font-semibold' : 'text-orange-600'}>
                    {isOverdue
                      ? (isCheck ? `encaissable depuis ${Math.abs(days)}j` : `${Math.abs(days)}j de retard`)
                      : days === 0 ? "Aujourd'hui" : `dans ${days}j`}
                  </span>
                  {!isCheck && a.expected_payment_mode && (
                    <>
                      <span>·</span>
                      <span>{PAYMENT_MODE_LABELS[a.expected_payment_mode as string] || (a.expected_payment_mode as string)}</span>
                    </>
                  )}
                </div>
              </div>
              <div className="text-right shrink-0">
                <p className="text-sm font-bold text-red-700">{remaining.toFixed(2)} <span className="text-[10px] font-normal text-gray-400">DH</span></p>
                <p className="text-[10px] text-gray-400">{STATUS_LABELS[a.status as string] || (a.status as string)}</p>
              </div>
            </div>
          );
        })}
        {compact && alerts.length > 8 && (
          <div className="px-4 py-2 text-center text-[11px] text-gray-400">
            … {alerts.length - 8} échéance{alerts.length - 8 > 1 ? 's' : ''} supplémentaire{alerts.length - 8 > 1 ? 's' : ''}
          </div>
        )}
      </div>
    </div>
  );
}
