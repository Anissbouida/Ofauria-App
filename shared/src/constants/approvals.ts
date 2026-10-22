/**
 * Circuits d'approbation (lot 8 Paramètres, mig 333).
 *
 * Une règle porte sur un type de pièce et une condition {field, op, value}
 * évaluée sur les valeurs que le module fournit au moment de la soumission.
 * Les types de pièce et leurs champs sont fixés ici : le serveur sait les
 * calculer, l'écran Paramètres sait les proposer.
 */

export type ApprovalFieldKind = 'number' | 'enum';

export interface ApprovalField {
  label: string;
  kind: ApprovalFieldKind;
  unit?: string;
  options?: { value: string; label: string }[];
}

export interface ApprovalDocTypeDef {
  label: string;
  /** Ce que l'approbation déclenche une fois accordée. */
  effect: string;
  fields: Record<string, ApprovalField>;
}

export const APPROVAL_DOC_TYPES = {
  purchase_order: {
    label: 'Bon de commande fournisseur',
    effect: 'Le bon est envoyé au fournisseur.',
    fields: {
      amount: { label: 'Montant HT', kind: 'number', unit: 'DH' },
    },
  },
  invoice_cancel: {
    label: 'Annulation de facture (avoir)',
    effect: 'La facture passe au statut annulé.',
    fields: {
      amount: { label: 'Montant TTC', kind: 'number', unit: 'DH' },
      invoice_type: {
        label: 'Type de facture', kind: 'enum',
        options: [
          { value: 'emitted', label: 'Facture client (émise)' },
          { value: 'received', label: 'Facture fournisseur (reçue)' },
        ],
      },
    },
  },
  inventory_count: {
    label: 'Écart de contrôle d\'ouverture',
    effect: 'Le contrôle est validé et l\'écart répercuté sur le stock.',
    fields: {
      gap_pct: { label: 'Écart en % des quantités attendues', kind: 'number', unit: '%' },
      gap_qty: { label: 'Écart en unités (valeur absolue)', kind: 'number', unit: 'u' },
      lines: { label: 'Nombre de lignes en écart', kind: 'number' },
    },
  },
} as const satisfies Record<string, ApprovalDocTypeDef>;

export type ApprovalDocType = keyof typeof APPROVAL_DOC_TYPES;

export const APPROVAL_OPS = {
  gte: '≥', gt: '>', lte: '≤', lt: '<', eq: '=', neq: '≠',
} as const;
export type ApprovalOp = keyof typeof APPROVAL_OPS;

export interface ApprovalCondition {
  field?: string;
  op?: ApprovalOp;
  value?: number | string;
}

export type ApprovalRequestStatus = 'pending' | 'approved' | 'rejected' | 'cancelled';
export type ApprovalStepStatus = 'waiting' | 'pending' | 'approved' | 'rejected' | 'skipped';

export const APPROVAL_REQUEST_STATUS_LABELS: Record<ApprovalRequestStatus, string> = {
  pending: 'En attente', approved: 'Approuvée', rejected: 'Refusée', cancelled: 'Annulée',
};

export const APPROVAL_STEP_STATUS_LABELS: Record<ApprovalStepStatus, string> = {
  waiting: 'À venir', pending: 'En cours', approved: 'Approuvée', rejected: 'Refusée', skipped: 'Sans objet',
};

/** Condition vide = toujours. */
export function approvalConditionMatches(cond: ApprovalCondition | null | undefined, values: Record<string, unknown>): boolean {
  if (!cond || !cond.field) return true;
  const v = values[cond.field];
  if (v === undefined || v === null) return false;
  const t = cond.value;
  switch (cond.op) {
    case 'gte': return Number(v) >= Number(t);
    case 'gt': return Number(v) > Number(t);
    case 'lte': return Number(v) <= Number(t);
    case 'lt': return Number(v) < Number(t);
    case 'eq': return String(v) === String(t);
    case 'neq': return String(v) !== String(t);
    default: return false;
  }
}

/** « Montant HT ≥ 5 000 DH », pour les écrans. */
export function describeApprovalCondition(docType: string, cond: ApprovalCondition | null | undefined): string {
  if (!cond || !cond.field) return 'Toujours';
  const def = (APPROVAL_DOC_TYPES as Record<string, ApprovalDocTypeDef>)[docType]?.fields[cond.field];
  const label = def?.label ?? cond.field;
  const op = cond.op ? APPROVAL_OPS[cond.op] : '?';
  if (def?.kind === 'enum') {
    const opt = def.options?.find(o => o.value === String(cond.value));
    return `${label} ${op} ${opt?.label ?? cond.value}`;
  }
  const num = typeof cond.value === 'number' ? cond.value.toLocaleString('fr-FR') : String(cond.value ?? '');
  return `${label} ${op} ${num}${def?.unit ? ` ${def.unit}` : ''}`;
}
