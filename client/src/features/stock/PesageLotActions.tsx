import { useState } from 'react';
import { Undo2, Trash2 } from 'lucide-react';
import { LotMovementModal } from './LotMovementModal';

/**
 * Actions sur un lot en zone entamee (audit pesage W3) : retour en scelle ou perte.
 * Les deux passent par la modale unique de mouvement de lot (module Stock, lot 3).
 */
export function PesageLotActions({ lotId, lotNumber, ingredientName, pesageQuantity, economatQuantity = 0, unit, isExpired }: {
  lotId: string; lotNumber: string; ingredientName: string; pesageQuantity: number; economatQuantity?: number; unit: string; isExpired: boolean;
}) {
  const [mode, setMode] = useState<'return' | 'waste' | null>(null);
  return (
    <div style={{ display: 'inline-flex', gap: 6 }} onClick={(e) => e.stopPropagation()}>
      <button type="button" className="odoo-btn-secondary" onClick={() => setMode('return')}
        title="Refermer le contenant et le remettre en réserve">
        <Undo2 size={12} /> Remettre en réserve
      </button>
      <button type="button" className="odoo-btn-secondary" onClick={() => setMode('waste')}
        title="Déclarer une perte (renversement, contamination, fond de sac, DLC)">
        <Trash2 size={12} /> Perte
      </button>
      {mode && (
        <LotMovementModal
          lot={{ id: lotId, lot_number: lotNumber, ingredient_name: ingredientName, unit, economat_quantity: economatQuantity, pesage_quantity: pesageQuantity, is_expired: isExpired }}
          initialType={mode}
          onClose={() => setMode(null)}
        />
      )}
    </div>
  );
}
