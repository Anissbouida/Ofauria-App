import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Loader2, PackageOpen, Undo2, Trash2, X, AlertTriangle } from 'lucide-react';
import { ingredientLotsApi, type LotMovementType } from '../../api/inventory.api';
import { notify } from '../../components/ui/InlineNotification';
import { apiErrorMessage } from '../../api/errors';
import { useReferentiel } from '../../hooks/useReferentiel';

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

const LOSS_REASONS = [
  { v: 'dlc_expired', label: 'DLC expirée', sub: 'Date de péremption dépassée' },
  { v: 'damaged', label: 'Endommagé', sub: 'Casse, contamination' },
  { v: 'quarantine_failed', label: 'Échec contrôle', sub: 'Non conforme' },
  { v: 'other', label: 'Autre', sub: 'Préciser dans la note' },
] as const;

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
  const [lossReason, setLossReason] = useState<string>(expired ? 'dlc_expired' : 'other');
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
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ backgroundColor: 'rgba(0,0,0,0.35)' }}
      onClick={(e) => e.stopPropagation()}>
      <div className="odoo-scope" style={{ margin: 0, minHeight: 0, width: '100%', maxWidth: 500, maxHeight: '90vh', overflowY: 'auto', borderRadius: 4, boxShadow: '0 10px 30px rgba(0,0,0,0.2)' }}>
        <div style={{ padding: '0.875rem 1rem', borderBottom: '1px solid var(--theme-bg-separator)', backgroundColor: meta.danger ? '#fdf0ed' : '#f9fafb', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <Icon size={16} style={{ color: meta.danger ? '#dc3545' : 'var(--theme-accent)' }} />
          <div style={{ flex: 1 }}>
            <h2 style={{ fontSize: '0.9375rem', fontWeight: 600, color: meta.danger ? '#721c24' : 'var(--theme-text-strong)' }}>{meta.title}</h2>
            <p style={{ fontSize: '0.75rem', color: 'var(--theme-text-muted)', marginTop: 1 }}>
              {lot.ingredient_name}{lot.lot_number ? ` · lot ${lot.lot_number}` : ''}
            </p>
          </div>
          <button type="button" onClick={onClose} style={{ padding: 4, color: 'var(--theme-text-muted)' }}><X size={16} /></button>
        </div>

        <div style={{ padding: '1rem', display: 'flex', flexDirection: 'column', gap: '0.875rem', backgroundColor: '#fff' }}>
          {!lockType && available.length > 1 && (
            <div className="odoo-view-switcher" style={{ display: 'flex', width: '100%' }}>
              {available.map(t => (
                <button key={t} type="button" onClick={() => switchType(t)} className={type === t ? 'active' : ''}
                  style={{ flex: 1, padding: '0.375rem 0.5rem', fontSize: '0.75rem' }}>
                  {TYPE_META[t].label}
                </button>
              ))}
            </div>
          )}

          <div style={{ border: '1px solid var(--theme-bg-separator)', borderRadius: 4, backgroundColor: '#f9fafb', padding: '0.5rem 0.75rem', fontSize: '0.75rem', display: 'flex', gap: '1rem' }}>
            <div>En réserve : <strong style={{ fontFamily: 'monospace' }}>{fmt(scelle)} {lot.unit}</strong></div>
            <div>Au pesage : <strong style={{ fontFamily: 'monospace', color: '#6f42c1' }}>{fmt(entame)} {lot.unit}</strong></div>
            {expired && <span className="odoo-tag odoo-tag-red" style={{ marginLeft: 'auto' }}><AlertTriangle size={10} /> Lot périmé</span>}
          </div>

          {type !== 'losses' && (
            <div>
              <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, color: 'var(--theme-text-muted)', marginBottom: 4 }}>
                {type === 'open' ? 'Quantité à ouvrir' : type === 'return' ? 'Quantité remise en réserve' : 'Quantité perdue'}
                <span style={{ fontWeight: 400 }}> (max {fmt(zoneQty)} {lot.unit})</span>
              </label>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <input type="text" inputMode="decimal" value={quantity} autoFocus
                  onChange={(e) => setQuantity(e.target.value.replace(/[^0-9.,]/g, ''))}
                  className="input" style={{ flex: 1, fontFamily: 'monospace', textAlign: 'right' }} />
                <span style={{ fontSize: '0.8125rem', color: 'var(--theme-text-muted)', fontWeight: 500 }}>{lot.unit}</span>
                <button type="button" className="odoo-btn-secondary" onClick={() => setQuantity(fmt(zoneQty))}>Tout</button>
              </div>
              {containerSize > 0 && Number.isFinite(qty) && qty > 0 && (
                <p style={{ fontSize: '0.6875rem', color: 'var(--theme-text-muted)', marginTop: 4 }}>
                  Contenant entier : {containerCount} × {fmt(containerSize)} {lot.unit}{lot.container_type_label ? ` (${lot.container_type_label})` : ''}, la quantité sera arrondie au contenant.
                </p>
              )}
              {!qtyOk && quantity && (
                <p style={{ fontSize: '0.75rem', color: '#dc3545', marginTop: 4 }}>Quantité invalide ou supérieure au disponible ({fmt(zoneQty)} {lot.unit}).</p>
              )}
            </div>
          )}

          {type === 'losses' ? (
            <>
              <div>
                <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, color: 'var(--theme-text-muted)', marginBottom: 6 }}>Motif</label>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.375rem' }}>
                  {LOSS_REASONS.map(opt => (
                    <button key={opt.v} type="button" onClick={() => setLossReason(opt.v)}
                      style={{
                        padding: '0.5rem 0.625rem', borderRadius: 3, textAlign: 'left',
                        border: `1px solid ${lossReason === opt.v ? 'var(--theme-accent)' : 'var(--theme-bg-separator)'}`,
                        backgroundColor: lossReason === opt.v ? '#f3edf2' : '#fff',
                        boxShadow: lossReason === opt.v ? 'inset 0 0 0 1px var(--theme-accent)' : 'none',
                      }}>
                      <div style={{ fontSize: '0.8125rem', fontWeight: 600, color: 'var(--theme-text-strong)' }}>{opt.label}</div>
                      <div style={{ fontSize: '0.6875rem', color: 'var(--theme-text-muted)', marginTop: 1 }}>{opt.sub}</div>
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, color: 'var(--theme-text-muted)', marginBottom: 4 }}>Note (optionnel)</label>
                <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} className="input" style={{ width: '100%' }} placeholder="Détails additionnels..." />
              </div>
              <div className="odoo-alert danger" style={{ margin: 0 }}>
                <AlertTriangle size={14} style={{ marginTop: 2, flexShrink: 0 }} />
                <div>
                  <span className="odoo-alert-title">Action irréversible</span> — {fmt(scelle + entame)} {lot.unit} retirés du stock
                  {lostValue != null && lostValue > 0 ? ` (${lostValue.toFixed(2)} DH)` : ''}.
                </div>
              </div>
            </>
          ) : (
            <div>
              {type === 'waste' && (
                <>
                  <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, color: 'var(--theme-text-muted)', marginBottom: 6 }}>Motif</label>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.375rem', marginBottom: '0.75rem' }}>
                    {wasteReasons.map(r => (
                      <button key={r.code} type="button" onClick={() => setWasteCode(r.code)} title={r.description ?? undefined}
                        style={{
                          padding: '0.375rem 0.625rem', borderRadius: 3, fontSize: '0.75rem',
                          border: `1px solid ${wasteCode === r.code ? 'var(--theme-accent)' : 'var(--theme-bg-separator)'}`,
                          backgroundColor: wasteCode === r.code ? '#f3edf2' : '#fff',
                          fontWeight: wasteCode === r.code ? 600 : 400, color: 'var(--theme-text-strong)',
                        }}>
                        {r.label}
                      </button>
                    ))}
                  </div>
                </>
              )}
              <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, color: 'var(--theme-text-muted)', marginBottom: 4 }}>
                {type === 'waste' ? (wasteCode === 'autre' ? 'Précision (obligatoire)' : 'Précision (optionnel)') : 'Note (optionnel)'}
              </label>
              <input type="text" value={reason} onChange={(e) => setReason(e.target.value)} className="input" style={{ width: '100%', borderColor: type === 'waste' && !reasonOk ? '#b85d1a' : undefined }}
                placeholder={type === 'waste' ? 'Ex : sac percé à la livraison' : type === 'open' ? 'Ex : pré-ouverture du matin' : 'Ex : reliquat refermé'} />
            </div>
          )}

          <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end', paddingTop: '0.5rem', borderTop: '1px solid var(--theme-bg-separator)' }}>
            <button type="button" onClick={onClose} disabled={mutation.isPending} className="odoo-btn-secondary">Annuler</button>
            <button type="button" onClick={() => mutation.mutate()} disabled={!canSubmit || mutation.isPending}
              className={meta.danger ? 'odoo-btn-danger' : 'odoo-btn-primary'}>
              {mutation.isPending ? <Loader2 size={13} className="animate-spin" /> : <Icon size={13} />} {meta.label}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
