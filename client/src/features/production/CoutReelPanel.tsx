import { useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { money, currencySymbol } from '../../utils/money';
import PlanCostAllocation from './PlanCostAllocation';
import { apiErrorMessage } from '../../api/errors';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { productionCoutApi } from '../../api/production-cout.api';
import { notify } from '../../components/ui/InlineNotification';
import { Alert, EmptyState, LoadingState, Segmented, Tabs } from '../../components/ds';
import { StatusTag } from '../../components/ui/StatusTag';
import { AlertTriangle, Calculator, Layers, Loader2, RefreshCw, Scale } from 'lucide-react';
import './production.css';
import { useProdTerms } from '../../hooks/useProdTerms';

/**
 * Onglet Coûts d'un plan (refonte 2026-11-23) : le coût se lit article par article.
 *   1. Coût de revient par article — coût unitaire ou coût total, le plan en ligne de total.
 *   2. Structure du coût de revient de l'article choisi — chaque élément de coût avec sa base de calcul.
 *   3. Analyse du plan — écarts, centres de coûts, natures de coûts, consommations, méthodes.
 * Vocabulaire des ERP : coûts directs, frais généraux, centre de coûts, inducteur, taux d'imputation,
 * coût standard / coût réel, écart sur prix / sur quantité. Aucun calcul n'est refait ici : tout
 * vient de production_cout_reel (moteur analytique, mig 655-660).
 */

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
  /** Mig 268 (audit A10) : prévu au mix réellement produit et écart de mix isolé. */
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

// Écart MO : gamme standard (mig 388) vs réel (étapes mig 089) — roadmap lot 1
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

// Coût de revient par sortie de coupe (mig 302/397) — roadmap lot 2
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

interface NiveauItem {
  plan_item_id: string; product_name: string; quantity: number; prix_vente_ht_u: number | null; cout_production_u: number | null;
  cout_revient_u: number | null; cout_revient: number; ventes_ht: number; marge: number; taux_marge: number | null; taux_marque: number | null;
  /** Lot A (mig 657) : composantes propres de l'article. */
  matieres?: number; emballages?: number; main_oeuvre?: number; energie?: number; machine?: number; sous_traitance?: number;
  charges_appro?: number; charges_production?: number; charges_structure?: number; charges_directes?: number;
  /** Détail des charges de structure et part de chaque centre (plans recalculés depuis le 2026-11-23). */
  charges_administration?: number; charges_distribution?: number;
  charges_centres?: { code: string; name: string; level: string; driverLabel: string; quantity: number; rate: number; total: number }[];
  cout_production?: number;
  labour_hours?: number; labour_source?: 'pointe' | 'standard' | 'aucun';
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
  items: NiveauItem[];
}

const LEVEL_LABEL: Record<string, string> = { approvisionnement: "Coût d'achat", production: 'Coût de production', administration: 'Coût de revient', distribution: 'Coût de revient' };
const PLAN_KEY = '__plan';

function toNum(v: Money): number {
  if (v == null) return 0;
  const n = typeof v === 'number' ? v : parseFloat(v);
  return Number.isFinite(n) ? n : 0;
}
/** Montant sans devise (l'unité est dans l'en-tête de colonne). */
const nf = (v: Money, d = 2) => toNum(v).toLocaleString('fr-FR', { minimumFractionDigits: d, maximumFractionDigits: d });
const qf = (v: Money, max = 2) => toNum(v).toLocaleString('fr-FR', { maximumFractionDigits: max });
const signed = (v: number, d = 2) => (v > 0.004 ? '+' : v < -0.004 ? '−' : '') + nf(Math.abs(v), d);
const pctTxt = (v: number | null | undefined) => (v == null ? '—' : `${v.toLocaleString('fr-FR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} %`);
const varianceColor = (v: number) => (v > 0.005 ? 'var(--ds-danger)' : v < -0.005 ? 'var(--ds-success)' : undefined);
const marginColor = (v: number) => (v < -0.005 ? 'var(--ds-danger)' : v > 0.005 ? 'var(--ds-success)' : undefined);

/** Élément de coût d'une structure (article ou plan). */
interface CostElement {
  key: string; label: string; base?: string; amount: number;
  /** Couleur de la palette catégorielle (barre et pastille) ; absente pour un sous-total. */
  color?: string;
  kind?: 'group' | 'quiet';
}

const CAT = (k: string) => `var(--ds-cat-${k})`;

function centresBase(it: NiveauItem, levels: string[], fallback: string): string {
  const cs = (it.charges_centres ?? []).filter(c => levels.includes(c.level) && Math.abs(c.total) > 0.004);
  if (!cs.length) return fallback;
  return cs.map(c => `${c.driverLabel} ${qf(c.quantity)} × taux ${qf(c.rate, 4)}`).join(' + ');
}

function itemElements(it: NiveauItem): CostElement[] {
  const out: CostElement[] = [
    { key: 'mat', label: 'Matières premières', base: 'Consommations de matières et de produits semi-finis', amount: toNum(it.matieres), color: CAT('blue') },
  ];
  const labourBase = it.labour_source === 'pointe' ? `Temps déclaré : ${qf(it.labour_hours)} h`
    : it.labour_source === 'standard' ? `Temps standard de la gamme : ${qf(it.labour_hours)} h` : undefined;
  const directs: CostElement[] = [
    { key: 'emb', label: 'Emballages', base: 'Au prorata des quantités produites', amount: toNum(it.emballages), color: CAT('olive') },
    { key: 'mo', label: "Main-d'œuvre directe", base: labourBase, amount: toNum(it.main_oeuvre), color: CAT('gold') },
    { key: 'ene', label: 'Énergie', base: 'Au prorata des quantités produites', amount: toNum(it.energie), color: CAT('pink') },
    { key: 'mach', label: 'Machine', base: 'Taux du poste × temps', amount: toNum(it.machine), color: CAT('pink') },
    { key: 'fac', label: 'Sous-traitance', base: 'Au prorata des quantités produites', amount: toNum(it.sous_traitance), color: CAT('pink') },
    { key: 'dir', label: 'Frais directs', base: "Charges affectées à l'article", amount: toNum(it.charges_directes), color: CAT('pink') },
  ].filter(e => Math.abs(e.amount) > 0.004);
  if (directs.length) out.push(...directs);
  else out.push({ key: 'mo', label: "Main-d'œuvre directe", base: 'Avec emballages et énergie : rien de déclaré', amount: 0, kind: 'quiet' });
  const overheads: CostElement[] = [
    { key: 'appro', label: "Frais généraux d'approvisionnement", base: centresBase(it, ['approvisionnement'], 'Centre Achats'), amount: toNum(it.charges_appro), color: CAT('teal') },
    { key: 'prod', label: 'Frais généraux de production', base: centresBase(it, ['production'], 'Centres de production'), amount: toNum(it.charges_production), color: CAT('purple') },
  ].filter(e => Math.abs(e.amount) > 0.004);
  out.push(...overheads);
  const production = it.cout_production ?? (it.cout_production_u != null ? it.cout_production_u * it.quantity : toNum(it.cout_revient) - toNum(it.charges_structure));
  out.push({ key: 'production', label: 'Coût de production', base: 'Valorisation du stock de produits finis', amount: production, kind: 'group' });
  const structure: CostElement[] = (it.charges_administration != null
    ? [
      { key: 'adm', label: 'Frais généraux administratifs', base: centresBase(it, ['administration'], 'Centre Administration'), amount: toNum(it.charges_administration), color: CAT('slate') },
      { key: 'dist', label: 'Frais de commercialisation', base: centresBase(it, ['distribution'], 'Centre Commercial'), amount: toNum(it.charges_distribution), color: CAT('brown') },
    ]
    : [{ key: 'struct', label: 'Frais généraux hors production', base: 'Administration et commercialisation', amount: toNum(it.charges_structure), color: CAT('slate') }]
  ).filter(e => Math.abs(e.amount) > 0.004);
  out.push(...structure);
  out.push({ key: 'revient', label: 'Coût de revient complet', base: 'Coût de production + frais hors production', amount: toNum(it.cout_revient), kind: 'group' });
  return out;
}

/** Structure d'un coût : barre (ce que contient le prix de vente) puis un élément de coût par ligne. */
function CostStructure({ title, elements, quantity, ventes, marge, tauxMarge, tauxMarque }: {
  title: string; elements: CostElement[]; quantity: number; ventes: number; marge: number | null;
  tauxMarge: number | null; tauxMarque: number | null;
}) {
  const sym = currencySymbol();
  const revient = elements.find(e => e.key === 'revient')?.amount ?? 0;
  const priced = ventes > 0.004;
  const basis = priced ? Math.max(ventes, revient) : revient;
  const share = (v: number) => (basis > 0 ? `${(v / basis * 100).toLocaleString('fr-FR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} %` : '—');
  const unit = (v: number) => (quantity > 0 ? nf(v / quantity) : '—');
  const segments = elements.filter(e => e.color && e.amount > 0.004);
  const m = marge ?? 0;
  return (
    <>
      <div className="pd-cost-lead">
        <strong>{title}</strong>
        {basis > 0 && (
          <div className="pd-cost-split" role="img"
            aria-label={priced ? `Coût de revient ${share(revient)} du prix de vente, marge nette ${share(m)}` : 'Répartition du coût de revient'}>
            {segments.map(s => <span key={s.key} style={{ width: `${s.amount / basis * 100}%`, background: s.color }} />)}
            {priced && m > 0.004 && <span style={{ width: `${m / basis * 100}%`, background: 'var(--ds-success)', opacity: .55 }} />}
          </div>
        )}
        <div className="pd-cost-lead-foot">
          <span><strong>Coût de revient complet {quantity > 0 ? money(revient / quantity) : money(revient)}</strong>{priced ? ` · ${share(revient)} du prix` : ''}</span>
          {priced && <span style={{ color: marginColor(m), fontWeight: 600 }}>Marge nette {quantity > 0 ? money(m / quantity) : money(m)} · {share(m)} du prix</span>}
        </div>
      </div>
      <div className="ds-scroll">
        <table className="odoo-table ds-dense">
          <thead><tr>
            <th>Élément de coût</th>
            <th>Base de calcul</th>
            <th className="ds-num">Coût unitaire ({sym})</th>
            <th className="ds-num">Coût total ({sym})</th>
            <th className="ds-num">{priced ? '% du prix de vente' : '% du coût de revient'}</th>
          </tr></thead>
          <tbody>
            {elements.map(e => (
              <tr key={e.key} className={e.kind === 'group' ? 'ds-group' : undefined}>
                <td className={e.kind === 'quiet' ? 'ds-muted' : undefined}>
                  <span className="pd-cost-dot" style={{ background: e.color ?? 'transparent' }} aria-hidden="true" />{e.label}
                </td>
                <td className="pd-cost-base">{e.base}</td>
                <td className="ds-num">{unit(e.amount)}</td>
                <td className="ds-num">{nf(e.amount)}</td>
                <td className="ds-num">{Math.abs(e.amount) > 0.004 ? share(e.amount) : '—'}</td>
              </tr>
            ))}
            {priced && (
              <tr>
                <td><span className="pd-cost-dot" aria-hidden="true" />Prix de vente HT</td>
                <td className="pd-cost-base">Tarif hors taxe</td>
                <td className="ds-num">{unit(ventes)}</td>
                <td className="ds-num">{nf(ventes)}</td>
                <td className="ds-num">{share(ventes)}</td>
              </tr>
            )}
          </tbody>
          {priced && (
            <tfoot><tr>
              <td><span className="pd-cost-dot" style={{ background: 'var(--ds-success)', opacity: .55 }} aria-hidden="true" />Marge nette</td>
              <td className="pd-cost-base" style={{ fontWeight: 400 }}>Prix de vente − coût de revient · marge sur coût {pctTxt(tauxMarge)}</td>
              <td className="ds-num" style={{ color: marginColor(m) }}>{quantity > 0 ? signed(m / quantity) : '—'}</td>
              <td className="ds-num" style={{ color: marginColor(m) }}>{signed(m)}</td>
              <td className="ds-num">{pctTxt(tauxMarque)}</td>
            </tr></tfoot>
          )}
        </table>
      </div>
    </>
  );
}

function PanelNote({ children }: { children: ReactNode }) {
  return <p className="pd-cost-foot">{children}</p>;
}

type AnalysisTab = 'ecarts' | 'centres' | 'natures' | 'conso' | 'mo' | 'equip' | 'pertes' | 'sorties' | 'cle' | 'methodes';

export default function CoutReelPanel({ planId, planStatus, isChef, totalQuantity, perUnit }: CoutReelPanelProps) {
  const queryClient = useQueryClient();
  const T = useProdTerms();
  const [mode, setMode] = useState<'unit' | 'total'>('unit');
  const [selected, setSelected] = useState<string | null>(null);
  const [tab, setTab] = useState<AnalysisTab | null>(null);
  const active = ['in_progress', 'completed'].includes(planStatus);

  const { data: cout, isLoading } = useQuery<CoutReel | null>({
    queryKey: ['production-cout', planId],
    queryFn: () => productionCoutApi.getCost(planId).catch(() => null),
    enabled: active,
  });

  // Écart MO standard (gamme) vs réel (étapes) — roadmap lot 1
  const { data: moEcart } = useQuery<MoEcart | null>({
    queryKey: ['production-mo-ecart', planId],
    queryFn: () => productionCoutApi.moEcartByPlan(planId).catch(() => null),
    enabled: active,
  });

  // Coût de revient par sortie de coupe — roadmap lot 2
  const { data: outputsCost } = useQuery<OutputCostGroup[]>({
    queryKey: ['production-outputs-cost', planId],
    queryFn: () => productionCoutApi.outputCostByPlan(planId).catch(() => []),
    enabled: active,
  });

  // Charge par poste vs capacité — roadmap lot 3
  const { data: charge } = useQuery<ChargeRow[]>({
    queryKey: ['production-charge', planId],
    queryFn: () => productionCoutApi.chargeByPlan(planId).catch(() => []),
    enabled: active,
  });

  const calculateMutation = useMutation({
    mutationFn: () => productionCoutApi.calculateCost(planId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['production-cout', planId] });
      queryClient.invalidateQueries({ queryKey: ['production', planId, 'summary'] });
      notify.success('Coût de revient calculé');
    },
    onError: (e: unknown) => notify.error(apiErrorMessage(e, 'Erreur calcul')),
  });

  if (!active) return null;

  const sym = currencySymbol();
  const recalcButton = (primary: boolean, label: string) => (
    <button type="button" onClick={() => calculateMutation.mutate()} disabled={calculateMutation.isPending}
      className={primary ? 'odoo-btn-primary' : 'odoo-btn-secondary ds-btn-sm'}>
      {calculateMutation.isPending ? <Loader2 size={14} className="animate-spin" aria-hidden="true" /> : primary ? <Calculator size={14} aria-hidden="true" /> : <RefreshCw size={14} aria-hidden="true" />}
      {label}
    </button>
  );

  if (isLoading) return <div className="ds-panel pd-section"><LoadingState bare /></div>;

  if (!cout) {
    return (
      <div className="ds-panel pd-section">
        <EmptyState bare icon={Calculator} title="Le coût de revient n'a pas encore été calculé"
          text="Il se calcule une fois la production terminée, à partir des consommations réelles et des frais généraux du mois."
          action={isChef && planStatus === 'completed' ? recalcButton(true, 'Calculer le coût de revient') : undefined} />
      </div>
    );
  }

  const coutMat = toNum(cout.cout_matieres);
  const coutMO = toNum(cout.cout_main_oeuvre);
  const coutEnergie = toNum(cout.cout_energie);
  const coutCharges = toNum(cout.cout_charges_fixes);
  const coutEmballages = toNum(cout.cout_emballages);
  const coutFacon = toNum(cout.cout_sous_traitance);
  const coutMachine = toNum(cout.cout_machine);
  // G0-23 : le revient est celui du serveur ; l'écran ne refait pas l'addition. Les pertes sont une
  // valorisation de matière déjà comptée dans cout_matieres : un « dont » (mig 339).
  const coutRevient = cout.cout_total != null
    ? toNum(cout.cout_total)
    : coutMat + coutEmballages + coutMO + coutEnergie + coutCharges + coutFacon + coutMachine;
  const coutPertes = toNum(cout.cout_pertes);
  // Mig 655 : coût calculé par le moteur analytique (centres, capacité normale).
  const niveaux = cout.niveaux ?? null;
  const da = cout.detail_analytique ?? null;
  const analytic = !!da;
  const items = niveaux?.items ?? [];
  const perItem = items.some(i => i.matieres != null);
  const unites = niveaux?.unites ?? totalQuantity ?? 0;

  // ── Structure du plan entier (repli quand le coût par article n'existe pas, et vue « Plan »). ──
  const planElements: CostElement[] = [
    { key: 'mat', label: 'Matières premières', base: 'Consommations de matières et de produits semi-finis', amount: coutMat, color: CAT('blue') },
    { key: 'emb', label: 'Emballages', base: 'Sorties de stock du plan', amount: coutEmballages, color: CAT('olive') },
    { key: 'mo', label: "Main-d'œuvre directe", base: 'Temps déclaré ou temps standard des gammes', amount: coutMO, color: CAT('gold') },
    { key: 'ene', label: 'Énergie', base: 'Équipements utilisés × durée', amount: coutEnergie, color: CAT('pink') },
    { key: 'mach', label: 'Machine', base: 'Taux du poste × temps', amount: coutMachine, color: CAT('pink') },
    { key: 'fac', label: 'Sous-traitance', base: 'Façon facturée', amount: coutFacon, color: CAT('pink') },
    ...(analytic ? [
      { key: 'dir', label: 'Frais directs', base: 'Charges affectées à un article', amount: toNum(cout.cout_charges_directes), color: CAT('pink') },
      { key: 'appro', label: "Frais généraux d'approvisionnement", base: 'Centre Achats', amount: toNum(cout.cout_charges_appro), color: CAT('teal') },
      { key: 'prod', label: 'Frais généraux de production', base: 'Centres de production', amount: toNum(cout.cout_charges_production), color: CAT('purple') },
    ] : [
      { key: 'fg', label: 'Frais généraux', base: 'Taux appliqué au coût des matières', amount: coutCharges, color: CAT('purple') },
    ]),
  ].filter(e => e.key === 'mat' || Math.abs(e.amount) > 0.004);
  if (analytic) {
    planElements.push({ key: 'production', label: 'Coût de production', base: 'Valorisation du stock de produits finis', amount: niveaux?.cout_production_complet ?? toNum(cout.cout_production), kind: 'group' });
    const struct = toNum(cout.cout_charges_structure);
    if (Math.abs(struct) > 0.004) planElements.push({ key: 'struct', label: 'Frais généraux hors production', base: 'Administration et commercialisation', amount: struct, color: CAT('slate') });
  }
  planElements.push({ key: 'revient', label: 'Coût de revient complet', base: analytic ? 'Coût de production + frais hors production' : undefined, amount: coutRevient, kind: 'group' });

  const current = perItem ? (items.find(i => i.plan_item_id === selected) ?? (selected === PLAN_KEY ? null : items[0])) : null;
  const viewKey = current ? current.plan_item_id : PLAN_KEY;
  const k = (it: { quantity: number }) => (mode === 'unit' ? it.quantity : 1);
  const cell = (v: number, q: number) => (q > 0 ? nf(v / q) : '—');
  const directOf = (it: NiveauItem) => toNum(it.matieres) + toNum(it.emballages) + toNum(it.main_oeuvre) + toNum(it.energie) + toNum(it.machine) + toNum(it.sous_traitance) + toNum(it.charges_directes);
  const overheadOf = (it: NiveauItem) => toNum(it.charges_appro) + toNum(it.charges_production) + toNum(it.charges_structure);
  const productionOf = (it: NiveauItem) => it.cout_production ?? (it.cout_production_u != null ? it.cout_production_u * it.quantity : 0);

  const missingAssets = analytic && da?.byNature ? ['amortissement', 'outillage'].filter(n => !da.byNature!.some(x => x.nature === n)) : [];
  const calculatedOn = cout.calculated_at ? new Date(cout.calculated_at).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' }) : null;

  // ── Onglets de l'analyse : seuls ceux qui ont des données. ──
  const e = niveaux?.ecarts ?? null;
  const legacyEcart = !e && cout.cout_prevu != null && toNum(cout.cout_prevu) > 0;
  const hasMo = cout.detail_main_oeuvre.length > 0 || (moEcart?.items.length ?? 0) > 0;
  const hasEquip = (cout.detail_energie || []).length > 0 || (cout.detail_machine || []).length > 0 || (charge?.length ?? 0) > 0;
  const tabs: { key: AnalysisTab; label: string }[] = [
    ...(e || legacyEcart ? [{ key: 'ecarts' as const, label: 'Analyse des écarts' }] : []),
    ...(analytic && da && (da.lines.length > 0 || da.direct.length > 0) ? [{ key: 'centres' as const, label: 'Centres de coûts' }]
      : !analytic && (cout.detail_charges_fixes || []).length > 0 ? [{ key: 'centres' as const, label: 'Frais généraux' }] : []),
    ...(analytic && da?.byNature ? [{ key: 'natures' as const, label: 'Natures de coûts' }] : []),
    ...(cout.detail_matieres.length > 0 || (cout.detail_emballages?.length ?? 0) > 0 ? [{ key: 'conso' as const, label: 'Consommations matières' }] : []),
    ...(hasMo ? [{ key: 'mo' as const, label: "Main-d'œuvre" }] : []),
    ...(hasEquip ? [{ key: 'equip' as const, label: 'Énergie et machines' }] : []),
    ...((cout.detail_pertes || []).length > 0 ? [{ key: 'pertes' as const, label: 'Pertes' }] : []),
    ...((outputsCost?.length ?? 0) > 0 ? [{ key: 'sorties' as const, label: 'Sorties de coupe' }] : []),
    { key: 'cle' as const, label: 'Clé de répartition' },
    ...((cout.methodes?.length ?? 0) > 0 ? [{ key: 'methodes' as const, label: 'Méthodes de valorisation' }] : []),
  ];
  const activeTab: AnalysisTab = tabs.some(t => t.key === tab) ? tab! : tabs[0].key;

  const ecartLine = (key: string) => e?.lignes.find(l => l.key === key)?.montant ?? 0;
  const verdict = (v: number) => (Math.abs(v) < 0.005 ? null : v < 0
    ? <StatusTag tone="done" label="Favorable" />
    : <StatusTag tone="blocked" label="Défavorable" />);

  const rawMaterials = cout.detail_matieres.filter(d => !String(d.ingredient_id).startsWith('semi:'));
  const semiFinished = cout.detail_matieres.filter(d => String(d.ingredient_id).startsWith('semi:'));
  const sumOf = (rows: { total: Money }[]) => rows.reduce((s, r) => s + toNum(r.total), 0);

  return (
    <div className="pd-cost">
      {/* ── 1. Coût de revient par article ── */}
      <section className="ds-panel pd-section" aria-label="Coût de revient par article">
        <div className="pd-section-head">
          <Calculator size={14} aria-hidden="true" /> {items.length > 0 ? 'Coût de revient par article' : 'Coût de revient'}
          <span className="pd-cost-note">
            {analytic ? 'Méthode des coûts complets' : 'Coût réel du plan'}{calculatedOn ? ` · calculé le ${calculatedOn}` : ''}
          </span>
          <span className="pd-cost-tools">
            {items.length > 0 && (
              <Segmented label="Afficher les montants" value={mode} onChange={setMode}
                options={[{ key: 'unit', label: 'Coût unitaire' }, { key: 'total', label: 'Coût total' }]} />
            )}
            {isChef && recalcButton(false, 'Recalculer')}
          </span>
        </div>

        {(missingAssets.length > 0 || (da?.warnings.length ?? 0) > 0 || (e?.articles_sans_fiche ?? 0) > 0) && (
          <div className="pd-cost-alerts">
            {missingAssets.length > 0 && (
              <Alert tone="warning" icon={AlertTriangle}
                action={<Link to="/production/analyse-couts">Enregistrer les équipements et outils</Link>}>
                Coûts sous-estimés : {missingAssets.length === 2 ? "aucun équipement ni outil n'est au registre" : missingAssets[0] === 'amortissement' ? "aucun équipement n'est au registre" : "aucun outil n'est au registre"},
                {' '}leur amortissement n'est compté dans aucun article.
              </Alert>
            )}
            {(da?.warnings ?? []).map((w, i) => <Alert key={i} tone="warning" icon={AlertTriangle}>{w}</Alert>)}
            {(e?.articles_sans_fiche ?? 0) > 0 && (
              <Alert tone="warning" icon={AlertTriangle}>{e!.articles_sans_fiche} article(s) sans fiche technique : hors du coût standard.</Alert>
            )}
          </div>
        )}

        {items.length > 0 ? (
          <>
            <div className="ds-scroll">
              <table className="odoo-table">
                <thead><tr>
                  <th>Article</th>
                  <th className="ds-num">Quantité</th>
                  {perItem && <><th className="ds-num">Coûts directs</th><th className="ds-num">Frais généraux</th></>}
                  <th className="ds-num">Coût de production</th>
                  <th className="ds-num">Coût de revient</th>
                  <th className="ds-num">{mode === 'unit' ? 'Prix de vente HT' : "Chiffre d'affaires HT"}</th>
                  <th className="ds-num">Marge nette</th>
                  <th>Marge (%)</th>
                </tr></thead>
                <tbody>{items.map(it => {
                  const q = k(it);
                  const isSel = perItem && viewKey === it.plan_item_id;
                  return (
                    <tr key={it.plan_item_id} className={`${perItem ? 'ds-clickable' : ''}${isSel ? ' ds-selected' : ''}`}
                      onClick={perItem ? () => setSelected(it.plan_item_id) : undefined}>
                      <td>
                        {perItem
                          ? <button type="button" className="pd-cost-pick" aria-pressed={isSel} onClick={() => setSelected(it.plan_item_id)}>{it.product_name}</button>
                          : <span className="ds-strong">{it.product_name}</span>}
                      </td>
                      <td className="ds-num">{qf(it.quantity)}</td>
                      {perItem && <>
                        <td className="ds-num">{cell(directOf(it), q)}</td>
                        <td className="ds-num">{cell(overheadOf(it), q)}</td>
                      </>}
                      <td className="ds-num">{cell(productionOf(it), q)}</td>
                      <td className="ds-num ds-strong">{cell(toNum(it.cout_revient), q)}</td>
                      <td className="ds-num">{it.ventes_ht > 0 ? cell(it.ventes_ht, q) : '—'}</td>
                      <td className="ds-num" style={{ color: marginColor(it.marge), fontWeight: 600 }}>{it.ventes_ht > 0 && q > 0 ? signed(it.marge / q) : '—'}</td>
                      <td><MarginMeter value={it.taux_marque} /></td>
                    </tr>
                  );
                })}</tbody>
                {niveaux && (() => {
                  const q = mode === 'unit' ? niveaux.unites : 1;
                  const overhead = niveaux.charges.approvisionnement + niveaux.charges.production + niveaux.charges.structure;
                  return (
                    <tfoot><tr>
                      <td>{mode === 'unit' ? 'Moyenne du plan' : 'Total du plan'}</td>
                      <td className="ds-num">{qf(niveaux.unites)}</td>
                      {perItem && <>
                        <td className="ds-num">{cell(niveaux.cout_production_direct, q)}</td>
                        <td className="ds-num">{cell(overhead, q)}</td>
                      </>}
                      <td className="ds-num">{cell(niveaux.cout_production_complet, q)}</td>
                      <td className="ds-num">{cell(niveaux.cout_revient_complet, q)}</td>
                      <td className="ds-num">{niveaux.ventes_ht > 0 ? cell(niveaux.ventes_ht, q) : '—'}</td>
                      <td className="ds-num" style={{ color: marginColor(niveaux.marge) }}>{niveaux.ventes_ht > 0 && q > 0 ? signed(niveaux.marge / q) : '—'}</td>
                      <td><MarginMeter value={niveaux.taux_marque} /></td>
                    </tr></tfoot>
                  );
                })()}
              </table>
            </div>
            <PanelNote>
              {mode === 'unit' ? `Coût unitaire en ${sym} par unité produite.` : `Coût total en ${sym} pour la quantité produite.`}
              {perItem ? " Cliquez sur un article pour afficher la structure de son coût de revient." : ' Coût par article selon la clé de répartition du plan.'}
            </PanelNote>
          </>
        ) : (
          <PanelNote>
            Coût de revient du plan : <strong className="ds-strong">{money(coutRevient)}</strong>
            {totalQuantity && totalQuantity > 0 && perUnit != null ? ` · ${money(perUnit)} par unité (${qf(totalQuantity)} unités)` : ''}.
          </PanelNote>
        )}
      </section>

      {/* ── 2. Structure du coût de revient ── */}
      <section className="ds-panel pd-section" aria-label="Structure du coût de revient">
        <div className="pd-section-head">
          <Layers size={14} aria-hidden="true" /> Structure du coût de revient
          {current && <span className="pd-cost-note">{qf(current.quantity)} unités produites</span>}
          {perItem && items.length > 0 && (
            <span className="pd-cost-tools">
              {items.length <= 5 ? (
                <Segmented label="Article affiché" value={viewKey} onChange={setSelected}
                  options={[...items.map(it => ({ key: it.plan_item_id, label: it.product_name })), ...(items.length > 1 ? [{ key: PLAN_KEY, label: 'Plan entier' }] : [])]} />
              ) : (
                <select className="ds-input sm" aria-label="Article affiché" value={viewKey} onChange={ev => setSelected(ev.target.value)} style={{ width: 'auto' }}>
                  {items.map(it => <option key={it.plan_item_id} value={it.plan_item_id}>{it.product_name}</option>)}
                  <option value={PLAN_KEY}>Plan entier</option>
                </select>
              )}
            </span>
          )}
        </div>
        {current ? (
          <CostStructure
            title={current.prix_vente_ht_u != null ? `${current.product_name} : ce que contient son prix de vente de ${money(current.prix_vente_ht_u)} HT` : `${current.product_name} : composition du coût de revient`}
            elements={itemElements(current)} quantity={current.quantity} ventes={current.ventes_ht}
            marge={current.marge} tauxMarge={current.taux_marge} tauxMarque={current.taux_marque} />
        ) : (
          <CostStructure
            title={niveaux && niveaux.ventes_ht > 0 ? `Plan entier : ce que contient le chiffre d'affaires de ${money(niveaux.ventes_ht)} HT` : 'Plan entier : composition du coût de revient'}
            elements={planElements} quantity={unites} ventes={niveaux?.ventes_ht ?? 0}
            marge={niveaux?.marge ?? null} tauxMarge={niveaux?.taux_marge ?? null} tauxMarque={niveaux?.taux_marque ?? null} />
        )}
        {analytic && (
          <PanelNote>
            Le stock est valorisé au coût de production ; le coût de revient complet ajoute les frais d'administration et de commercialisation.
            Frais fixes imputés sur la capacité normale : la sous-activité du mois reste en écart sur volume
            (<Link to="/production/analyse-couts">Analyse des coûts</Link>).
          </PanelNote>
        )}
      </section>

      {/* ── 3. Analyse du plan ── */}
      <section className="ds-panel pd-section" aria-label="Analyse du plan">
        <div className="pd-section-head">
          <Scale size={14} aria-hidden="true" /> Analyse du plan
          <span className="pd-cost-note">
            {items.length > 1 ? `Les ${items.length} articles réunis : ` : ''}{unites > 0 ? `${qf(unites)} unités, ` : ''}{money(coutRevient)}
          </span>
        </div>
        <div className="pd-cost-tabs">
          <Tabs label="Analyse du plan" value={activeTab} onChange={setTab} tabs={tabs} />
        </div>

        {activeTab === 'ecarts' && e && (() => {
          const autresReel = coutEmballages + coutEnergie + coutMachine + coutFacon;
          const ecartMat = ecartLine('prix_matieres') + ecartLine('quantites');
          const row = (label: string, std: number, reel: number, ecart: number) => (
            <tr key={label} className={Math.abs(std) + Math.abs(reel) < 0.005 ? 'ds-muted' : undefined}>
              <td className="ds-strong">{label}</td>
              <td className="ds-num">{nf(std)}</td>
              <td className="ds-num">{nf(reel)}</td>
              <td className="ds-num" style={{ color: varianceColor(ecart), fontWeight: 600 }}>{signed(ecart)}</td>
              <td>{verdict(ecart)}</td>
            </tr>
          );
          const sub = (key: string, label: string) => {
            const l = e.lignes.find(x => x.key === key);
            return (
              <tr key={key} className="pd-cost-sub">
                <td>{label}</td><td /><td />
                <td className="ds-num" style={{ color: varianceColor(l?.montant ?? 0) }}>{signed(l?.montant ?? 0)}</td>
                <td className="pd-cost-base">{l?.detail}</td>
              </tr>
            );
          };
          return (
            <div className="ds-scroll">
              <table className="odoo-table ds-dense">
                <thead><tr>
                  <th>Élément de coût</th>
                  <th className="ds-num">Coût standard ({sym})</th>
                  <th className="ds-num">Coût réel ({sym})</th>
                  <th className="ds-num">Écart ({sym})</th>
                  <th>Interprétation</th>
                </tr></thead>
                <tbody>
                  {row('Matières', e.standard.matieres, coutMat, ecartMat)}
                  {sub('prix_matieres', 'Écart sur prix')}
                  {sub('quantites', 'Écart sur quantité')}
                  {row("Main-d'œuvre directe", e.standard.main_oeuvre, coutMO, ecartLine('main_oeuvre'))}
                  {row('Frais généraux', e.standard.charges, coutCharges, ecartLine('charges'))}
                  {row('Emballages, énergie, machine, sous-traitance', e.standard.emballages, autresReel, ecartLine('autres'))}
                </tbody>
                <tfoot><tr>
                  <td>Total du plan</td>
                  <td className="ds-num">{nf(e.standard.total)}</td>
                  <td className="ds-num">{nf(e.reel_total)}</td>
                  <td className="ds-num" style={{ color: varianceColor(e.ecart_total) }}>{signed(e.ecart_total)}</td>
                  <td>{e.ecart_pct != null ? `${signed(e.ecart_pct, 1)} % par rapport au coût standard` : ''}</td>
                </tr></tfoot>
              </table>
            </div>
          );
        })()}

        {/* Mode sans moteur analytique : prévu (mix standard), écart de mix, écart prix / pertes (audit A10). */}
        {activeTab === 'ecarts' && legacyEcart && (() => {
          const prevu = toNum(cout.cout_prevu);
          const prevuMix = cout.cout_prevu_mix_reel != null ? toNum(cout.cout_prevu_mix_reel) : null;
          const ecartTot = coutRevient - prevu;
          const ecartMix = cout.ecart_mix != null ? toNum(cout.ecart_mix) : (prevuMix != null ? prevu - prevuMix : null);
          const ecartPrix = prevuMix != null ? coutRevient - prevuMix : null;
          return (
            <div className="ds-scroll">
              <table className="odoo-table ds-dense">
                <thead><tr><th>Élément</th><th className="ds-num">Montant ({sym})</th><th>Interprétation</th></tr></thead>
                <tbody>
                  <tr><td className="ds-strong">Coût prévu (mix standard)</td><td className="ds-num">{nf(prevu)}</td><td /></tr>
                  {prevuMix != null && Math.abs(ecartMix ?? 0) > 0.01 && (
                    <tr><td>Écart de mix</td>
                      <td className="ds-num" style={{ color: varianceColor(-(ecartMix ?? 0)) }}>{signed(-(ecartMix ?? 0))}</td>
                      <td className="pd-cost-base">Dû au mix réellement produit ; aucune sur ou sous-consommation de matière.</td></tr>
                  )}
                  {prevuMix != null && (
                    <tr><td>Coût prévu au mix réel</td><td className="ds-num">{nf(prevuMix)}</td>
                      <td className="pd-cost-base">Coût prévu recalculé sur les quantités réellement produites.</td></tr>
                  )}
                  {ecartPrix != null && (
                    <tr><td>Écart sur prix et pertes</td>
                      <td className="ds-num" style={{ color: varianceColor(ecartPrix) }}>{signed(ecartPrix)}</td>
                      <td className="pd-cost-base">Sur ou sous-consommation, pertes et variation de prix des {T.ingredientsLc}.</td></tr>
                  )}
                </tbody>
                <tfoot><tr>
                  <td>Écart total (réel − prévu)</td>
                  <td className="ds-num" style={{ color: varianceColor(ecartTot) }}>{signed(ecartTot)}</td>
                  <td>{prevu > 0 ? `${signed(ecartTot / prevu * 100, 1)} %` : ''}</td>
                </tr></tfoot>
              </table>
            </div>
          );
        })()}

        {activeTab === 'centres' && analytic && da && (
          <>
            <div className="ds-scroll">
              <table className="odoo-table ds-dense">
                <thead><tr>
                  <th>Centre de coûts</th><th>Niveau de coût</th><th>Inducteur de coût</th>
                  <th className="ds-num">Quantité</th><th className="ds-num">Taux ({sym})</th>
                  <th className="ds-num">Fixe ({sym})</th><th className="ds-num">Variable ({sym})</th><th className="ds-num">Imputé ({sym})</th>
                </tr></thead>
                <tbody>
                  {da.lines.map((d, i) => (
                    <tr key={i}>
                      <td className="ds-strong">{d.name} <span className="ds-muted">{d.code}</span></td>
                      <td>{LEVEL_LABEL[d.level] ?? d.level}</td>
                      <td>{d.driverLabel}</td>
                      <td className="ds-num">{qf(d.quantity)}</td>
                      <td className="ds-num">{qf(toNum(d.rateFixed) + toNum(d.rateVariable), 4)}</td>
                      <td className="ds-num">{nf(d.fixed)}</td>
                      <td className="ds-num">{nf(d.variable)}</td>
                      <td className="ds-num ds-strong">{nf(d.total)}</td>
                    </tr>
                  ))}
                  {da.direct.map((d, i) => (
                    <tr key={`d${i}`}>
                      <td className="ds-strong">{d.label}</td><td>Frais directs</td><td>{d.productName}</td>
                      <td className="ds-num">{qf(d.quantity)}</td>
                      <td className="ds-num">{qf(d.rate, 4)}</td>
                      <td className="ds-num" colSpan={2} /><td className="ds-num ds-strong">{nf(d.total)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot><tr><td colSpan={7}>Total des frais généraux imputés</td><td className="ds-num">{nf(coutCharges)}</td></tr></tfoot>
              </table>
            </div>
            <PanelNote>
              Taux = taux d'imputation du centre : coûts mensuels du centre ÷ capacité normale du mois ({da.month}).
              {' '}<Link to="/production/analyse-couts">Paramétrer les centres de coûts</Link>
            </PanelNote>
          </>
        )}

        {activeTab === 'centres' && !analytic && (
          <div className="ds-scroll">
            <table className="odoo-table ds-dense">
              <thead><tr><th>Frais généraux</th><th className="ds-num">Taux</th><th className="ds-num">Assiette ({sym})</th><th className="ds-num">Quote-part ({sym})</th></tr></thead>
              <tbody>{(cout.detail_charges_fixes || []).map((d, i) => (
                <tr key={i}>
                  <td className="ds-strong">{d.label}</td>
                  <td className="ds-num">{d.taux != null ? `${qf(toNum(d.taux) * 100)} %` : '—'}</td>
                  <td className="ds-num">{d.base != null ? nf(d.base) : '—'}</td>
                  <td className="ds-num">{nf(d.part)}</td>
                </tr>
              ))}</tbody>
              <tfoot><tr><td colSpan={3}>Total des frais généraux</td><td className="ds-num">{nf(coutCharges)}</td></tr></tfoot>
            </table>
          </div>
        )}

        {activeTab === 'natures' && da?.byNature && (
          <>
            <div className="ds-scroll">
              <table className="odoo-table ds-dense">
                <thead><tr>
                  <th>Nature de coût</th><th className="ds-num">Imputé au plan ({sym})</th><th className="ds-num">Par unité ({sym})</th>
                  <th className="ds-num">% des frais généraux</th><th>État</th>
                </tr></thead>
                <tbody>
                  {da.byNature.map(n => (
                    <tr key={n.nature}>
                      <td className="ds-strong">{n.label}</td>
                      <td className="ds-num">{nf(n.amount)}</td>
                      <td className="ds-num">{unites > 0 ? nf(n.amount / unites) : '—'}</td>
                      <td className="ds-num">{coutCharges > 0 ? pctTxt(n.amount / coutCharges * 100) : '—'}</td>
                      <td />
                    </tr>
                  ))}
                  {missingAssets.map(n => (
                    <tr key={n}>
                      <td className="ds-strong">{n === 'amortissement' ? 'Amortissement des immobilisations' : 'Outillage et petit matériel'}</td>
                      <td className="ds-num">{nf(0)}</td><td className="ds-num">—</td><td className="ds-num">—</td>
                      <td><StatusTag tone="todo" label="Rien au registre" /></td>
                    </tr>
                  ))}
                </tbody>
                <tfoot><tr>
                  <td>Total des frais généraux</td><td className="ds-num">{nf(coutCharges)}</td>
                  <td className="ds-num">{unites > 0 ? nf(coutCharges / unites) : '—'}</td><td className="ds-num">{pctTxt(100)}</td><td />
                </tr></tfoot>
              </table>
            </div>
            <PanelNote>
              Part de chaque nature dans les centres qui imputent ce plan. Immobilisations et outillage :
              {' '}<Link to="/production/analyse-couts">Analyse des coûts › Équipements et outils</Link>
            </PanelNote>
          </>
        )}

        {activeTab === 'conso' && (
          <div className="ds-scroll">
            <table className="odoo-table ds-dense">
              <thead><tr>
                <th>Composant</th><th className="ds-num">Quantité</th><th className="ds-num">Prix unitaire ({sym})</th>
                <th className="ds-num">Total ({sym})</th><th className="ds-num">% des matières</th>
              </tr></thead>
              <tbody>
                {([['Matières premières', rawMaterials], ['Produits semi-finis', semiFinished]] as [string, CoutReel['detail_matieres']][])
                  .filter(([, rows]) => rows.length > 0).flatMap(([label, rows]) => [
                    <tr key={label} className="ds-group">
                      <td colSpan={3}>{label}</td><td className="ds-num">{nf(sumOf(rows))}</td>
                      <td className="ds-num">{coutMat > 0 ? pctTxt(sumOf(rows) / coutMat * 100) : '—'}</td>
                    </tr>,
                    ...rows.map((d, i) => (
                      <tr key={`${label}${i}`}>
                        <td className="ds-strong">{d.name.replace(/\s*\(semi-fini\)$/, '')}</td>
                        <td className="ds-num">{nf(d.qty)}</td>
                        <td className="ds-num">{nf(d.unit_cost)}</td>
                        <td className="ds-num">{nf(d.total)}</td>
                        <td className="ds-num">{coutMat > 0 ? pctTxt(toNum(d.total) / coutMat * 100) : '—'}</td>
                      </tr>
                    )),
                  ])}
                {(cout.detail_emballages?.length ?? 0) > 0 && [
                  <tr key="emb" className="ds-group"><td colSpan={3}>Emballages</td><td className="ds-num">{nf(coutEmballages)}</td><td /></tr>,
                  ...(cout.detail_emballages ?? []).map((d, i) => (
                    <tr key={`emb${i}`}>
                      <td className="ds-strong">{d.name}</td>
                      <td className="ds-num">{qf(d.qty, 3)}{d.unit ? ` ${d.unit}` : ''}</td>
                      <td className="ds-num">{nf(d.unit_cost)}</td>
                      <td className="ds-num">{nf(d.total)}</td>
                      <td />
                    </tr>
                  )),
                ]}
              </tbody>
              <tfoot><tr><td colSpan={3}>Total des matières</td><td className="ds-num">{nf(coutMat)}</td><td className="ds-num">{pctTxt(100)}</td></tr></tfoot>
            </table>
          </div>
        )}

        {activeTab === 'mo' && (
          <>
            {cout.detail_main_oeuvre.length > 0 && (
              <div className="ds-scroll">
                <table className="odoo-table ds-dense">
                  <thead><tr><th>Employé</th><th className="ds-num">Temps (min)</th><th className="ds-num">Taux horaire ({sym})</th><th className="ds-num">Total ({sym})</th></tr></thead>
                  <tbody>{cout.detail_main_oeuvre.map((d, i) => (
                    <tr key={i}>
                      <td className="ds-strong">{d.name}</td>
                      <td className="ds-num">{qf(d.minutes)}</td>
                      <td className="ds-num">{nf(d.hourly_rate)}</td>
                      <td className="ds-num">{nf(d.total)}</td>
                    </tr>
                  ))}</tbody>
                  <tfoot><tr><td colSpan={3}>Total de la main-d'œuvre directe</td><td className="ds-num">{nf(coutMO)}</td></tr></tfoot>
                </table>
              </div>
            )}
            {moEcart && moEcart.items.length > 0 && (moEcart.totals.nb_items_sans_gamme === moEcart.totals.nb_items ? (
              <PanelNote>
                Aucune gamme de production rattachée. Définissez des gammes (Production › Postes et gammes) pour comparer
                le temps standard de main-d'œuvre au temps réellement passé.
              </PanelNote>
            ) : (
              <div className="ds-scroll">
                <table className="odoo-table ds-dense">
                  <thead><tr>
                    <th>Article</th>
                    <th className="ds-num">Temps standard (min)</th><th className="ds-num">Temps réel (min)</th>
                    <th className="ds-num">Coût standard ({sym})</th><th className="ds-num">Coût réel ({sym})</th><th className="ds-num">Écart ({sym})</th>
                  </tr></thead>
                  <tbody>{moEcart.items.map(d => (
                    <tr key={d.plan_item_id}>
                      <td className="ds-strong">{d.product_name}{d.std_cost == null && <span className="ds-muted"> (sans gamme)</span>}</td>
                      <td className="ds-num">{d.std_minutes ?? '—'}</td>
                      <td className="ds-num">{d.reel_minutes}</td>
                      <td className="ds-num">{d.std_cost != null ? nf(d.std_cost) : '—'}</td>
                      <td className="ds-num">{nf(d.reel_cost)}</td>
                      <td className="ds-num" style={{ color: d.ecart_cost == null ? undefined : varianceColor(d.ecart_cost) }}>{d.ecart_cost == null ? '—' : signed(d.ecart_cost)}</td>
                    </tr>
                  ))}</tbody>
                  <tfoot><tr>
                    <td>Total des articles avec gamme</td>
                    <td className="ds-num">{moEcart.totals.std_minutes}</td>
                    <td className="ds-num">{moEcart.totals.reel_minutes}</td>
                    <td className="ds-num">{nf(moEcart.totals.std_cost)}</td>
                    <td className="ds-num">{nf(moEcart.totals.reel_cost)}</td>
                    <td className="ds-num" style={{ color: varianceColor(moEcart.totals.ecart_cost) }}>{signed(moEcart.totals.ecart_cost)}</td>
                  </tr></tfoot>
                </table>
              </div>
            ))}
          </>
        )}

        {activeTab === 'equip' && (
          <>
            {((cout.detail_energie || []).length > 0 || (cout.detail_machine || []).length > 0) && (
              <div className="ds-scroll">
                <table className="odoo-table ds-dense">
                  <thead><tr><th>Équipement ou poste</th><th className="ds-num">Temps (min)</th><th className="ds-num">Coût horaire ({sym})</th><th className="ds-num">Total ({sym})</th></tr></thead>
                  <tbody>
                    {(cout.detail_energie || []).length > 0 && <tr className="ds-group"><td colSpan={3}>Énergie des équipements</td><td className="ds-num">{nf(coutEnergie)}</td></tr>}
                    {(cout.detail_energie || []).map((d, i) => (
                      <tr key={`e${i}`}><td className="ds-strong">{d.name}</td><td className="ds-num">{qf(d.minutes)}</td><td className="ds-num">{nf(d.cout_horaire)}</td><td className="ds-num">{nf(d.total)}</td></tr>
                    ))}
                    {(cout.detail_machine || []).length > 0 && <tr className="ds-group"><td colSpan={3}>Postes de charge</td><td className="ds-num">{nf(coutMachine)}</td></tr>}
                    {(cout.detail_machine || []).map((d, i) => (
                      <tr key={`m${i}`}><td className="ds-strong">{d.name}</td><td className="ds-num">{qf(d.minutes)}</td><td className="ds-num">{nf(d.hourly_cost)}</td><td className="ds-num">{nf(d.total)}</td></tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {charge && charge.length > 0 && (
              <>
                <div className="ds-scroll">
                  <table className="odoo-table ds-dense">
                    <thead><tr><th>Poste de charge</th><th className="ds-num">Charge (min)</th><th className="ds-num">Capacité (min/jour)</th><th className="ds-num">Utilisation (%)</th><th>État</th></tr></thead>
                    <tbody>{charge.map(c => (
                      <tr key={c.work_center_id}>
                        <td className="ds-strong">{c.work_center_name}</td>
                        <td className="ds-num">{c.minutes_required}</td>
                        <td className="ds-num">{c.capacity_minutes_per_day ?? '—'}</td>
                        <td className="ds-num">{c.utilisation_pct ?? '—'}</td>
                        <td>{c.utilisation_pct == null ? null : c.overloaded ? <StatusTag tone="blocked" label="Surcharge" /> : c.utilisation_pct > 80 ? <StatusTag tone="todo" label="Proche de la capacité" /> : <StatusTag tone="done" label="Disponible" />}</td>
                      </tr>
                    ))}</tbody>
                  </table>
                </div>
                <PanelNote>Charge = nombre de fournées × durées de gamme. Capacité définie dans Production › Postes et gammes.</PanelNote>
              </>
            )}
          </>
        )}

        {activeTab === 'pertes' && (
          <>
            <div className="ds-scroll">
              <table className="odoo-table ds-dense">
                <thead><tr><th>Catégorie</th><th className="ds-num">Quantité</th><th className="ds-num">Coût matière unitaire ({sym})</th><th className="ds-num">Total ({sym})</th></tr></thead>
                <tbody>{(cout.detail_pertes || []).map((d, i) => (
                  <tr key={i}>
                    <td className="ds-strong">{d.categorie.replace(/^pertes?_/, '').replace(/_/g, ' ')}</td>
                    <td className="ds-num">{nf(d.quantite)}</td>
                    <td className="ds-num">{nf(d.cout_unitaire)}</td>
                    <td className="ds-num">{nf(d.total)}</td>
                  </tr>
                ))}</tbody>
                <tfoot><tr><td colSpan={3}>Total des pertes</td><td className="ds-num">{nf(coutPertes)}</td></tr></tfoot>
              </table>
            </div>
            <PanelNote>
              Matière perdue, déjà comptée dans les matières{coutMat > 0 && coutPertes > 0 ? ` (${pctTxt(coutPertes / coutMat * 100)} des matières)` : ''} : elle ne s'ajoute pas au coût de revient.
            </PanelNote>
          </>
        )}

        {activeTab === 'sorties' && (outputsCost ?? []).map(g => (
          <div className="ds-scroll" key={g.plan_item_id}>
            <table className="odoo-table ds-dense">
              <thead><tr>
                <th>Sortie de {g.item_product_name}</th><th className="ds-num">Quantité</th><th className="ds-num">Équivalent par unité</th>
                <th className="ds-num">Coût unitaire ({sym})</th><th className="ds-num">Coût total ({sym})</th>
              </tr></thead>
              <tbody>{g.outputs.map(o => (
                <tr key={o.output_id}>
                  <td className="ds-strong">{o.product_name || o.label}</td>
                  <td className="ds-num">{o.quantity}</td>
                  <td className="ds-num">{o.equiv_pieces}</td>
                  <td className="ds-num">{o.unit_cost != null ? nf(o.unit_cost) : '—'}</td>
                  <td className="ds-num">{o.cost_share != null ? nf(o.cost_share) : '—'}</td>
                </tr>
              ))}</tbody>
              <tfoot><tr>
                <td colSpan={4}>Total de l'article{g.complete ? '' : ' (partiel : une sortie sans coût)'}</td>
                <td className="ds-num">{nf(g.total_cost)}</td>
              </tr></tfoot>
            </table>
          </div>
        ))}

        {activeTab === 'cle' && <div className="pd-cost-body"><PlanCostAllocation planId={planId} canEdit /></div>}

        {activeTab === 'methodes' && (
          <div className="ds-scroll">
            <table className="odoo-table">
              <thead><tr>
                <th>Méthode</th><th className="ds-num">Coût total ({sym})</th><th className="ds-num">Coût unitaire ({sym})</th>
                <th className="ds-num">Marge (%)</th><th>Ce qu'elle compte</th>
              </tr></thead>
              <tbody>{(cout.methodes ?? []).map(m => {
                const ventes = niveaux?.ventes_ht ?? 0;
                const retained = m.key === 'rationnelle';
                return (
                  <tr key={m.key} className={retained ? 'ds-selected' : undefined}>
                    <td className="ds-strong">{m.label}{retained && <> <StatusTag tone="progress" label="Méthode retenue" /></>}</td>
                    <td className="ds-num">{m.total != null ? nf(m.total) : '—'}</td>
                    <td className="ds-num">{m.total != null && unites > 0 ? nf(m.total / unites) : '—'}</td>
                    <td className="ds-num">{m.total != null && ventes > 0 ? pctTxt((ventes - m.total) / ventes * 100) : '—'}</td>
                    <td className="pd-cost-base">{m.note}</td>
                  </tr>
                );
              })}</tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

/** Marge (%) : jauge + valeur (marge nette ÷ prix de vente HT). */
function MarginMeter({ value }: { value: number | null | undefined }) {
  if (value == null) return <span className="ds-muted">—</span>;
  const w = Math.max(0, Math.min(100, value));
  return (
    <span className="pd-cost-meter">
      <i aria-hidden="true"><b style={{ width: `${w}%`, background: value < 0 ? 'var(--ds-danger)' : undefined }} /></i>
      {pctTxt(value)}
    </span>
  );
}
