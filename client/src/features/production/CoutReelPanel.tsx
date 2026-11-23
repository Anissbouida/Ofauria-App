import { useState } from 'react';
import { Link } from 'react-router-dom';
import { money, currencySymbol } from '../../utils/money';
import PlanCostAllocation from './PlanCostAllocation';
import { apiErrorMessage } from '../../api/errors';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { productionCoutApi } from '../../api/production-cout.api';
import { notify } from '../../components/ui/InlineNotification';
import { DataPanel, LoadingState } from '../../components/ds';
import {
  Calculator, Loader2,
  ChevronDown, ChevronRight, Users, Package, DollarSign, Building2, Plus, Equal, Zap, TrendingDown, Clock, Scissors, Gauge, Layers, Scale
} from 'lucide-react';
import './production.css';
import { useProdTerms } from '../../hooks/useProdTerms';

interface CoutReelPanelProps {
  planId: string;
  planStatus: string;
  isChef: boolean;
  totalQuantity?: number;
  /** Prix de revient par unité calculé au serveur (M8-05). */
  perUnit?: number | null;
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
  /** label + part ; taux/base (mig 527 : taux et assiette ; mig 655 : coût de l'unité d'œuvre et quantité d'inducteur). */
  detail_charges_fixes: { label: string; taux?: Money; base?: Money; part: Money }[];
  /** Mig 655 : charges analytiques séparées par niveau (somme = cout_charges_fixes). */
  cout_charges_appro?: Money;
  cout_charges_production?: Money;
  cout_charges_structure?: Money;
  cout_charges_directes?: Money;
  /** Coût de production (sans charges de structure) : valorisation des lots. */
  cout_production?: Money;
  niveaux?: Niveaux | null;
  methodes?: { key: string; label: string; total: number | null; note: string }[] | null;
  detail_analytique?: {
    month: string;
    lines: { code: string; name: string; level: string; driverLabel: string; quantity: number; rateFixed: number; rateVariable: number; fixed: number; variable: number; total: number }[];
    direct: { label: string; productName: string; quantity: number; rate: number; total: number }[];
    /** Mig 660 : charges imputées par nature (amortissement, outillage, loyer, personnel…). */
    byNature?: { nature: string; label: string; amount: number }[];
    warnings: string[];
  } | null;
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
  /** G0-23 : emballages consommés par le plan, et revient calculé par le serveur (seule définition). */
  cout_emballages?: Money;
  /** Façon du sous-traitant (M9, mig 584). */
  cout_sous_traitance?: Money;
  /** Étape 9 multi-industries (mig 645) : taux du poste × temps réel. */
  cout_machine?: Money;
  detail_machine?: { work_center_id: string; name: string; minutes: Money; hourly_cost: Money; total: Money }[];
  detail_emballages?: { packaging_id: string; name: string; unit: string | null; qty: Money; unit_cost: Money; total: Money }[];
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

// Charge par poste vs capacité (mig 398) — roadmap lot 3
interface ChargeRow {
  work_center_id: string;
  work_center_name: string;
  minutes_required: number;
  capacity_minutes_per_day: number | null;
  utilisation_pct: number | null;
  overloaded: boolean;
}

interface Niveaux {
  cout_achat: number; cout_production_direct: number; cout_production_complet: number; cout_revient_complet: number;
  charges: { approvisionnement: number; production: number; structure: number; directes: number };
  unites: number; cout_revient_unitaire: number | null; cout_production_unitaire: number | null;
  ventes_ht: number; prix_vente_ht_unitaire: number | null; marge: number; marge_unitaire: number | null;
  taux_marge: number | null; taux_marque: number | null;
  /** Lot E : écart au coût standard (fiches × quantités, charges des centres), décomposé. */
  ecarts?: { standard: { matieres: number; emballages: number; main_oeuvre: number; charges: number; total: number };
             reel_total: number; ecart_total: number; ecart_pct: number | null;
             lignes: { key: string; label: string; detail: string; montant: number }[]; articles_sans_fiche: number };
  items: { plan_item_id: string; product_name: string; quantity: number; prix_vente_ht_u: number | null; cout_production_u: number | null;
           cout_revient_u: number | null; cout_revient: number; ventes_ht: number; marge: number; taux_marge: number | null; taux_marque: number | null;
           /** Lot A (mig 657) : composantes propres de l'article. */
           matieres?: number; main_oeuvre?: number; charges_appro?: number; charges_production?: number; charges_structure?: number;
           charges_directes?: number; labour_hours?: number; labour_source?: 'pointe' | 'standard' | 'aucun' }[];
}

const LEVEL_SHORT: Record<string, string> = { approvisionnement: 'Approvisionnement', production: 'Production', administration: 'Administration', distribution: 'Distribution' };
const pctTxt = (v: number | null | undefined) => (v == null ? '—' : `${v.toLocaleString('fr-FR', { maximumFractionDigits: 1 })} %`);

function toNum(v: Money): number {
  if (v == null) return 0;
  const n = typeof v === 'number' ? v : parseFloat(v);
  return Number.isFinite(n) ? n : 0;
}

export default function CoutReelPanel({ planId, planStatus, isChef, totalQuantity, perUnit }: CoutReelPanelProps) {
  const queryClient = useQueryClient();
  const T = useProdTerms();
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

  // Charge par poste vs capacité — roadmap lot 3
  const { data: charge } = useQuery<ChargeRow[]>({
    queryKey: ['production-charge', planId],
    queryFn: () => productionCoutApi.chargeByPlan(planId).catch(() => []),
    enabled: ['in_progress', 'completed'].includes(planStatus),
  });

  const calculateMutation = useMutation({
    mutationFn: () => productionCoutApi.calculateCost(planId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['production-cout', planId] });
      queryClient.invalidateQueries({ queryKey: ['production', planId, 'summary'] });
      notify.success('Cout de revient calcule');
    },
    onError: (e: any) => notify.error(apiErrorMessage(e, 'Erreur calcul')),
  });

  if (planStatus !== 'completed' && planStatus !== 'in_progress') return null;

  const fmtMoney = (val: Money) => money(toNum(val));

  const coutMat = toNum(cout?.cout_matieres);
  const coutMO = toNum(cout?.cout_main_oeuvre);
  const coutEnergie = toNum(cout?.cout_energie);
  const coutCharges = toNum(cout?.cout_charges_fixes);
  const coutEmballages = toNum(cout?.cout_emballages);
  const coutFacon = toNum(cout?.cout_sous_traitance);
  const coutMachine = toNum(cout?.cout_machine);
  // G0-23 : le revient est celui du serveur (cout_total = matieres + emballages + MO +
  // energie + charges) ; l'ecran ne refait plus l'addition. Les pertes (cout_pertes) sont
  // une valorisation de matiere DEJA comptee dans cout_matieres : un « dont » (mig 339).
  const coutRevient = cout?.cout_total != null
    ? toNum(cout.cout_total)
    : coutMat + coutEmballages + coutMO + coutEnergie + coutCharges + coutFacon + coutMachine;
  const coutPertes = toNum(cout?.cout_pertes);
  // Mig 655 : coût calculé par le moteur analytique (centres, capacité normale).
  const niveaux = cout?.niveaux ?? null;
  const analytic = !!cout?.detail_analytique;
  const coutStructure = toNum(cout?.cout_charges_structure);
  const perItem = !!niveaux?.items.some(i => i.matieres != null);

  return (
    <div className="ds-panel pd-section">
      <div className="pd-section-head">
        <Calculator size={12} /> Coût de revient
        {cout && (
          <span style={{ marginLeft: 'auto', fontSize: '13px', fontWeight: 600, color: 'var(--ds-success)' }}>
            {fmtMoney(coutRevient)}
          </span>
        )}
      </div>

      {!cout && !isLoading && (
        <div style={{ padding: '1rem', textAlign: 'center', backgroundColor: 'var(--ds-card)' }}>
          <p style={{ fontSize: '13px', color: 'var(--ds-muted)', marginBottom: '0.5rem' }}>Le coût de revient n'a pas encore été calculé.</p>
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
        <LoadingState bare />
      )}

      {cout && (
        <>
          {/* Breakdown : Matières + M.O. + Charges = Revient */}
          <div className="odoo-stat-grid" style={{ borderBottom: '1px solid var(--ds-sep)' }}>
            <div className="odoo-stat-card" style={{ cursor: 'default' }}>
              <div className="odoo-stat-card-label">
                <Package size={11} style={{ display: 'inline', marginRight: 4 }} />Matières
              </div>
              <div className="odoo-stat-card-value" style={{ fontSize: '16px' }}>{fmtMoney(coutMat)}</div>
            </div>
            <div className="odoo-stat-card" style={{ cursor: 'default' }}>
              <div className="odoo-stat-card-label">
                <Package size={11} style={{ display: 'inline', marginRight: 4 }} />Emballages
              </div>
              <div className="odoo-stat-card-value" style={{ fontSize: '16px' }}>{fmtMoney(coutEmballages)}</div>
            </div>
            <div className="odoo-stat-card" style={{ cursor: 'default' }}>
              <div className="odoo-stat-card-label">
                <Users size={11} style={{ display: 'inline', marginRight: 4 }} />M.O.
              </div>
              <div className="odoo-stat-card-value" style={{ fontSize: '16px' }}>{fmtMoney(coutMO)}</div>
            </div>
            <div className="odoo-stat-card" style={{ cursor: 'default' }}>
              <div className="odoo-stat-card-label">
                <Zap size={11} style={{ display: 'inline', marginRight: 4 }} />Énergie
              </div>
              <div className="odoo-stat-card-value" style={{ fontSize: '16px' }}>{fmtMoney(coutEnergie)}</div>
            </div>
            {analytic ? (<>
              <div className="odoo-stat-card" style={{ cursor: 'default' }} title="Charges d'approvisionnement + charges indirectes de production + charges directes : dans le coût de production.">
                <div className="odoo-stat-card-label">
                  <Building2 size={11} style={{ display: 'inline', marginRight: 4 }} />Charges de production
                </div>
                <div className="odoo-stat-card-value" style={{ fontSize: '16px' }}>{fmtMoney(coutCharges - coutStructure)}</div>
              </div>
              <div className="odoo-stat-card" style={{ cursor: 'default' }} title="Quote-part de l'administration et de la distribution : dans le coût de revient complet, pas dans la valeur du stock.">
                <div className="odoo-stat-card-label">
                  <Layers size={11} style={{ display: 'inline', marginRight: 4 }} />Charges de structure
                </div>
                <div className="odoo-stat-card-value" style={{ fontSize: '16px' }}>{fmtMoney(coutStructure)}</div>
              </div>
            </>) : (
            <div className="odoo-stat-card" style={{ cursor: 'default' }}>
              <div className="odoo-stat-card-label">
                <Building2 size={11} style={{ display: 'inline', marginRight: 4 }} />Charges
              </div>
              <div className="odoo-stat-card-value" style={{ fontSize: '16px' }}>{fmtMoney(coutCharges)}</div>
            </div>
            )}
            {coutMachine > 0 && (
              <div className="odoo-stat-card" style={{ cursor: 'default' }}>
                <div className="odoo-stat-card-label">
                  <Building2 size={11} style={{ display: 'inline', marginRight: 4 }} />Machine
                </div>
                <div className="odoo-stat-card-value" style={{ fontSize: '16px' }}>{fmtMoney(coutMachine)}</div>
              </div>
            )}
            {coutFacon > 0 && (
              <div className="odoo-stat-card" style={{ cursor: 'default' }}>
                <div className="odoo-stat-card-label">
                  <Building2 size={11} style={{ display: 'inline', marginRight: 4 }} />Façon
                </div>
                <div className="odoo-stat-card-value" style={{ fontSize: '16px' }}>{fmtMoney(coutFacon)}</div>
              </div>
            )}
            <div className="odoo-stat-card" style={{ cursor: 'default', backgroundColor: 'var(--ds-hair)' }}>
              <div className="odoo-stat-card-label">
                <DollarSign size={11} style={{ display: 'inline', marginRight: 4, color: 'var(--ds-success)' }} />Revient
              </div>
              <div className="odoo-stat-card-value" style={{ fontSize: '16px', color: 'var(--ds-success)' }}>{fmtMoney(coutRevient)}</div>
            </div>
          </div>

          {/* Dont pertes : matiere perdue (rendement), deja incluse dans les matieres */}
          {coutPertes > 0 && (
            <div style={{
              padding: '0.4rem 1rem',
              backgroundColor: 'var(--ds-card)',
              borderBottom: '1px solid var(--ds-sep)',
              display: 'flex', justifyContent: 'space-between', alignItems: 'center',
              fontSize: '13px',
            }}>
              <span style={{ color: 'var(--ds-muted)' }}>
                <TrendingDown size={11} style={{ display: 'inline', marginRight: 4, color: 'var(--ds-danger)' }} />
                dont pertes (matière perdue, déjà comptée dans Matières)
              </span>
              <span style={{ fontWeight: 600, color: 'var(--ds-danger)' }}>
                {fmtMoney(coutPertes)}{coutMat > 0 ? ` (${((coutPertes / coutMat) * 100).toFixed(1)} % des matières)` : ''}
              </span>
            </div>
          )}

          {/* Prix par unite */}
          {totalQuantity && totalQuantity > 0 && perUnit != null && (
            <div style={{
              padding: '0.5rem 1rem',
              backgroundColor: 'var(--ds-card)',
              borderBottom: '1px solid var(--ds-sep)',
              display: 'flex', justifyContent: 'space-between', alignItems: 'center',
              fontSize: '13px',
            }}>
              <span style={{ color: 'var(--ds-muted)' }}>Prix de revient par unité ({totalQuantity} unités)</span>
              <span style={{ fontWeight: 600 }}>{money(perUnit)}</span>
            </div>
          )}

          {/* Mig 655 : niveaux de coût et rentabilité (prix de vente HT). */}
          {niveaux && (
            <div style={{ padding: '0.75rem 1rem', borderBottom: '1px solid var(--ds-sep)', backgroundColor: 'var(--ds-card)', fontSize: '13px' }}>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', columnGap: 28, rowGap: 4 }}>
                <div>
                  {([
                    ["Coût d'achat (matières + emballages + approvisionnement)", niveaux.cout_achat],
                    ['Coût de production direct', niveaux.cout_production_direct],
                    ['Coût de production complet', niveaux.cout_production_complet],
                    ['Coût de revient complet', niveaux.cout_revient_complet],
                  ] as [string, number][]).map(([l, v], i) => (
                    <div key={l} style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4, fontWeight: i === 3 ? 600 : 400 }}>
                      <span style={{ color: i === 3 ? undefined : 'var(--ds-muted)' }}>{l}</span><span>{money(v)}</span>
                    </div>
                  ))}
                </div>
                <div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                    <span style={{ color: 'var(--ds-muted)' }}>Coût de revient unitaire</span><span style={{ fontWeight: 600 }}>{niveaux.cout_revient_unitaire != null ? money(niveaux.cout_revient_unitaire, { decimals: 4 }) : '—'}</span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                    <span style={{ color: 'var(--ds-muted)' }}>Prix de vente HT moyen</span><span>{niveaux.prix_vente_ht_unitaire != null ? money(niveaux.prix_vente_ht_unitaire, { decimals: 4 }) : '—'}</span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                    <span style={{ color: 'var(--ds-muted)' }}>Marge ({money(niveaux.ventes_ht)} de ventes HT)</span>
                    <span style={{ fontWeight: 600, color: niveaux.marge < 0 ? 'var(--ds-danger)' : 'var(--ds-success)' }}>{money(niveaux.marge, { signed: true })}</span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                    <span style={{ color: 'var(--ds-muted)' }} title="Marge ÷ coût de revient">Taux de marge</span><span>{pctTxt(niveaux.taux_marge)}</span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                    <span style={{ color: 'var(--ds-muted)' }} title="Marge ÷ prix de vente HT">Taux de marque</span><span>{pctTxt(niveaux.taux_marque)}</span>
                  </div>
                </div>
              </div>
              <p style={{ margin: '6px 0 0', fontSize: 11, color: 'var(--ds-muted)' }}>
                Le stock est valorisé au coût de production ({money(niveaux.cout_production_complet)}) ; le coût de revient complet ajoute la quote-part
                d'administration et de distribution. Charges fixes imputées sur la capacité normale : la sous-activité du mois reste en
                écart de période (<Link to="/production/analyse-couts">Analyse des coûts</Link>).
              </p>
            </div>
          )}

          {/* Ecart prevu vs reel, decompose (audit A10) : mix vs prix/pertes.
              N'affiche rien si le prevu n'est pas dispo (recettes sans product_id
              ou plan lance avant mig 261). */}
          {niveaux?.ecarts && (() => {
            const e = niveaux.ecarts;
            const color = (v: number) => v > 0.005 ? 'var(--ds-danger)' : v < -0.005 ? 'var(--ds-success)' : 'var(--ds-muted)';
            return (
              <div style={{ padding: '0.75rem 1rem', borderBottom: '1px solid var(--ds-sep)', backgroundColor: 'var(--ds-card)', fontSize: '13px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}
                  title="Coût des fiches techniques × quantités produites, avec les charges des centres du mois (mêmes règles que le coût réel).">
                  <span style={{ color: 'var(--ds-muted)' }}>Coût standard au mix produit</span>
                  <span style={{ fontWeight: 500 }}>{money(e.standard.total)}</span>
                </div>
                {e.lignes.filter(l => Math.abs(l.montant) >= 0.01).map(l => (
                  <div key={l.key} style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }} title={l.detail}>
                    <span style={{ color: 'var(--ds-muted)' }}>Écart — {l.label}</span>
                    <span style={{ fontWeight: 500, color: color(l.montant) }}>{money(l.montant, { signed: true })}</span>
                  </div>
                ))}
                <div style={{ display: 'flex', justifyContent: 'space-between', paddingTop: 4, borderTop: '1px dashed var(--ds-sep)', fontWeight: 600 }}>
                  <span>Écart total (réel − standard)</span>
                  <span style={{ color: color(e.ecart_total) }}>
                    {money(e.ecart_total, { signed: true })}{e.ecart_pct != null ? ` (${e.ecart_pct > 0 ? '+' : ''}${e.ecart_pct.toLocaleString('fr-FR', { maximumFractionDigits: 1 })} %)` : ''}
                  </span>
                </div>
                {e.articles_sans_fiche > 0 && <p style={{ margin: '4px 0 0', fontSize: 11, color: 'var(--ds-muted)' }}>{e.articles_sans_fiche} article(s) sans fiche technique : hors du coût standard.</p>}
              </div>
            );
          })()}

          {!niveaux?.ecarts && cout.cout_prevu != null && toNum(cout.cout_prevu) > 0 && (() => {
            const prevu = toNum(cout.cout_prevu);
            const prevuMix = cout.cout_prevu_mix_reel != null ? toNum(cout.cout_prevu_mix_reel) : null;
            const ecartTot = coutRevient - prevu;
            const ecartMix = cout.ecart_mix != null ? toNum(cout.ecart_mix)
              : (prevuMix != null ? prevu - prevuMix : null);
            const ecartPrix = prevuMix != null ? coutRevient - prevuMix : null;
            const color = (v: number) => v > 0 ? 'var(--ds-danger)' : v < 0 ? 'var(--ds-success)' : 'var(--ds-muted)';
            const sign = (v: number) => (v > 0 ? '+' : '');
            return (
              <div style={{
                padding: '0.75rem 1rem', borderBottom: '1px solid var(--ds-sep)',
                backgroundColor: 'var(--ds-card)', fontSize: '13px',
              }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                  <span style={{ color: 'var(--ds-muted)' }}>Coût prévu (mix standard)</span>
                  <span style={{ fontWeight: 500 }}>{fmtMoney(prevu)}</span>
                </div>
                {prevuMix != null && Math.abs((ecartMix ?? 0)) > 0.01 && (
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}
                    title="Différence due au mix réellement produit (ex : 6 moyens au lieu de 3+3). N'implique aucune sur/sous-consommation de matière — c'est un effet volume par format.">
                    <span style={{ color: 'var(--ds-muted)' }}>Écart de mix</span>
                    <span style={{ fontWeight: 500, color: color(-(ecartMix ?? 0)) }}>
                      {money(-(ecartMix ?? 0), { signed: true })}
                    </span>
                  </div>
                )}
                {prevuMix != null && (
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}
                    title="Coût prévu recalculé sur les quantités réellement produites (le mix standard ne compte plus).">
                    <span style={{ color: 'var(--ds-muted)' }}>Prévu au mix réel</span>
                    <span style={{ fontWeight: 500 }}>{fmtMoney(prevuMix)}</span>
                  </div>
                )}
                {ecartPrix != null && (
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}
                    title={`Ce qui reste de l'écart après avoir absorbé le mix : sur/sous-consommation matière + pertes + variation de prix des ${T.ingredientsLc}.`}>
                    <span style={{ color: 'var(--ds-muted)' }}>Écart prix / pertes</span>
                    <span style={{ fontWeight: 500, color: color(ecartPrix) }}>
                      {money(ecartPrix, { signed: true })}
                    </span>
                  </div>
                )}
                <div style={{ display: 'flex', justifyContent: 'space-between', paddingTop: 4, borderTop: '1px dashed var(--ds-sep)', fontWeight: 600 }}>
                  <span>Écart total (Réel − Prévu)</span>
                  <span style={{ color: color(ecartTot) }}>
                    {money(ecartTot, { signed: true })}
                    {' '}({sign(ecartTot)}{prevu > 0 ? ((ecartTot / prevu) * 100).toFixed(1) : '0.0'} %)
                  </span>
                </div>
              </div>
            );
          })()}

          {/* Expandable detail sections */}
          <div className="border-t border-gray-100 divide-y divide-gray-100">
            {(cout.detail_emballages?.length ?? 0) > 0 && (
              <DetailSection title="Détail emballages" icon={<Package size={12} className="text-orange-500" />}
                isExpanded={expandedSection === 'emballages'} onToggle={() => setExpandedSection(expandedSection === 'emballages' ? null : 'emballages')}>
                <DataPanel label="Détail emballages">
                <table className="odoo-table ds-dense">
                  <thead><tr>
                    <th>Emballage</th>
                    <th className="ds-num">Qté</th>
                    <th className="ds-num">PU ({currencySymbol()})</th>
                    <th className="ds-num">Total</th>
                  </tr></thead>
                  <tbody>{(cout.detail_emballages ?? []).map((d, i) => (
                    <tr key={i}>
                      <td className="ds-strong">{d.name}</td>
                      <td className="ds-num">{toNum(d.qty).toLocaleString('fr-FR', { maximumFractionDigits: 3 })}{d.unit ? ` ${d.unit}` : ''}</td>
                      <td className="ds-num">{toNum(d.unit_cost).toFixed(2)}</td>
                      <td className="ds-num">{fmtMoney(d.total)}</td>
                    </tr>
                  ))}</tbody>
                </table>
                </DataPanel>
              </DetailSection>
            )}
            {cout.detail_matieres.length > 0 && (
              <DetailSection title="Détail matières" icon={<Package size={12} className="text-amber-500" />}
                isExpanded={expandedSection === 'matieres'} onToggle={() => setExpandedSection(expandedSection === 'matieres' ? null : 'matieres')}>
                <DataPanel label="Détail matières">
                <table className="odoo-table ds-dense">
                  <thead><tr>
                    <th>{T.ingredient}</th>
                    <th className="ds-num">Qte</th>
                    <th className="ds-num">PU ({currencySymbol()})</th>
                    <th className="ds-num">Total ({currencySymbol()})</th>
                  </tr></thead>
                  <tbody>{cout.detail_matieres.map((d, i) => (
                    <tr key={i}>
                      <td className="ds-strong">{d.name}</td>
                      <td className="ds-num">{toNum(d.qty).toFixed(2)}</td>
                      <td className="ds-num">{toNum(d.unit_cost).toFixed(2)}</td>
                      <td className="ds-num">{toNum(d.total).toFixed(2)}</td>
                    </tr>
                  ))}</tbody>
                </table>
                </DataPanel>
              </DetailSection>
            )}

            {cout.detail_main_oeuvre.length > 0 && (
              <DetailSection title="Détail main d'oeuvre" icon={<Users size={12} className="text-blue-500" />}
                isExpanded={expandedSection === 'mo'} onToggle={() => setExpandedSection(expandedSection === 'mo' ? null : 'mo')}>
                <DataPanel label="Détail main d'oeuvre">
                <table className="odoo-table ds-dense">
                  <thead><tr>
                    <th>Employé</th>
                    <th className="ds-num">Minutes</th>
                    <th className="ds-num">Taux/h ({currencySymbol()})</th>
                    <th className="ds-num">Total ({currencySymbol()})</th>
                  </tr></thead>
                  <tbody>{cout.detail_main_oeuvre.map((d, i) => (
                    <tr key={i}>
                      <td className="ds-strong">{d.name}</td>
                      <td className="ds-num">{toNum(d.minutes)}</td>
                      <td className="ds-num">{toNum(d.hourly_rate).toFixed(2)}</td>
                      <td className="ds-num">{toNum(d.total).toFixed(2)}</td>
                    </tr>
                  ))}</tbody>
                </table>
                </DataPanel>
              </DetailSection>
            )}

            {moEcart && moEcart.items.length > 0 && (
              <DetailSection title="Écart M.O. : gamme standard vs reel" icon={<Clock size={12} className="text-indigo-500" />}
                isExpanded={expandedSection === 'mo-ecart'} onToggle={() => setExpandedSection(expandedSection === 'mo-ecart' ? null : 'mo-ecart')}>
                {moEcart.totals.nb_items_sans_gamme === moEcart.totals.nb_items ? (
                  <p className="text-xs text-gray-500 px-2 py-1">
                    Aucune gamme de production rattachée. Définissez des gammes (Production › Postes & gammes)
                    pour comparer le temps de main-d'œuvre standard au temps réellement passé.
                  </p>
                ) : (
                  <DataPanel label="Écart M.O. : gamme standard vs réel">
                  <table className="odoo-table ds-dense">
                    <thead><tr>
                      <th>Produit</th>
                      <th className="ds-num">Std (min)</th>
                      <th className="ds-num">Réel (min)</th>
                      <th className="ds-num">Std ({currencySymbol()})</th>
                      <th className="ds-num">Réel ({currencySymbol()})</th>
                      <th className="ds-num">Écart ({currencySymbol()})</th>
                    </tr></thead>
                    <tbody>{moEcart.items.map((d) => (
                      <tr key={d.plan_item_id}>
                        <td className="ds-strong">
                          {d.product_name}
                          {d.std_cost == null && <span className="text-gray-300"> (sans gamme)</span>}
                        </td>
                        <td className="ds-num">{d.std_minutes ?? '—'}</td>
                        <td className="ds-num">{d.reel_minutes}</td>
                        <td className="ds-num">{d.std_cost != null ? d.std_cost.toFixed(2) : '—'}</td>
                        <td className="ds-num">{d.reel_cost.toFixed(2)}</td>
                        <td className="ds-num"
                          style={{ color: d.ecart_cost == null ? 'var(--ds-muted)' : d.ecart_cost > 0 ? 'var(--ds-danger)' : d.ecart_cost < 0 ? 'var(--ds-success)' : undefined }}>
                          {d.ecart_cost == null ? '—' : `${d.ecart_cost > 0 ? '+' : ''}${d.ecart_cost.toFixed(2)}`}
                        </td>
                      </tr>
                    ))}</tbody>
                    <tfoot>
                      <tr>
                        <td>Total (items avec gamme)</td>
                        <td className="ds-num">{moEcart.totals.std_minutes}</td>
                        <td className="ds-num">{moEcart.totals.reel_minutes}</td>
                        <td className="ds-num">{moEcart.totals.std_cost.toFixed(2)}</td>
                        <td className="ds-num">{moEcart.totals.reel_cost.toFixed(2)}</td>
                        <td className="ds-num"
                          style={{ color: moEcart.totals.ecart_cost > 0 ? 'var(--ds-danger)' : moEcart.totals.ecart_cost < 0 ? 'var(--ds-success)' : undefined }}>
                          {moEcart.totals.ecart_cost > 0 ? '+' : ''}{moEcart.totals.ecart_cost.toFixed(2)}
                        </td>
                      </tr>
                    </tfoot>
                  </table>
                  </DataPanel>
                )}
              </DetailSection>
            )}

            {outputsCost && outputsCost.length > 0 && (
              <DetailSection title="Coût par sortie (coupe)" icon={<Scissors size={12} className="text-pink-500" />}
                isExpanded={expandedSection === 'outputs'} onToggle={() => setExpandedSection(expandedSection === 'outputs' ? null : 'outputs')}>
                {outputsCost.map((g) => (
                  <div key={g.plan_item_id} className="mb-3 last:mb-0">
                    <div className="text-xs font-semibold text-gray-700 px-2 py-1">{g.item_product_name}</div>
                    <DataPanel label={`Coût par sortie : ${g.item_product_name}`}>
                    <table className="odoo-table ds-dense">
                      <thead><tr>
                        <th>Sortie</th>
                        <th className="ds-num">Qté</th>
                        <th className="ds-num">Équiv/u</th>
                        <th className="ds-num">Coût/u</th>
                        <th className="ds-num">Coût total</th>
                      </tr></thead>
                      <tbody>{g.outputs.map((o) => (
                        <tr key={o.output_id}>
                          <td className="ds-strong">{o.product_name || o.label}</td>
                          <td className="ds-num">{o.quantity}</td>
                          <td className="ds-num">{o.equiv_pieces}</td>
                          <td className="ds-num">{o.unit_cost != null ? money(o.unit_cost) : '—'}</td>
                          <td className="ds-num">{o.cost_share != null ? money(o.cost_share) : '—'}</td>
                        </tr>
                      ))}</tbody>
                      <tfoot><tr>
                        <td colSpan={4}>Total article{g.complete ? '' : ' (partiel — sortie sans coût)'}</td>
                        <td className="ds-num">{money(g.total_cost)}</td>
                      </tr></tfoot>
                    </table>
                    </DataPanel>
                  </div>
                ))}
              </DetailSection>
            )}

            <DetailSection title="Répartition du coût entre les articles" icon={<Scissors size={12} className="text-indigo-500" />}
              isExpanded={expandedSection === 'allocation'} onToggle={() => setExpandedSection(expandedSection === 'allocation' ? null : 'allocation')}>
              <PlanCostAllocation planId={planId} canEdit />
            </DetailSection>

            {charge && charge.length > 0 && (
              <DetailSection title="Charge par poste (capacité)" icon={<Gauge size={12} className="text-cyan-600" />}
                isExpanded={expandedSection === 'charge'} onToggle={() => setExpandedSection(expandedSection === 'charge' ? null : 'charge')}>
                <DataPanel label="Charge par poste">
                <table className="odoo-table ds-dense">
                  <thead><tr>
                    <th>Poste</th>
                    <th className="ds-num">Charge (min)</th>
                    <th className="ds-num">Capacité (min/j)</th>
                    <th className="ds-num">Utilisation (%)</th>
                  </tr></thead>
                  <tbody>{charge.map((c) => (
                    <tr key={c.work_center_id}>
                      <td className="ds-strong">{c.work_center_name}</td>
                      <td className="ds-num">{c.minutes_required}</td>
                      <td className="ds-num">{c.capacity_minutes_per_day != null ? c.capacity_minutes_per_day : '—'}</td>
                      <td className="ds-num"
                        style={{ color: c.utilisation_pct == null ? 'var(--ds-muted)' : c.overloaded ? 'var(--ds-danger)' : c.utilisation_pct > 80 ? 'var(--ds-warning)' : 'var(--ds-success)' }}>
                        {c.utilisation_pct == null ? '—' : c.utilisation_pct}{c.overloaded ? ' ⚠' : ''}
                      </td>
                    </tr>
                  ))}</tbody>
                </table>
                </DataPanel>
                <p className="text-[11px] text-gray-400 px-2 pt-1">Charge = nb de fournées × durées de gamme. Capacité définie dans Production › Postes & gammes.</p>
              </DetailSection>
            )}

            {analytic && cout.detail_analytique && (cout.detail_analytique.lines.length > 0 || cout.detail_analytique.direct.length > 0) && (
              <DetailSection title="Charges imputées par centre (imputation rationnelle)" icon={<Building2 size={12} className="text-violet-500" />}
                isExpanded={expandedSection === 'charges'} onToggle={() => setExpandedSection(expandedSection === 'charges' ? null : 'charges')}>
                <DataPanel label="Charges imputées par centre">
                <table className="odoo-table ds-dense">
                  <thead><tr>
                    <th>Centre</th><th>Niveau</th><th>Inducteur</th>
                    <th className="ds-num">Quantité</th><th className="ds-num">Coût de l'unité d'œuvre</th>
                    <th className="ds-num">Fixe</th><th className="ds-num">Variable</th><th className="ds-num">Imputé</th>
                  </tr></thead>
                  <tbody>
                    {cout.detail_analytique.lines.map((d, i) => (
                      <tr key={i}>
                        <td className="ds-strong">{d.name} <span className="ds-muted">{d.code}</span></td>
                        <td>{LEVEL_SHORT[d.level] ?? d.level}</td>
                        <td>{d.driverLabel}</td>
                        <td className="ds-num">{toNum(d.quantity).toLocaleString('fr-FR', { maximumFractionDigits: 2 })}</td>
                        <td className="ds-num">{(toNum(d.rateFixed) + toNum(d.rateVariable)).toLocaleString('fr-FR', { maximumFractionDigits: 4 })}</td>
                        <td className="ds-num">{fmtMoney(d.fixed)}</td>
                        <td className="ds-num">{fmtMoney(d.variable)}</td>
                        <td className="ds-num">{fmtMoney(d.total)}</td>
                      </tr>
                    ))}
                    {cout.detail_analytique.direct.map((d, i) => (
                      <tr key={`d${i}`}>
                        <td className="ds-strong">{d.label}</td><td>Charge directe</td><td>{d.productName}</td>
                        <td className="ds-num">{toNum(d.quantity).toLocaleString('fr-FR')}</td>
                        <td className="ds-num">{toNum(d.rate).toLocaleString('fr-FR', { maximumFractionDigits: 4 })}</td>
                        <td className="ds-num" colSpan={2} /><td className="ds-num">{fmtMoney(d.total)}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot><tr><td className="ds-strong" colSpan={7}>Total des charges imputées</td><td className="ds-num ds-strong">{fmtMoney(coutCharges)}</td></tr></tfoot>
                </table>
                </DataPanel>
                <p className="text-[11px] text-gray-400 px-2 pt-1">
                  Coût de l'unité d'œuvre = charges mensuelles du centre ÷ capacité normale mensuelle (mois {cout.detail_analytique.month}).
                  Paramétrage : <Link to="/production/analyse-couts">Production › Analyse des coûts</Link>.
                </p>
              </DetailSection>
            )}

            {analytic && cout.detail_analytique?.byNature && (
              <DetailSection title="Charges par nature (dont amortissements et outillage)" icon={<Layers size={12} className="text-violet-500" />}
                isExpanded={expandedSection === 'natures'} onToggle={() => setExpandedSection(expandedSection === 'natures' ? null : 'natures')}>
                <DataPanel label="Charges par nature">
                <table className="odoo-table ds-dense">
                  <thead><tr><th>Nature</th><th className="ds-num">Montant imputé au plan</th><th className="ds-num">Par unité</th></tr></thead>
                  <tbody>
                    {['amortissement', 'outillage'].filter(n => !cout.detail_analytique!.byNature!.some(x => x.nature === n)).map(n => (
                      <tr key={n}><td className="ds-strong">{n === 'amortissement' ? 'Amortissement des équipements' : 'Outillage et petit matériel'}</td>
                        <td className="ds-num ds-muted">0,00 — rien au registre</td><td /></tr>
                    ))}
                    {cout.detail_analytique.byNature.map(n => (
                      <tr key={n.nature}>
                        <td className="ds-strong">{n.label}</td><td className="ds-num">{fmtMoney(n.amount)}</td>
                        <td className="ds-num">{niveaux && niveaux.unites > 0 ? money(n.amount / niveaux.unites, { decimals: 4 }) : '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot><tr><td className="ds-strong">Total des charges</td><td className="ds-num ds-strong">{fmtMoney(coutCharges)}</td><td /></tr></tfoot>
                </table>
                </DataPanel>
                <p className="text-[11px] text-gray-400 px-2 pt-1">
                  Part de chaque nature dans les centres qui imputent ce plan. Équipements immobilisés et outillage : <Link to="/production/analyse-couts">Analyse des coûts › Équipements et outils</Link>.
                </p>
              </DetailSection>
            )}

            {niveaux && niveaux.items.length > 0 && (
              <DetailSection title="Coût et marge par article" icon={<Scale size={12} className="text-emerald-600" />}
                isExpanded={expandedSection === 'marges'} onToggle={() => setExpandedSection(expandedSection === 'marges' ? null : 'marges')}>
                <DataPanel label="Coût et marge par article">
                <table className="odoo-table ds-dense">
                  <thead><tr>
                    <th>Article</th><th className="ds-num">Quantité</th>
                    {perItem && <><th className="ds-num">Matières</th><th className="ds-num">M.O.</th><th className="ds-num">Charges</th></>}
                    <th className="ds-num">Coût de production / u</th>
                    <th className="ds-num">Coût de revient / u</th><th className="ds-num">Prix HT / u</th>
                    <th className="ds-num">Marge</th><th className="ds-num">Taux de marge</th><th className="ds-num">Taux de marque</th>
                  </tr></thead>
                  <tbody>{niveaux.items.map(it => (
                    <tr key={it.plan_item_id}>
                      <td className="ds-strong">{it.product_name}</td>
                      <td className="ds-num">{toNum(it.quantity).toLocaleString('fr-FR')}</td>
                      {perItem && <>
                        <td className="ds-num">{fmtMoney(it.matieres)}</td>
                        <td className="ds-num" title={it.labour_source === 'standard' ? 'Temps standard de la gamme' : it.labour_source === 'pointe' ? 'Temps pointé' : 'Aucun temps connu'}>{fmtMoney(it.main_oeuvre)}</td>
                        <td className="ds-num">{fmtMoney(toNum(it.charges_appro) + toNum(it.charges_production) + toNum(it.charges_structure) + toNum(it.charges_directes))}</td>
                      </>}
                      <td className="ds-num">{it.cout_production_u != null ? money(it.cout_production_u, { decimals: 4 }) : '—'}</td>
                      <td className="ds-num">{it.cout_revient_u != null ? money(it.cout_revient_u, { decimals: 4 }) : '—'}</td>
                      <td className="ds-num">{it.prix_vente_ht_u != null ? money(it.prix_vente_ht_u, { decimals: 2 }) : '—'}</td>
                      <td className="ds-num" style={{ color: it.marge < 0 ? 'var(--ds-danger)' : undefined }}>{money(it.marge, { signed: true })}</td>
                      <td className="ds-num">{pctTxt(it.taux_marge)}</td>
                      <td className="ds-num">{pctTxt(it.taux_marque)}</td>
                    </tr>
                  ))}</tbody>
                </table>
                </DataPanel>
                <p className="text-[11px] text-gray-400 px-2 pt-1">{perItem
                  ? 'Coût propre de chaque article : matières de sa fiche (rapprochées des consommations réelles), main-d\'œuvre de ses étapes ou de sa gamme, charges des centres selon ses unités d\'œuvre. Emballages, énergie et façon du plan au prorata des quantités.'
                  : 'Coût par article selon la clé de répartition du plan (section « Répartition du coût entre les articles »).'}</p>
              </DetailSection>
            )}

            {(cout.methodes?.length ?? 0) > 0 && (
              <DetailSection title="Comparaison des méthodes de calcul" icon={<Calculator size={12} className="text-sky-600" />}
                isExpanded={expandedSection === 'methodes'} onToggle={() => setExpandedSection(expandedSection === 'methodes' ? null : 'methodes')}>
                <DataPanel label="Comparaison des méthodes">
                <table className="odoo-table ds-dense">
                  <thead><tr><th>Méthode</th><th className="ds-num">Coût total</th><th className="ds-num">Coût unitaire</th><th className="ds-num">Marge / ventes HT</th><th>Lecture</th></tr></thead>
                  <tbody>{(cout.methodes ?? []).map(m => {
                    const units = niveaux?.unites ?? 0;
                    const ventes = niveaux?.ventes_ht ?? 0;
                    return (
                      <tr key={m.key} style={m.key === 'rationnelle' ? { fontWeight: 600 } : undefined}>
                        <td>{m.label}</td>
                        <td className="ds-num">{m.total != null ? money(m.total) : '—'}</td>
                        <td className="ds-num">{m.total != null && units > 0 ? money(m.total / units, { decimals: 4 }) : '—'}</td>
                        <td className="ds-num">{m.total != null && ventes > 0 ? pctTxt((ventes - m.total) / ventes * 100) : '—'}</td>
                        <td style={{ fontSize: 12, color: 'var(--ds-muted)', fontWeight: 400 }}>{m.note}</td>
                      </tr>
                    );
                  })}</tbody>
                </table>
                </DataPanel>
              </DetailSection>
            )}

            {!analytic && (cout.detail_charges_fixes || []).length > 0 && (
              <DetailSection title="Détail charges fixes" icon={<Building2 size={12} className="text-violet-500" />}
                isExpanded={expandedSection === 'charges'} onToggle={() => setExpandedSection(expandedSection === 'charges' ? null : 'charges')}>
                <DataPanel label="Détail charges fixes">
                <table className="odoo-table ds-dense">
                  <thead><tr>
                    <th>Charge</th>
                    <th className="ds-num">Taux</th>
                    <th className="ds-num">Assiette</th>
                    <th className="ds-num">Quote-part</th>
                  </tr></thead>
                  <tbody>{(cout.detail_charges_fixes || []).map((d, i) => (
                    <tr key={i}>
                      <td className="ds-strong">{d.label}</td>
                      <td className="ds-num">{d.taux != null ? `${(toNum(d.taux) * 100).toLocaleString('fr-FR', { maximumFractionDigits: 2 })} %` : '—'}</td>
                      <td className="ds-num">{d.base != null ? fmtMoney(d.base) : '—'}</td>
                      <td className="ds-num">{fmtMoney(d.part)}</td>
                    </tr>
                  ))}</tbody>
                </table>
                </DataPanel>
              </DetailSection>
            )}

            {(cout.detail_energie || []).length > 0 && (
              <DetailSection title="Détail energie (equipements)" icon={<Zap size={12} className="text-yellow-500" />}
                isExpanded={expandedSection === 'energie'} onToggle={() => setExpandedSection(expandedSection === 'energie' ? null : 'energie')}>
                <DataPanel label="Détail énergie">
                <table className="odoo-table ds-dense">
                  <thead><tr>
                    <th>Equipement</th>
                    <th className="ds-num">Minutes</th>
                    <th className="ds-num">Coût/h ({currencySymbol()})</th>
                    <th className="ds-num">Total ({currencySymbol()})</th>
                  </tr></thead>
                  <tbody>{(cout.detail_energie || []).map((d, i) => (
                    <tr key={i}>
                      <td className="ds-strong">{d.name}</td>
                      <td className="ds-num">{toNum(d.minutes)}</td>
                      <td className="ds-num">{toNum(d.cout_horaire).toFixed(2)}</td>
                      <td className="ds-num">{toNum(d.total).toFixed(2)}</td>
                    </tr>
                  ))}</tbody>
                </table>
                </DataPanel>
              </DetailSection>
            )}

            {(cout.detail_machine || []).length > 0 && (
              <DetailSection title="Détail machine (postes de charge)" icon={<Building2 size={12} />}
                isExpanded={expandedSection === 'machine'} onToggle={() => setExpandedSection(expandedSection === 'machine' ? null : 'machine')}>
                <DataPanel label="Détail machine">
                <table className="odoo-table ds-dense">
                  <thead><tr>
                    <th>Poste</th>
                    <th className="ds-num">Minutes</th>
                    <th className="ds-num">Taux/h ({currencySymbol()})</th>
                    <th className="ds-num">Total ({currencySymbol()})</th>
                  </tr></thead>
                  <tbody>{(cout.detail_machine || []).map((d, i) => (
                    <tr key={i}>
                      <td className="ds-strong">{d.name}</td>
                      <td className="ds-num">{toNum(d.minutes)}</td>
                      <td className="ds-num">{toNum(d.hourly_cost).toFixed(2)}</td>
                      <td className="ds-num">{toNum(d.total).toFixed(2)}</td>
                    </tr>
                  ))}</tbody>
                </table>
                </DataPanel>
              </DetailSection>
            )}

            {(cout.detail_pertes || []).length > 0 && (
              <DetailSection title="Détail pertes (valorisées au coût matière)" icon={<TrendingDown size={12} className="text-red-500" />}
                isExpanded={expandedSection === 'pertes'} onToggle={() => setExpandedSection(expandedSection === 'pertes' ? null : 'pertes')}>
                <DataPanel label="Détail pertes">
                <table className="odoo-table ds-dense">
                  <thead><tr>
                    <th>Catégorie</th>
                    <th className="ds-num">Qte</th>
                    <th className="ds-num">PU matière ({currencySymbol()})</th>
                    <th className="ds-num">Total ({currencySymbol()})</th>
                  </tr></thead>
                  <tbody>{(cout.detail_pertes || []).map((d, i) => (
                    <tr key={i}>
                      <td className="ds-strong">{d.categorie.replace(/^pertes?_/, '').replace(/_/g, ' ')}</td>
                      <td className="ds-num">{toNum(d.quantite).toFixed(2)}</td>
                      <td className="ds-num">{toNum(d.cout_unitaire).toFixed(2)}</td>
                      <td className="ds-num">{toNum(d.total).toFixed(2)}</td>
                    </tr>
                  ))}</tbody>
                </table>
                </DataPanel>
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
