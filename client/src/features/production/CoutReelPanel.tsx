import { useState } from 'react';
import { apiErrorMessage } from '../../api/errors';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { productionCoutApi } from '../../api/production-cout.api';
import { notify } from '../../components/ui/InlineNotification';
import {
  Calculator, Loader2,
  ChevronDown, ChevronRight, Users, Package, DollarSign, Building2, Plus, Equal, Zap, TrendingDown, Clock, Scissors
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
  /**
   * Mig 268 (audit A10) : prevu au mix REELLEMENT produit
   * (theo × actual_quantity) et ecart de mix isole
   * = cout_prevu - cout_prevu_mix_reel. Le reste (cout_total -
   * cout_prevu_mix_reel) est l'ecart prix + pertes.
   */
  cout_prevu_mix_reel?: Money;
  ecart_mix?: Money;
  detail_matieres: { ingredient_id: string; name: string; qty: Money; unit_cost: Money; total: Money }[];
  detail_main_oeuvre: { employee_id: string; name: string; minutes: Money; hourly_rate: Money; total: Money }[];
  detail_energie: { equipement_id: string; name: string; minutes: Money; cout_horaire: Money; total: Money }[];
  detail_pertes: { categorie: string; quantite: Money; cout_unitaire: Money; total: Money }[];
  calculated_by_name: string;
  calculated_at: string;
}

// Ecart MO : gamme standard (mig 388) vs reel (etapes mig 089) — roadmap lot 1
interface MoEcartItem {
  plan_item_id: string;
  product_name: string;
  quantity: number | null;
  routing_id: string | null;
  routing_name: string | null;
  std_minutes: number | null;
  std_cost: number | null;
  reel_minutes: number;
  reel_cost: number;
  ecart_minutes: number | null;
  ecart_cost: number | null;
}
interface MoEcart {
  items: MoEcartItem[];
  totals: {
    std_minutes: number; std_cost: number;
    reel_minutes: number; reel_cost: number;
    ecart_minutes: number; ecart_cost: number;
    nb_items: number; nb_items_sans_gamme: number;
  };
}

// Cout de revient par sortie de coupe (mig 302/397) — roadmap lot 2
interface OutputCostLine {
  output_id: string;
  label: string;
  product_name: string | null;
  quantity: number;
  equiv_pieces: number;
  unit_cost: number | null;
  cost_share: number | null;
}
interface OutputCostGroup {
  plan_item_id: string;
  item_product_name: string | null;
  outputs: OutputCostLine[];
  total_cost: number;
  complete: boolean;
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

  // Ecart MO standard (gamme) vs reel (etapes) — roadmap lot 1
  const { data: moEcart } = useQuery<MoEcart | null>({
    queryKey: ['production-mo-ecart', planId],
    queryFn: () => productionCoutApi.moEcartByPlan(planId).catch(() => null),
    enabled: ['in_progress', 'completed'].includes(planStatus),
  });

  // Cout de revient par sortie de coupe — roadmap lot 2
  const { data: outputsCost } = useQuery<OutputCostGroup[]>({
    queryKey: ['production-outputs-cost', planId],
    queryFn: () => productionCoutApi.outputCostByPlan(planId).catch(() => []),
    enabled: ['in_progress', 'completed'].includes(planStatus),
  });

  const calculateMutation = useMutation({
    mutationFn: () => productionCoutApi.calculateCost(planId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['production-cout', planId] });
      notify.success('Cout de revient calcule');
    },
    onError: (e: any) => notify.error(apiErrorMessage(e, 'Erreur calcul')),
  });

  if (planStatus !== 'completed' && planStatus !== 'in_progress') return null;

  const formatDH = (val: Money) => `${toNum(val).toFixed(2)} DH`;

  const coutMat = toNum(cout?.cout_matieres);
  const coutMO = toNum(cout?.cout_main_oeuvre);
  const coutEnergie = toNum(cout?.cout_energie);
  const coutCharges = toNum(cout?.cout_charges_fixes);
  // Revient = matieres + MO + energie + charges. Les pertes (cout_pertes) sont
  // une valorisation de matiere DEJA comptee dans cout_matieres : un « dont »,
  // pas un terme additif (mig 339).
  const coutRevient = coutMat + coutMO + coutEnergie + coutCharges;
  const coutPertes = toNum(cout?.cout_pertes);

  return (
    <div className="odoo-section">
      <div className="odoo-section-header">
        <Calculator size={12} /> Coût de revient
        {cout && (
          <span style={{ marginLeft: 'auto', fontSize: '0.8125rem', fontWeight: 600, color: '#28a745' }}>
            {formatDH(coutRevient)}
          </span>
        )}
      </div>

      {!cout && !isLoading && (
        <div style={{ padding: '1rem', textAlign: 'center', backgroundColor: 'var(--theme-bg-card)' }}>
          <p style={{ fontSize: '0.8125rem', color: 'var(--theme-text-muted)', marginBottom: '0.5rem' }}>Le coût de revient n'a pas encore été calculé.</p>
          {isChef && planStatus === 'completed' && (
            <button onClick={() => calculateMutation.mutate()} disabled={calculateMutation.isPending}
              className="odoo-btn-primary">
              {calculateMutation.isPending ? <Loader2 size={13} className="animate-spin" /> : <Calculator size={13} />}
              Calculer le coût de revient
            </button>
          )}
        </div>
      )}

      {isLoading && (
        <div style={{ padding: '1.5rem', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, color: 'var(--theme-text-muted)' }}>
          <Loader2 size={14} className="animate-spin" /> Chargement...
        </div>
      )}

      {cout && (
        <>
          {/* Breakdown : Matières + M.O. + Charges = Revient */}
          <div className="odoo-stat-grid" style={{ borderBottom: '1px solid var(--theme-bg-separator)' }}>
            <div className="odoo-stat-card" style={{ cursor: 'default' }}>
              <div className="odoo-stat-card-label">
                <Package size={11} style={{ display: 'inline', marginRight: 4 }} />Matières
              </div>
              <div className="odoo-stat-card-value" style={{ fontSize: '1rem' }}>{formatDH(coutMat)}</div>
            </div>
            <div className="odoo-stat-card" style={{ cursor: 'default' }}>
              <div className="odoo-stat-card-label">
                <Users size={11} style={{ display: 'inline', marginRight: 4 }} />M.O.
              </div>
              <div className="odoo-stat-card-value" style={{ fontSize: '1rem' }}>{formatDH(coutMO)}</div>
            </div>
            <div className="odoo-stat-card" style={{ cursor: 'default' }}>
              <div className="odoo-stat-card-label">
                <Zap size={11} style={{ display: 'inline', marginRight: 4 }} />Énergie
              </div>
              <div className="odoo-stat-card-value" style={{ fontSize: '1rem' }}>{formatDH(coutEnergie)}</div>
            </div>
            <div className="odoo-stat-card" style={{ cursor: 'default' }}>
              <div className="odoo-stat-card-label">
                <Building2 size={11} style={{ display: 'inline', marginRight: 4 }} />Charges
              </div>
              <div className="odoo-stat-card-value" style={{ fontSize: '1rem' }}>{formatDH(coutCharges)}</div>
            </div>
            <div className="odoo-stat-card" style={{ cursor: 'default', backgroundColor: 'var(--theme-bg-secondary)' }}>
              <div className="odoo-stat-card-label">
                <DollarSign size={11} style={{ display: 'inline', marginRight: 4, color: '#28a745' }} />Revient
              </div>
              <div className="odoo-stat-card-value" style={{ fontSize: '1rem', color: '#28a745' }}>{formatDH(coutRevient)}</div>
            </div>
          </div>

          {/* Dont pertes : matiere perdue (rendement), deja incluse dans les matieres */}
          {coutPertes > 0 && (
            <div style={{
              padding: '0.4rem 1rem',
              backgroundColor: 'var(--theme-bg-card)',
              borderBottom: '1px solid var(--theme-bg-separator)',
              display: 'flex', justifyContent: 'space-between', alignItems: 'center',
              fontSize: '0.8125rem',
            }}>
              <span style={{ color: 'var(--theme-text-muted)' }}>
                <TrendingDown size={11} style={{ display: 'inline', marginRight: 4, color: '#dc3545' }} />
                dont pertes (matière perdue, déjà comptée dans Matières)
              </span>
              <span style={{ fontWeight: 600, color: '#dc3545' }}>
                {formatDH(coutPertes)}{coutMat > 0 ? ` (${((coutPertes / coutMat) * 100).toFixed(1)} % des matières)` : ''}
              </span>
            </div>
          )}

          {/* Prix par unite */}
          {totalQuantity && totalQuantity > 0 && (
            <div style={{
              padding: '0.5rem 1rem',
              backgroundColor: 'var(--theme-bg-card)',
              borderBottom: '1px solid var(--theme-bg-separator)',
              display: 'flex', justifyContent: 'space-between', alignItems: 'center',
              fontSize: '0.8125rem',
            }}>
              <span style={{ color: 'var(--theme-text-muted)' }}>Prix de revient par unité ({totalQuantity} unités)</span>
              <span style={{ fontWeight: 600 }}>{(coutRevient / totalQuantity).toFixed(2)} DH</span>
            </div>
          )}

          {/* Ecart prevu vs reel, decompose (audit A10) : mix vs prix/pertes.
              N'affiche rien si le prevu n'est pas dispo (recettes sans product_id
              ou plan lance avant mig 261). */}
          {cout.cout_prevu != null && toNum(cout.cout_prevu) > 0 && (() => {
            const prevu = toNum(cout.cout_prevu);
            const prevuMix = cout.cout_prevu_mix_reel != null ? toNum(cout.cout_prevu_mix_reel) : null;
            const ecartTot = coutRevient - prevu;
            const ecartMix = cout.ecart_mix != null ? toNum(cout.ecart_mix)
              : (prevuMix != null ? prevu - prevuMix : null);
            const ecartPrix = prevuMix != null ? coutRevient - prevuMix : null;
            const color = (v: number) => v > 0 ? '#c62828' : v < 0 ? '#2e7d32' : 'var(--theme-text-muted)';
            const sign = (v: number) => (v > 0 ? '+' : '');
            return (
              <div style={{
                padding: '0.75rem 1rem', borderBottom: '1px solid var(--theme-bg-separator)',
                backgroundColor: 'var(--theme-bg-card)', fontSize: '0.8125rem',
              }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                  <span style={{ color: 'var(--theme-text-muted)' }}>Coût prévu (mix standard)</span>
                  <span style={{ fontWeight: 500 }}>{formatDH(prevu)}</span>
                </div>
                {prevuMix != null && Math.abs((ecartMix ?? 0)) > 0.01 && (
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}
                    title="Différence due au mix réellement produit (ex : 6 moyens au lieu de 3+3). N'implique aucune sur/sous-consommation de matière — c'est un effet volume par format.">
                    <span style={{ color: 'var(--theme-text-muted)' }}>Écart de mix</span>
                    <span style={{ fontWeight: 500, color: color(-(ecartMix ?? 0)) }}>
                      {sign(-(ecartMix ?? 0))}{(-(ecartMix ?? 0)).toFixed(2)} DH
                    </span>
                  </div>
                )}
                {prevuMix != null && (
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}
                    title="Coût prévu recalculé sur les quantités réellement produites (le mix standard ne compte plus).">
                    <span style={{ color: 'var(--theme-text-muted)' }}>Prévu au mix réel</span>
                    <span style={{ fontWeight: 500 }}>{formatDH(prevuMix)}</span>
                  </div>
                )}
                {ecartPrix != null && (
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}
                    title="Ce qui reste de l'écart après avoir absorbé le mix : sur/sous-consommation matière + pertes + variation de prix des ingrédients.">
                    <span style={{ color: 'var(--theme-text-muted)' }}>Écart prix / pertes</span>
                    <span style={{ fontWeight: 500, color: color(ecartPrix) }}>
                      {sign(ecartPrix)}{ecartPrix.toFixed(2)} DH
                    </span>
                  </div>
                )}
                <div style={{ display: 'flex', justifyContent: 'space-between', paddingTop: 4, borderTop: '1px dashed var(--theme-bg-separator)', fontWeight: 600 }}>
                  <span>Écart total (Réel − Prévu)</span>
                  <span style={{ color: color(ecartTot) }}>
                    {sign(ecartTot)}{ecartTot.toFixed(2)} DH
                    {' '}({sign(ecartTot)}{prevu > 0 ? ((ecartTot / prevu) * 100).toFixed(1) : '0.0'} %)
                  </span>
                </div>
              </div>
            );
          })()}

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

            {moEcart && moEcart.items.length > 0 && (
              <DetailSection title="Ecart M.O. : gamme standard vs reel" icon={<Clock size={12} className="text-indigo-500" />}
                isExpanded={expandedSection === 'mo-ecart'} onToggle={() => setExpandedSection(expandedSection === 'mo-ecart' ? null : 'mo-ecart')}>
                {moEcart.totals.nb_items_sans_gamme === moEcart.totals.nb_items ? (
                  <p className="text-xs text-gray-500 px-2 py-1">
                    Aucune gamme de production rattachée. Définissez des gammes (Production › Postes & gammes)
                    pour comparer le temps de main-d'œuvre standard au temps réellement passé.
                  </p>
                ) : (
                  <table className="w-full text-xs">
                    <thead><tr className="text-gray-400 uppercase">
                      <th className="text-left py-1 px-2">Produit</th>
                      <th className="text-right py-1 px-2">Std (min)</th>
                      <th className="text-right py-1 px-2">Réel (min)</th>
                      <th className="text-right py-1 px-2">Std (DH)</th>
                      <th className="text-right py-1 px-2">Réel (DH)</th>
                      <th className="text-right py-1 px-2">Écart (DH)</th>
                    </tr></thead>
                    <tbody>{moEcart.items.map((d) => (
                      <tr key={d.plan_item_id} className="border-t border-gray-50">
                        <td className="py-1 px-2 text-gray-700">
                          {d.product_name}
                          {d.std_cost == null && <span className="text-gray-300"> (sans gamme)</span>}
                        </td>
                        <td className="py-1 px-2 text-right text-gray-500">{d.std_minutes ?? '—'}</td>
                        <td className="py-1 px-2 text-right text-gray-500">{d.reel_minutes}</td>
                        <td className="py-1 px-2 text-right text-gray-500">{d.std_cost != null ? d.std_cost.toFixed(2) : '—'}</td>
                        <td className="py-1 px-2 text-right text-gray-500">{d.reel_cost.toFixed(2)}</td>
                        <td className="py-1 px-2 text-right font-medium"
                          style={{ color: d.ecart_cost == null ? '#9ca3af' : d.ecart_cost > 0 ? '#c62828' : d.ecart_cost < 0 ? '#2e7d32' : undefined }}>
                          {d.ecart_cost == null ? '—' : `${d.ecart_cost > 0 ? '+' : ''}${d.ecart_cost.toFixed(2)}`}
                        </td>
                      </tr>
                    ))}</tbody>
                    <tfoot>
                      <tr className="border-t border-gray-200 font-semibold text-gray-800">
                        <td className="py-1 px-2">Total (items avec gamme)</td>
                        <td className="py-1 px-2 text-right">{moEcart.totals.std_minutes}</td>
                        <td className="py-1 px-2 text-right">{moEcart.totals.reel_minutes}</td>
                        <td className="py-1 px-2 text-right">{moEcart.totals.std_cost.toFixed(2)}</td>
                        <td className="py-1 px-2 text-right">{moEcart.totals.reel_cost.toFixed(2)}</td>
                        <td className="py-1 px-2 text-right"
                          style={{ color: moEcart.totals.ecart_cost > 0 ? '#c62828' : moEcart.totals.ecart_cost < 0 ? '#2e7d32' : undefined }}>
                          {moEcart.totals.ecart_cost > 0 ? '+' : ''}{moEcart.totals.ecart_cost.toFixed(2)}
                        </td>
                      </tr>
                    </tfoot>
                  </table>
                )}
              </DetailSection>
            )}

            {outputsCost && outputsCost.length > 0 && (
              <DetailSection title="Coût par sortie (coupe)" icon={<Scissors size={12} className="text-pink-500" />}
                isExpanded={expandedSection === 'outputs'} onToggle={() => setExpandedSection(expandedSection === 'outputs' ? null : 'outputs')}>
                {outputsCost.map((g) => (
                  <div key={g.plan_item_id} className="mb-3 last:mb-0">
                    <div className="text-xs font-semibold text-gray-700 px-2 py-1">{g.item_product_name}</div>
                    <table className="w-full text-xs">
                      <thead><tr className="text-gray-400 uppercase">
                        <th className="text-left py-1 px-2">Sortie</th>
                        <th className="text-right py-1 px-2">Qté</th>
                        <th className="text-right py-1 px-2">Équiv/u</th>
                        <th className="text-right py-1 px-2">Coût/u</th>
                        <th className="text-right py-1 px-2">Coût total</th>
                      </tr></thead>
                      <tbody>{g.outputs.map((o) => (
                        <tr key={o.output_id} className="border-t border-gray-50">
                          <td className="py-1 px-2 text-gray-700">{o.product_name || o.label}</td>
                          <td className="py-1 px-2 text-right text-gray-500">{o.quantity}</td>
                          <td className="py-1 px-2 text-right text-gray-500">{o.equiv_pieces}</td>
                          <td className="py-1 px-2 text-right text-gray-500">{o.unit_cost != null ? `${o.unit_cost.toFixed(2)} DH` : '—'}</td>
                          <td className="py-1 px-2 text-right font-medium text-gray-900">{o.cost_share != null ? `${o.cost_share.toFixed(2)} DH` : '—'}</td>
                        </tr>
                      ))}</tbody>
                      <tfoot><tr className="border-t border-gray-200 font-semibold text-gray-800">
                        <td className="py-1 px-2" colSpan={4}>Total article{g.complete ? '' : ' (partiel — sortie sans coût)'}</td>
                        <td className="py-1 px-2 text-right">{g.total_cost.toFixed(2)} DH</td>
                      </tr></tfoot>
                    </table>
                  </div>
                ))}
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

            {(cout.detail_energie || []).length > 0 && (
              <DetailSection title="Detail energie (equipements)" icon={<Zap size={12} className="text-yellow-500" />}
                isExpanded={expandedSection === 'energie'} onToggle={() => setExpandedSection(expandedSection === 'energie' ? null : 'energie')}>
                <table className="w-full text-xs">
                  <thead><tr className="text-gray-400 uppercase">
                    <th className="text-left py-1 px-2">Equipement</th>
                    <th className="text-right py-1 px-2">Minutes</th>
                    <th className="text-right py-1 px-2">Cout/h</th>
                    <th className="text-right py-1 px-2">Total</th>
                  </tr></thead>
                  <tbody>{(cout.detail_energie || []).map((d, i) => (
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

            {(cout.detail_pertes || []).length > 0 && (
              <DetailSection title="Detail pertes (valorisees au cout matiere)" icon={<TrendingDown size={12} className="text-red-500" />}
                isExpanded={expandedSection === 'pertes'} onToggle={() => setExpandedSection(expandedSection === 'pertes' ? null : 'pertes')}>
                <table className="w-full text-xs">
                  <thead><tr className="text-gray-400 uppercase">
                    <th className="text-left py-1 px-2">Categorie</th>
                    <th className="text-right py-1 px-2">Qte</th>
                    <th className="text-right py-1 px-2">PU matiere</th>
                    <th className="text-right py-1 px-2">Total</th>
                  </tr></thead>
                  <tbody>{(cout.detail_pertes || []).map((d, i) => (
                    <tr key={i} className="border-t border-gray-50">
                      <td className="py-1 px-2 text-gray-700">{d.categorie.replace(/^pertes?_/, '').replace(/_/g, ' ')}</td>
                      <td className="py-1 px-2 text-right text-gray-500">{toNum(d.quantite).toFixed(2)}</td>
                      <td className="py-1 px-2 text-right text-gray-500">{toNum(d.cout_unitaire).toFixed(2)}</td>
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
