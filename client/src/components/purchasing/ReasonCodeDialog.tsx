import { useId, useMemo, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { useReferentiel } from '../../hooks/useReferentiel';
import { FormField, Modal } from '../ds';

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
  const formId = useId();

  const submit = () => { if (valid && !pending) onSubmit({ reasonCodeId, note: note.trim() || undefined }); };

  return (
    <Modal title={title} width={480} onClose={onClose} locked={pending}
      footer={
        /* « Retour » et non « Annuler » : l'action confirmée est souvent elle-même une annulation. */
        <div className="ds-form-foot">
          <span className="ds-grow" />
          <button type="button" onClick={onClose} className="odoo-btn-secondary" disabled={pending}>Retour</button>
          <button type="submit" form={formId} disabled={!valid || pending} aria-busy={pending || undefined}
            className={danger ? 'ds-btn-danger solid' : 'odoo-btn-primary'}
            style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
            {pending && <Loader2 size={13} className="animate-spin" aria-hidden="true" />}
            {confirmLabel}
          </button>
        </div>
      }>
      <form id={formId} onSubmit={(e) => { e.preventDefault(); submit(); }} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {description && <p style={{ margin: 0, fontSize: 14, color: 'var(--ds-muted)' }}>{description}</p>}
        <FormField label="Motif" htmlFor="reason-code" required>
          <select id="reason-code" value={reasonCodeId} onChange={(e) => setReasonCodeId(e.target.value)} autoFocus className="ds-input" aria-required="true">
            <option value="">{isLoading ? 'Chargement…' : '— Choisir un motif —'}</option>
            {options.map(o => <option key={o.id} value={o.id}>{o.label}</option>)}
          </select>
        </FormField>
        <FormField label="Précision" htmlFor="reason-note" required={requiresNote}
          hint={requiresNote ? 'Obligatoire pour ce motif (3 caractères au moins).' : 'Facultatif'}>
          <textarea id="reason-note" rows={2} value={note} onChange={(e) => setNote(e.target.value)} maxLength={1000}
            className="ds-input" style={{ minHeight: 64 }} />
        </FormField>
      </form>
    </Modal>
  );
}
