import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Loader2, PackageOpen, Undo2, Trash2, AlertTriangle } from 'lucide-react';
import { ingredientLotsApi, type LotMovementType } from '../../api/inventory.api';
import { notify } from '../../components/ui/InlineNotification';
import { apiErrorMessage } from '../../api/errors';
import { StatusTag } from '../../components/ui/StatusTag';
import { useReferentiel } from '../../hooks/useReferentiel';
import { money } from '../../utils/money';
import { Alert, FormField, Modal } from '../../components/ds';

/** Ce que la modale a besoin de connaitre d'un lot, quel que soit l'ecran d'origine. */
export interface LotMovementLot {
  id: string;
  lot_number?: string | null;
  ingredient_name: string;
  unit: string;
  economat_quantity: number;
  pesage_quantity: number;
  unit_cost?: number | null;
  is_expired?: boolean;
  /** Taille d'un contenant (regle « contenant entier » a l'ouverture). */
  container_size?: number | null;
  container_type_label?: string | null;
}

type UiType = Exclude<LotMovementType, 'quarantine'>;

const TYPE_META: Record<UiType, { label: string; title: string; icon: typeof PackageOpen; danger?: boolean }> = {
  open: { label: 'Ouvrir', title: 'Ouvrir un contenant', icon: PackageOpen },
  return: { label: 'Remettre en réserve', title: 'Remettre en réserve (contenant refermé)', icon: Undo2 },
  waste: { label: 'Perte', title: 'Déclarer une perte (poste de pesée)', icon: Trash2, danger: true },
  losses: { label: 'Lot aux pertes', title: 'Envoyer le lot entier aux pertes', icon: Trash2, danger: true },
};

// M6-03 : motifs du référentiel unique « scrap_reasons », domaine matière.
const SUB: Record<string, string> = { dlc_expiree: 'Date de péremption dépassée', casse: 'Casse, renversé', qualite_non_conforme: 'Non conforme', autre: 'Préciser dans la note' };

const fmt = (n: number) => String(Math.round(n * 10000) / 10000);

/**
 * Modale UNIQUE des mouvements de lot du module Stock (lot 3 de la refonte).
 * Remplace OpenContainerModal (fiche ingredient), SendToLossesDialog (liste) et les
 * formulaires inline de PesageLotActions : un seul formulaire, un seul endpoint
 * (POST /ingredient-lots/:id/movement), les memes regles quel que soit l'ecran.
 */
export function LotMovementModal({ lot, initialType, lockType = false, only, onClose, onDone }: {
  lot: LotMovementLot;
  initialType: UiType;
  /** true : l'utilisateur ne peut pas changer de type (bouton dedie). */
  lockType?: boolean;
  /** Restreint les types proposes (ex. declaration de perte : waste + losses). */
  only?: UiType[];
  onClose: () => void;
  onDone?: () => void;
}) {
  const queryClient = useQueryClient();
  const scelle = lot.economat_quantity || 0;
  const entame = lot.pesage_quantity || 0;
  const expired = !!lot.is_expired;
  const available: UiType[] = [
    ...(scelle > 0 && !expired ? ['open' as const] : []),
    ...(entame > 0 ? ['return' as const, 'waste' as const] : []),
    'losses' as const,
  ].filter(t => !only || only.includes(t));
  const [type, setType] = useState<UiType>(available.includes(initialType) ? initialType : available[0]);
  const zoneQty = type === 'open' ? scelle : entame;
  const [quantity, setQuantity] = useState<string>(fmt(zoneQty));
  const [reason, setReason] = useState<string>('');
  // Perte partielle : motif du referentiel material_loss_reasons (mig 333) + precision libre.
  const { entries: wasteReasons, getLabel: wasteLabel } = useReferentiel('material_loss_reasons');
  const [wasteCode, setWasteCode] = useState<string>(expired ? 'dlc_expiree' : '');
  const { entries: scrapEntries } = useReferentiel('scrap_reasons');
  const LOSS_REASONS = scrapEntries
    .filter(e => { const d = (e.metadata as { domains?: string[] } | undefined)?.domains; return !d || d.includes('matiere'); })
    .map(e => ({ v: e.code, label: e.label, sub: SUB[e.code] ?? '' }));
  const [lossReason, setLossReason] = useState<string>(expired ? 'dlc_expiree' : 'autre');
  const [note, setNote] = useState('');

  const switchType = (t: UiType) => {
    setType(t);
    setQuantity(fmt(t === 'open' ? scelle : entame));
  };

  const qty = parseFloat(quantity.replace(',', '.'));
  const qtyOk = type === 'losses' || (Number.isFinite(qty) && qty > 0 && qty <= zoneQty + 1e-9);
  const containerSize = type === 'open' && lot.container_size && lot.container_size > 0 ? lot.container_size : 0;
  const containerCount = containerSize ? Math.ceil(qty / containerSize) : undefined;
  const reasonOk = type === 'waste' ? !!wasteCode && (wasteCode !== 'autre' || reason.trim().length >= 3) : true;
  const canSubmit = qtyOk && reasonOk;

  const mutation = useMutation({
    mutationFn: () => ingredientLotsApi.movement(lot.id, type === 'losses'
      ? { type, reason: lossReason, note: note.trim() || undefined }
      : type === 'waste'
        ? { type, quantity: qty, reasonCode: wasteCode, reason: [wasteLabel(wasteCode), reason.trim()].filter(Boolean).join(' — ') }
        : { type, quantity: qty, containerCount, reason: reason.trim() || undefined }),
    onSuccess: () => {
      // Toutes les vues qui lisent les lots / le stock / la zone entamee.
      queryClient.invalidateQueries({ predicate: q => {
        const k = String(q.queryKey[0] || '');
        return k === 'inventory' || k.startsWith('ingredient-lots') || k.startsWith('warehouse-');
      } });
      const name = `${lot.ingredient_name}${lot.lot_number ? ` (lot ${lot.lot_number})` : ''}`;
      notify.success(
        type === 'open' ? `${fmt(qty)} ${lot.unit} de ${name} ouverts`
        : type === 'return' ? `${fmt(qty)} ${lot.unit} de ${name} remis en réserve`
        : type === 'waste' ? `Perte enregistrée : ${fmt(qty)} ${lot.unit} de ${name}`
        : `${name} envoyé aux pertes`);
      onDone?.();
      onClose();
    },
    onError: (e: unknown) => notify.error(apiErrorMessage(e, 'Erreur lors du mouvement')),
  });

  const meta = TYPE_META[type];
  const Icon = meta.icon;
  const lostValue = type === 'losses' && lot.unit_cost ? (scelle + entame) * lot.unit_cost : null;

  return (
    <Modal title={meta.title} subtitle={<>{lot.ingredient_name}{lot.lot_number ? ` · lot ${lot.lot_number}` : ''}</>}
      onClose={onClose} locked={mutation.isPending} width={500}
      footer={
        <div className="ds-form-foot">
          <span className="ds-grow" />
          <button type="button" onClick={onClose} disabled={mutation.isPending} className="odoo-btn-secondary">Annuler</button>
          <button type="button" onClick={() => mutation.mutate()} disabled={!canSubmit || mutation.isPending} aria-busy={mutation.isPending || undefined}
            className={meta.danger ? 'ds-btn-danger solid' : 'odoo-btn-primary'}>
            {mutation.isPending ? <Loader2 size={13} className="animate-spin" /> : <Icon size={13} />} {meta.label}
          </button>
        </div>
      }>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.875rem' }}>
          {!lockType && available.length > 1 && (
            <div className="odoo-view-switcher" style={{ display: 'flex', width: '100%' }}>
              {available.map(t => (
                <button key={t} type="button" onClick={() => switchType(t)} className={type === t ? 'active' : ''}
                  style={{ flex: 1, padding: '0.375rem 0.5rem', fontSize: '12px' }}>
                  {TYPE_META[t].label}
                </button>
              ))}
            </div>
          )}

          <div style={{ border: '1px solid var(--ds-sep)', borderRadius: 4, backgroundColor: 'var(--ds-bg)', padding: '0.5rem 0.75rem', fontSize: '12px', display: 'flex', gap: '1rem' }}>
            <div>En réserve : <strong style={{ fontFamily: 'monospace' }}>{fmt(scelle)} {lot.unit}</strong></div>
            <div>Au pesage : <strong style={{ fontFamily: 'monospace' }}>{fmt(entame)} {lot.unit}</strong></div>
            {expired && <span style={{ marginLeft: 'auto' }}><StatusTag tone="late" label="Lot périmé" /></span>}
          </div>

          {type !== 'losses' && (
            <FormField htmlFor="lot-move-qty" required
              label={<>{type === 'open' ? 'Quantité à ouvrir' : type === 'return' ? 'Quantité remise en réserve' : 'Quantité perdue'}<span style={{ fontWeight: 400 }}> (max {fmt(zoneQty)} {lot.unit})</span></>}
              error={!qtyOk && quantity ? `Quantité invalide ou supérieure au disponible (${fmt(zoneQty)} ${lot.unit}).` : undefined}
              hint={containerSize > 0 && Number.isFinite(qty) && qty > 0
                ? `Contenant entier : ${containerCount} × ${fmt(containerSize)} ${lot.unit}${lot.container_type_label ? ` (${lot.container_type_label})` : ''}, la quantité sera arrondie au contenant.`
                : undefined}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <input id="lot-move-qty" type="text" inputMode="decimal" value={quantity} autoFocus
                  onChange={(e) => setQuantity(e.target.value.replace(/[^0-9.,]/g, ''))}
                  className="ds-input ds-num" style={{ flex: 1 }} aria-invalid={!qtyOk && !!quantity || undefined} />
                <span style={{ fontSize: '13px', color: 'var(--ds-muted)', fontWeight: 500 }}>{lot.unit}</span>
                <button type="button" className="odoo-btn-secondary" onClick={() => setQuantity(fmt(zoneQty))}>Tout</button>
              </div>
            </FormField>
          )}

          {type === 'losses' ? (
            <>
              <div>
                <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: 'var(--ds-ink)', marginBottom: 6 }}>Motif</label>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.375rem' }}>
                  {LOSS_REASONS.map(opt => (
                    <button key={opt.v} type="button" onClick={() => setLossReason(opt.v)}
                      style={{
                        padding: '0.5rem 0.625rem', borderRadius: 3, textAlign: 'left',
                        border: `1px solid ${lossReason === opt.v ? 'var(--ds-accent)' : 'var(--ds-sep)'}`,
                        backgroundColor: lossReason === opt.v ? 'var(--ds-tint)' : 'var(--ds-card)',
                        boxShadow: lossReason === opt.v ? 'inset 0 0 0 1px var(--ds-accent)' : 'none',
                      }}>
                      <div style={{ fontSize: '13px', fontWeight: 600, color: 'var(--ds-ink)' }}>{opt.label}</div>
                      <div style={{ fontSize: '12px', color: 'var(--ds-muted)', marginTop: 1 }}>{opt.sub}</div>
                    </button>
                  ))}
                </div>
              </div>
              <div className="ds-field">
                <label htmlFor="lot-move-note">Note (facultatif)</label>
                <textarea id="lot-move-note" value={note} onChange={(e) => setNote(e.target.value)} rows={2} className="ds-input" placeholder="Détails additionnels…" />
              </div>
              <Alert tone="danger" icon={AlertTriangle}>
                Action irréversible — {fmt(scelle + entame)} {lot.unit} retirés du stock
                {lostValue != null && lostValue > 0 ? ` (${money(lostValue)})` : ''}.
              </Alert>
            </>
          ) : (
            <div>
              {type === 'waste' && (
                <>
                  <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: 'var(--ds-ink)', marginBottom: 6 }}>Motif</label>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.375rem', marginBottom: '0.75rem' }}>
                    {wasteReasons.map(r => (
                      <button key={r.code} type="button" onClick={() => setWasteCode(r.code)} title={r.description ?? undefined}
                        style={{
                          padding: '0.375rem 0.625rem', borderRadius: 3, fontSize: '12px',
                          border: `1px solid ${wasteCode === r.code ? 'var(--ds-accent)' : 'var(--ds-sep)'}`,
                          backgroundColor: wasteCode === r.code ? 'var(--ds-tint)' : 'var(--ds-card)',
                          fontWeight: wasteCode === r.code ? 600 : 400, color: 'var(--ds-ink)',
                        }}>
                        {r.label}
                      </button>
                    ))}
                  </div>
                </>
              )}
              <label htmlFor="lot-move-reason" className="ds-field-label" style={{ display: 'block', marginBottom: 6 }}>
                {type === 'waste' ? (wasteCode === 'autre' ? 'Précision (obligatoire)' : 'Précision (facultatif)') : 'Note (facultatif)'}
              </label>
              <input id="lot-move-reason" type="text" value={reason} onChange={(e) => setReason(e.target.value)} className="ds-input" style={{ borderColor: type === 'waste' && !reasonOk ? 'var(--ds-warning)' : undefined }}
                placeholder={type === 'waste' ? 'Ex : sac percé à la livraison' : type === 'open' ? 'Ex : pré-ouverture du matin' : 'Ex : reliquat refermé'} />
            </div>
          )}

        </div>
    </Modal>
  );
}
