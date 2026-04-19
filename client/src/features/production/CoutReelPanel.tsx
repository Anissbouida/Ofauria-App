import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { productionCoutApi } from '../../api/production-cout.api';
import { notify } from '../../components/ui/InlineNotification';
import {
  Calculator, TrendingUp, TrendingDown, Loader2,
  ChevronDown, ChevronRight, Users, Zap, Package, AlertTriangle, DollarSign
} from 'lucide-react';

interface CoutReelPanelProps {
  planId: string;
  planStatus: string;
  isChef: boolean;
}

// NOTE : l'API Postgres renvoie les colonnes `numeric` sous forme de string
// (pg driver default). On type donc les montants en `number | string` et on
// passe partout par `toNum()` avant d'appeler des methodes numeriques.
type Money = number | string | null | undefined;

interface CoutReel {
  id: string;
  plan_id: string;
  cout_matieres: Money;
  cout_main_oeuvre: Money;
  cout_energie: Money;
  cout_pertes: Money;
  cout_total: Money;
  cout_prevu: Money;
  ecart_pct: Money;
  detail_matieres: { ingredient_id: string; name: string; qty: Money; unit_cost: Money; total: Money }[];
  detail_main_oeuvre: { employee_id: string; name: string; minutes: Money; hourly_rate: Money; total: Money }[];
  detail_energie: { equipement_id: string; name: string; minutes: Money; cout_horaire: Money; total: Money }[];
  detail_pertes: { categorie: string; quantite: Money; cout_unitaire: Money; total: Money }[];
  calculated_by_name: string;
  calculated_at: string;
}

function toNum(v: Money): number {
  if (v == null) return 0;
  const n = typeof v === 'number' ? v : parseFloat(v);
  return Number.isFinite(n) ? n : 0;
}

export default function CoutReelPanel({ planId, planStatus, isChef }: CoutReelPanelProps) {
  const queryClient = useQueryClient();
  const [expandedSection, setExpandedSection] = useState<string | null>(null);

  const { data: cout, isLoading } = useQuery<CoutReel | null>({
    queryKey: ['production-cout', planId],
    queryFn: () => productionCoutApi.getCost(planId).catch(() => null),
    enabled: ['in_progress', 'completed'].includes(planStatus),
  });

  const calculateMutation = useMutation({
    mutationFn: () => productionCoutApi.calculateCost(planId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['production-cout', planId] });
      notify.success('Cout reel calcule');
    },
    onError: (e: any) => notify.error(e?.response?.data?.error?.message || 'Erreur calcul'),
  });

  if (planStatus !== 'completed' && planStatus !== 'in_progress') return null;

  const formatDH = (val: Money) => {
    if (val == null) return '—';
    return `${toNum(val).toFixed(2)} DH`;
  };

  const sections = [
    { key: 'matieres', label: 'Matieres premieres', icon: <Package size={13} className="text-amber-500" />, total: cout?.cout_matieres, color: 'amber' },
    { key: 'main_oeuvre', label: 'Main d\'oeuvre', icon: <Users size={13} className="text-blue-500" />, total: cout?.cout_main_oeuvre, color: 'blue' },
    { key: 'energie', label: 'Energie / Equipements', icon: <Zap size={13} className="text-violet-500" />, total: cout?.cout_energie, color: 'violet' },
    { key: 'pertes', label: 'Pertes', icon: <AlertTriangle size={13} className="text-red-500" />, total: cout?.cout_pertes, color: 'red' },
  ];

  return (
    <div className="bg-white rounded-2xl shadow-sm border border-gray-200 overflow-hidden">
      <div className="px-5 py-3.5 border-b border-gray-100 flex items-center gap-3">
        <Calculator size={16} className="text-amber-600" />
        <h3 className="font-semibold text-gray-900 text-sm">Cout reel de production</h3>
        {cout && (
          <span className="ml-auto text-sm font-bold text-gray-900">{formatDH(cout.cout_total)}</span>
        )}
      </div>

      {!cout && !isLoading && (
        <div className="p-5 text-center">
          <p className="text-sm text-gray-500 mb-3">Le cout reel n'a pas encore ete calcule pour ce plan.</p>
          {isChef && planStatus === 'completed' && (
            <button onClick={() => calculateMutation.mutate()} disabled={calculateMutation.isPending}
              className="px-4 py-2 bg-amber-600 text-white rounded-lg text-sm font-medium hover:bg-amber-700 transition inline-flex items-center gap-2">
              {calculateMutation.isPending ? <Loader2 size={14} className="animate-spin" /> : <Calculator size={14} />}
              Calculer le cout reel
            </button>
          )}
        </div>
      )}

      {isLoading && (
        <div className="p-6 flex items-center justify-center gap-2 text-gray-400">
          <Loader2 size={16} className="animate-spin" /> Chargement...
        </div>
      )}

      {cout && (
        <>
          {/* Summary cards */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 p-4">
            {sections.map(s => (
              <div key={s.key} className={`rounded-xl bg-${s.color}-50 border border-${s.color}-200 p-3`}>
                <div className="flex items-center gap-1.5 mb-1">
                  {s.icon}
                  <span className="text-[10px] font-bold text-gray-500 uppercase">{s.label}</span>
                </div>
                <div className={`text-base font-bold text-${s.color}-700`}>{formatDH(s.total)}</div>
              </div>
            ))}
          </div>

          {/* Variance */}
          {cout.cout_prevu != null && (() => {
            const ecart = toNum(cout.ecart_pct);
            const hasEcart = cout.ecart_pct != null;
            return (
              <div className={`mx-4 mb-3 p-3 rounded-xl border flex items-center gap-3 ${
                ecart <= 0 ? 'bg-emerald-50 border-emerald-200' : ecart <= 10 ? 'bg-amber-50 border-amber-200' : 'bg-red-50 border-red-200'
              }`}>
                <DollarSign size={16} className="text-gray-500" />
                <div className="flex-1">
                  <span className="text-xs text-gray-500">Prevu: {formatDH(cout.cout_prevu)}</span>
                  <span className="mx-2 text-gray-300">|</span>
                  <span className="text-xs text-gray-500">Reel: {formatDH(cout.cout_total)}</span>
                </div>
                <div className={`flex items-center gap-1 text-sm font-bold ${
                  ecart <= 0 ? 'text-emerald-700' : ecart <= 10 ? 'text-amber-700' : 'text-red-700'
                }`}>
                  {ecart <= 0 ? <TrendingDown size={14} /> : <TrendingUp size={14} />}
                  {hasEcart ? `${ecart > 0 ? '+' : ''}${ecart.toFixed(1)}%` : '—'}
                </div>
              </div>
            );
          })()}

          {/* Expandable detail sections */}
          <div className="border-t border-gray-100 divide-y divide-gray-100">
            {/* Matières */}
            {cout.detail_matieres.length > 0 && (
              <DetailSection title="Detail matieres" icon={<Package size={12} className="text-amber-500" />}
                isExpanded={expandedSection === 'matieres'} onToggle={() => setExpandedSection(expandedSection === 'matieres' ? null : 'matieres')}>
                <table className="w-full text-xs">
                  <thead><tr className="text-gray-400 uppercase">
                    <th className="text-left py-1 px-2">Ingredient</th>
                    <th className="text-right py-1 px-2">Qte</th>
                    <th className="text-right py-1 px-2">PU</th>
                    <th className="text-right py-1 px-2">Total</th>
                  </tr></thead>
                  <tbody>{cout.detail_matieres.map((d, i) => (
                    <tr key={i} className="border-t border-gray-50">
                      <td className="py-1 px-2 text-gray-700">{d.name}</td>
                      <td className="py-1 px-2 text-right text-gray-500">{toNum(d.qty).toFixed(2)}</td>
                      <td className="py-1 px-2 text-right text-gray-500">{toNum(d.unit_cost).toFixed(2)}</td>
                      <td className="py-1 px-2 text-right font-medium text-gray-900">{toNum(d.total).toFixed(2)}</td>
                    </tr>
                  ))}</tbody>
                </table>
              </DetailSection>
            )}

            {/* Main d'oeuvre */}
            {cout.detail_main_oeuvre.length > 0 && (
              <DetailSection title="Detail main d'oeuvre" icon={<Users size={12} className="text-blue-500" />}
                isExpanded={expandedSection === 'mo'} onToggle={() => setExpandedSection(expandedSection === 'mo' ? null : 'mo')}>
                <table className="w-full text-xs">
                  <thead><tr className="text-gray-400 uppercase">
                    <th className="text-left py-1 px-2">Employe</th>
                    <th className="text-right py-1 px-2">Minutes</th>
                    <th className="text-right py-1 px-2">Taux/h</th>
                    <th className="text-right py-1 px-2">Total</th>
                  </tr></thead>
                  <tbody>{cout.detail_main_oeuvre.map((d, i) => (
                    <tr key={i} className="border-t border-gray-50">
                      <td className="py-1 px-2 text-gray-700">{d.name}</td>
                      <td className="py-1 px-2 text-right text-gray-500">{toNum(d.minutes)}</td>
                      <td className="py-1 px-2 text-right text-gray-500">{toNum(d.hourly_rate).toFixed(2)}</td>
                      <td className="py-1 px-2 text-right font-medium text-gray-900">{toNum(d.total).toFixed(2)}</td>
                    </tr>
                  ))}</tbody>
                </table>
              </DetailSection>
            )}

            {/* Energie */}
            {cout.detail_energie.length > 0 && (
              <DetailSection title="Detail energie" icon={<Zap size={12} className="text-violet-500" />}
                isExpanded={expandedSection === 'energie'} onToggle={() => setExpandedSection(expandedSection === 'energie' ? null : 'energie')}>
                <table className="w-full text-xs">
                  <thead><tr className="text-gray-400 uppercase">
                    <th className="text-left py-1 px-2">Equipement</th>
                    <th className="text-right py-1 px-2">Minutes</th>
                    <th className="text-right py-1 px-2">Cout/h</th>
                    <th className="text-right py-1 px-2">Total</th>
                  </tr></thead>
                  <tbody>{cout.detail_energie.map((d, i) => (
                    <tr key={i} className="border-t border-gray-50">
                      <td className="py-1 px-2 text-gray-700">{d.name}</td>
                      <td className="py-1 px-2 text-right text-gray-500">{toNum(d.minutes)}</td>
                      <td className="py-1 px-2 text-right text-gray-500">{toNum(d.cout_horaire).toFixed(2)}</td>
                      <td className="py-1 px-2 text-right font-medium text-gray-900">{toNum(d.total).toFixed(2)}</td>
                    </tr>
                  ))}</tbody>
                </table>
              </DetailSection>
            )}
          </div>

          {/* Recalculate button */}
          {isChef && (
            <div className="p-4 border-t border-gray-100 flex justify-end">
              <button onClick={() => calculateMutation.mutate()} disabled={calculateMutation.isPending}
                className="px-3 py-1.5 bg-gray-100 text-gray-600 rounded-lg text-xs hover:bg-gray-200 transition inline-flex items-center gap-1.5">
                {calculateMutation.isPending ? <Loader2 size={12} className="animate-spin" /> : <Calculator size={12} />}
                Recalculer
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function DetailSection({ title, icon, isExpanded, onToggle, children }: {
  title: string; icon: React.ReactNode; isExpanded: boolean; onToggle: () => void; children: React.ReactNode;
}) {
  return (
    <div>
      <button onClick={onToggle} className="w-full px-4 py-2.5 flex items-center gap-2 hover:bg-gray-50 transition-colors text-left">
        {isExpanded ? <ChevronDown size={12} className="text-gray-400" /> : <ChevronRight size={12} className="text-gray-400" />}
        {icon}
        <span className="text-xs font-medium text-gray-700">{title}</span>
      </button>
      {isExpanded && <div className="px-4 pb-3">{children}</div>}
    </div>
  );
}
