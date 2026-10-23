import { useState } from 'react';
import { Link } from 'react-router-dom';
import { BON_SORTIE_STATUS_LABELS } from '@ofauria/shared';
import { apiErrorMessage } from '../../api/errors';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Loader2, Package, PackageOpen, AlertTriangle, X, CalendarClock, ShoppingCart, CheckCircle } from 'lucide-react';
import { format } from 'date-fns';
import { fr } from 'date-fns/locale';
import { bonSortieApi } from '../../api/bon-sortie.api';
import { referentielApi } from '../../api/referentiel.api';
import { purchaseRequestsApi } from '../../api/purchase-requests.api';
import { notify } from '../../components/ui/InlineNotification';
import { useConfirm } from '../../components/ui/ConfirmDialog';

type TransferModalPayload = {
  ligneId: string;
  ingredientName: string;
  unit: string;
  requiredQty: number;
  economatAvailable: number;
  lotNumber?: string;
  lotDlc?: string;
  bonNumero: string;
  // Contenant par defaut de l'ingredient : pilote la saisie par contenant (ex Seau de 5 kg).
  containerSize?: number;
  containerTypeId?: string;
  containerTypeLabel?: string;
};

/**
 * Liste auto-portee des contenants a ouvrir (scelle -> entame) pour les bons en cours.
 * Utilisable telle quelle dans n'importe quelle page (Pesage / Economat / Dashboard).
 * Inclut son propre fetching, sa mutation de transfert + le bouton "Tout transferer".
 *
 * Variant 'transfers-tab' = vue dediee onglet (avec bandeau intro). 'compact' = sans bandeau.
 */
export function TransferRequestsList({ variant = 'transfers-tab' }: { variant?: 'transfers-tab' | 'compact' }) {
  const queryClient = useQueryClient();
  const confirm = useConfirm();
  const [transferringAll, setTransferringAll] = useState(false);
  // Modale de confirmation : permet au magasinier d'ajuster qty + saisir une note avant transfert.
  // Reproduit le geste existant du module Economat (OpenContainerModal).
  const [modalPayload, setModalPayload] = useState<TransferModalPayload | null>(null);

  const { data: rows = [], isLoading, error, isError } = useQuery<Record<string, any>[]>({
    queryKey: ['warehouse-transfer-requests'],
    queryFn: bonSortieApi.transferRequests,
    refetchInterval: 20000,
    retry: 1,
  });

  // Apres transfert, on rafraichit aussi la liste des BSI et le stock pesage / economat
  // pour que toutes les vues qui dependent de ces donnees voient l'etat a jour.
  const invalidateAll = () => {
    queryClient.invalidateQueries({ queryKey: ['warehouse-transfer-requests'] });
    queryClient.invalidateQueries({ queryKey: ['warehouse-queue'] });
    queryClient.invalidateQueries({ queryKey: ['warehouse-pesage-stock'] });
    queryClient.invalidateQueries({ queryKey: ['inventory'] });
    queryClient.invalidateQueries({ queryKey: ['bons-sortie'] });
  };

  const transferLineMutation = useMutation({
    mutationFn: (vars: { ligneId: string; overrideQty?: number; overrideLotId?: string; reason?: string; containerTypeId?: string; containerCount?: number }) =>
      bonSortieApi.transferLineFromEconomat(vars.ligneId, {
        overrideQty: vars.overrideQty,
        overrideLotId: vars.overrideLotId,
        reason: vars.reason,
        containerTypeId: vars.containerTypeId,
        containerCount: vars.containerCount,
      }),
    onSuccess: () => {
      invalidateAll();
      setModalPayload(null);
      notify.success('Transfert Economat → Pesage effectue');
    },
    onError: (e: any) => notify.error(apiErrorMessage(e, 'Erreur transfert')),
  });

  // Commande du manquant : quand l'economat ne couvre pas le besoin de la ligne, le
  // transfert est refuse cote serveur (une ligne BSI doit etre integralement couverte).
  // Sans cette action l'ecran est un cul-de-sac : le magasinier commande ici le seul
  // delta manquant, comme il le ferait depuis l'onglet "Ingredients a commander".
  const [orderedLineIds, setOrderedLineIds] = useState<Set<string>>(new Set());
  const commanderMutation = useMutation({
    mutationFn: ({ line, missing }: { line: Record<string, any>; missing: number }) =>
      purchaseRequestsApi.create({
        ingredientId: line.ingredient_id as string,
        quantity: missing,
        unit: (line.unit || line.ingredient_unit || 'kg') as string,
        reason: 'production',
        note: `BSI ${line.bon_numero || ''} — manquant transfert economat`,
        supplierId: null,
      }),
    onSuccess: (_d, vars) => {
      setOrderedLineIds(prev => new Set(prev).add(vars.line.line_id as string));
      invalidateAll();
      queryClient.invalidateQueries({ queryKey: ['purchase-requests'] });
      queryClient.invalidateQueries({ queryKey: ['purchase-requests-grouped'] });
      notify.success('Demande d\'achat créée pour le manquant (Stock › À commander)');
    },
    onError: (e: any) => notify.error(e?.response?.data?.error?.message || apiErrorMessage(e, 'Demande d\'achat impossible')),
  });

  // "Tout transferer" : raccourci batch qui transfere chaque ligne avec la qty exacte
  // demandee par le BSI (pas de modale, pas d'ajustement). Pour un transfert avec qty
  // ajustee, l'utilisateur clique "Transferer" sur chaque ligne et passe par la modale.
  const transferAll = async () => {
    // Seules les lignes que l'economat couvre : les autres echoueraient a coup sur.
    const coverable = rows.filter(r => {
      const qty = parseFloat(r.transfer_required_qty as string || '0');
      const avail = r.economat_available_total != null ? parseFloat(r.economat_available_total as string) : parseFloat(r.suggested_lot_economat_qty as string || '0');
      return avail + 1e-9 >= qty;
    });
    if (coverable.length === 0) { notify.error('Aucune ligne couverte par l\'économat'); return; }
    const ok = await confirm(
      `Ouvrir ${coverable.length} contenant${coverable.length > 1 ? 's' : ''} avec la quantité exacte demandée par les bons ?` +
      (coverable.length < rows.length ? `\n\n${rows.length - coverable.length} ligne(s) non couverte(s) par l'économat seront laissées de côté.` : '') +
      `\n\nPour ouvrir un contenant entier, utilisez « Ouvrir » sur la ligne.`,
      { title: 'Tout ouvrir', confirmLabel: 'Ouvrir' });
    if (!ok) return;
    setTransferringAll(true);
    let success = 0;
    let failed = 0;
    try {
      for (const req of coverable) {
        try {
          await bonSortieApi.transferLineFromEconomat(req.line_id as string);
          success++;
        } catch {
          failed++;
        }
      }
      invalidateAll();
      if (failed === 0) notify.success(`${success} contenant(s) ouvert(s)`);
      else notify(`${success} ouvert(s), ${failed} erreur(s)`, { icon: '⚠️' });
    } finally {
      setTransferringAll(false);
    }
  };

  if (isLoading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '3rem' }}>
        <Loader2 size={28} className="animate-spin" style={{ color: 'var(--theme-accent)' }} />
      </div>
    );
  }
  if (isError) {
    const errMsg = (error as any)?.response?.data?.error || (error as any)?.message || 'Erreur inconnue';
    const status = (error as any)?.response?.status;
    return (
      <div className="odoo-alert danger">
        <AlertTriangle size={14} style={{ marginTop: 2, flexShrink: 0 }} />
        <div>
          <span className="odoo-alert-title">Impossible de charger les contenants à ouvrir</span> — {status ? `[${status}] ` : ''}{errMsg}
          {status === 403 && ' (accès réservé aux rôles magasinier, admin et gérant)'}
        </div>
      </div>
    );
  }
  if (rows.length === 0) {
    return (
      <div style={{ padding: '3rem', textAlign: 'center', color: 'var(--theme-text-muted)' }}>
        <PackageOpen size={32} style={{ margin: '0 auto 0.5rem', opacity: 0.4 }} />
        <p style={{ fontSize: '0.8125rem', fontWeight: 500 }}>Aucun contenant à ouvrir pour les bons de sortie en cours.</p>
      </div>
    );
  }

  // Groupage par bon pour faciliter la lecture quand plusieurs lignes du meme bon attendent.
  const groups = new Map<string, { bon_numero: string; plan_date?: string; plan_type?: string; bon_status: string; lines: Record<string, any>[] }>();
  for (const r of rows) {
    const key = r.bon_id as string;
    if (!groups.has(key)) {
      groups.set(key, {
        bon_numero: r.bon_numero as string,
        plan_date: r.plan_date as string | undefined,
        plan_type: r.plan_type as string | undefined,
        bon_status: r.bon_status as string,
        lines: [],
      });
    }
    groups.get(key)!.lines.push(r);
  }

  const isTransferring = transferLineMutation.isPending;
  const pendingLineId = transferLineMutation.variables?.ligneId;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
      {variant === 'transfers-tab' && (
        <div className="odoo-alert warning">
          <PackageOpen size={14} style={{ color: '#856404', marginTop: 2, flexShrink: 0 }} />
          <div style={{ flex: 1 }}>
            <span className="odoo-alert-title">{rows.length} contenant{rows.length > 1 ? 's' : ''} à ouvrir pour les bons de sortie en cours</span>
            {' — '}depuis le bon, l'ouverture se fait en pesant la ligne. Cette liste sert à préparer les contenants à l'avance ou à commander un manquant.
          </div>
          <button type="button" onClick={transferAll} disabled={transferringAll || isTransferring} className="odoo-btn-primary">
            {transferringAll ? <Loader2 size={13} className="animate-spin" /> : <PackageOpen size={13} />}
            {transferringAll ? 'Ouverture...' : `Tout ouvrir (${rows.length})`}
          </button>
        </div>
      )}

      {Array.from(groups.entries()).map(([bonId, g]) => (
        <div key={bonId} className="odoo-section">
          <div className="odoo-section-header">
            <Package size={12} />
            <span style={{ fontFamily: 'ui-monospace, monospace' }}>{g.bon_numero}</span>
            <span style={{ color: 'var(--theme-text-muted)' }}>·</span>
            <span>Plan du {g.plan_date ? format(new Date(g.plan_date), 'dd MMM yyyy', { locale: fr }) : '—'}</span>
            {g.plan_type && <span className="odoo-tag odoo-tag-grey">{g.plan_type}</span>}
            <span className="odoo-tag odoo-tag-orange">
              {BON_SORTIE_STATUS_LABELS[g.bon_status as keyof typeof BON_SORTIE_STATUS_LABELS] || g.bon_status}
            </span>
            <div style={{ flex: 1 }} />
            <Link to={`/stock?tab=bons&bon=${bonId}`} className="odoo-btn-secondary" style={{ textDecoration: 'none' }}>Ouvrir le bon</Link>
          </div>
          <table className="odoo-table">
            <thead>
              <tr>
                <th>Ingrédient</th>
                <th style={{ textAlign: 'right' }}>À ouvrir</th>
                <th>Lot suggéré</th>
                <th style={{ textAlign: 'right' }}>Dispo en réserve</th>
                <th style={{ width: 260 }}></th>
              </tr>
            </thead>
            <tbody>
              {g.lines.map((l) => {
                const ligneId = l.line_id as string;
                const qty = parseFloat(l.transfer_required_qty as string || '0');
                const unit = (l.unit || l.ingredient_unit || 'kg') as string;
                // Dispo scellee de l'INGREDIENT (tous lots), pas du seul lot suggere : le
                // lot suggere est fige a la generation du bon et un reappro arrive dans un
                // lot neuf. Le serveur bascule en FEFO sur un lot couvrant au moment du
                // transfert. On garde la qty du lot suggere pour l'affichage detaille.
                const suggestedLotQty = parseFloat(l.suggested_lot_economat_qty as string || '0');
                const economatAvailable = l.economat_available_total != null
                  ? parseFloat(l.economat_available_total as string)
                  : suggestedLotQty;
                const isPending = isTransferring && pendingLineId === ligneId;
                const insufficient = economatAvailable < qty;
                const missing = Math.max(0, qty - economatAvailable);
                const alreadyOrdered = !!l.already_ordered || orderedLineIds.has(ligneId);
                const isOrdering = commanderMutation.isPending
                  && (commanderMutation.variables as { line?: Record<string, any> } | undefined)?.line?.line_id === ligneId;
                const otherLot = suggestedLotQty + 1e-9 < qty && economatAvailable + 1e-9 >= qty;
                return (
                  <tr key={ligneId} className={insufficient ? 'row-danger' : ''}>
                    <td style={{ fontWeight: 500 }}>{l.ingredient_name as string}</td>
                    <td style={{ textAlign: 'right', fontFamily: 'ui-monospace, monospace', fontWeight: 600 }}>{qty.toFixed(2)} {unit}</td>
                    <td style={{ color: 'var(--theme-text-muted)' }}>
                      {l.suggested_lot_number ? <span style={{ fontFamily: 'ui-monospace, monospace' }}>{l.suggested_lot_number as string}</span> : '—'}
                      {otherLot && <span style={{ fontSize: '0.6875rem' }}> (lot suggéré {suggestedLotQty.toFixed(2)}, un autre lot sera pris)</span>}
                    </td>
                    <td style={{ textAlign: 'right', fontFamily: 'ui-monospace, monospace', color: insufficient ? '#dc3545' : undefined, fontWeight: insufficient ? 600 : 400 }}>
                      {economatAvailable.toFixed(2)} {unit}
                      {insufficient && <span className="odoo-tag odoo-tag-red" style={{ marginLeft: 6 }}><AlertTriangle size={10} /> insuffisant</span>}
                    </td>
                    <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                      {/* Scelle insuffisant : le transfert est impossible (regle serveur),
                          on propose de commander le seul delta manquant. */}
                      {insufficient && (alreadyOrdered ? (
                        <span className="odoo-tag odoo-tag-green" style={{ marginRight: 6 }}><CheckCircle size={10} /> Manquant commandé</span>
                      ) : (
                        <button type="button" onClick={() => commanderMutation.mutate({ line: l, missing })}
                          disabled={isOrdering || transferringAll} className="odoo-btn-secondary" style={{ marginRight: 6 }}
                          title={`Demander l'achat de ${missing.toFixed(2)} ${unit} (Stock › À commander)`}>
                          {isOrdering ? <Loader2 size={12} className="animate-spin" /> : <ShoppingCart size={12} />} Commander {missing.toFixed(2)} {unit}
                        </button>
                      ))}
                      <button type="button"
                        onClick={() => setModalPayload({
                          ligneId,
                          ingredientName: l.ingredient_name as string,
                          unit,
                          requiredQty: qty,
                          economatAvailable,
                          lotNumber: l.suggested_lot_number as string | undefined,
                          lotDlc: l.suggested_lot_dlc as string | undefined,
                          bonNumero: g.bon_numero,
                          containerSize: l.container_size != null ? parseFloat(l.container_size as string) : undefined,
                          containerTypeId: (l.container_type_id as string) || undefined,
                          containerTypeLabel: (l.container_type_label as string) || undefined,
                        })}
                        disabled={isPending || transferringAll || insufficient}
                        className="odoo-btn-primary"
                        title={insufficient ? 'Réserve insuffisante' : 'Ouvrir le contenant pour cette ligne'}>
                        {isPending ? <Loader2 size={12} className="animate-spin" /> : <PackageOpen size={12} />} Ouvrir
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ))}

      {modalPayload && (
        <BsiTransferModal
          payload={modalPayload}
          onClose={() => setModalPayload(null)}
          onConfirm={(qty, reason, overrideLotId, containerTypeId, containerCount) => transferLineMutation.mutate({
            ligneId: modalPayload.ligneId,
            overrideQty: qty,
            overrideLotId,
            reason,
            containerTypeId,
            containerCount,
          })}
          isLoading={transferLineMutation.isPending}
        />
      )}
    </div>
  );
}

/**
 * Modale de confirmation de transfert. Affiche le contexte (ingredient / lot / DLC / BSI),
 * permet d'ajuster la qty (defaut = besoin BSI), de saisir une note et de selectionner
 * un lot alternatif au lot suggere par le FEFO (delta v1 point 4).
 */
/** Affiche une quantite sans jamais l'arrondir au-dessus. Les quantites sont stockees
 *  en numeric(12,4) : 4 decimales suffisent a etre exact, les zeros de fin sont retires.
 *  Un toFixed(2) sur une borne (5.487 -> "5.49") produisait une valeur superieure au
 *  stock reel : le champ pre-rempli depassait le lot et la confirmation restait bloquee,
 *  alors que le lot couvrait le besoin au gramme pres. */
const fmtQty = (n: number) => String(Math.round(n * 10000) / 10000);

function BsiTransferModal({ payload, onClose, onConfirm, isLoading }: {
  payload: TransferModalPayload;
  onClose: () => void;
  onConfirm: (qty: number, reason?: string, overrideLotId?: string, containerTypeId?: string, containerCount?: number) => void;
  isLoading: boolean;
}) {
  // Delta v1 point 4 : chargement de la liste FEFO des lots Economat dispo pour cette ligne.
  // Le magasinier confirme le suggere ou en choisit un autre. La qty max et la DLC sont
  // recalculees dynamiquement en fonction du lot selectionne.
  const { data: economatLots = [], isLoading: lotsLoading } = useQuery<Record<string, any>[]>({
    queryKey: ['bsi-line-economat-lots', payload.ligneId],
    queryFn: () => bonSortieApi.economatLotsForLigne(payload.ligneId),
  });
  // Lot selectionne : initialement le suggere (premier de la liste FEFO).
  const [selectedLotId, setSelectedLotId] = useState<string | null>(null);
  const selectedLot = economatLots.find(l => (l.id as string) === selectedLotId) || economatLots.find(l => l.is_suggested) || economatLots[0];
  const effectiveLotId = (selectedLot?.id as string | undefined) || null;
  const effectiveAvailable = parseFloat((selectedLot?.economat_quantity as string) || '0') || payload.economatAvailable;
  const effectiveLotNumber = (selectedLot?.lot_number as string) || payload.lotNumber;
  const effectiveDlc = (selectedLot?.expiration_date as string) || payload.lotDlc;
  const isOverride = !!selectedLot && !selectedLot.is_suggested;

  // Referentiel editable des types de contenant (Parametres -> Referentiel).
  // Le magasinier declare le contenant ouvert (sac, carton...) + le nombre.
  const { data: containerTypes = [] } = useQuery<Record<string, any>[]>({
    queryKey: ['ref-entries', 'container_types'],
    // entries() renvoie { table, entries } — on extrait le tableau des entrees.
    queryFn: () => referentielApi.entries('container_types').then((r: any) => (r?.entries ?? []) as Record<string, any>[]),
    staleTime: 5 * 60 * 1000,
  });

  // L'ingredient a-t-il un contenant defini (ex Seau de 5 kg) ? Si oui, on pilote la
  // saisie par NOMBRE de contenants : la quantite en kg = nombre x taille du contenant.
  // Le magasinier ne peut pas transferer "1.3 kg" : il ouvre des contenants entiers.
  // Un contenant n'est "defini" que si le TYPE ET la quantite/contenant sont renseignes sur
  // l'ingredient. Une container_size heritee seule (sans type) -> saisie kg libre.
  const containerSize = payload.containerSize && payload.containerSize > 0 && payload.containerTypeId
    ? payload.containerSize : null;
  // Par defaut : assez de contenants pour couvrir le besoin BSI (arrondi superieur).
  const defaultCount = containerSize ? Math.max(1, Math.ceil(payload.requiredQty / containerSize)) : 0;

  const [note, setNote] = useState<string>('');
  const [containerTypeId, setContainerTypeId] = useState<string>(payload.containerTypeId || '');
  const [containerCount, setContainerCount] = useState<string>(containerSize ? String(defaultCount) : '');
  // En mode libre (pas de contenant), la qty est saisie directement en kg.
  const [freeQty, setFreeQty] = useState<string>(fmtQty(payload.requiredQty));

  const parsedCount = parseInt(containerCount, 10);
  const effectiveCount = Number.isFinite(parsedCount) && parsedCount > 0 ? parsedCount : undefined;
  // Quantite effective : pilotee par les contenants si l'ingredient en a un, sinon saisie libre.
  const qty = containerSize
    ? (effectiveCount ? effectiveCount * containerSize : NaN)
    : parseFloat(freeQty);
  // Tolerance 1e-9 : besoin et dispo sont des numeric(12,4) parses en flottant, une
  // egalite stricte peut echouer sur la poussiere binaire (5.487 <= 5.487).
  const isValid = !isNaN(qty)
    && qty >= payload.requiredQty - 1e-9
    && qty <= effectiveAvailable + 1e-9
    && !!effectiveLotId;

  return (
    <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="odoo-scope" style={{ width: '100%', maxWidth: 448, borderRadius: 4, overflow: 'hidden', boxShadow: '0 10px 30px rgba(0,0,0,0.2)' }} role="dialog" aria-label="Transfert Économat vers Pesage">
        <div className="odoo-control-bar">
          <div className="odoo-breadcrumb">
            <PackageOpen size={14} style={{ color: 'var(--theme-accent)' }} />
            <span>Transfert Économat → Pesage</span>
            <span className="odoo-breadcrumb-separator">/</span>
            <span className="odoo-breadcrumb-current">{payload.ingredientName}</span>
          </div>
          <div style={{ flex: 1 }} />
          <button type="button" onClick={onClose} className="odoo-pager-btn" aria-label="Fermer"><X size={14} /></button>
        </div>

        <div className="p-5 space-y-4">
          <div style={{ border: '1px solid var(--odoo-border)', borderRadius: 4, padding: '8px 12px', fontSize: '0.8125rem', display: 'flex', flexDirection: 'column', gap: 4 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span style={{ color: 'var(--odoo-text-muted)' }}>Bon de sortie</span>
              <span style={{ fontFamily: 'ui-monospace, monospace', fontWeight: 600 }}>{payload.bonNumero}</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span style={{ color: 'var(--odoo-text-muted)' }}>Besoin du bon</span>
              <span style={{ fontWeight: 600 }}>{fmtQty(payload.requiredQty)} {payload.unit}</span>
            </div>
          </div>

          {/* Delta v1 point 4 : selecteur de lot FEFO. Le lot suggere est presente en premier
              (marque par is_suggested). Le magasinier peut le confirmer ou en choisir un autre. */}
          <div>
            <label className="text-xs font-semibold text-gray-700 uppercase tracking-wide mb-1.5 block">
              Lot a transferer {lotsLoading && <Loader2 size={11} className="inline animate-spin ml-1" />}
            </label>
            {economatLots.length === 0 && !lotsLoading && (
              <div className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
                Aucun lot Economat actif pour cet ingredient.
              </div>
            )}
            {economatLots.length > 0 && (
              <div className="space-y-1.5 max-h-48 overflow-y-auto pr-1">
                {economatLots.map((lot) => {
                  const lotId = lot.id as string;
                  const isSelected = effectiveLotId === lotId;
                  const lotEconomat = parseFloat(lot.economat_quantity as string || '0');
                  const lotInsufficient = lotEconomat < payload.requiredQty;
                  return (
                    <button
                      key={lotId}
                      type="button"
                      onClick={() => setSelectedLotId(lotId)}
                      disabled={lotInsufficient}
                      className={`w-full text-left px-3 py-2 rounded-lg border transition-colors flex items-center gap-2 ${
                        isSelected
                          ? 'bg-amber-100 border-amber-400 ring-2 ring-amber-300'
                          : 'bg-white border-gray-200 hover:border-amber-300 hover:bg-amber-50'
                      } ${lotInsufficient ? 'opacity-50 cursor-not-allowed' : ''}`}
                    >
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="font-mono text-sm font-semibold text-gray-800">
                            {(lot.lot_number as string) || (lot.supplier_lot_number as string) || lotId.slice(0, 8)}
                          </span>
                          {lot.is_suggested && (
                            <span className="text-[10px] uppercase tracking-wide bg-emerald-100 text-emerald-700 px-1.5 py-0.5 rounded">
                              Suggéré FEFO
                            </span>
                          )}
                        </div>
                        <div className="text-[11px] text-gray-500 flex items-center gap-2 mt-0.5">
                          {lot.expiration_date && (
                            <span className="inline-flex items-center gap-1">
                              <CalendarClock size={10} />
                              DLC {format(new Date(lot.expiration_date as string), 'dd/MM/yyyy')}
                            </span>
                          )}
                          <span className="text-gray-400">·</span>
                          <span>{fmtQty(lotEconomat)} {payload.unit} dispo</span>
                          {lotInsufficient && (
                            <span className="text-red-600 font-semibold">insuffisant</span>
                          )}
                        </div>
                      </div>
                      {isSelected && (
                        <div className="w-5 h-5 rounded-full bg-amber-500 flex items-center justify-center shrink-0">
                          <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="2 6.5 5 9 10 3.5"/></svg>
                        </div>
                      )}
                    </button>
                  );
                })}
              </div>
            )}
            {isOverride && (
              <p className="text-[11px] text-amber-700 mt-1.5 bg-amber-50 border border-amber-200 rounded px-2 py-1">
                ⚠ Lot different du suggere FEFO : la raison sera tracee dans l'audit.
              </p>
            )}
            {effectiveDlc && (
              <p className="text-[11px] text-gray-500 mt-1.5">
                DLC du lot selectionne : <strong>{format(new Date(effectiveDlc), 'dd/MM/yyyy')}</strong> · Dispo : <strong>{fmtQty(effectiveAvailable)} {payload.unit}</strong>
              </p>
            )}
            {/* Garde-fou : eviter "unused var" warnings sur effectiveLotNumber (utilisable pour debug). */}
            <span className="hidden">{effectiveLotNumber}</span>
          </div>

          {/* Contenant : type (referentiel editable) + nombre. Si l'ingredient a une taille
              de contenant definie (ex Seau de 5 kg), le NOMBRE pilote la quantite transferee
              (transfert par contenant entier). Sinon, saisie libre en kg ci-dessous. */}
          <div className="grid grid-cols-[1fr_auto] gap-3">
            <div>
              <label className="text-xs font-semibold text-gray-700 uppercase tracking-wide mb-1.5 block">
                Type de contenant
              </label>
              <select
                value={containerTypeId}
                onChange={(e) => setContainerTypeId(e.target.value)}
                className="w-full px-3 py-2.5 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-amber-400 outline-none bg-white"
              >
                <option value="">— Aucun —</option>
                {containerTypes.map((ct) => (
                  <option key={ct.id as string} value={ct.id as string}>
                    {ct.label as string}
                  </option>
                ))}
              </select>
            </div>
            <div className="w-28">
              <label className="text-xs font-semibold text-gray-700 uppercase tracking-wide mb-1.5 block">
                {containerSize ? 'Nb contenants' : 'Nombre'}
              </label>
              <input
                type="number" min={1} step={1}
                value={containerCount}
                onChange={(e) => setContainerCount(e.target.value)}
                placeholder="ex 2"
                className="w-full px-3 py-2.5 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-amber-400 outline-none font-mono text-right"
              />
            </div>
          </div>

          {containerSize ? (
            /* Mode par contenant : la quantite en kg est calculee, non saisissable. */
            <div>
              <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 flex items-center justify-between text-sm text-amber-900">
                <span className="font-mono">
                  {effectiveCount || 0} × {containerSize} {payload.unit}
                </span>
                <span className="font-mono font-bold">
                  = {Number.isFinite(qty) ? qty.toFixed(2) : '—'} {payload.unit}
                </span>
              </div>
              <p className="text-[11px] text-gray-500 mt-1.5">
                Transfert par contenant entier. Le besoin BSI est de {payload.requiredQty.toFixed(2)} {payload.unit} — le surplus reste au pesage.
              </p>
            </div>
          ) : (
            /* Mode libre : pas de contenant defini sur l'ingredient, saisie directe en kg. */
            <div>
              <label className="text-xs font-semibold text-gray-700 uppercase tracking-wide mb-1.5 block">
                Quantité à transférer
              </label>
              <div className="flex items-center gap-2">
                <input
                  type="number" step="0.01" min={payload.requiredQty} max={effectiveAvailable}
                  value={freeQty}
                  onChange={(e) => setFreeQty(e.target.value)}
                  className="flex-1 px-3 py-2.5 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-amber-400 outline-none font-mono text-right"
                />
                <span className="text-sm text-gray-500 font-medium">{payload.unit}</span>
              </div>
              <p className="text-[11px] text-gray-500 mt-1.5">
                Doit être ≥ {fmtQty(payload.requiredQty)} (besoin BSI) et ≤ {fmtQty(effectiveAvailable)} (dispo du lot sélectionné).
                Tu peux transférer plus si tu ouvres un contenant entier — le surplus restera au pesage.
              </p>
            </div>
          )}
          {qty < payload.requiredQty && (
            <p className="text-xs text-red-600 -mt-2">Inférieur au besoin BSI ({fmtQty(payload.requiredQty)} {payload.unit}).</p>
          )}
          {qty > effectiveAvailable && (
            <p className="text-xs text-red-600 -mt-2">Dépasse la quantité dispo sur ce lot ({fmtQty(effectiveAvailable)} {payload.unit}).</p>
          )}

          <div>
            <label className="text-xs font-semibold text-gray-700 uppercase tracking-wide mb-1.5 block">
              Note (optionnelle)
            </label>
            <input
              type="text" value={note} onChange={(e) => setNote(e.target.value)}
              placeholder="Ex : Ouverture nouveau sac, contenant entamé..."
              className="w-full px-3 py-2.5 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-amber-400 outline-none"
            />
          </div>

          <div className="flex gap-3 pt-2">
            <button onClick={onClose}
              disabled={isLoading}
              className="flex-1 py-2.5 px-4 rounded-xl text-gray-700 font-medium bg-gray-100 hover:bg-gray-200 transition-colors disabled:opacity-60">
              Annuler
            </button>
            <button onClick={() => onConfirm(qty, note.trim() || undefined, isOverride ? (effectiveLotId || undefined) : undefined, containerTypeId || undefined, effectiveCount)}
              disabled={!isValid || isLoading}
              className="flex-1 py-2.5 px-4 rounded-xl text-white font-medium bg-amber-600 hover:bg-amber-700 transition disabled:opacity-50 disabled:cursor-not-allowed inline-flex items-center justify-center gap-2">
              {isLoading ? <Loader2 size={14} className="animate-spin" /> : <PackageOpen size={14} />}
              {isLoading ? 'Transfert...' : 'Confirmer le transfert'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
