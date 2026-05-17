import { useState, useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { bonSortieApi } from '../../api/bon-sortie.api';
import { useAuth } from '../../context/AuthContext';
import {
  Loader2, CheckCircle, AlertTriangle, Package, PackageOpen, Check, XCircle,
  RefreshCw, ChevronDown, ChevronUp, Edit3, Truck, ShoppingCart, ArrowRightCircle,
} from 'lucide-react';
import { format } from 'date-fns';
import { notify } from '../../components/ui/InlineNotification';
import { smartFormatQuantity } from '../../utils/units';

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

  const bon = (bons as Record<string, any>[]).find((b: Record<string, any>) => b.status !== 'annule') as Record<string, any> | undefined;
  const lines = (bon?.lines || []) as Record<string, any>[];

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

  // Note : la commande fournisseur sur une ligne en rupture totale s'effectue
  // desormais depuis le module Economat (onglet "Ingredients a commander"),
  // pas depuis ce panneau. Le bandeau ruptures plus bas redirige le magasinier.

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
  // Les lignes annulees (status='annule') ne participent plus au BSI : exclues du total.
  const activeLines = lines.filter((l) => l.status !== 'annule');
  const totalLines = activeLines.length;
  const prelevees = activeLines.filter((l) => ['preleve', 'substitue'].includes(l.status as string)).length;
  const enAttente = activeLines.filter((l) => ['en_attente', 'rupture'].includes(l.status as string)).length;
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
  // Les lignes ECONOMAT_REQUIRES_TRANSFER sont affichees dans la section "transferts requis"
  // (stock dispo en economat, juste a transferer) — elles ne sont pas en rupture.
  // Les lignes annulees (status='annule') sont exclues : elles ne participent plus au BSI.
  const ruptureLines = lines.filter((l) =>
    l.status !== 'annule'
    && l.source_location !== 'ECONOMAT_REQUIRES_TRANSFER'
    && (
      parseFloat(l.allocated_quantity as string || '0') < parseFloat(l.needed_quantity as string || '0')
      || (l.status === 'rupture' && !l.ingredient_lot_id)
    )
  );
  // Option B : lignes en attente de transfert Economat → Pesage.
  // Le transfert se fait DEPUIS le module Economat (onglet "Transferts demandes" de InventoryPage),
  // pas depuis ce panneau. Ici on affiche uniquement un bandeau informatif.
  const transferRequiredLines = lines.filter((l) => l.source_location === 'ECONOMAT_REQUIRES_TRANSFER');
  const hasRupture = ruptureLines.length > 0;
  const isPartial = bon?.status === 'preparation_partielle';
  // Permet le commit partiel si :
  //  - vraies ruptures (stock manquant) avec au moins une ligne prelevee, OU
  //  - transferts economat encore non effectues avec au moins une ligne prelevee.
  // Cas 2 : le magasinier valide ce qui est deja transfere/pese et garde les autres
  // en attente. Il fera le transfert depuis le module Economat puis "Re-verifier dispo".
  const canCommitPartial = bon?.status === 'preparation'
    && (hasRupture || transferRequiredLines.length > 0)
    && prelevees > 0;

  const confirmLine = (line: Record<string, any>) => {
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
      {/* En-tete compact (la banniere globale est rendue dans PlanDetailPage) */}
      {variant === 'inline' && (
        <div className="odoo-section-header" style={{ borderRadius: 4, border: '1px solid var(--theme-bg-separator)' }}>
          <Truck size={12} /> Bon de sortie
          <span style={{ marginLeft: 4, fontFamily: 'monospace', color: 'var(--theme-text-muted)', fontWeight: 400 }}>{bon.numero as string}</span>
          {isClosed && (
            <span className="odoo-tag odoo-tag-green" style={{ marginLeft: 'auto' }}>
              <CheckCircle size={10} /> Clôturé
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
                  transferRequiredLines.length > 0 ? `${transferRequiredLines.length} transfert(s) economat en attente — effectuez-les depuis le module Economat ou utilisez "Valider partiel"` :
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
                onClick={() => validateBon()}
                disabled={validating || startMutation.isPending}
                className="flex-1 px-4 py-2.5 bg-emerald-600 text-white rounded-lg text-sm font-semibold hover:bg-emerald-700 transition-colors disabled:opacity-60 flex items-center justify-center gap-1.5">
                {(validating || startMutation.isPending) ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle size={14} />}
                Accepter et valider la reception
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

      {/* Bandeau informatif : transferts Economat -> Pesage en attente.
          Le transfert ne se fait PLUS depuis ce panneau : le magasinier doit aller dans
          le module Economat (onglet "Transferts demandes") pour selectionner le lot et
          realiser le transfert, ou commander l'ingredient en rupture. */}
      {!isClosed && transferRequiredLines.length > 0 && isMagasinier && (
        <div className="bg-amber-50 border-2 border-amber-300 rounded-xl p-3.5">
          <div className="flex items-start gap-3 mb-2">
            <div className="w-9 h-9 rounded-lg bg-amber-100 flex items-center justify-center shrink-0">
              <ArrowRightCircle size={18} className="text-amber-700" />
            </div>
            <div className="flex-1">
              <p className="text-sm font-semibold text-amber-900">
                {transferRequiredLines.length} ingredient{transferRequiredLines.length > 1 ? 's' : ''} disponible{transferRequiredLines.length > 1 ? 's' : ''} en economat
              </p>
              <p className="text-xs text-amber-800 mt-0.5">
                Le stock existe en economat mais n'a pas encore ete transfere au pesage.
                Effectue le transfert depuis le module Economat (selection du lot FEFO), puis reviens ici pour finaliser le prelevement.
              </p>
            </div>
            <Link
              to="/inventory?tab=transfers"
              className="px-3.5 py-2 bg-amber-600 text-white rounded-lg text-xs font-semibold hover:bg-amber-700 transition-colors flex items-center gap-1.5 shrink-0 shadow-sm"
            >
              <ArrowRightCircle size={13} />
              Voir dans Economat
            </Link>
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

      {/* Bandeau alerte ruptures (vraies ruptures uniquement). Visible uniquement par
          le magasinier. La commande fournisseur ne se fait PLUS depuis ce panneau :
          le magasinier va dans le module Economat (onglet "Ingredients a commander")
          pour declencher la commande de maniere centralisee.
          Ici on garde le bouton "Re-verifier dispo" pour re-allouer apres reappro/transfert. */}
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
                Le stock est insuffisant pour ces ingredients. Declenche la commande fournisseur depuis le module Economat, puis "Re-verifier dispo" ici. Tu peux aussi prelever ce qui est dispo et valider en partiel.
              </p>
            </div>
            <div className="flex flex-col gap-1.5 shrink-0">
              <Link
                to="/inventory?tab=ruptures"
                className="px-3.5 py-2 bg-blue-600 text-white rounded-lg text-xs font-semibold hover:bg-blue-700 transition-colors flex items-center gap-1.5 shadow-sm"
              >
                <ShoppingCart size={13} />
                Voir dans Economat
              </Link>
              {/* Re-verifie la dispo apres reappro/transfert : re-run FEFO sur les ruptures.
                  Utile quand le magasinier a transfere depuis l'economat ou ajoute du stock
                  APRES la generation du BSI. */}
              <button
                onClick={() => completePendingMutation.mutate()}
                disabled={completePendingMutation.isPending}
                className="px-3.5 py-2 bg-orange-600 text-white rounded-lg text-xs font-semibold hover:bg-orange-700 disabled:opacity-60 transition-colors flex items-center gap-1.5 shadow-sm"
                title="Re-verifie la dispo et re-alloue les lignes en rupture (apres transfert ou reappro)"
              >
                {completePendingMutation.isPending ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />}
                {completePendingMutation.isPending ? 'Verification...' : 'Re-verifier dispo'}
              </button>
            </div>
          </div>
          <ul className="text-xs text-orange-800 ml-12 space-y-1.5 mt-2">
            {ruptureLines.slice(0, 5).map((l) => {
              const need = parseFloat(l.needed_quantity as string || '0');
              const avail = parseFloat(l.allocated_quantity as string || '0');
              const missing = need - avail;
              return (
                <li key={l.id as string}>
                  <strong>{l.ingredient_name as string}</strong> :
                  dispo <span className="font-mono">{avail.toFixed(2)} {l.unit as string}</span> /
                  besoin <span className="font-mono">{need.toFixed(2)} {l.unit as string}</span> →
                  <span className="text-red-700 font-semibold"> manque {missing.toFixed(2)}</span>
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

      {/* Lines list — table-like layout (header strip + rows) */}
      <div className="odoo-section">
        <div style={{
          display: 'grid',
          gridTemplateColumns: isMagasinier ? '24px 1fr auto auto auto' : '24px 1fr auto auto',
          gap: '0.625rem',
          padding: '0.5rem 0.75rem',
          backgroundColor: 'var(--theme-bg-page)',
          borderBottom: '1px solid var(--theme-bg-separator)',
          fontSize: '0.6875rem',
          fontWeight: 600,
          color: 'var(--theme-text-muted)',
          textTransform: 'uppercase',
          letterSpacing: '0.03em',
        }}>
          <span />
          <span>Ingrédient</span>
          <span style={{ textAlign: 'right' }}>Quantité</span>
          {isMagasinier && <span style={{ textAlign: 'right' }}>Source</span>}
          <span style={{ textAlign: 'right' }}>Statut</span>
        </div>
        {(() => {
          // Pour le chef : on agrege par ingredient (un sac de farine peut etre
          // pris sur plusieurs lots → le chef veut juste voir le total commande).
          // Le magasinier garde le detail par lot pour faire le prelevement.
          if (isMagasinier) return lines;
          const byIngredient = new Map<string, Record<string, any>>();
          for (const l of lines) {
            if (l.status === 'annule') continue;
            const key = l.ingredient_id as string;
            const existing = byIngredient.get(key);
            const needed = parseFloat(l.needed_quantity as string || '0');
            const allocated = parseFloat(l.allocated_quantity as string || '0');
            const isRupture = (l.status === 'rupture' && !l.ingredient_lot_id)
              || allocated < needed
              || l.source_location === 'RUPTURE';
            if (!existing) {
              byIngredient.set(key, {
                ...l,
                needed_quantity: needed,
                allocated_quantity: allocated,
                actual_quantity: null,
                lot_number: null,
                ingredient_lot_id: null,
                source_location: isRupture ? 'RUPTURE' : null,
                status: isRupture ? 'rupture' : 'en_attente',
                _isRupture: isRupture,
              });
            } else {
              existing.needed_quantity = parseFloat(existing.needed_quantity) + needed;
              existing.allocated_quantity = parseFloat(existing.allocated_quantity) + allocated;
              if (isRupture) {
                existing._isRupture = true;
                existing.status = 'rupture';
                existing.source_location = 'RUPTURE';
              }
            }
          }
          return Array.from(byIngredient.values());
        })().map((line) => {
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

          // Source du stock : badge visuel pour aider le magasinier a savoir ou recuperer l'ingredient.
          //  - PESAGE : sac deja ouvert dans la zone pesage (rien a faire de special)
          //  - ECONOMAT_REQUIRES_TRANSFER : besoin de transferer un contenant scelle de l'economat vers le pesage
          //  - rupture avec lot attache : contenant economat dispo mais a ouvrir
          //  - RUPTURE : aucun stock
          const sourceLocation = line.source_location as string | undefined;
          const isToOpenFromEconomat = lineStatus === 'rupture' && !!line.ingredient_lot_id && allocated >= needed && allocated > 0;
          const sourceBadge = isTransferRequired
            ? { label: 'Économat — à transférer', cls: 'bg-amber-50 text-amber-800 border-amber-200', Icon: PackageOpen }
            : isToOpenFromEconomat
            ? { label: 'Économat — à ouvrir', cls: 'bg-blue-50 text-blue-800 border-blue-200', Icon: PackageOpen }
            : sourceLocation === 'PESAGE'
            ? { label: 'Pesage', cls: 'bg-emerald-50 text-emerald-800 border-emerald-200', Icon: Package }
            : sourceLocation === 'RUPTURE' || lineStatus === 'rupture'
            ? { label: 'Rupture', cls: 'bg-red-50 text-red-700 border-red-200', Icon: AlertTriangle }
            : null;

          const rowDot = isDone ? 'ok'
            : hasEcart ? 'warning'
            : lotExpired ? 'danger'
            : 'neutral';

          // Delta v1 point 5 : indicateur visuel par ligne, terminologie spec :
          //   Pret       — ingredient pese et prepare (preleve / substitue / ecart)
          //   En transfert — absent du pesage, present en economat (transfert pas fait)
          //   En commande  — absent du pesage ET de l'economat (rupture, achat necessaire)
          //   En attente   — pesage dispo mais pas encore confirme par le magasinier
          const lineSpecStatus: { label: string; cls: string; Icon: typeof CheckCircle } | null = isDone
            ? { label: 'Pret', cls: 'odoo-tag-green', Icon: CheckCircle }
            : isTransferRequired
            ? { label: 'En transfert', cls: 'odoo-tag-orange', Icon: ArrowRightCircle }
            : (lineStatus === 'rupture' && !line.ingredient_lot_id)
            ? { label: 'En commande', cls: 'odoo-tag-red', Icon: AlertTriangle }
            : null;
          return (
            <div
              key={line.id as string}
              style={{
                padding: '0.5rem 0.75rem',
                borderBottom: '1px solid var(--theme-bg-separator)',
                backgroundColor: 'var(--theme-bg-card)',
                fontSize: '0.8125rem',
                opacity: lotExpired ? 0.6 : 1,
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.625rem' }}>
                <span className={`odoo-status-dot ${rowDot}`} />

                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
                    <span style={{ fontSize: '0.8125rem', fontWeight: 400, color: 'var(--theme-text-strong)' }}>
                      {line.ingredient_name as string}
                    </span>
                    <span style={{ fontSize: '0.8125rem', color: 'var(--theme-text-muted)' }}>
                      {(() => {
                        const f = smartFormatQuantity(displayedQty, unit);
                        const d = f.unit === 'g' || f.unit === 'ml' ? 0 : 2;
                        return <>
                          <strong style={{ color: 'var(--theme-text-strong)', fontWeight: 600 }}>{f.value.toFixed(d)}</strong>
                          <span style={{ fontSize: '0.6875rem', marginLeft: 2 }}>{f.unit}</span>
                        </>;
                      })()}
                      {isMagasinier && actual !== null && actual !== allocated && (() => {
                        const af = smartFormatQuantity(actual, unit);
                        const d = af.unit === 'g' || af.unit === 'ml' ? 0 : 2;
                        return <span style={{ color: '#b85d1a', fontWeight: 600, marginLeft: 4 }}>&rarr; {af.value.toFixed(d)} {af.unit}</span>;
                      })()}
                    </span>
                    {isMagasinier && lotExpired && <span className="odoo-tag odoo-tag-red">Lot expiré</span>}
                    {sourceBadge && !isDone && isMagasinier && (
                      <span className={`odoo-tag ${
                        isTransferRequired ? 'odoo-tag-yellow'
                        : isToOpenFromEconomat ? 'odoo-tag-blue'
                        : sourceLocation === 'PESAGE' ? 'odoo-tag-green'
                        : 'odoo-tag-red'
                      }`}>
                        <sourceBadge.Icon size={10} />
                        {sourceBadge.label}
                        {isToOpenFromEconomat && line.lot_number && (
                          <span style={{ fontFamily: 'monospace', opacity: 0.7 }}>· {line.lot_number as string}</span>
                        )}
                      </span>
                    )}
                  </div>
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

                {/* Delta v1 point 5 : indicateur visuel par ligne (3 etats spec). */}
                {lineSpecStatus && (
                  <span
                    className={`odoo-tag ${lineSpecStatus.cls} shrink-0`}
                    title={
                      lineSpecStatus.label === 'En transfert'
                        ? 'Effectue le transfert depuis le module Economat (onglet Transferts demandes)'
                        : lineSpecStatus.label === 'En commande'
                        ? 'Ingredient absent du pesage ET de l\'economat — commande fournisseur necessaire'
                        : 'Ingredient pese et pret'
                    }
                  >
                    <lineSpecStatus.Icon size={12} />
                    {lineSpecStatus.label}
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
      {!isClosed && isChef && (bon.status === 'prelevement' || bon.status === 'verifie') && (allDone || !isMagasinier) && (
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
