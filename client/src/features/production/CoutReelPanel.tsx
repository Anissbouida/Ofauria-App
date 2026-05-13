import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { productionCoutApi } from '../../api/production-cout.api';
import { notify } from '../../components/ui/InlineNotification';
import {
  Calculator, Loader2,
  ChevronDown, ChevronRight, Users, Package, DollarSign, Building2, Plus, Equal
} from 'lucide-react';

interface CoutReelPanelProps {
  planId: string;
  planStatus: string;
  isChef: boolean;
  totalQuantity?: number;
}

type Money = number | string | null | undefined;

interface CoutReel {
  id: string;
  plan_id: string;
  cout_matieres: Money;
  cout_main_oeuvre: Money;
  cout_energie: Money;
  cout_pertes: Money;
  cout_total: Money;
  cout_charges_fixes: Money;
  detail_charges_fixes: { label: string; mensuel: Money; part: Money }[];
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

export default function CoutReelPanel({ planId, planStatus, isChef, totalQuantity }: CoutReelPanelProps) {
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
      notify.success('Cout de revient calcule');
    },
    onError: (e: any) => notify.error(e?.response?.data?.error?.message || 'Erreur calcul'),
  });

  if (planStatus !== 'completed' && planStatus !== 'in_progress') return null;

  const formatDH = (val: Money) => `${toNum(val).toFixed(2)} DH`;

  const coutMat = toNum(cout?.cout_matieres);
  const coutMO = toNum(cout?.cout_main_oeuvre);
  const coutCharges = toNum(cout?.cout_charges_fixes);
  const coutRevient = coutMat + coutMO + coutCharges;

  return (
    <div className="bg-white rounded-2xl shadow-sm border border-gray-200 overflow-hidden">
      <div className="px-5 py-3.5 border-b border-gray-100 flex items-center gap-3">
        <Calculator size={16} className="text-amber-600" />
        <h3 className="font-semibold text-gray-900 text-sm">Cout de revient</h3>
        {cout && (
          <span className="ml-auto text-sm font-bold text-emerald-700">{formatDH(coutRevient)}</span>
        )}
      </div>

      {!cout && !isLoading && (
        <div className="p-5 text-center">
          <p className="text-sm text-gray-500 mb-3">Le cout de revient n'a pas encore ete calcule.</p>
          {isChef && planStatus === 'completed' && (
            <button onClick={() => calculateMutation.mutate()} disabled={calculateMutation.isPending}
              className="px-4 py-2 bg-amber-600 text-white rounded-lg text-sm font-medium hover:bg-amber-700 transition inline-flex items-center gap-2">
              {calculateMutation.isPending ? <Loader2 size={14} className="animate-spin" /> : <Calculator size={14} />}
              Calculer le cout de revient
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
          {/* Formula: Matieres + MO + Charges = Revient */}
          <div className="flex items-center gap-2 justify-center p-4">
            <div className="rounded-xl bg-amber-50 border border-amber-200 px-3 py-2 text-center flex-1">
              <div className="flex items-center gap-1 justify-center mb-0.5">
                <Package size={10} className="text-amber-500" />
                <span className="text-[9px] font-bold text-gray-500 uppercase">Matieres</span>
              </div>
              <div className="text-sm font-bold text-amber-700">{formatDH(coutMat)}</div>
            </div>
            <Plus size={12} className="text-gray-400 shrink-0" />
            <div className="rounded-xl bg-blue-50 border border-blue-200 px-3 py-2 text-center flex-1">
              <div className="flex items-center gap-1 justify-center mb-0.5">
                <Users size={10} className="text-blue-500" />
                <span className="text-[9px] font-bold text-gray-500 uppercase">M.O.</span>
              </div>
              <div className="text-sm font-bold text-blue-700">{formatDH(coutMO)}</div>
            </div>
            <Plus size={12} className="text-gray-400 shrink-0" />
            <div className="rounded-xl bg-violet-50 border border-violet-200 px-3 py-2 text-center flex-1">
              <div className="flex items-center gap-1 justify-center mb-0.5">
                <Building2 size={10} className="text-violet-500" />
                <span className="text-[9px] font-bold text-gray-500 uppercase">Charges</span>
              </div>
              <div className="text-sm font-bold text-violet-700">{formatDH(coutCharges)}</div>
            </div>
            <Equal size={12} className="text-gray-400 shrink-0" />
            <div className="rounded-xl bg-emerald-50 border border-emerald-200 px-3 py-2 text-center flex-1">
              <div className="flex items-center gap-1 justify-center mb-0.5">
                <DollarSign size={10} className="text-emerald-500" />
                <span className="text-[9px] font-bold text-gray-500 uppercase">Revient</span>
              </div>
              <div className="text-sm font-bold text-emerald-700">{formatDH(coutRevient)}</div>
            </div>
          </div>

          {/* Prix par unite */}
          {totalQuantity && totalQuantity > 0 && (
            <div className="mx-4 mb-3 px-4 py-2.5 rounded-xl bg-gray-50 border border-gray-200 flex items-center justify-between">
              <span className="text-xs text-gray-500">Prix de revient par unite ({totalQuantity} unites)</span>
              <span className="text-sm font-bold text-gray-900">{(coutRevient / totalQuantity).toFixed(2)} DH</span>
            </div>
          )}

          {/* Expandable detail sections */}
          <div className="border-t border-gray-100 divide-y divide-gray-100">
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

            {(cout.detail_charges_fixes || []).length > 0 && (
              <DetailSection title="Detail charges fixes" icon={<Building2 size={12} className="text-violet-500" />}
                isExpanded={expandedSection === 'charges'} onToggle={() => setExpandedSection(expandedSection === 'charges' ? null : 'charges')}>
                <table className="w-full text-xs">
                  <thead><tr className="text-gray-400 uppercase">
                    <th className="text-left py-1 px-2">Charge</th>
                    <th className="text-right py-1 px-2">Mensuel</th>
                    <th className="text-right py-1 px-2">Quote-part</th>
                  </tr></thead>
                  <tbody>{(cout.detail_charges_fixes || []).map((d, i) => (
                    <tr key={i} className="border-t border-gray-50">
                      <td className="py-1 px-2 text-gray-700">{d.label}</td>
                      <td className="py-1 px-2 text-right text-gray-500">{formatDH(d.mensuel)}</td>
                      <td className="py-1 px-2 text-right font-medium text-gray-900">{formatDH(d.part)}</td>
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
