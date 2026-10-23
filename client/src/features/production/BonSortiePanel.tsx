import { useState, Fragment } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { bonSortieApi, type WeighingPayload } from '../../api/bon-sortie.api';
import { purchaseRequestsApi } from '../../api/purchase-requests.api';
import {
  Loader2, CheckCircle, AlertTriangle, Package, PackageOpen, Check, XCircle,
  RefreshCw, ChevronDown, ChevronUp, Scale, Truck, ShoppingCart, Clock, Layers,
} from 'lucide-react';
import { format } from 'date-fns';
import { notify } from '../../components/ui/InlineNotification';
import { StatusBanner } from '../../components/ui/StatusBanner';
import { useConfirm } from '../../components/ui/ConfirmDialog';
import { apiErrorMessage } from '../../api/errors';
import { smartFormatQuantity } from '../../utils/units';

/**
 * Panneau du bon de sortie (demande d'ingredients d'un plan de production).
 *
 * Un seul ecran pour le magasinier : chaque ligne porte son etat et son action.
 *   - A peser     : le stock est au pesage -> saisir le poids.
 *   - A ouvrir    : le stock est en economat -> saisir le poids, le serveur ouvre le
 *                   contenant (transfert economat -> pesage) dans la meme action.
 *                   Plus de detour par le module Economat.
 *   - Manquant    : rien en stock -> « Commander » (demande d'achat) ; le bon peut
 *                   quand meme etre remis au chef en signalant les manquants.
 *   - Lot perime  : choisir un autre lot avant de peser.
 *   - Pese        : termine (ecart affiche, motif si hors tolerance).
 * « Autre lot » sur chaque ligne : le lot reellement attrape (substitution tracee).
 *
 * Utilise :
 *   - dans l'espace de traitement du Pesage (magasinier, isChef=false)
 *   - inline dans PlanDetailPage (chef : lecture, les actions de reception sont
 *     dans le bandeau en haut de la page du plan)
 *   - en page autonome depuis l'historique du Pesage (variant='page')
 */

type Line = Record<string, any>;
type LineKind = 'pese' | 'a_peser' | 'a_ouvrir' | 'manquant' | 'stock_revenu' | 'lot_perime' | 'attente';

const DONE_STATUSES = ['preleve', 'substitue', 'ecart'];

function lineKind(l: Line): LineKind {
  const status = l.status as string;
  if (DONE_STATUSES.includes(status)) return 'pese';
  const needed = parseFloat(l.needed_quantity as string || '0');
  if (status === 'rupture' && !l.ingredient_lot_id) {
    const stock = parseFloat(l.current_stock_total as string || '0');
    return stock >= needed && needed > 0 ? 'stock_revenu' : 'manquant';
  }
  if (status === 'en_attente' && l.source_location === 'ECONOMAT_REQUIRES_TRANSFER') {
    // Contenant deja ouvert a l'avance (stock libre au pesage) : rien a ouvrir, on pese.
    const target = parseFloat(l.transfer_required_qty as string || l.needed_quantity as string || '0');
    const staged = parseFloat(l.current_pesage_total as string || '0');
    return staged + 1e-9 >= target && target > 0 ? 'a_peser' : 'a_ouvrir';
  }
  if (status === 'en_attente') return l.lot_expired ? 'lot_perime' : 'a_peser';
  return 'attente';
}

/** Cible de la pesee : allocation, ou besoin pour une ligne a ouvrir / manquante. */
function lineTarget(l: Line, kind: LineKind): number {
  // Une ligne « a ouvrir » (meme deja mise au pesage a l'avance, donc affichee « a
  // peser ») n'a pas d'allocation tant qu'elle n'est pas pesee : la cible est la
  // quantite a sortir de l'economat.
  if (kind === 'a_ouvrir' || (l.source_location === 'ECONOMAT_REQUIRES_TRANSFER' && l.status === 'en_attente')) {
    return parseFloat(l.transfer_required_qty as string || l.needed_quantity as string || '0');
  }
  if (kind === 'manquant' || kind === 'stock_revenu') return parseFloat(l.needed_quantity as string || '0');
  return parseFloat(l.allocated_quantity as string || '0');
}

const KIND_TAG: Record<LineKind, { label: string; cls: string; Icon: typeof CheckCircle; title: string }> = {
  pese:         { label: 'Pesé',          cls: 'odoo-tag-green',  Icon: CheckCircle,  title: 'Ingrédient pesé et prêt' },
  a_peser:      { label: 'À peser',       cls: 'odoo-tag-grey',   Icon: Scale,        title: 'Le stock est au pesage : saisissez le poids' },
  a_ouvrir:     { label: 'À ouvrir',      cls: 'odoo-tag-blue',   Icon: PackageOpen,  title: 'Le stock est en économat : pesez, le contenant est ouvert automatiquement' },
  manquant:     { label: 'Manquant',      cls: 'odoo-tag-red',    Icon: AlertTriangle, title: 'Rien en stock (pesage ni économat) : commandez, ou remettez le bon en signalant le manquant' },
  stock_revenu: { label: 'Stock revenu',  cls: 'odoo-tag-yellow', Icon: RefreshCw,    title: 'Du stock est arrivé depuis : actualisez le stock ou choisissez un lot' },
  lot_perime:   { label: 'Lot périmé',    cls: 'odoo-tag-red',    Icon: XCircle,      title: 'Le lot alloué a dépassé sa DLC : choisissez un autre lot' },
  attente:      { label: 'En attente',    cls: 'odoo-tag-grey',   Icon: Clock,        title: '' },
};

/** Lot reellement pris, a choisir parmi les lots utilisables (pesage puis economat, FEFO). */
function LotSelect({ ligneId, value, onChange, unit }: { ligneId: string; value: string; onChange: (lotId: string, lot: Line | null) => void; unit: string }) {
  const { data: lots = [], isLoading } = useQuery<Line[]>({
    queryKey: ['bsi-ligne-lots', ligneId],
    queryFn: () => bonSortieApi.lotsForLigne(ligneId),
    staleTime: 10000,
  });
  const fmt = (q: unknown) => {
    const f = smartFormatQuantity(parseFloat(q as string || '0'), unit);
    return `${f.value.toFixed(f.unit === 'g' || f.unit === 'ml' ? 0 : 2)} ${f.unit}`;
  };
  if (isLoading) return <Loader2 size={13} className="animate-spin" />;
  return (
    <select value={value} onChange={(e) => onChange(e.target.value, lots.find(l => l.id === e.target.value) || null)} className="bsi-lot-select" title="Lot réellement utilisé">
      <option value="">— lot proposé (FEFO) —</option>
      {lots.map((lot) => {
        const pesage = parseFloat(lot.pesage_free as string || '0');
        const eco = parseFloat(lot.economat_quantity as string || '0');
        const dlc = lot.expiration_date ? format(new Date(lot.expiration_date as string), 'dd/MM/yy') : 'sans DLC';
        const where = pesage > 0 ? `pesage ${fmt(pesage)}` : `économat ${fmt(eco)}`;
        return (
          <option key={lot.id as string} value={lot.id as string} disabled={!!lot.is_expired}>
            {((lot.supplier_lot_number || lot.lot_number) as string | null) || 'lot sans n°'} · DLC {dlc} · {where}{lot.is_expired ? ' · PÉRIMÉ' : ''}
          </option>
        );
      })}
    </select>
  );
}

export function BonSortiePanel({
  planId,
  isChef,
  isMagasinier = false,
  variant = 'page',
}: {
  planId: string;
  isChef: boolean;
  /** L'utilisateur courant prepare les bons (magasinier, admin, manager). */
  isMagasinier?: boolean;
  variant?: 'inline' | 'page';
}) {
  const queryClient = useQueryClient();
  const confirm = useConfirm();

  // Saisie locale par ligne : poids reel + motif + lot choisi + contenants ouverts.
  // Jamais pre-remplie avec la cible : c'est la mesure qui entre dans le systeme.
  type Entry = { value: string; reason: string; lotId: string; containers: string; pickLot: boolean; openQty: string; lotEco: number | null; lotPesage: number | null };
  const EMPTY: Entry = { value: '', reason: '', lotId: '', containers: '', pickLot: false, openQty: '', lotEco: null, lotPesage: null };
  const [entries, setEntries] = useState<Record<string, Entry>>({});
  const entryOf = (id: string): Entry => entries[id] ?? EMPTY;
  const setEntry = (id: string, patch: Partial<Entry>) =>
    setEntries(prev => ({ ...prev, [id]: { ...(prev[id] ?? EMPTY), ...patch } }));
  const clearEntry = (id: string) => setEntries(prev => { const n = { ...prev }; delete n[id]; return n; });
  const [showDetails, setShowDetails] = useState(false);

  const { data: bons = [], isLoading } = useQuery({
    queryKey: ['bons-sortie', planId],
    queryFn: () => bonSortieApi.getByPlan(planId),
    enabled: !!planId,
    refetchInterval: (q) => {
      const active = ((q.state.data || []) as Line[]).find(b => b.status !== 'annule');
      return active && !['cloture', 'annule'].includes(active.status as string) ? 15000 : false;
    },
  });

  const bon = (bons as Line[]).find((b) => b.status !== 'annule') as Line | undefined;
  const allLines = (bon?.lines || []) as Line[];
  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['bons-sortie', planId] });
    queryClient.invalidateQueries({ queryKey: ['warehouse-queue'] });
    queryClient.invalidateQueries({ queryKey: ['warehouse-pesage-stock'] });
    queryClient.invalidateQueries({ queryKey: ['warehouse-transfer-requests'] });
    queryClient.invalidateQueries({ queryKey: ['warehouse-rupture-requests'] });
  };
  const onError = (e: unknown) => notify.error(apiErrorMessage(e, 'Erreur'));

  // ─── Mutations ───
  const markPreparationMutation = useMutation({
    mutationFn: () => bonSortieApi.markPreparation(bon!.id as string),
    onSuccess: () => { invalidate(); notify.success('Préparation démarrée — le chef a été notifié'); },
    onError,
  });
  const markReadyMutation = useMutation({
    mutationFn: (withMissing: boolean) => bonSortieApi.markReady(bon!.id as string, { withMissing }),
    onSuccess: (_d, withMissing) => {
      invalidate();
      notify.success(withMissing ? 'Bon remis au chef avec les manquants signalés' : 'Bon remis au chef — il a été notifié');
    },
    onError,
  });
  const completePendingMutation = useMutation({
    mutationFn: () => bonSortieApi.completePending(bon!.id as string),
    onSuccess: (data: Line) => {
      invalidate();
      const resolved = data?.resolved || 0;
      const left = data?.remainingPendingLines ?? 0;
      notify.success(left === 0 ? `Stock actualisé : ${resolved} ligne(s) ré-allouée(s)` : `${resolved} ligne(s) ré-allouée(s), ${left} toujours manquante(s)`);
    },
    onError,
  });
  const regenerateMutation = useMutation({
    mutationFn: () => bonSortieApi.regenerate(planId),
    onSuccess: () => { invalidate(); notify.success('Bon régénéré'); },
    onError,
  });
  const ligneMutation = useMutation({
    mutationFn: ({ ligneId, payload }: { ligneId: string; payload: WeighingPayload }) => bonSortieApi.updateLigne(ligneId, payload),
    onSuccess: (data: Line, vars) => {
      invalidate();
      clearEntry(vars.ligneId);
      const opened = parseFloat(data?.opened_qty || '0');
      if (opened > 0) notify.success(`Pesée enregistrée — contenant ouvert (${opened.toFixed(2)} ${data?.unit || ''} transférés au pesage)`);
    },
    onError,
  });
  const weighAllMutation = useMutation({
    mutationFn: (lines: Array<WeighingPayload & { ligneId: string }>) => bonSortieApi.weighLignes(bon!.id as string, lines),
    onSuccess: (data: Line) => {
      invalidate();
      setEntries({});
      const hors = data?.outOfTolerance || 0;
      notify.success(`${data?.weighed || 0} pesée(s) enregistrée(s)` + (hors > 0 ? ` — dont ${hors} hors tolérance` : ''));
    },
    onError,
  });
  const [orderedIds, setOrderedIds] = useState<Set<string>>(new Set());
  const orderMutation = useMutation({
    mutationFn: (line: Line) => purchaseRequestsApi.create({
      ingredientId: line.ingredient_id as string,
      quantity: Math.max(0.001, parseFloat(line.needed_quantity as string || '0') - parseFloat(line.allocated_quantity as string || '0')),
      unit: (line.unit || line.ingredient_unit || 'kg') as string,
      reason: 'production',
      note: `Bon ${bon?.numero || ''} — manquant au pesage`,
      supplierId: null,
    }),
    onSuccess: (_d, line) => {
      setOrderedIds(prev => new Set(prev).add(line.id as string));
      queryClient.invalidateQueries({ queryKey: ['purchase-requests'] });
      queryClient.invalidateQueries({ queryKey: ['purchase-requests-grouped'] });
      invalidate();
      notify.success(`${line.ingredient_name} : demande d'achat créée (Stock › À commander)`);
    },
    onError,
  });

  // ─── Lignes : ingredients (pesees) et emballages (informatifs) ───
  const activeLines = allLines.filter((l) => l.status !== 'annule');
  const ingredientLines = activeLines.filter((l) => !l.is_packaging);
  const packagingLines = activeLines.filter((l) => !!l.is_packaging);
  const kinds = new Map<string, LineKind>(ingredientLines.map((l) => [l.id as string, lineKind(l)]));
  const count = (k: LineKind) => ingredientLines.filter((l) => kinds.get(l.id as string) === k).length;
  const totalLines = ingredientLines.length;
  const pesees = count('pese');
  const aPeser = count('a_peser');
  const aOuvrir = count('a_ouvrir');
  const lotsPerimes = count('lot_perime');
  const stockRevenu = count('stock_revenu');
  const manquantLines = ingredientLines.filter((l) => kinds.get(l.id as string) === 'manquant');
  const manquants = manquantLines.length;
  const restant = aPeser + aOuvrir + lotsPerimes + stockRevenu;
  const progressPct = totalLines > 0 ? Math.round((pesees / totalLines) * 100) : 0;
  const allDone = totalLines > 0 && pesees === totalLines;
  // Lignes manquantes au moment de la remise / livraison : visibles par le chef.
  const missingAtDelivery = ingredientLines.filter((l) => l.status === 'rupture');

  // ─── Evaluation d'une saisie contre la bande de tolerance ───
  type WeighEval = {
    raw: string; qty: number | null; target: number; tolerance: number; ecart: number; outOfBand: boolean;
    reason: string; ready: boolean; blockedReason: string | null;
    inputUnit: string; inputFactor: number; inputDigits: number; targetInInput: number; minInput: number; maxInput: number;
    lotId: string; containers: number | null; opensContainers: number | null;
    openQty: number | null; openQtyOk: boolean; openDefault: number | null;
  };
  const evalWeighing = (line: Line, kind: LineKind): WeighEval => {
    const entry = entryOf(line.id as string);
    const target = lineTarget(line, kind);
    const tolerance = parseFloat(line.tolerance_qty as string || '0');
    const baseUnit = (line.ingredient_unit as string) || (line.unit as string) || 'kg';
    // Unite de SAISIE : celle dans laquelle la cible s'affiche (125 g se pese en
    // grammes, pas en 0,125 kg). La conversion vers l'unite de base reste interne.
    const inputUnit = smartFormatQuantity(target, baseUnit).unit || baseUnit;
    const inputFactor = inputUnit === baseUnit ? 1 : 1000;
    const inputDigits = inputUnit === 'g' || inputUnit === 'ml' ? 0 : 3;
    const raw = entry.value.replace(',', '.').trim();
    const parsed = raw === '' ? null : parseFloat(raw);
    const qty = parsed !== null && Number.isFinite(parsed) && parsed >= 0 ? parsed / inputFactor : null;
    const ecart = qty === null ? 0 : qty - target;
    const outOfBand = qty !== null && Math.abs(ecart) > tolerance + 1e-9;
    const reason = entry.reason.trim();
    const needsLot = (kind === 'lot_perime' || kind === 'stock_revenu') && !entry.lotId;
    const blockedReason = needsLot ? 'Choisissez le lot utilisé' : null;
    // Regle « contenant entier » : contenant defini = type + taille sur la fiche.
    const containerSize = line.container_size != null && line.container_type_id ? parseFloat(line.container_size as string) : 0;
    const containers = entry.containers.trim() !== '' && Number.isFinite(Number(entry.containers)) && Number(entry.containers) > 0
      ? Math.floor(Number(entry.containers)) : null;
    // Ouverture prevue (ligne a ouvrir) : contenants entiers si l'ingredient en a,
    // sinon exactement la quantite pesee. Le magasinier peut saisir ce qu'il a
    // reellement sorti de l'economat (ex. le sac entier) ou prendre « Tout le lot ».
    const isOpeningKind = kind === 'a_ouvrir' || ((kind === 'lot_perime' || kind === 'stock_revenu') && entry.lotEco !== null && (entry.lotPesage ?? 0) + 1e-9 < (qty ?? 0));
    const opensContainers = isOpeningKind && containerSize > 0 && qty !== null
      ? (containers ?? Math.max(1, Math.ceil(qty / containerSize - 1e-9)))
      : null;
    const openDefault = !isOpeningKind || qty === null ? null
      : opensContainers !== null ? opensContainers * containerSize : qty;
    const openRaw = entry.openQty.replace(',', '.').trim();
    const openQty = openRaw === '' ? null : parseFloat(openRaw) / inputFactor;
    const lotEco = entry.lotEco ?? (line.suggested_lot_economat_qty != null ? parseFloat(line.suggested_lot_economat_qty as string) : null);
    const openQtyOk = openQty === null
      || (Number.isFinite(openQty) && openQty > 0 && (qty === null || openQty + 1e-9 >= qty) && (lotEco === null || openQty <= lotEco + 1e-9));
    return {
      raw: entry.value, qty, target, tolerance, ecart, outOfBand, reason,
      ready: qty !== null && !needsLot && openQtyOk && (!outOfBand || reason.length >= 3),
      blockedReason, inputUnit, inputFactor, inputDigits,
      targetInInput: target * inputFactor,
      minInput: Math.max(0, (target - tolerance) * inputFactor),
      maxInput: (target + tolerance) * inputFactor,
      lotId: entry.lotId, containers, opensContainers,
      openQty, openQtyOk, openDefault,
    };
  };
  const payloadOf = (line: Line, ev: WeighEval): WeighingPayload => ({
    actualQuantity: ev.qty as number,
    reason: ev.outOfBand ? ev.reason : undefined,
    source: 'manual',
    lotId: ev.lotId || undefined,
    containerCount: ev.openQty === null ? (ev.containers ?? undefined) : undefined,
    transferQty: ev.openQty ?? undefined,
  });

  const WEIGHABLE: LineKind[] = ['a_peser', 'a_ouvrir', 'lot_perime', 'stock_revenu'];
  const bonStatus = bon?.status as string | undefined;
  const canPrepare = isMagasinier && !!bonStatus && ['preparation', 'preparation_partielle'].includes(bonStatus);
  const weighableLines = ingredientLines.filter((l) => WEIGHABLE.includes(kinds.get(l.id as string) as LineKind));
  const pendingWeighings = weighableLines
    .map((line) => ({ line, ev: evalWeighing(line, kinds.get(line.id as string) as LineKind) }))
    .filter(({ ev }) => ev.qty !== null);
  const readyWeighings = pendingWeighings.filter(({ ev }) => ev.ready);
  const blockedWeighings = pendingWeighings.filter(({ ev }) => !ev.ready);

  const remettre = async () => {
    if (manquants === 0) { markReadyMutation.mutate(false); return; }
    const names = manquantLines.map((l) => l.ingredient_name as string).join(', ');
    const ok = await confirm(
      `${manquants} ingrédient${manquants > 1 ? 's' : ''} manquant${manquants > 1 ? 's' : ''} : ${names}.\n\nRemettre le bon au chef en signalant ${manquants > 1 ? 'ces manquants' : 'ce manquant'} ? Il décidera de produire sans, ou de refuser la réception.`,
      { title: 'Remettre avec des manquants', confirmLabel: 'Remettre au chef' },
    );
    if (ok) markReadyMutation.mutate(true);
  };

  if (isLoading) return (
    <div className="flex items-center justify-center h-40">
      <Loader2 size={28} className="animate-spin" style={{ color: 'var(--theme-accent)' }} />
    </div>
  );

  if (!bon) return (
    <div className="flex flex-col items-center justify-center h-40 gap-2">
      <Package size={32} className="text-gray-300" />
      <p className="text-sm text-gray-500">Aucun bon de sortie pour ce plan</p>
    </div>
  );

  const isClosed = bon.status === 'cloture';
  const isDelivered = ['prelevement', 'verifie', 'cloture'].includes(bon.status as string);
  const inPreparation = ['preparation', 'preparation_partielle'].includes(bon.status as string);
  const containerClass = variant === 'inline' ? 'space-y-3' : 'space-y-4 max-w-5xl mx-auto';
  const fmtQty = (q: number, unit: string) => {
    const f = smartFormatQuantity(q, unit);
    const d = f.unit === 'g' || f.unit === 'ml' ? 0 : 3;
    return { v: f.value.toFixed(d), u: f.unit };
  };

  const missingList = missingAtDelivery.length > 0 && (
    <ul className="status-banner-list">
      {missingAtDelivery.map((l) => {
        const unit = (l.ingredient_unit || l.unit || 'kg') as string;
        const miss = fmtQty(parseFloat(l.needed_quantity as string || '0') - parseFloat(l.allocated_quantity as string || '0'), unit);
        return <li key={l.id as string}><strong>{l.ingredient_name as string}</strong> : manque {miss.v} {miss.u}</li>;
      })}
    </ul>
  );

  return (
    <div className={containerClass}>
      {variant === 'inline' && (
        <div className="odoo-section-header" style={{ borderRadius: 4, border: '1px solid var(--theme-bg-separator)' }}>
          <Truck size={12} /> Bon de sortie
          <span style={{ marginLeft: 4, fontFamily: 'monospace', color: 'var(--theme-text-muted)', fontWeight: 400 }}>{bon.numero as string}</span>
          {isClosed && (
            <span className="odoo-tag odoo-tag-green" style={{ marginLeft: 'auto' }}>
              <CheckCircle size={10} /> Livré
            </span>
          )}
        </div>
      )}

      {/* ─── Bandeau d'etape ─── */}
      {bon.status === 'genere' && (isMagasinier ? (
        <StatusBanner tone="info" icon={Truck} title="Nouvelle demande à préparer"
          actions={
            <button onClick={() => markPreparationMutation.mutate()} disabled={markPreparationMutation.isPending} className="odoo-btn-primary">
              {markPreparationMutation.isPending ? <Loader2 size={13} className="animate-spin" /> : <Truck size={13} />}
              Prendre en charge
            </button>
          }>
          Le chef attend que vous prépariez les ingrédients.
        </StatusBanner>
      ) : (
        <StatusBanner tone="neutral" icon={Truck} title="En attente de prise en charge">
          Le magasinier a été notifié pour préparer les ingrédients.
        </StatusBanner>
      ))}

      {inPreparation && (
        <StatusBanner tone="warning" icon={Scale} title="Préparation en cours"
          actions={isMagasinier ? (
            <>
              {(manquants > 0 || stockRevenu > 0) && (
                <button onClick={() => completePendingMutation.mutate()} disabled={completePendingMutation.isPending}
                  className="odoo-btn-secondary" title="Refait l'allocation (FEFO) des lignes manquantes après un réapprovisionnement">
                  {completePendingMutation.isPending ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />}
                  Actualiser le stock
                </button>
              )}
              <button onClick={remettre}
                disabled={markReadyMutation.isPending || restant > 0 || totalLines === 0}
                title={restant > 0 ? `${restant} ingrédient${restant > 1 ? 's' : ''} encore à peser` : manquants > 0 ? 'Remettre en signalant les manquants' : 'Remettre les ingrédients au chef'}
                className="odoo-btn-primary">
                {markReadyMutation.isPending ? <Loader2 size={13} className="animate-spin" /> : <CheckCircle size={13} />}
                {manquants > 0 ? `Remettre avec ${manquants} manquant${manquants > 1 ? 's' : ''}` : 'Remettre au chef'}
              </button>
            </>
          ) : undefined}>
          {isMagasinier ? (
            restant > 0
              ? <>Reste <strong>{restant}</strong> ingrédient{restant > 1 ? 's' : ''} à peser
                  {aOuvrir > 0 && <> (dont {aOuvrir} à ouvrir depuis l'économat)</>}
                  {manquants > 0 && <>, <strong>{manquants}</strong> manquant{manquants > 1 ? 's' : ''}</>}.</>
              : manquants > 0
                ? <>Tout ce qui est en stock est pesé. <strong>{manquants}</strong> ingrédient{manquants > 1 ? 's' : ''} manquant{manquants > 1 ? 's' : ''} : commandez-{manquants > 1 ? 'les' : 'le'} ou remettez le bon en le signalant au chef.</>
                : <>Tous les ingrédients sont pesés : remettez le bon au chef.</>
          ) : 'Le magasinier prépare les ingrédients. Vous serez notifié dès qu\'ils sont prêts.'}
          {bon.chef_reject_reason && (
            <div className="status-banner-note danger"><strong>Refus précédent :</strong> {bon.chef_reject_reason as string}</div>
          )}
        </StatusBanner>
      )}

      {bon.status === 'pret' && (
        <StatusBanner tone="success" icon={CheckCircle} title={missingAtDelivery.length > 0 ? `Ingrédients prêts — ${missingAtDelivery.length} manquant${missingAtDelivery.length > 1 ? 's' : ''} signalé${missingAtDelivery.length > 1 ? 's' : ''}` : 'Ingrédients prêts à récupérer'}>
          {isChef && variant === 'inline'
            ? 'Vérifiez les quantités, puis confirmez ou refusez la réception depuis le bandeau en haut de la page.'
            : `En attente de la réception par ${(bon.generated_by_name as string) || 'le chef'}.`}
          {missingList}
        </StatusBanner>
      )}

      {isClosed && (
        <StatusBanner tone="success" icon={CheckCircle} title="Ingrédients livrés">
          {missingAtDelivery.length > 0
            ? <>Livré avec {missingAtDelivery.length} ingrédient{missingAtDelivery.length > 1 ? 's' : ''} manquant{missingAtDelivery.length > 1 ? 's' : ''}.</>
            : 'La production peut démarrer.'}
          {missingList}
        </StatusBanner>
      )}

      {/* ─── Tableau des lignes ─── */}
      <div className="odoo-section bsi-lines" style={{ margin: 0 }}>
        {!isDelivered && isMagasinier && (
          <div className="bsi-lines-toolbar">
            <div className="bsi-lines-progress">
              <span className="bsi-lines-progress-label">
                <strong>{pesees}</strong> / {totalLines} ingrédient{totalLines > 1 ? 's' : ''} pesé{pesees > 1 ? 's' : ''}
                {manquants > 0 && <> · <span style={{ color: '#a94442' }}>{manquants} manquant{manquants > 1 ? 's' : ''}</span></>}
              </span>
              <div className="bsi-lines-progress-track">
                <div className={`bsi-lines-progress-bar ${allDone ? 'is-done' : ''}`} style={{ width: `${progressPct}%` }} />
              </div>
              <span className={`bsi-lines-progress-pct ${allDone ? 'is-done' : ''}`}>{progressPct}%</span>
            </div>
            {canPrepare && weighableLines.length > 0 && (
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
                {blockedWeighings.length > 0 && (
                  <span className="odoo-tag odoo-tag-orange">
                    <AlertTriangle size={10} /> {blockedWeighings.length} à compléter (motif ou lot)
                  </span>
                )}
                <button
                  onClick={() => weighAllMutation.mutate(readyWeighings.map(({ line, ev }) => ({ ligneId: line.id as string, ...payloadOf(line, ev) })))}
                  disabled={weighAllMutation.isPending || readyWeighings.length === 0}
                  className="odoo-btn-primary"
                  title="Enregistre en une fois toutes les pesées saisies">
                  {weighAllMutation.isPending ? <Loader2 size={13} className="animate-spin" /> : <Scale size={13} />}
                  {readyWeighings.length === 0
                    ? `Enregistrer les pesées (${weighableLines.length} à peser)`
                    : `Enregistrer ${readyWeighings.length} pesée${readyWeighings.length > 1 ? 's' : ''}`}
                </button>
              </div>
            )}
          </div>
        )}

        <div style={{ overflowX: 'auto' }}>
        <table className="odoo-table bsi-lines-table">
          <thead>
            <tr>
              <th style={{ width: 28 }}></th>
              <th>Ingrédient</th>
              <th>État</th>
              <th style={{ textAlign: 'right' }}>Demandé</th>
              {isMagasinier && <th style={{ textAlign: 'right' }}>Plage tolérée</th>}
              <th style={{ textAlign: 'right', width: isMagasinier ? 170 : undefined }}>{isMagasinier ? 'Poids pesé' : 'Reçu'}</th>
              {isMagasinier && <th style={{ textAlign: 'right' }}>Écart</th>}
              {isMagasinier && <th style={{ width: 44 }}></th>}
            </tr>
          </thead>
          <tbody>
        {(isMagasinier ? ingredientLines : aggregateForChef(ingredientLines, kinds)).map((line) => {
          const kind = (line._kind as LineKind | undefined) ?? (kinds.get(line.id as string) as LineKind);
          const unit = (line.ingredient_unit || line.unit || 'kg') as string;
          const target = lineTarget(line, kind);
          const needed = parseFloat(line.needed_quantity as string || '0');
          const actual = line.actual_quantity != null ? parseFloat(line.actual_quantity as string) : null;
          const allocated = parseFloat(line.allocated_quantity as string || '0');
          const isDone = kind === 'pese';
          const hasEcart = line.status === 'ecart';
          const canWeigh = canPrepare && WEIGHABLE.includes(kind);
          const ev = canWeigh ? evalWeighing(line, kind) : null;
          const entry = entryOf(line.id as string);
          const tag = hasEcart ? { label: 'Pesé — écart', cls: 'odoo-tag-orange', Icon: AlertTriangle, title: 'Hors tolérance, motif enregistré' } : KIND_TAG[kind];
          const rowDot = hasEcart ? 'warning' : isDone ? 'ok' : (kind === 'manquant' || kind === 'lot_perime') ? 'danger' : 'neutral';
          const shown = fmtQty(isMagasinier ? target : needed, unit);
          const weighedEcart = actual === null ? 0 : actual - allocated;
          const recordedEcart = fmtQty(Math.abs(weighedEcart), unit);
          const containerSize = line.container_size != null && line.container_type_id ? parseFloat(line.container_size as string) : 0;
          const alreadyOrdered = !!line.already_ordered || orderedIds.has(line.id as string);
          const saveLine = () => ev && ev.ready && ligneMutation.mutate({ ligneId: line.id as string, payload: payloadOf(line, ev) });
          const lotLabel = (line.supplier_lot_number || line.lot_number) as string | null;
          const suggestedLabel = (line.suggested_lot_number as string | null) || (line.suggested_economat_lot_id ? 'sans n°' : null);

          return (
            <Fragment key={line.id as string}>
            <tr className={`${kind === 'lot_perime' ? 'bsi-row-muted' : ''} ${isDone ? 'bsi-row-done' : ''}`}>
              <td><span className={`odoo-status-dot ${rowDot}`} /></td>
              <td>
                <div style={{ fontWeight: 600, color: 'var(--theme-text-strong)' }}>{line.ingredient_name as string}</div>
                {isMagasinier && (
                  <div className="bsi-sub">
                    {kind === 'a_ouvrir' && suggestedLabel && <>Ouvrir le lot <span style={{ fontFamily: 'ui-monospace, monospace' }}>{suggestedLabel}</span>{containerSize > 0 && <> · {line.container_type_label ? `${line.container_type_label} de ` : 'contenant de '}{fmtQty(containerSize, unit).v} {fmtQty(containerSize, unit).u}</>}</>}
                    {kind !== 'a_ouvrir' && lotLabel && <>Lot <span style={{ fontFamily: 'ui-monospace, monospace' }}>{lotLabel}</span></>}
                    {kind === 'a_ouvrir' && !suggestedLabel && <>Lot choisi automatiquement (FEFO)</>}
                  </div>
                )}
                {isMagasinier && line.ecart_reason && <div className="bsi-sub" style={{ fontStyle: 'italic' }}>« {line.ecart_reason as string} »</div>}
                {canWeigh && ev && (
                  <div className="bsi-lot-row">
                    {entry.pickLot || entry.lotId ? (
                      <LotSelect ligneId={line.id as string} value={entry.lotId} unit={unit}
                        onChange={(lotId, lot) => setEntry(line.id as string, {
                          lotId, pickLot: true, openQty: '',
                          lotEco: lot ? parseFloat(lot.economat_quantity as string || '0') : null,
                          lotPesage: lot ? parseFloat(lot.pesage_free as string || '0') : null,
                        })} />
                    ) : (
                      <button type="button" className="bsi-link-btn" onClick={() => setEntry(line.id as string, { pickLot: true })}>
                        <Layers size={11} /> {kind === 'lot_perime' || kind === 'stock_revenu' ? 'Choisir le lot' : 'Autre lot'}
                      </button>
                    )}
                    {ev.openDefault !== null && (
                      <span className="bsi-open-row" title="Quantité réellement sortie de l'économat (le reste du contenant ouvert reste au pesage)">
                        <PackageOpen size={11} /> Sorti de l'économat :
                        {containerSize > 0 && (
                          <label className="bsi-containers">
                            <input type="text" inputMode="numeric"
                              value={entry.containers || (ev.opensContainers != null ? String(ev.opensContainers) : '1')}
                              onChange={(e) => setEntry(line.id as string, { containers: e.target.value.replace(/[^0-9]/g, ''), openQty: '' })}
                              className="bsi-weigh-input bsi-containers-input" title="Nombre de contenants ouverts" />
                            <span className="bsi-unit">× {(line.container_type_label as string) || 'contenant'} de {fmtQty(containerSize, unit).v} {fmtQty(containerSize, unit).u}</span>
                          </label>
                        )}
                        {containerSize > 0 ? (
                          <span className="bsi-unit">= <strong>{fmtQty((ev.containers ?? ev.opensContainers ?? 1) * containerSize, unit).v} {fmtQty((ev.containers ?? ev.opensContainers ?? 1) * containerSize, unit).u}</strong> (contenant entier)</span>
                        ) : (
                          <>
                            <input type="text" inputMode="decimal"
                              value={entry.openQty}
                              placeholder={(ev.openDefault * ev.inputFactor).toFixed(ev.inputDigits)}
                              onChange={(e) => setEntry(line.id as string, { openQty: e.target.value.replace(/[^0-9.,]/g, ''), containers: '' })}
                              className={`bsi-weigh-input bsi-open-input ${entry.openQty && !ev.openQtyOk ? 'is-out' : ''}`}
                              title="Quantité sortie de l'économat" />
                            <span className="bsi-unit">{ev.inputUnit}</span>
                          </>
                        )}
                        {(entry.lotEco ?? (line.suggested_lot_economat_qty != null ? parseFloat(line.suggested_lot_economat_qty as string) : null)) !== null && (() => {
                          const eco = entry.lotEco ?? parseFloat(line.suggested_lot_economat_qty as string);
                          const allContainers = containerSize > 0 ? Math.max(1, Math.ceil(eco / containerSize - 1e-9)) : 0;
                          return (
                            <button type="button" className="bsi-link-btn" title="Tout ce que le lot a en économat passe au pesage"
                              onClick={() => containerSize > 0
                                ? setEntry(line.id as string, { containers: String(allContainers), openQty: '' })
                                : setEntry(line.id as string, { openQty: (eco * ev.inputFactor).toFixed(ev.inputDigits), containers: '' })}>
                              Tout le lot ({containerSize > 0 ? `${allContainers} × ${fmtQty(containerSize, unit).v} ${fmtQty(containerSize, unit).u}` : `${fmtQty(eco, unit).v} ${fmtQty(eco, unit).u}`})
                            </button>
                          );
                        })()}
                      </span>
                    )}
                  </div>
                )}
              </td>
              <td>
                <span className={`odoo-tag ${tag.cls}`} title={tag.title}><tag.Icon size={10} /> {tag.label}</span>
                {isMagasinier && kind === 'manquant' && !isDelivered && (
                  alreadyOrdered
                    ? <div style={{ marginTop: 4 }}><span className="odoo-tag odoo-tag-green"><ShoppingCart size={10} /> Commandé</span></div>
                    : <div style={{ marginTop: 4 }}>
                        <button type="button" className="bsi-link-btn" disabled={orderMutation.isPending}
                          onClick={() => orderMutation.mutate(line)} title="Demander l'achat du manquant (Stock › À commander)">
                          <ShoppingCart size={11} /> Commander
                        </button>
                      </div>
                )}
              </td>
              <td className="bsi-num"><strong>{shown.v}</strong> <span className="bsi-unit">{shown.u}</span></td>
              {isMagasinier && (
                <td className="bsi-num bsi-muted">
                  {ev ? <>{ev.minInput.toFixed(ev.inputDigits)} – {ev.maxInput.toFixed(ev.inputDigits)} <span className="bsi-unit">{ev.inputUnit}</span></> : <span className="bsi-empty">—</span>}
                </td>
              )}
              <td className="bsi-num">
                {ev ? (
                  <div className="bsi-weigh">
                    <input
                      type="text" inputMode="decimal"
                      value={ev.raw}
                      onChange={(e) => setEntry(line.id as string, { value: e.target.value.replace(/[^0-9.,]/g, '') })}
                      onKeyDown={(e) => { if (e.key === 'Enter') saveLine(); }}
                      placeholder={ev.targetInInput.toFixed(ev.inputDigits)}
                      className={`bsi-weigh-input ${ev.qty === null ? '' : ev.outOfBand ? 'is-out' : 'is-ok'}`}
                      title={ev.blockedReason || 'Poids lu sur la balance'}
                    />
                    <span className="bsi-unit">{ev.inputUnit}</span>
                  </div>
                ) : actual !== null && (isMagasinier || isDelivered) ? (
                  <>
                    <strong>{fmtQty(actual, unit).v}</strong> <span className="bsi-unit">{fmtQty(actual, unit).u}</span>
                    {line.weighing_source === 'auto' && isMagasinier && (
                      <div><span className="odoo-tag odoo-tag-grey" title="Ligne complétée par le système, sans pesée réelle">non pesé</span></div>
                    )}
                  </>
                ) : <span className="bsi-empty">—</span>}
              </td>
              {isMagasinier && (
                <td className="bsi-num">
                  {ev && ev.qty !== null ? (
                    <span className={`odoo-tag ${ev.outOfBand ? 'odoo-tag-orange' : 'odoo-tag-green'}`}>
                      {ev.outOfBand ? <AlertTriangle size={10} /> : <Check size={10} />}
                      {Number(fmtQty(Math.abs(ev.ecart), unit).v) === 0 ? 'pile' : `${ev.ecart > 0 ? '+' : '−'}${fmtQty(Math.abs(ev.ecart), unit).v} ${fmtQty(Math.abs(ev.ecart), unit).u}`}
                    </span>
                  ) : !ev && actual !== null ? (
                    <span className={`odoo-tag ${line.ecart_reason ? 'odoo-tag-orange' : Number(recordedEcart.v) === 0 ? 'odoo-tag-green' : 'odoo-tag-grey'}`}>
                      {Number(recordedEcart.v) === 0 ? 'pile' : `${weighedEcart > 0 ? '+' : '−'}${recordedEcart.v} ${recordedEcart.u}`}
                    </span>
                  ) : <span className="bsi-empty">—</span>}
                </td>
              )}
              {isMagasinier && (
                <td style={{ textAlign: 'right' }}>
                  {ev?.ready && (
                    <button onClick={saveLine} disabled={ligneMutation.isPending} className="bsi-save-btn" title="Enregistrer cette pesée">
                      {ligneMutation.isPending && ligneMutation.variables?.ligneId === line.id ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
                    </button>
                  )}
                </td>
              )}
            </tr>
            {ev?.outOfBand && (
              <tr className="bsi-reason-row">
                <td></td>
                <td colSpan={7}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                    <AlertTriangle size={13} style={{ color: '#b85d1a', flexShrink: 0 }} />
                    <input type="text" value={entry.reason}
                      onChange={(e) => setEntry(line.id as string, { reason: e.target.value })}
                      onKeyDown={(e) => { if (e.key === 'Enter') saveLine(); }}
                      placeholder="Hors tolérance — motif obligatoire (ex : sac entamé, reste de lot, perte au transvasement)"
                      className="bsi-reason-input" />
                  </div>
                </td>
              </tr>
            )}
            </Fragment>
          );
        })}
          </tbody>
        </table>
        </div>

        {/* Emballages : informatifs, consommes a la remise du bon (pas de pesee). */}
        {packagingLines.length > 0 && (
          <div className="bsi-packaging">
            <div className="odoo-section-header" style={{ border: 'none' }}>
              <Package size={12} /> Emballages
              <span style={{ marginLeft: 6, fontWeight: 400, color: 'var(--theme-text-muted)' }}>— consommés automatiquement à la remise, rien à peser</span>
            </div>
            <table className="odoo-table bsi-lines-table">
              <tbody>
                {packagingLines.map((p) => {
                  const need = parseFloat(p.needed_quantity as string || '0');
                  const alloc = parseFloat(p.allocated_quantity as string || '0');
                  const short = alloc + 1e-9 < need;
                  return (
                    <tr key={p.id as string}>
                      <td style={{ width: 28 }}><span className={`odoo-status-dot ${short ? 'warning' : 'ok'}`} /></td>
                      <td><strong>{p.ingredient_name as string}</strong>{p.packaging_format ? <span className="bsi-sub"> {p.packaging_format as string}</span> : null}</td>
                      <td className="bsi-num">{need.toFixed(need % 1 === 0 ? 0 : 2)} <span className="bsi-unit">{(p.unit || '') as string}</span></td>
                      <td>{short ? <span className="odoo-tag odoo-tag-orange"><AlertTriangle size={10} /> stock insuffisant ({alloc.toFixed(0)} dispo)</span> : <span className="odoo-tag odoo-tag-green"><Check size={10} /> en stock</span>}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Historique du bon (repliable) */}
      <div className="odoo-section" style={{ margin: 0 }}>
        <button onClick={() => setShowDetails(!showDetails)} className="odoo-section-header"
          style={{ width: '100%', borderBottom: showDetails ? undefined : 'none', cursor: 'pointer' }}>
          {showDetails ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
          Historique du bon
        </button>
        {showDetails && (
          <div style={{ padding: '0.75rem 1rem', fontSize: '0.75rem', color: 'var(--theme-text-muted)', display: 'flex', flexDirection: 'column', gap: 4 }}>
            {bon.generated_at && <p>Demandé le {format(new Date(bon.generated_at as string), 'dd/MM/yyyy à HH:mm')}{bon.generated_by_name ? ` par ${bon.generated_by_name as string}` : ''}</p>}
            {bon.preparation_at && <p>Pris en charge le {format(new Date(bon.preparation_at as string), 'dd/MM/yyyy à HH:mm')}{bon.preparation_by_name ? ` par ${bon.preparation_by_name as string}` : ''}</p>}
            {bon.ready_at && <p>Remis au chef le {format(new Date(bon.ready_at as string), 'dd/MM/yyyy à HH:mm')}{bon.ready_by_name ? ` par ${bon.ready_by_name as string}` : ''}</p>}
            {bon.prelevement_at && <p>Réception acceptée le {format(new Date(bon.prelevement_at as string), 'dd/MM/yyyy à HH:mm')}{bon.prelevement_by_name ? ` par ${bon.prelevement_by_name as string}` : ''}</p>}
            {bon.closed_at && <p>Livré le {format(new Date(bon.closed_at as string), 'dd/MM/yyyy à HH:mm')}</p>}
            {bon.status === 'genere' && isChef && (
              <div style={{ marginTop: 6 }}>
                <button onClick={() => regenerateMutation.mutate()} disabled={regenerateMutation.isPending} className="odoo-btn-secondary">
                  <RefreshCw size={13} /> Régénérer le bon
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

/** Vue chef : une ligne par ingredient (un besoin pris sur plusieurs lots reste un
 *  seul ingredient pour lui), avec l'etat reel : pese, manquant, ou en preparation. */
function aggregateForChef(lines: Line[], kinds: Map<string, LineKind>): Line[] {
  const byIngredient = new Map<string, Line>();
  for (const l of lines) {
    const key = l.ingredient_id as string;
    const kind = kinds.get(l.id as string) as LineKind;
    const needed = parseFloat(l.needed_quantity as string || '0');
    const allocated = parseFloat(l.allocated_quantity as string || '0');
    const actual = l.actual_quantity != null ? parseFloat(l.actual_quantity as string) : null;
    const existing = byIngredient.get(key);
    if (!existing) {
      byIngredient.set(key, {
        ...l, needed_quantity: needed, allocated_quantity: allocated, actual_quantity: actual,
        _kinds: [kind], _kind: kind,
      });
    } else {
      existing.needed_quantity = parseFloat(existing.needed_quantity) + needed;
      existing.allocated_quantity = parseFloat(existing.allocated_quantity) + allocated;
      if (actual !== null) existing.actual_quantity = (existing.actual_quantity ?? 0) + actual;
      (existing._kinds as LineKind[]).push(kind);
      if (existing.status !== 'ecart' && l.status === 'ecart') existing.status = 'ecart';
    }
  }
  for (const agg of byIngredient.values()) {
    const ks = agg._kinds as LineKind[];
    agg._kind = ks.includes('manquant') ? 'manquant'
      : ks.every((k) => k === 'pese') ? 'pese'
      : 'attente';
    if (agg._kind !== 'pese' && agg.status === 'ecart') agg.status = 'en_attente';
  }
  return Array.from(byIngredient.values());
}
