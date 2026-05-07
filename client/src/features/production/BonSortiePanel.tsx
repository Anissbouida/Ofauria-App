import { useState, useEffect, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { bonSortieApi } from '../../api/bon-sortie.api';
import { ingredientLotsApi } from '../../api/inventory.api';
import { purchaseRequestsApi } from '../../api/purchase-requests.api';
import { useAuth } from '../../context/AuthContext';
import {
  Loader2, CheckCircle, AlertTriangle, Package, PackageOpen, Check, XCircle,
  RefreshCw, ChevronDown, ChevronUp, Edit3, Truck, ShoppingCart,
} from 'lucide-react';
import { format } from 'date-fns';
import { notify } from '../../components/ui/InlineNotification';

/**
 * Panneau reutilisable de gestion du bon de sortie.
 * Utilise :
 *   - comme page autonome via BonSortiePrelevementPage (route /production/:id/bon-sortie)
 *   - inline dans PlanDetailPage (onglet Preparation > sous-onglet "Bon de sortie")
 *
 * variant='inline' : pas de bouton valider fixe en bas de page, layout plus compact.
 */
export function BonSortiePanel({
  planId,
  isChef,
  isMagasinier = false,
  variant = 'page',
}: {
  planId: string;
  isChef: boolean;
  /** L'utilisateur courant a le role magasinier (peut prendre en charge et marquer pret). */
  isMagasinier?: boolean;
  variant?: 'inline' | 'page';
}) {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  // L'interface User de @ofauria/shared expose la propriete `id` (UUID), pas `userId`.
  const currentUserId = user?.id as string | undefined;

  // Editing state: which line is being manually edited
  const [editingLine, setEditingLine] = useState<string | null>(null);
  const [editValue, setEditValue] = useState('');
  const [showDetails, setShowDetails] = useState(false);
  // Modale de refus chef (saisie du motif)
  const [rejectingOpen, setRejectingOpen] = useState(false);
  const [rejectReason, setRejectReason] = useState('');

  const { data: bons = [], isLoading } = useQuery({
    queryKey: ['bons-sortie', planId],
    queryFn: () => bonSortieApi.getByPlan(planId),
    enabled: !!planId,
  });

  const bon = (bons as Record<string, unknown>[]).find((b: Record<string, unknown>) => b.status !== 'annule') as Record<string, unknown> | undefined;
  const lines = (bon?.lines || []) as Record<string, unknown>[];

  // Auto-start prelevement ; ref anti-double-appel (StrictMode dev).
  const autoStartedForBonId = useRef<string | null>(null);

  const startMutation = useMutation({
    mutationFn: () => bonSortieApi.startPrelevement(bon!.id as string),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['bons-sortie', planId] }); },
    onError: (e: any) => {
      const msg: string = e?.response?.data?.error || e?.message || '';
      if (msg.includes('statut invalide') || msg.includes('introuvable')) {
        queryClient.invalidateQueries({ queryKey: ['bons-sortie', planId] });
        return;
      }
      notify.error(msg || 'Erreur');
    },
  });

  // Pas d'auto-transition : le BSI reste en 'genere' jusqu'a ce que le magasinier
  // prenne explicitement en charge via le bouton "Prendre en charge". Cela garantit
  // que le workflow passe TOUJOURS par le magasinier, meme quand le chef ouvre le plan
  // en premier. Le chef (non-magasinier) voit "En attente de prise en charge".
  // autoStartedForBonId garde une reference pour un usage futur eventuel mais n'est plus
  // declenche automatiquement.
  void autoStartedForBonId;

  // ─── Mutations workflow magasinier/chef ───
  const markPreparationMutation = useMutation({
    mutationFn: () => bonSortieApi.markPreparation(bon!.id as string),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['bons-sortie', planId] });
      notify.success('Preparation demarree — le chef a ete notifie');
    },
    onError: (e: any) => notify.error(e?.response?.data?.error || 'Erreur'),
  });

  const markReadyMutation = useMutation({
    mutationFn: () => bonSortieApi.markReady(bon!.id as string),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['bons-sortie', planId] });
      notify.success('Pret a remettre — le chef a ete notifie');
    },
    onError: (e: any) => notify.error(e?.response?.data?.error || 'Erreur'),
  });

  const chefRejectMutation = useMutation({
    mutationFn: (reason: string) => bonSortieApi.chefReject(bon!.id as string, reason),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['bons-sortie', planId] });
      notify.success('Reception refusee — le magasinier a ete notifie du motif');
      setRejectingOpen(false);
      setRejectReason('');
    },
    onError: (e: any) => notify.error(e?.response?.data?.error || 'Erreur'),
  });

  const ligneMutation = useMutation({
    mutationFn: ({ ligneId, actualQuantity }: { ligneId: string; actualQuantity: number }) =>
      bonSortieApi.updateLigne(ligneId, { actualQuantity }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['bons-sortie', planId] });
      setEditingLine(null);
    },
    onError: (e: any) => notify.error(e?.response?.data?.error || 'Erreur'),
  });

  // Ouvrir contenant economat -> pesage + marquer la ligne preleve en 1 clic.
  // Pour les lignes 'rupture' ou allocated >= needed (cas "a ouvrir depuis economat").
  const openAndPickMutation = useMutation({
    mutationFn: async ({ line }: { line: Record<string, unknown> }) => {
      const lotId = line.ingredient_lot_id as string;
      const qty = parseFloat(line.allocated_quantity as string || '0');
      if (!lotId || qty <= 0) throw new Error('Lot ou quantite invalide');
      // 1. Ouvrir le contenant (transfert economat -> pesage)
      await ingredientLotsApi.openContainer(lotId, qty, `Ouvert depuis BSI ${bon?.numero || ''}`);
      // 2. Marquer la ligne BSI comme prelevee
      await bonSortieApi.updateLigne(line.id as string, { actualQuantity: qty });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['bons-sortie', planId] });
      queryClient.invalidateQueries({ queryKey: ['inventory'] });
    },
    onError: (e: any) => notify.error(e?.response?.data?.error?.message || e?.message || 'Erreur ouverture contenant'),
  });

  // Batch : ouvrir tous les contenants economat des lignes "a ouvrir" en une seule action.
  const [openingAll, setOpeningAll] = useState(false);
  const openAllContainers = async () => {
    if (toOpenLines.length === 0) return;
    setOpeningAll(true);
    let success = 0;
    let failed = 0;
    try {
      for (const line of toOpenLines) {
        try {
          const lotId = line.ingredient_lot_id as string;
          const qty = parseFloat(line.allocated_quantity as string || '0');
          if (!lotId || qty <= 0) { failed++; continue; }
          await ingredientLotsApi.openContainer(lotId, qty, `Ouvert depuis BSI ${bon?.numero || ''}`);
          await bonSortieApi.updateLigne(line.id as string, { actualQuantity: qty });
          success++;
        } catch {
          failed++;
        }
      }
      await queryClient.invalidateQueries({ queryKey: ['bons-sortie', planId] });
      await queryClient.invalidateQueries({ queryKey: ['inventory'] });
      if (failed === 0) notify.success(`${success} contenant(s) ouvert(s) et prelevés`);
      else notify(`${success} ouvert(s), ${failed} erreur(s)`, { icon: '⚠️' });
    } finally {
      setOpeningAll(false);
    }
  };

  // Option B : transferer une ligne ECONOMAT_REQUIRES_TRANSFER vers Pesage.
  // Apres transfert, la ligne devient PESAGE/en_attente avec allocated_quantity rempli :
  // le magasinier peut ensuite peser et confirmer (bouton "Confirmer" existant).
  const transferLineMutation = useMutation({
    mutationFn: (ligneId: string) => bonSortieApi.transferLineFromEconomat(ligneId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['bons-sortie', planId] });
      queryClient.invalidateQueries({ queryKey: ['inventory'] });
      notify.success('Transfert Economat → Pesage effectue');
    },
    onError: (e: any) => notify.error(e?.response?.data?.error || 'Erreur transfert'),
  });

  const [transferringAll, setTransferringAll] = useState(false);
  const transferAllRequired = async () => {
    setTransferringAll(true);
    let success = 0;
    let failed = 0;
    try {
      for (const line of transferRequiredLines) {
        try {
          await bonSortieApi.transferLineFromEconomat(line.id as string);
          success++;
        } catch {
          failed++;
        }
      }
      await queryClient.invalidateQueries({ queryKey: ['bons-sortie', planId] });
      await queryClient.invalidateQueries({ queryKey: ['inventory'] });
      if (failed === 0) notify.success(`${success} transfert(s) effectue(s) — pese et confirme maintenant`);
      else notify(`${success} transferes, ${failed} erreur(s)`, { icon: '⚠️' });
    } finally {
      setTransferringAll(false);
    }
  };

  const closeMutation = useMutation({
    mutationFn: () => bonSortieApi.close(bon!.id as string),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['bons-sortie', planId] });
      notify.success('Bon cloture — ingredients livres');
    },
    onError: (e: any) => notify.error(e?.response?.data?.error || 'Erreur'),
  });

  const regenerateMutation = useMutation({
    mutationFn: () => bonSortieApi.regenerate(planId),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['bons-sortie', planId] }); notify.success('Bon regenere'); },
    onError: (e: any) => notify.error(e?.response?.data?.error || 'Erreur'),
  });

  // EF-03/CA-04/CA-05 : sur une ligne en rupture totale (ni pesage ni economat),
  // ajouter l'ingredient a la liste d'attente d'achat (service existant). Marque
  // la ligne dans commandedLineIds pour bloquer le re-clic + retour visuel.
  const [commandedLineIds, setCommandedLineIds] = useState<Set<string>>(new Set());
  const commanderRuptureMutation = useMutation({
    mutationFn: ({ line }: { line: Record<string, unknown> }) =>
      purchaseRequestsApi.create({
        ingredientId: line.ingredient_id as string,
        quantity: parseFloat(line.needed_quantity as string || '0'),
        unit: (line.unit || line.ingredient_unit || 'kg') as string,
        reason: 'production',
        note: `BSI ${bon?.numero || ''} — rupture totale signalee par magasinier`,
        supplierId: null,
      }),
    onSuccess: (_data, vars) => {
      setCommandedLineIds(prev => new Set(prev).add(vars.line.id as string));
      queryClient.invalidateQueries({ queryKey: ['purchase-requests'] });
      queryClient.invalidateQueries({ queryKey: ['purchase-requests-grouped'] });
      notify.success('Ajoute a la liste d\'attente d\'achat');
    },
    onError: (e: any) => notify.error(e?.response?.data?.error?.message || e?.response?.data?.error || 'Erreur ajout liste d\'attente'),
  });

  // BSI partiel : valider ce qui est prelevé, garder le reste en attente
  const commitPartialMutation = useMutation({
    mutationFn: () => bonSortieApi.commitPartial(bon!.id as string),
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: ['bons-sortie', planId] });
      notify.success(`Prélèvement partiel validé (${data?.done_count || 0} prêt(s), ${data?.pending_count || 0} en attente)`);
    },
    onError: (e: any) => notify.error(e?.response?.data?.error || 'Erreur'),
  });

  // Après réapprovisionnement : refait le FEFO sur les lignes en attente
  const completePendingMutation = useMutation({
    mutationFn: () => bonSortieApi.completePending(bon!.id as string),
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: ['bons-sortie', planId] });
      if (data?.remainingPendingLines === 0) {
        notify.success(`Toutes les lignes ont été allouées (${data?.resolved} résolue(s))`);
      } else {
        notify.success(`${data?.resolved || 0} ligne(s) résolue(s), ${data?.remainingPendingLines || 0} encore en attente`);
      }
    },
    onError: (e: any) => notify.error(e?.response?.data?.error || 'Erreur'),
  });

  // Stats — la progression compte les lignes effectivement prelevees,
  // pas le complement de "en_attente" (sinon les lignes 'rupture' sont
  // comptees comme prelevees a tort, affichant 100% des le debut).
  const totalLines = lines.length;
  const prelevees = lines.filter((l) => ['preleve', 'substitue'].includes(l.status as string)).length;
  const enAttente = lines.filter((l) => ['en_attente', 'rupture'].includes(l.status as string)).length;
  // Lignes prelevables en "tout conforme" : exclut les transferts requis (allocated=0
  // tant que le magasinier n'a pas transfere depuis l'economat).
  const nonBloquees = lines.filter((l) =>
    l.status === 'en_attente'
    && !l.lot_expired
    && l.lot_status !== 'expired'
    && l.source_location !== 'ECONOMAT_REQUIRES_TRANSFER'
  );
  const allDone = totalLines > 0 && enAttente === 0;
  const progressPct = totalLines > 0 ? Math.round((prelevees / totalLines) * 100) : 0;

  // Phase BSI partiel — vraies ruptures uniquement (allocated < needed OU pas de lot attache).
  // Les lignes 'rupture' avec allocated >= needed ET un lot attache sont en realite
  // "a ouvrir depuis l'economat" (stock dispo dans le contenant, juste pas encore en pesage)
  // → c'est une etape normale du workflow, pas une rupture.
  const ruptureLines = lines.filter((l) =>
    parseFloat(l.allocated_quantity as string || '0') < parseFloat(l.needed_quantity as string || '0')
    || (l.status === 'rupture' && !l.ingredient_lot_id)
  );
  const toOpenLines = lines.filter((l) =>
    l.status === 'rupture'
    && !!l.ingredient_lot_id
    && parseFloat(l.allocated_quantity as string || '0') >= parseFloat(l.needed_quantity as string || '0')
  );
  // Option B : lignes en attente de transfert Economat → Pesage. Apres transfert,
  // la ligne devient source_location='PESAGE' avec allocated > 0.
  const transferRequiredLines = lines.filter((l) => l.source_location === 'ECONOMAT_REQUIRES_TRANSFER');
  const hasRupture = ruptureLines.length > 0;
  const isPartial = bon?.status === 'preparation_partielle';
  const canCommitPartial = bon?.status === 'preparation' && hasRupture && prelevees > 0;

  const confirmLine = (line: Record<string, unknown>) => {
    const allocated = parseFloat(line.allocated_quantity as string || '0');
    ligneMutation.mutate({ ligneId: line.id as string, actualQuantity: allocated });
  };

  const [confirmingAll, setConfirmingAll] = useState(false);
  const confirmAllLines = async () => {
    setConfirmingAll(true);
    try {
      for (const line of nonBloquees) {
        const allocated = parseFloat(line.allocated_quantity as string || '0');
        await bonSortieApi.updateLigne(line.id as string, { actualQuantity: allocated });
      }
      await queryClient.invalidateQueries({ queryKey: ['bons-sortie', planId] });
      notify.success(`${nonBloquees.length} ligne(s) confirmee(s)`);
    } catch (e: any) {
      notify.error(e?.response?.data?.error || 'Erreur');
    } finally {
      setConfirmingAll(false);
    }
  };

  const [validating, setValidating] = useState(false);
  const validateBon = async () => {
    setValidating(true);
    try {
      // Chaine complete des transitions terminales : pret -> prelevement -> verifie -> cloture
      // (le bouton "Valider" peut etre clique depuis n'importe lequel de ces statuts).
      if (bon!.status === 'pret') {
        await bonSortieApi.startPrelevement(bon!.id as string);
      }
      // Apres startPrelevement on est en 'prelevement' → verify peut etre appele.
      // verify est idempotent (ne fait rien si deja verifie/cloture).
      if (['prelevement', 'pret'].includes(bon!.status as string)) {
        await bonSortieApi.verify(bon!.id as string);
      }
      await bonSortieApi.close(bon!.id as string);
      await queryClient.invalidateQueries({ queryKey: ['bons-sortie', planId] });
      await queryClient.invalidateQueries({ queryKey: ['production', planId] });
      notify.success('Bon valide et cloture — ingredients livres');
    } catch (e: any) {
      notify.error(e?.response?.data?.error?.message || e?.response?.data?.error || e?.message || 'Erreur de validation');
    } finally {
      setValidating(false);
    }
  };

  if (isLoading) return (
    <div className="flex items-center justify-center h-40">
      <Loader2 size={28} className="animate-spin text-emerald-500" />
    </div>
  );

  if (!bon) return (
    <div className="flex flex-col items-center justify-center h-40 gap-2">
      <Package size={32} className="text-gray-300" />
      <p className="text-sm text-gray-500">Aucun bon de sortie pour ce plan</p>
    </div>
  );

  const isClosed = bon.status === 'cloture';
  const isVerified = bon.status === 'verifie';

  const containerClass = variant === 'inline'
    ? 'space-y-3'
    : 'space-y-4 max-w-2xl mx-auto pb-32';

  return (
    <div className={containerClass}>
      {/* En-tete compact (variant=page uniquement, la page wrapper fournit son propre header) */}
      {variant === 'inline' && (
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-sm font-bold text-gray-800">Bon de sortie</h3>
            <p className="text-xs text-gray-400 font-mono">{bon.numero as string}</p>
          </div>
          {isClosed && (
            <span className="px-2.5 py-1 rounded-full text-xs font-bold bg-emerald-50 text-emerald-700 border border-emerald-200 flex items-center gap-1">
              <CheckCircle size={12} /> Cloture
            </span>
          )}
        </div>
      )}

      {/* ─── Workflow Magasinier : bannieres par statut ─── */}

      {/* Statut 'genere' vu par le magasinier : bouton "Prendre en charge" */}
      {bon.status === 'genere' && isMagasinier && (
        <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 flex items-start gap-3">
          <div className="w-9 h-9 rounded-lg bg-blue-100 flex items-center justify-center shrink-0">
            <Truck size={18} className="text-blue-600" />
          </div>
          <div className="flex-1">
            <p className="text-sm font-semibold text-blue-900">Nouvelle demande a preparer</p>
            <p className="text-xs text-blue-700 mt-0.5">Le chef attend que vous prepariez les ingredients.</p>
          </div>
          <button
            onClick={() => markPreparationMutation.mutate()}
            disabled={markPreparationMutation.isPending}
            className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-semibold hover:bg-blue-700 transition-colors disabled:opacity-60 flex items-center gap-1.5 shrink-0">
            {markPreparationMutation.isPending ? <Loader2 size={14} className="animate-spin" /> : <Truck size={14} />}
            Prendre en charge
          </button>
        </div>
      )}

      {/* Statut 'genere' vu par le chef : en attente d'un magasinier */}
      {bon.status === 'genere' && isChef && !isMagasinier && (
        <div className="bg-gray-50 border border-gray-200 rounded-xl p-4 flex items-start gap-3">
          <div className="w-9 h-9 rounded-lg bg-gray-100 flex items-center justify-center shrink-0">
            <Truck size={18} className="text-gray-500" />
          </div>
          <div className="flex-1">
            <p className="text-sm font-semibold text-gray-800">En attente de prise en charge</p>
            <p className="text-xs text-gray-500 mt-0.5">Le magasinier sera notifie pour preparer les ingredients.</p>
          </div>
        </div>
      )}

      {/* Statut 'preparation' : magasinier prepare + bouton "Pret a remettre" */}
      {bon.status === 'preparation' && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 flex items-start gap-3">
          <div className="w-9 h-9 rounded-lg bg-amber-100 flex items-center justify-center shrink-0">
            <Loader2 size={18} className="text-amber-600 animate-spin" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-amber-900">Preparation en cours</p>
            <p className="text-xs text-amber-700 mt-0.5">
              {isMagasinier
                ? 'Quand tous les ingredients sont prepares, marquez le bon comme pret.'
                : 'Le magasinier prepare les ingredients. Vous serez notifie une fois pret.'}
            </p>
            {bon.chef_reject_reason && (
              <p className="text-xs text-red-700 mt-1.5 bg-red-50 border border-red-200 rounded px-2 py-1">
                <strong>Refus precedent :</strong> {bon.chef_reject_reason as string}
              </p>
            )}
          </div>
          {isMagasinier && (
            <div className="flex flex-col gap-2 shrink-0">
              <button
                onClick={() => markReadyMutation.mutate()}
                disabled={markReadyMutation.isPending || hasRupture || enAttente > 0 || transferRequiredLines.length > 0}
                title={
                  transferRequiredLines.length > 0 ? `${transferRequiredLines.length} transfert(s) Economat → Pesage requis avant de marquer pret` :
                  hasRupture ? 'Ingredients en rupture — utilisez "Valider partiel"' :
                  enAttente > 0 ? `${enAttente} ingredient(s) non encore preleve(s)` : ''
                }
                className="px-4 py-2 bg-emerald-600 text-white rounded-lg text-sm font-semibold hover:bg-emerald-700 transition-colors disabled:opacity-60 disabled:cursor-not-allowed flex items-center gap-1.5">
                {markReadyMutation.isPending ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle size={14} />}
                Pret a remettre
              </button>
              {canCommitPartial && (
                <button
                  onClick={() => commitPartialMutation.mutate()}
                  disabled={commitPartialMutation.isPending}
                  className="px-4 py-2 bg-orange-500 text-white rounded-lg text-sm font-semibold hover:bg-orange-600 transition-colors disabled:opacity-60 flex items-center gap-1.5">
                  {commitPartialMutation.isPending ? <Loader2 size={14} className="animate-spin" /> : <Package size={14} />}
                  Valider partiel
                </button>
              )}
            </div>
          )}
        </div>
      )}

      {/* Statut 'pret' : seul le chef qui a demande le BSI peut valider ou refuser.
          Les autres utilisateurs (y compris le magasinier qui vient de preparer, ou un autre chef
          du meme store) n'ont pas le droit de valider la reception pour eux. */}
      {bon.status === 'pret' && (() => {
        const requesterId = bon.generated_by as string | undefined;
        const isRequester = !!currentUserId && !!requesterId && currentUserId === requesterId;
        // canValidate : peuvent accepter la reception
        //  - le chef qui a genere le BSI (isRequester)
        //  - admin/manager en secours
        //  - tout chef de production (le BSI generator peut etre l'admin via "Restaurer",
        //    mais c'est l'equipe production cible qui recoit physiquement)
        // canValidate : peuvent accepter / refuser la reception. Action strictement
        // chef (workflow Option B). Le standalone page (variant='page') est la vue
        // magasinier — meme un admin/manager ne doit pas voir les boutons quand il
        // arrive depuis WarehousePage (sinon il accepte sa propre preparation).
        const canValidate = variant !== 'page' && isChef && (isRequester || ['admin', 'manager'].includes(user?.role || '') || ['baker', 'pastry_chef', 'viennoiserie', 'beldi_sale'].includes(user?.role || ''));
        const requesterName = (bon.generated_by_name as string) || 'le chef demandeur';
        return (
        <div className="bg-emerald-50 border border-emerald-300 rounded-xl p-4">
          <div className="flex items-start gap-3 mb-3">
            <div className="w-9 h-9 rounded-lg bg-emerald-100 flex items-center justify-center shrink-0">
              <CheckCircle size={18} className="text-emerald-600" />
            </div>
            <div className="flex-1">
              <p className="text-sm font-semibold text-emerald-900">Ingredients prets a recuperer</p>
              <p className="text-xs text-emerald-700 mt-0.5">
                {canValidate
                  ? 'Verifiez les quantites et la conformite, puis acceptez ou refusez la reception.'
                  : `En attente de la validation de ${requesterName}.`}
              </p>
            </div>
          </div>
          {canValidate && !rejectingOpen && (
            <div className="flex gap-2">
              <button
                onClick={() => startMutation.mutate()}
                disabled={startMutation.isPending}
                className="flex-1 px-4 py-2.5 bg-emerald-600 text-white rounded-lg text-sm font-semibold hover:bg-emerald-700 transition-colors disabled:opacity-60 flex items-center justify-center gap-1.5">
                {startMutation.isPending ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle size={14} />}
                Accepter la reception
              </button>
              <button
                onClick={() => setRejectingOpen(true)}
                className="px-4 py-2.5 bg-white border border-red-300 text-red-700 rounded-lg text-sm font-semibold hover:bg-red-50 transition-colors flex items-center gap-1.5">
                <XCircle size={14} />
                Refuser
              </button>
            </div>
          )}
          {canValidate && rejectingOpen && (
            <div className="space-y-2 bg-white border border-red-200 rounded-lg p-3">
              <label className="text-xs font-semibold text-red-800">Motif du refus (obligatoire)</label>
              <textarea
                value={rejectReason}
                onChange={(e) => setRejectReason(e.target.value)}
                autoFocus
                rows={2}
                placeholder="Ex: Quantite insuffisante sur la farine, lot mal identifie..."
                className="w-full text-sm border border-red-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-red-400 outline-none resize-none"
              />
              <div className="flex gap-2">
                <button
                  onClick={() => chefRejectMutation.mutate(rejectReason.trim())}
                  disabled={chefRejectMutation.isPending || !rejectReason.trim()}
                  className="flex-1 px-3 py-2 bg-red-600 text-white rounded-lg text-xs font-semibold hover:bg-red-700 transition-colors disabled:opacity-50">
                  {chefRejectMutation.isPending ? 'Envoi...' : 'Confirmer le refus'}
                </button>
                <button
                  onClick={() => { setRejectingOpen(false); setRejectReason(''); }}
                  className="px-3 py-2 bg-gray-100 text-gray-700 rounded-lg text-xs font-semibold hover:bg-gray-200 transition-colors">
                  Annuler
                </button>
              </div>
            </div>
          )}
        </div>
        );
      })()}

      {/* Option B : bandeau "Transferts Economat → Pesage requis".
          Visible uniquement par le magasinier. Tant qu'au moins une ligne attend un transfert,
          le BSI ne peut pas etre marque pret (le backend refuse). */}
      {!isClosed && transferRequiredLines.length > 0 && isMagasinier && (
        <div className="bg-amber-50 border-2 border-amber-300 rounded-xl p-3.5">
          <div className="flex items-start gap-3 mb-2">
            <div className="w-9 h-9 rounded-lg bg-amber-100 flex items-center justify-center shrink-0">
              <PackageOpen size={18} className="text-amber-700" />
            </div>
            <div className="flex-1">
              <p className="text-sm font-semibold text-amber-900">
                ⚠️ {transferRequiredLines.length} transfert{transferRequiredLines.length > 1 ? 's' : ''} Economat → Pesage requis
              </p>
              <p className="text-xs text-amber-800 mt-0.5">
                Ces ingredients sont disponibles en economat mais doivent etre transferes au pesage avant prelevement.
                Tu dois transferer toutes les lignes avant de marquer le BSI pret.
              </p>
            </div>
            <button
              onClick={transferAllRequired}
              disabled={transferringAll}
              className="px-3.5 py-2 bg-amber-600 text-white rounded-lg text-xs font-semibold hover:bg-amber-700 disabled:opacity-60 transition-colors flex items-center gap-1.5 shrink-0 shadow-sm"
            >
              {transferringAll ? <Loader2 size={13} className="animate-spin" /> : <PackageOpen size={13} />}
              {transferringAll ? 'Transfert...' : `Tout transferer (${transferRequiredLines.length})`}
            </button>
          </div>
          <ul className="text-xs text-amber-900 ml-12 space-y-0.5 mt-2">
            {transferRequiredLines.slice(0, 5).map((l, i) => {
              const qty = parseFloat(l.transfer_required_qty as string || l.needed_quantity as string || '0');
              return (
                <li key={i}>
                  <strong>{l.ingredient_name as string}</strong> :
                  <span className="font-mono"> {qty.toFixed(2)} {l.unit as string}</span>
                  {l.lot_number ? <span className="text-amber-700"> (lot {l.lot_number as string})</span> : null}
                </li>
              );
            })}
            {transferRequiredLines.length > 5 && <li className="italic">+ {transferRequiredLines.length - 5} autres...</li>}
          </ul>
        </div>
      )}

      {/* Bandeau info : ingredients a ouvrir depuis l'economat (stock dispo, pas encore au pesage)
          Visible uniquement par le magasinier — le chef ne gere pas la dispo (Option B).
          Note : ce bandeau est l'ancien chemin (status='rupture' + lot attache + allocated>=needed),
          conserve pour les BSI generes avant la migration 113. Les nouveaux BSI utilisent
          source_location='ECONOMAT_REQUIRES_TRANSFER' (bandeau ci-dessus). */}
      {!isClosed && toOpenLines.length > 0 && isMagasinier && (
        <div className="bg-blue-50 border border-blue-200 rounded-xl p-3 flex items-start gap-3">
          <div className="w-8 h-8 rounded-lg bg-blue-100 flex items-center justify-center shrink-0">
            <PackageOpen size={16} className="text-blue-600" />
          </div>
          <div className="flex-1">
            <p className="text-sm font-semibold text-blue-900">
              {toOpenLines.length} ingredient{toOpenLines.length > 1 ? 's' : ''} a ouvrir depuis l'economat
            </p>
            <p className="text-xs text-blue-700 mt-0.5">
              Stock disponible mais pas encore en pesage — ouvrir le contenant economat pour les prelever.
            </p>
          </div>
          {isMagasinier && (
            <button
              onClick={openAllContainers}
              disabled={openingAll}
              className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-semibold hover:bg-blue-700 disabled:opacity-60 transition-colors flex items-center gap-1.5 shrink-0 shadow-sm"
            >
              {openingAll ? <Loader2 size={14} className="animate-spin" /> : <PackageOpen size={14} />}
              {openingAll ? 'Ouverture...' : `Ouvrir tous (${toOpenLines.length})`}
            </button>
          )}
        </div>
      )}

      {/* Phase BSI partiel : bandeau alerte ruptures (vraies ruptures uniquement)
          Visible uniquement par le magasinier — le chef n'est pas notifie de la dispo (Option B).
          Le chef voit uniquement le statut du BSI (en preparation / pret). */}
      {!isClosed && hasRupture && isMagasinier && (
        <div className="bg-orange-50 border-2 border-orange-300 rounded-xl p-4">
          <div className="flex items-start gap-3 mb-2">
            <div className="w-9 h-9 rounded-lg bg-orange-100 flex items-center justify-center shrink-0">
              <AlertTriangle size={18} className="text-orange-600" />
            </div>
            <div className="flex-1">
              <p className="text-sm font-semibold text-orange-900">
                {ruptureLines.length} ingredient{ruptureLines.length > 1 ? 's' : ''} en rupture / partiel
              </p>
              <p className="text-xs text-orange-700 mt-0.5">
                Le stock est insuffisant pour ces ingredients. Tu peux prelever ce qui est dispo et valider en partiel — la production continuera apres reapprovisionnement.
              </p>
            </div>
            {/* Re-verifie la dispo apres reappro/transfert : re-run FEFO sur les ruptures.
                Utile quand le magasinier a transfere depuis l'economat ou ajoute du stock
                APRES la generation du BSI. Le statut du BSI (preparation / preparation_partielle)
                est conserve, seules les lignes en rupture sont re-allouees si possible. */}
            <button
              onClick={() => completePendingMutation.mutate()}
              disabled={completePendingMutation.isPending}
              className="px-3.5 py-2 bg-orange-600 text-white rounded-lg text-xs font-semibold hover:bg-orange-700 disabled:opacity-60 transition-colors flex items-center gap-1.5 shrink-0 shadow-sm"
              title="Re-verifie la dispo et re-alloue les lignes en rupture (apres transfert ou reappro)"
            >
              {completePendingMutation.isPending ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />}
              {completePendingMutation.isPending ? 'Verification...' : 'Re-verifier dispo'}
            </button>
          </div>
          <ul className="text-xs text-orange-800 ml-12 space-y-1.5 mt-2">
            {ruptureLines.slice(0, 5).map((l) => {
              const need = parseFloat(l.needed_quantity as string || '0');
              const avail = parseFloat(l.allocated_quantity as string || '0');
              const missing = need - avail;
              const lineId = l.id as string;
              const isCommanded = commandedLineIds.has(lineId);
              // EF-03 : ligne en rupture totale (pas de lot attache, allocated=0) → bouton "Commander"
              // qui ajoute a la liste d'attente du module Achat.
              const isFullRupture = !l.ingredient_lot_id && avail < 0.001 && !!l.ingredient_id;
              const isPending = commanderRuptureMutation.isPending && (commanderRuptureMutation.variables as any)?.line?.id === lineId;
              return (
                <li key={lineId} className="flex items-center justify-between gap-2 flex-wrap">
                  <span>
                    <strong>{l.ingredient_name as string}</strong> :
                    dispo <span className="font-mono">{avail.toFixed(2)} {l.unit as string}</span> /
                    besoin <span className="font-mono">{need.toFixed(2)} {l.unit as string}</span> →
                    <span className="text-red-700 font-semibold"> manque {missing.toFixed(2)}</span>
                  </span>
                  {isFullRupture && (
                    isCommanded ? (
                      <span className="px-2 py-1 bg-emerald-100 text-emerald-800 rounded-md text-[11px] font-semibold flex items-center gap-1 shrink-0">
                        <CheckCircle size={11} /> Commande envoyee
                      </span>
                    ) : (
                      <button
                        onClick={() => commanderRuptureMutation.mutate({ line: l })}
                        disabled={isPending}
                        className="px-2.5 py-1 bg-blue-600 text-white rounded-md text-[11px] font-semibold hover:bg-blue-700 disabled:opacity-60 transition-colors flex items-center gap-1 shrink-0 shadow-sm"
                        title={`Ajouter ${need.toFixed(2)} ${l.unit as string} a la liste d'attente d'achat`}
                      >
                        {isPending ? <Loader2 size={11} className="animate-spin" /> : <ShoppingCart size={11} />}
                        Commander
                      </button>
                    )
                  )}
                </li>
              );
            })}
            {ruptureLines.length > 5 && <li className="italic">+ {ruptureLines.length - 5} autres ingredients...</li>}
          </ul>
        </div>
      )}

      {/* Phase BSI partiel : bandeau "preparation partielle" pour reprendre apres reappro
          Visible uniquement par le magasinier — c'est lui qui gere la reprise post-reappro. */}
      {isPartial && isMagasinier && (
        <div className="bg-blue-50 border-2 border-blue-300 rounded-xl p-4">
          <div className="flex items-start gap-3 mb-3">
            <div className="w-9 h-9 rounded-lg bg-blue-100 flex items-center justify-center shrink-0">
              <Package size={18} className="text-blue-600" />
            </div>
            <div className="flex-1">
              <p className="text-sm font-semibold text-blue-900">BSI en preparation partielle</p>
              <p className="text-xs text-blue-700 mt-0.5">
                Une partie a ete prelevee. Reste {ruptureLines.length} ingredient{ruptureLines.length > 1 ? 's' : ''} en attente d'approvisionnement.
              </p>
            </div>
          </div>
          {isMagasinier && (
            <button
              onClick={() => completePendingMutation.mutate()}
              disabled={completePendingMutation.isPending}
              className="w-full px-4 py-2.5 bg-blue-600 text-white rounded-lg text-sm font-semibold hover:bg-blue-700 transition-colors disabled:opacity-60 flex items-center justify-center gap-2">
              {completePendingMutation.isPending ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle size={14} />}
              Reprendre la preparation (re-allouer apres reappro)
            </button>
          )}
        </div>
      )}

      {/* Progress bar */}
      {!isClosed && (
        <div className="bg-white rounded-xl border border-gray-100 p-4">
          <div className="flex justify-between items-center mb-2">
            <span className="text-sm font-medium text-gray-700">
              {prelevees} / {totalLines} ingredients preleves
            </span>
            <span className={`text-sm font-bold ${allDone ? 'text-emerald-600' : 'text-amber-600'}`}>
              {progressPct}%
            </span>
          </div>
          <div className="h-3 bg-gray-100 rounded-full overflow-hidden">
            <div
              className={`h-full rounded-full transition-all duration-500 ${allDone ? 'bg-emerald-500' : 'bg-gradient-to-r from-amber-400 to-amber-500'}`}
              style={{ width: `${progressPct}%` }}
            />
          </div>
        </div>
      )}

      {/* Quick action: Tout conforme.
          Visible uniquement si :
          - magasinier (les chefs ne pesent pas)
          - BSI en preparation OU preparation_partielle (a pris en charge)
          - aucune ligne en attente de transfert Economat → Pesage
          Bloque le clic avant que le magasinier ait reellement transfere les ingredients
          (sinon il valide des lignes qu'il n'a pas encore physiquement pesees). */}
      {!isClosed && !isVerified && nonBloquees.length > 0 && isMagasinier
        && ['preparation', 'preparation_partielle'].includes(bon.status as string)
        && transferRequiredLines.length === 0 && (
        <button
          onClick={confirmAllLines}
          disabled={confirmingAll}
          className="w-full py-3.5 bg-gradient-to-r from-emerald-500 to-emerald-600 text-white rounded-xl font-semibold shadow-md hover:shadow-lg transition-all flex items-center justify-center gap-2 text-sm active:scale-[0.98]"
        >
          {confirmingAll ? (
            <Loader2 size={18} className="animate-spin" />
          ) : (
            <CheckCircle size={18} />
          )}
          Tout conforme ({nonBloquees.length} ligne{nonBloquees.length > 1 ? 's' : ''})
        </button>
      )}

      {/* Lines list */}
      <div className="space-y-2">
        {lines.map((line) => {
          const lineStatus = line.status as string;
          const allocated = parseFloat(line.allocated_quantity as string || '0');
          const needed = parseFloat(line.needed_quantity as string || '0');
          const actual = line.actual_quantity != null ? parseFloat(line.actual_quantity as string) : null;
          const unit = line.ingredient_unit as string || line.unit as string || 'kg';
          const lotExpired = line.lot_expired || line.lot_status === 'expired';
          const isDone = ['preleve', 'substitue'].includes(lineStatus);
          const isEditing = editingLine === (line.id as string);
          const hasEcart = lineStatus === 'ecart';
          // Option B : pour le chef, on masque l'etat allocated (qui peut etre 0 si transfert
          // requis non encore effectue par le magasinier). On affiche la qty demandee.
          // Pour le magasinier sur une ligne ECONOMAT_REQUIRES_TRANSFER, on affiche la qty
          // a transferer (transfer_required_qty) plutot que allocated=0.
          const transferRequiredQty = parseFloat(line.transfer_required_qty as string || '0');
          const isTransferRequired = line.source_location === 'ECONOMAT_REQUIRES_TRANSFER';
          const displayedQty = isMagasinier
            ? (isTransferRequired ? transferRequiredQty : allocated)
            : (allocated > 0 ? allocated : needed);

          return (
            <div
              key={line.id as string}
              className={`bg-white rounded-xl border p-3.5 transition-all ${
                isDone ? 'border-emerald-200 bg-emerald-50/30' :
                hasEcart ? 'border-amber-200 bg-amber-50/30' :
                lotExpired ? 'border-red-200 bg-red-50/20 opacity-60' :
                'border-gray-100'
              }`}
            >
              <div className="flex items-center gap-3">
                <div className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 ${
                  isDone ? 'bg-emerald-500 text-white' :
                  hasEcart ? 'bg-amber-500 text-white' :
                  lotExpired ? 'bg-red-100 text-red-400' :
                  'bg-gray-100 text-gray-400'
                }`}>
                  {isDone ? <Check size={16} /> :
                   hasEcart ? <AlertTriangle size={14} /> :
                   lotExpired ? <AlertTriangle size={14} /> :
                   <Package size={14} />}
                </div>

                <div className="flex-1 min-w-0">
                  <p className={`text-sm font-medium truncate ${isDone ? 'text-emerald-800' : 'text-gray-800'}`}>
                    {line.ingredient_name as string}
                  </p>
                  <p className="text-xs text-gray-400">
                    {displayedQty.toFixed(2)} {unit}
                    {isMagasinier && actual !== null && actual !== allocated && (
                      <span className="text-amber-600 font-medium ml-1">&rarr; {actual.toFixed(2)}</span>
                    )}
                    {isMagasinier && lotExpired && <span className="text-red-500 font-bold ml-1">Lot expire</span>}
                  </p>
                </div>

                {/* Boutons "Modifier qty" / "Confirmer" : magasinier seul, et uniquement
                    quand le BSI est pris en charge (preparation/preparation_partielle).
                    Caches aussi sur les lignes en attente de transfert (allocated=0 → confirmer
                    n'a pas de sens tant que le magasinier n'a pas transfere). */}
                {!isClosed && !isVerified && lineStatus === 'en_attente' && !lotExpired && !isEditing && !isTransferRequired
                  && isMagasinier
                  && ['preparation', 'preparation_partielle'].includes(bon.status as string) && (
                  <div className="flex items-center gap-1.5 shrink-0">
                    <button
                      onClick={() => { setEditingLine(line.id as string); setEditValue(allocated.toFixed(2)); }}
                      className="p-2 text-gray-400 hover:text-amber-600 hover:bg-amber-50 rounded-lg transition-colors"
                      title="Modifier la quantite"
                    >
                      <Edit3 size={16} />
                    </button>
                    <button
                      onClick={() => confirmLine(line)}
                      disabled={ligneMutation.isPending}
                      className="p-2 bg-emerald-500 text-white rounded-lg hover:bg-emerald-600 transition-colors active:scale-95"
                      title="Confirmer"
                    >
                      <Check size={16} />
                    </button>
                  </div>
                )}

                {/* Option B : ligne en attente de transfert Economat -> Pesage. Magasinier seul. */}
                {!isClosed && !isVerified && line.source_location === 'ECONOMAT_REQUIRES_TRANSFER' && isMagasinier && (
                  <button
                    onClick={() => transferLineMutation.mutate(line.id as string)}
                    disabled={transferLineMutation.isPending}
                    className="px-2.5 py-1.5 bg-amber-600 text-white rounded-lg hover:bg-amber-700 disabled:opacity-60 transition-colors flex items-center gap-1 text-xs font-semibold shrink-0 shadow-sm"
                    title="Transferer depuis Economat vers Pesage"
                  >
                    {transferLineMutation.isPending ? <Loader2 size={12} className="animate-spin" /> : <PackageOpen size={12} />}
                    Transferer
                  </button>
                )}

                {/* Ligne 'a ouvrir depuis economat' (status=rupture, lot attache, allocated>=needed) :
                    1 clic pour ouvrir le contenant + marquer prelevee.
                    Chemin legacy pour BSI generes avant migration 113. */}
                {!isClosed && !isVerified && lineStatus === 'rupture' && !!line.ingredient_lot_id && allocated >= parseFloat(line.needed_quantity as string || '0') && allocated > 0 && isMagasinier && (
                  <button
                    onClick={() => openAndPickMutation.mutate({ line })}
                    disabled={openAndPickMutation.isPending}
                    className="px-2.5 py-1.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-60 transition-colors flex items-center gap-1 text-xs font-semibold shrink-0 shadow-sm"
                    title="Ouvrir le contenant economat et prelever"
                  >
                    {openAndPickMutation.isPending ? <Loader2 size={12} className="animate-spin" /> : <PackageOpen size={12} />}
                    Ouvrir & prelever
                  </button>
                )}

                {isDone && (
                  <span className="text-emerald-500 shrink-0">
                    <CheckCircle size={20} />
                  </span>
                )}
              </div>

              {isEditing && (
                <div className="mt-2.5 flex items-center gap-2 pl-11">
                  <input
                    type="number" step="0.01" min="0"
                    value={editValue}
                    onChange={(e) => setEditValue(e.target.value)}
                    autoFocus
                    className="w-28 text-sm border border-amber-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-amber-400 outline-none text-right"
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        const val = parseFloat(editValue);
                        if (!isNaN(val)) ligneMutation.mutate({ ligneId: line.id as string, actualQuantity: val });
                      }
                      if (e.key === 'Escape') setEditingLine(null);
                    }}
                  />
                  <span className="text-xs text-gray-400">{unit}</span>
                  <button
                    onClick={() => {
                      const val = parseFloat(editValue);
                      if (!isNaN(val)) ligneMutation.mutate({ ligneId: line.id as string, actualQuantity: val });
                    }}
                    className="px-3 py-2 bg-amber-500 text-white rounded-lg text-xs font-medium hover:bg-amber-600 transition-colors"
                  >
                    OK
                  </button>
                  <button
                    onClick={() => setEditingLine(null)}
                    className="px-3 py-2 bg-gray-100 text-gray-600 rounded-lg text-xs font-medium hover:bg-gray-200 transition-colors"
                  >
                    Annuler
                  </button>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Bouton "Valider le bon de sortie" : visible UNIQUEMENT une fois que le chef
          a accepte la reception (statut 'prelevement' ou 'verifie'). Avant cette etape,
          le chef doit passer par le bouton "Accepter la reception" du bloc 'pret' ci-dessus,
          qui bascule le BSI en 'prelevement'. Sinon close() echoue avec "statut invalide". */}
      {!isClosed && allDone && isChef && (bon.status === 'prelevement' || bon.status === 'verifie') && (
        <button
          onClick={isVerified ? () => closeMutation.mutate() : validateBon}
          disabled={validating || closeMutation.isPending}
          className="w-full py-3.5 bg-gradient-to-r from-blue-600 to-indigo-600 text-white rounded-xl font-bold shadow-md hover:shadow-lg transition-all flex items-center justify-center gap-2 text-sm active:scale-[0.98]"
        >
          {(validating || closeMutation.isPending) ? (
            <Loader2 size={18} className="animate-spin" />
          ) : (
            <CheckCircle size={18} />
          )}
          Valider le bon de sortie
        </button>
      )}

      {/* Closed confirmation */}
      {isClosed && (
        <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-4 text-center">
          <CheckCircle size={28} className="text-emerald-500 mx-auto mb-1.5" />
          <p className="text-emerald-800 font-semibold text-sm">Ingredients livres</p>
          <p className="text-xs text-emerald-600 mt-0.5">La production peut demarrer</p>
        </div>
      )}

      {/* Details toggle */}
      <button
        onClick={() => setShowDetails(!showDetails)}
        className="w-full flex items-center justify-center gap-1.5 py-2 text-xs text-gray-400 hover:text-gray-600 transition-colors"
      >
        {showDetails ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
        {showDetails ? 'Masquer les details' : 'Voir les details'}
      </button>

      {showDetails && (
        <div className="bg-gray-50 rounded-xl border border-gray-100 p-4 space-y-3">
          <div className="space-y-1 text-xs text-gray-500">
            {bon.generated_at && <p>Genere le {format(new Date(bon.generated_at as string), 'dd/MM/yyyy a HH:mm')}{bon.generated_by_name ? ` par ${bon.generated_by_name as string}` : ''}</p>}
            {bon.prelevement_at && <p>Prelevement le {format(new Date(bon.prelevement_at as string), 'dd/MM/yyyy a HH:mm')}{bon.prelevement_by_name ? ` par ${bon.prelevement_by_name as string}` : ''}</p>}
            {bon.verified_at && <p>Verifie le {format(new Date(bon.verified_at as string), 'dd/MM/yyyy a HH:mm')}{bon.verified_by_name ? ` par ${bon.verified_by_name as string}` : ''}</p>}
            {bon.closed_at && <p>Cloture le {format(new Date(bon.closed_at as string), 'dd/MM/yyyy a HH:mm')}{bon.closed_by_name ? ` par ${bon.closed_by_name as string}` : ''}</p>}
          </div>
          {['genere', 'prelevement'].includes(bon.status as string) && isChef && (
            <button onClick={() => regenerateMutation.mutate()} disabled={regenerateMutation.isPending}
              className="px-4 py-2 bg-white border border-gray-200 text-gray-500 rounded-lg text-xs font-medium hover:bg-gray-50 transition flex items-center gap-1.5">
              <RefreshCw size={13} /> Regenerer le bon
            </button>
          )}
        </div>
      )}
    </div>
  );
}
