/**
 * Circuits d'approbation (lot 8 Paramètres, mig 350).
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
  purchase_request: {
    label: "Demande d'achat",
    effect: 'La demande est approuvée : elle peut être transformée en bon de commande.',
    fields: {
      // Montant estimé de la demande = quantité × coût unitaire de l'article.
      // C'est le besoin exprimé, AVANT tout engagement fournisseur (le BC viendra
      // après l'approbation). Permet « DA au-dessus de X DH → approbation ».
      amount: { label: 'Montant estimé', kind: 'number', unit: 'DH' },
      // Barème par rôle du demandeur (magasinier, production, gérant…), comme pour
      // le BC : se combine au montant via une condition composée {all:[...]}.
      buyer_role: {
        label: 'Rôle du demandeur', kind: 'enum',
        options: [
          { value: 'magasinier', label: 'Magasinier' },
          { value: 'manager', label: 'Gérant' },
          { value: 'admin', label: 'Administrateur' },
          { value: 'cashier', label: 'Caissier' },
        ],
      },
      // Catégorie d'achat de l'article (une seule par demande). Options câblées
      // côté UI (catégories dynamiques), comme pour le BC.
      category: { label: "Catégorie d'achat", kind: 'enum' },
      // Fournisseur pressenti de la demande (facultatif à ce stade). Options
      // câblées côté UI (liste des fournisseurs).
      supplier: { label: 'Fournisseur', kind: 'enum' },
    },
  },
  purchase_order: {
    label: 'Bon de commande fournisseur',
    effect: 'Le bon est envoyé au fournisseur.',
    fields: {
      // Engagement confronté à l'approbation : TTC par ligne + cumul fournisseur
      // du jour (anti-fractionnement, lot L4 P2P 1/5). Pas le HT brut.
      amount: { label: 'Engagement (TTC + cumul jour)', kind: 'number', unit: 'DH' },
      // Barème par rôle de l'acheteur / par catégorie d'achat (lot L4 P2P, 5/5).
      // Se combinent au montant via une condition composée {all:[...]}.
      buyer_role: {
        label: "Rôle de l'acheteur", kind: 'enum',
        options: [
          { value: 'magasinier', label: 'Magasinier' },
          { value: 'manager', label: 'Gérant' },
          { value: 'admin', label: 'Administrateur' },
          { value: 'cashier', label: 'Caissier' },
        ],
      },
      // La valeur soumise est la LISTE des catégories des lignes du BC : l'égalité
      // vaut « au moins une ligne dans cette catégorie ». Options câblées côté UI
      // (catégories d'achat dynamiques) — voir note du lot 5/5.
      category: { label: "Catégorie d'achat (une ligne au moins)", kind: 'enum' },
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
  payment_run: {
    label: 'Campagne de paiement fournisseurs',
    effect: 'La campagne est approuvée : le fichier de virement peut être édité.',
    fields: {
      amount: { label: 'Total de la campagne', kind: 'number', unit: 'DH' },
      lines: { label: 'Nombre de factures', kind: 'number' },
    },
  },
  bom_change: {
    label: 'Modification de nomenclature',
    effect: 'La nouvelle version de la fiche devient active à sa date d\'effet ; la précédente devient obsolète.',
    fields: {
      cost_change_pct: { label: 'Écart du coût unitaire (valeur absolue)', kind: 'number', unit: '%' },
      open_orders: { label: 'Ordres ouverts concernés', kind: 'number' },
      allergens_added: { label: 'Allergènes ajoutés', kind: 'number' },
    },
  },
  // Étape 6 multi-industries : approbations de production (aucune règle = aucun changement).
  production_order: {
    label: 'Confirmation d\'un ordre de fabrication',
    effect: 'L\'ordre est confirmé : besoins calculés, bon de sortie généré.',
    fields: {
      planned_qty: { label: 'Quantité planifiée totale', kind: 'number', unit: 'u' },
      items: { label: 'Nombre d\'articles', kind: 'number' },
      estimated_cost: { label: 'Coût matière estimé', kind: 'number', unit: 'DH' },
    },
  },
  production_start: {
    label: 'Démarrage de la production',
    effect: 'L\'ordre passe en cours de fabrication.',
    fields: {
      planned_qty: { label: 'Quantité planifiée totale', kind: 'number', unit: 'u' },
      items: { label: 'Nombre d\'articles', kind: 'number' },
    },
  },
  production_closure: {
    label: 'Clôture d\'un ordre de fabrication',
    effect: 'La déclaration peut être enregistrée : lots créés, coût réel calculé.',
    fields: {
      yield_gap_pct: { label: 'Écart au planifié (valeur absolue)', kind: 'number', unit: '%' },
      actual_qty: { label: 'Quantité déclarée', kind: 'number', unit: 'u' },
      partial: { label: 'Clôture partielle', kind: 'enum', options: [{ value: 'yes', label: 'Oui' }, { value: 'no', label: 'Non' }] },
    },
  },
  lot_release: {
    label: 'Libération d\'un lot de produit fini',
    effect: 'Le lot devient disponible à la vente.',
    fields: {
      failed_inspections: { label: 'Contrôles non conformes', kind: 'number' },
      quantity: { label: 'Quantité du lot', kind: 'number', unit: 'u' },
    },
  },
  nonconformity: {
    label: 'Clôture d\'une non-conformité',
    effect: 'La non-conformité est clôturée.',
    fields: {
      severity: { label: 'Gravité', kind: 'enum', options: [{ value: 'low', label: 'Faible' }, { value: 'medium', label: 'Moyenne' }, { value: 'high', label: 'Élevée' }] },
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

/**
 * Condition d'une règle. Trois formes, imbriquables :
 *   - feuille   : { field, op, value } ;
 *   - ET        : { all: [cond, ...] } — toutes doivent correspondre ;
 *   - OU        : { any: [cond, ...] } — au moins une.
 * Un barème « BC d'un magasinier au-dessus de 1 000 DH » s'écrit donc
 *   { all: [ {field:'buyer_role', op:'eq', value:'magasinier'},
 *            {field:'amount', op:'gt', value:1000} ] }.
 * Quand la valeur soumise pour un champ est une LISTE (ex. les catégories des
 * lignes du BC), eq/neq valent appartenance / non-appartenance.
 */
export interface ApprovalCondition {
  field?: string;
  op?: ApprovalOp;
  value?: number | string;
  all?: ApprovalCondition[];
  any?: ApprovalCondition[];
}

export type ApprovalRequestStatus = 'pending' | 'approved' | 'rejected' | 'cancelled';
export type ApprovalStepStatus = 'waiting' | 'pending' | 'approved' | 'rejected' | 'skipped';

export const APPROVAL_REQUEST_STATUS_LABELS: Record<ApprovalRequestStatus, string> = {
  pending: 'En attente', approved: 'Approuvée', rejected: 'Refusée', cancelled: 'Annulée',
};

export const APPROVAL_STEP_STATUS_LABELS: Record<ApprovalStepStatus, string> = {
  waiting: 'À venir', pending: 'En cours', approved: 'Approuvée', rejected: 'Refusée', skipped: 'Sans objet',
};

/** Condition vide = toujours. Gère les formes composées all / any. */
export function approvalConditionMatches(cond: ApprovalCondition | null | undefined, values: Record<string, unknown>): boolean {
  if (!cond) return true;
  if (Array.isArray(cond.all)) return cond.all.every(c => approvalConditionMatches(c, values));
  if (Array.isArray(cond.any)) return cond.any.length === 0 || cond.any.some(c => approvalConditionMatches(c, values));
  if (!cond.field) return true;
  const v = values[cond.field];
  if (v === undefined || v === null) return false;
  const t = cond.value;
  // Valeur-liste (ex. catégories des lignes du BC) : eq = appartenance.
  if (Array.isArray(v)) {
    const set = v.map(String);
    if (cond.op === 'eq') return set.includes(String(t));
    if (cond.op === 'neq') return !set.includes(String(t));
    return false;
  }
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

/** « Engagement ≥ 5 000 DH », « Magasinier ET > 1 000 DH », pour les écrans. */
export function describeApprovalCondition(docType: string, cond: ApprovalCondition | null | undefined): string {
  if (!cond) return 'Toujours';
  if (Array.isArray(cond.all)) {
    const parts = cond.all.map(c => describeApprovalCondition(docType, c)).filter(p => p !== 'Toujours');
    return parts.length ? parts.join(' et ') : 'Toujours';
  }
  if (Array.isArray(cond.any)) {
    const parts = cond.any.map(c => describeApprovalCondition(docType, c)).filter(p => p !== 'Toujours');
    return parts.length ? parts.join(' ou ') : 'Toujours';
  }
  if (!cond.field) return 'Toujours';
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
