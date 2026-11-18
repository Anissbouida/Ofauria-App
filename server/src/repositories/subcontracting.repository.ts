import { db, withTransaction } from '../config/database.js';
import { nextDocumentNumber } from '../utils/document-number.js';

/**
 * Sous-traitance de production (M9, mig 584).
 * Parcours : ordre d'un type « sous-traité » → sous-traitant + prix de façon → bon d'envoi
 * des composants (fige les quantités envoyées) → réception du produit fini par la déclaration
 * de production existante (lots, consommation des matières) → coût de façon dans le coût
 * de revient (prix unitaire × quantité reçue).
 */
export class SubcontractError extends Error {
  constructor(message: string, public status = 409) { super(message); }
}

type Runner = { query: (text: string, params?: unknown[]) => Promise<{ rows: any[] }> };
const r4 = (v: number) => Math.round(v * 10000) / 10000;
const r2 = (v: number) => Math.round(v * 100) / 100;

async function planWithType(planId: string, runner: Runner = db) {
  const r = await runner.query(
    `SELECT p.id, p.status, p.subcontractor_id, p.subcontract_unit_fee, p.subcontract_status, p.subcontract_received_at,
            COALESCE(t.is_subcontracting, false) AS is_subcontracting, s.name AS subcontractor_name
       FROM production_plans p
       LEFT JOIN production_order_types t ON t.id = p.order_type_id
       LEFT JOIN suppliers s ON s.id = p.subcontractor_id
      WHERE p.id = $1::uuid`, [planId]);
  return r.rows[0] as Record<string, any> | undefined;
}

/** Coût de façon : prix unitaire × quantité reçue (pure, testée sans base). */
export function subcontractFee(unitFee: number | null, receivedQty: number) {
  if (unitFee == null || !(unitFee >= 0)) return { amount: 0, detail: null };
  const amount = r2(unitFee * receivedQty);
  return { amount, detail: { unit_fee: unitFee, quantity: receivedQty, amount } };
}

export const subcontractingRepository = {
  /** Fiche de sous-traitance de l'ordre (null si l'ordre n'est pas sous-traité). */
  async get(planId: string) {
    const p = await planWithType(planId);
    if (!p || !p.is_subcontracting) return null;
    const shipments = (await db.query(
      `SELECT s.id, s.numero, s.shipped_at, s.notes, NULLIF(concat_ws(' ', u.first_name, u.last_name), '') AS shipped_by_name,
              COALESCE((SELECT json_agg(json_build_object('ingredient_id', l.ingredient_id, 'label', l.label, 'quantity', l.quantity::float8, 'unit', l.unit) ORDER BY l.label)
                          FROM subcontract_shipment_lines l WHERE l.shipment_id = s.id), '[]') AS lines
         FROM subcontract_shipments s LEFT JOIN users u ON u.id = s.shipped_by
        WHERE s.plan_id = $1::uuid ORDER BY s.shipped_at`, [planId])).rows;
    const received = await this.receivedQuantity(planId);
    const unitFee = p.subcontract_unit_fee != null ? Number(p.subcontract_unit_fee) : null;
    return {
      subcontractorId: p.subcontractor_id as string | null, subcontractorName: p.subcontractor_name as string | null,
      unitFee, status: (p.subcontract_status as string | null) ?? 'to_ship',
      receivedAt: p.subcontract_received_at, receivedQuantity: received,
      fee: subcontractFee(unitFee, received),
      shipments,
    };
  },

  /** Sous-traitant et prix de façon : modifiables tant que rien n'est reçu. */
  async setup(planId: string, input: { supplierId: string; unitFee: number | null }) {
    const p = await planWithType(planId);
    if (!p) throw new SubcontractError('Ordre introuvable', 404);
    if (!p.is_subcontracting) throw new SubcontractError('Le type de cet ordre n\'est pas « sous-traité »');
    if (p.subcontract_status === 'received' || ['completed', 'cancelled'].includes(p.status)) throw new SubcontractError('Ordre déjà reçu ou clos');
    const s = (await db.query(`SELECT id FROM suppliers WHERE id = $1::uuid AND is_active`, [input.supplierId])).rows[0];
    if (!s) throw new SubcontractError('Sous-traitant inconnu ou inactif', 400);
    await db.query(
      `UPDATE production_plans SET subcontractor_id = $2::uuid, subcontract_unit_fee = $3::numeric,
              subcontract_status = COALESCE(subcontract_status, 'to_ship') WHERE id = $1::uuid`,
      [planId, input.supplierId, input.unitFee]);
    return this.get(planId);
  },

  /** Bon d'envoi des composants : quantités = besoins calculés de l'ordre (figées à l'envoi). */
  async ship(planId: string, userId: string, notes?: string | null) {
    // withTransaction : db.query utilise la transaction en cours (contexte asynchrone).
    return withTransaction(async () => {
      const client = db;
      const p = await planWithType(planId, client);
      if (!p) throw new SubcontractError('Ordre introuvable', 404);
      if (!p.is_subcontracting) throw new SubcontractError('Le type de cet ordre n\'est pas « sous-traité »');
      if (!p.subcontractor_id) throw new SubcontractError('Choisissez d\'abord le sous-traitant');
      if (!['confirmed', 'ready_to_produce', 'in_progress'].includes(p.status)) throw new SubcontractError('Confirmez l\'ordre avant d\'envoyer les composants');
      if (p.subcontract_status && p.subcontract_status !== 'to_ship') throw new SubcontractError('Composants déjà envoyés');
      const needs = (await client.query(
        `SELECT n.ingredient_id, i.name, i.unit, SUM(n.needed_quantity)::float8 AS qty
           FROM production_ingredient_needs n JOIN ingredients i ON i.id = n.ingredient_id
          WHERE n.plan_id = $1::uuid GROUP BY n.ingredient_id, i.name, i.unit ORDER BY i.name`, [planId])).rows;
      const numero = await nextDocumentNumber(client, 'subcontract_shipment');
      const sh = (await client.query(
        `INSERT INTO subcontract_shipments (plan_id, supplier_id, numero, shipped_by, notes)
         VALUES ($1::uuid, $2::uuid, $3::text, $4::uuid, $5::text) RETURNING id`,
        [planId, p.subcontractor_id, numero, userId, notes?.trim() || null])).rows[0];
      for (const n of needs) {
        await client.query(
          `INSERT INTO subcontract_shipment_lines (shipment_id, ingredient_id, label, quantity, unit) VALUES ($1, $2, $3, $4::numeric, $5)`,
          [sh.id, n.ingredient_id, n.name, r4(Number(n.qty)), n.unit]);
      }
      await client.query(`UPDATE production_plans SET subcontract_status = 'shipped' WHERE id = $1::uuid`, [planId]);
      return { id: sh.id as string, numero, lines: needs.length };
    });
  },

  /** Garde avant la réception (déclaration) : message d'erreur, ou null si permise. */
  async receptionBlocker(planId: string): Promise<string | null> {
    const p = await planWithType(planId);
    if (!p?.is_subcontracting) return null;
    if (!p.subcontractor_id) return 'Ordre sous-traité : choisissez d\'abord le sous-traitant';
    if (!p.subcontract_status || p.subcontract_status === 'to_ship') return 'Ordre sous-traité : envoyez d\'abord les composants (bon d\'envoi)';
    return null;
  },

  /** Après une déclaration : l'ordre sous-traité passe « reçu ». */
  async markReceived(planId: string) {
    await db.query(
      `UPDATE production_plans p SET subcontract_status = 'received', subcontract_received_at = COALESCE(subcontract_received_at, now())
        WHERE p.id = $1::uuid AND p.subcontract_status = 'shipped'
          AND EXISTS (SELECT 1 FROM production_order_types t WHERE t.id = p.order_type_id AND t.is_subcontracting)`, [planId]);
  },

  async receivedQuantity(planId: string): Promise<number> {
    const r = await db.query(
      `SELECT COALESCE(SUM(actual_quantity), 0)::float8 AS q FROM production_plan_items WHERE plan_id = $1::uuid AND status <> 'cancelled'`, [planId]);
    return Number(r.rows[0].q) || 0;
  },

  /** Composante « façon » du coût de revient (0 pour un ordre non sous-traité). */
  async feeCost(planId: string) {
    const p = await planWithType(planId);
    if (!p?.is_subcontracting) return { amount: 0, detail: null };
    return subcontractFee(p.subcontract_unit_fee != null ? Number(p.subcontract_unit_fee) : null, await this.receivedQuantity(planId));
  },

  /** Ordres sous-traités non clos (suivi). */
  async listOpen() {
    return (await db.query(
      `SELECT p.id, p.of_number, p.plan_date, p.status, p.subcontract_status, p.subcontract_unit_fee::float8 AS unit_fee, s.name AS subcontractor_name
         FROM production_plans p JOIN production_order_types t ON t.id = p.order_type_id AND t.is_subcontracting
         LEFT JOIN suppliers s ON s.id = p.subcontractor_id
        WHERE p.status NOT IN ('completed', 'cancelled') ORDER BY p.plan_date DESC LIMIT 200`)).rows;
  },
};
