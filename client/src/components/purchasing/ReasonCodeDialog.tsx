import { useMemo, useState } from 'react';
import { X, Loader2 } from 'lucide-react';
import ModalBackdrop from '../ui/ModalBackdrop';
import { useReferentiel } from '../../hooks/useReferentiel';

/**
 * Saisie d'un motif codé pour une action sensible sur un document d'achat (mig 306).
 *
 * Les motifs viennent du référentiel `purchase_reason_codes` (Paramètres → Référentiel),
 * filtrés par périmètre d'usage (metadata.scope). Quand le motif l'exige
 * (metadata.requires_note), une précision écrite est obligatoire.
 */
export type ReasonScope = 'cancel' | 'not_delivered' | 'hold' | 'reject' | 'return' | 'force_close' | 'variance' | 'cash_override' | 'reverse'
  | 'correct' | 'change' | 'release_hold' | 'cancel_invoice' | 'reopen_invoice' | 'void_payment';

export interface ReasonCodeDialogProps {
  title: string;
  scope: ReasonScope;
  /** Ce qui va se passer, en une ou deux phrases. */
  description?: string;
  confirmLabel: string;
  danger?: boolean;
  pending?: boolean;
  onClose: () => void;
  onSubmit: (value: { reasonCodeId: string; note?: string }) => void;
}

export default function ReasonCodeDialog({
  title, scope, description, confirmLabel, danger, pending, onClose, onSubmit,
}: ReasonCodeDialogProps) {
  const { entries, isLoading } = useReferentiel('purchase_reason_codes');
  const options = useMemo(
    () => entries
      .filter(e => Array.isArray(e.metadata?.scope) && (e.metadata!.scope as string[]).includes(scope))
      .sort((a, b) => (a.display_order ?? 0) - (b.display_order ?? 0)),
    [entries, scope],
  );
  const [reasonCodeId, setReasonCodeId] = useState('');
  const [note, setNote] = useState('');
  const selected = options.find(o => o.id === reasonCodeId);
  const requiresNote = !!selected?.metadata?.requires_note;
  const valid = !!reasonCodeId && (!requiresNote || note.trim().length >= 3);

  return (
    <ModalBackdrop onClose={onClose} className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="odoo-scope" onClick={(e) => e.stopPropagation()}
        style={{ width: '100%', maxWidth: 480, borderRadius: 4, overflow: 'hidden', boxShadow: '0 10px 30px rgba(0,0,0,0.2)' }}>
        <div className="odoo-control-bar">
          <div className="odoo-breadcrumb"><span className="odoo-breadcrumb-current">{title}</span></div>
          <div style={{ flex: 1 }} />
          <button onClick={onClose} className="odoo-pager-btn" title="Fermer"><X size={14} /></button>
        </div>
        <form onSubmit={(e) => { e.preventDefault(); if (valid) onSubmit({ reasonCodeId, note: note.trim() || undefined }); }}
          style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 10 }}>
          {description && <p style={{ margin: 0, fontSize: '0.8125rem', color: 'var(--theme-text-muted)' }}>{description}</p>}
          <label htmlFor="reason-code" style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--theme-text-muted)' }}>Motif *</label>
          <select id="reason-code" value={reasonCodeId} onChange={(e) => setReasonCodeId(e.target.value)} autoFocus
            className="w-full px-3 py-2 border border-gray-200 rounded-md text-sm focus:outline-none focus:ring-1 focus:ring-blue-400">
            <option value="">{isLoading ? 'Chargement…' : '— Choisir un motif —'}</option>
            {options.map(o => <option key={o.id} value={o.id}>{o.label}</option>)}
          </select>
          <label htmlFor="reason-note" style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--theme-text-muted)' }}>
            Précision{requiresNote ? ' *' : ''}
          </label>
          <textarea id="reason-note" rows={2} value={note} onChange={(e) => setNote(e.target.value)} maxLength={1000}
            className="w-full px-3 py-2 border border-gray-200 rounded-md text-sm focus:outline-none focus:ring-1 focus:ring-blue-400"
            placeholder={requiresNote ? 'Obligatoire pour ce motif' : 'Facultatif'} />
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 4 }}>
            <button type="button" onClick={onClose} className="odoo-btn-secondary">Retour</button>
            <button type="submit" disabled={!valid || pending} className={danger ? 'odoo-btn-danger' : 'odoo-btn-primary'}
              style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
              {pending && <Loader2 size={12} className="animate-spin" />}
              {confirmLabel}
            </button>
          </div>
        </form>
      </div>
    </ModalBackdrop>
  );
}
