import { db } from '../config/database.js';
import { approvalService } from './approval.service.js';
import type { ApprovalDocType } from '@ofauria/shared';

/**
 * Approbations de production (plan d'exécution multi-industries, étape 6).
 *
 * Confirmation, démarrage, clôture d'un ordre, libération d'un lot et clôture d'une
 * non-conformité passent par le moteur d'approbation générique. Sans règle active pour le
 * type de pièce, rien ne change (comportement historique). Avec une règle applicable :
 *   - la première tentative crée la demande et refuse l'action (409, « approbation demandée ») ;
 *   - tant que la demande est en attente, l'action reste refusée ;
 *   - approuvée : l'effet est appliqué par le gestionnaire (confirmation, démarrage, libération,
 *     clôture de la non-conformité) ; pour la clôture d'un ordre, la déclaration est ensuite
 *     acceptée (elle porte les quantités saisies, que la demande ne conserve pas) ;
 *   - refusée : une nouvelle tentative crée une nouvelle demande.
 */
export class ApprovalPendingError extends Error {
  statusCode = 409;
  code = 'APPROVAL_PENDING';
  constructor(message: string, public requestId: string) { super(message); }
}

type GateInput = {
  docType: ApprovalDocType; docId: string; docLabel: string;
  values: Record<string, number | string | boolean | null | string[]>;
  userId: string; storeId?: string | null;
};

/** Laisse passer, ou lève ApprovalPendingError. Une demande approuvée et non consommée laisse passer une fois. */
export async function gateApproval(input: GateInput): Promise<void> {
  const last = (await db.query(
    `SELECT id, status, applied_at FROM approval_requests WHERE doc_type = $1 AND doc_id = $2 ORDER BY requested_at DESC LIMIT 1`,
    [input.docType, input.docId])).rows[0];
  if (last?.status === 'approved') return;
  if (last?.status === 'pending') throw new ApprovalPendingError(`Approbation en attente pour « ${input.docLabel} ».`, last.id);
  const r = await approvalService.submit({
    docType: input.docType, docId: input.docId, docLabel: input.docLabel, amount: null,
    values: input.values, requestedBy: input.userId, storeId: input.storeId ?? null,
  });
  if (r.outcome === 'not_required') return;
  throw new ApprovalPendingError(`Approbation demandée pour « ${input.docLabel} » : l'action sera possible après décision.`, r.request.id);
}

/** Valeurs d'un ordre pour les conditions des règles (quantités, articles, coût matière estimé). */
export async function planApprovalValues(planId: string) {
  const r = (await db.query(
    `SELECT pp.of_number,
            COALESCE(sum(i.planned_quantity), 0)::float8 AS planned_qty, count(i.id)::int AS items,
            (SELECT COALESCE(sum(n.needed_quantity * COALESCE(ing.unit_cost, 0)), 0)::float8
               FROM production_ingredient_needs n JOIN ingredients ing ON ing.id = n.ingredient_id WHERE n.plan_id = pp.id) AS estimated_cost
       FROM production_plans pp LEFT JOIN production_plan_items i ON i.plan_id = pp.id
      WHERE pp.id = $1 GROUP BY pp.id`, [planId])).rows[0];
  return { label: `Ordre ${r?.of_number ?? planId.slice(0, 8)}`, planned_qty: r?.planned_qty ?? 0, items: r?.items ?? 0, estimated_cost: r?.estimated_cost ?? 0 };
}

/** Libération d'un lot de produit fini (route qualité). Lot introuvable : laisse la route répondre. */
export async function gateLotRelease(lotId: string, userId: string, storeId?: string | null): Promise<void> {
  const lot = (await db.query(
    `SELECT pl.lot_number, (pl.backroom_qty + pl.vitrine_qty)::float8 AS qty,
            (SELECT count(*)::int FROM quality_inspections qi WHERE qi.product_lot_id = pl.id AND qi.status = 'faite' AND NOT qi.conformity) AS failed
       FROM product_lots pl WHERE pl.id = $1`, [lotId])).rows[0];
  if (!lot) return;
  await gateApproval({ docType: 'lot_release', docId: lotId, docLabel: `Lot ${lot.lot_number}`,
    values: { failed_inspections: lot.failed, quantity: lot.qty }, userId, storeId });
}

/** Clôture d'une non-conformité encore ouverte. */
export async function gateNonconformityClosure(ncId: string, severity: string | undefined, userId: string, storeId?: string | null): Promise<void> {
  const cur = (await db.query(`SELECT status, severity, nc_number, title FROM quality_nonconformities WHERE id = $1`, [ncId])).rows[0];
  if (!cur || cur.status === 'closed') return;
  await gateApproval({ docType: 'nonconformity', docId: ncId, docLabel: `${cur.nc_number ?? ''} ${cur.title}`.trim(),
    values: { severity: severity ?? cur.severity }, userId, storeId });
}
