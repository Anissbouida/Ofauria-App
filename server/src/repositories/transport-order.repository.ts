import { db, withTransaction } from '../config/database.js';
import { nextDocumentNumber } from '../utils/document-number.js';
import { invoiceRepository } from './accounting.repository.js';
import { freightRateRepository } from './freight-rate.repository.js';

/**
 * Ordres de transport (mig 726, feuille de route étape 6.2) : la demande d'un client chargeur,
 * distincte de la commande. Prix calculé par la grille tarifaire (mig 714) selon la base choisie,
 * ou saisi à la main sans base. Cycle : draft → planned (tournée) → in_transit → delivered
 * (preuve de livraison) → facturé ; cancelled avant l'enlèvement.
 */
export class TransportOrderError extends Error {
  constructor(message: string, public statusCode = 400) { super(message); }
}

export type TransportOrderInput = {
  customerId: string; pickupAddress: string; deliveryAddress: string;
  originZone?: string | null; destinationZone?: string | null; pickupDate?: string | null; deliveryDate?: string | null;
  goodsDescription?: string | null; weightKg?: number | null; pallets?: number | null; distanceKm?: number | null;
  pricingBasis?: 'weight' | 'pallet' | 'distance' | null; amountHt?: number | null; tvaRate?: number | null; notes?: string | null;
};

const r2 = (n: number) => Math.round(n * 100) / 100;
const txt = (v: string | null | undefined, max = 2000) => (v ?? '').trim().slice(0, max) || null;

/** Prix : grille si une base est choisie (quantité = poids, palettes ou distance), sinon montant saisi. */
async function priceOf(i: TransportOrderInput) {
  if (i.pricingBasis) {
    const qty = i.pricingBasis === 'weight' ? i.weightKg : i.pricingBasis === 'pallet' ? i.pallets : i.distanceKm;
    if (!(Number(qty) > 0)) throw new TransportOrderError('Renseignez la quantité de la base de prix (poids, palettes ou distance)');
    try {
      const p = await freightRateRepository.price({ basis: i.pricingBasis, quantity: Number(qty), customerId: i.customerId,
        originZone: i.originZone ?? null, destinationZone: i.destinationZone ?? null, date: i.pickupDate ?? null });
      return { gridId: p.gridId as string, amountHt: r2(p.amount), taxAmount: r2(p.taxAmount), totalTtc: r2(p.totalTtc) };
    } catch (e) {
      throw new TransportOrderError((e as Error).message, (e as { statusCode?: number }).statusCode === 404 ? 422 : 400);
    }
  }
  const ht = r2(Math.max(0, Number(i.amountHt ?? 0)));
  const tax = r2(ht * Math.max(0, Number(i.tvaRate ?? 0)) / 100);
  return { gridId: null, amountHt: ht, taxAmount: tax, totalTtc: r2(ht + tax) };
}

const SELECT = `
  SELECT t.*, COALESCE(NULLIF(btrim(c.company_name), ''), btrim(concat_ws(' ', c.first_name, c.last_name))) AS customer_name, r.label AS route_label, r.route_date, r.driver_name, r.vehicle_label,
         i.invoice_number, g.name AS grid_name
    FROM transport_orders t
    JOIN customers c ON c.id = t.customer_id
    LEFT JOIN delivery_routes r ON r.id = t.route_id
    LEFT JOIN invoices i ON i.id = t.invoice_id
    LEFT JOIN freight_rate_grids g ON g.id = t.grid_id`;

export const transportOrderRepository = {
  async list(f: { status?: string | null; routeId?: string | null } = {}) {
    return (await db.query(
      `${SELECT} WHERE ($1::text IS NULL OR t.status = $1) AND ($2::uuid IS NULL OR t.route_id = $2)
        ORDER BY (t.status IN ('delivered', 'cancelled')), t.pickup_date NULLS LAST, t.created_at DESC LIMIT 500`,
      [f.status || null, f.routeId || null])).rows;
  },

  async get(id: string) {
    const row = (await db.query(`${SELECT} WHERE t.id = $1`, [id])).rows[0];
    if (!row) throw new TransportOrderError('Ordre de transport introuvable', 404);
    return row;
  },

  async create(i: TransportOrderInput, userId: string) {
    return withTransaction(async () => {
      const p = await priceOf(i);
      const number = await nextDocumentNumber(db, 'transport_order', i.pickupDate ?? undefined);
      const r = await db.query(
        `INSERT INTO transport_orders (number, customer_id, pickup_address, delivery_address, origin_zone, destination_zone, pickup_date, delivery_date,
                goods_description, weight_kg, pallets, distance_km, pricing_basis, grid_id, amount_ht, tax_amount, total_ttc, notes, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19) RETURNING id`,
        [number, i.customerId, txt(i.pickupAddress), txt(i.deliveryAddress), txt(i.originZone, 80), txt(i.destinationZone, 80), i.pickupDate || null,
          i.deliveryDate || null, txt(i.goodsDescription), i.weightKg ?? null, i.pallets ?? null, i.distanceKm ?? null, i.pricingBasis ?? null,
          p.gridId, p.amountHt, p.taxAmount, p.totalTtc, txt(i.notes), userId]);
      return this.get(r.rows[0].id);
    });
  },

  /** Modifiable tant que la marchandise n'est pas enlevée ; le prix est recalculé. */
  async update(id: string, i: TransportOrderInput) {
    return withTransaction(async () => {
      const cur = (await db.query(`SELECT status FROM transport_orders WHERE id = $1 FOR UPDATE`, [id])).rows[0];
      if (!cur) throw new TransportOrderError('Ordre de transport introuvable', 404);
      if (!['draft', 'planned'].includes(cur.status)) throw new TransportOrderError('Un ordre enlevé, livré ou annulé ne se modifie plus', 409);
      const p = await priceOf(i);
      await db.query(
        `UPDATE transport_orders SET customer_id=$2, pickup_address=$3, delivery_address=$4, origin_zone=$5, destination_zone=$6, pickup_date=$7,
                delivery_date=$8, goods_description=$9, weight_kg=$10, pallets=$11, distance_km=$12, pricing_basis=$13, grid_id=$14,
                amount_ht=$15, tax_amount=$16, total_ttc=$17, notes=$18, updated_at=now() WHERE id=$1`,
        [id, i.customerId, txt(i.pickupAddress), txt(i.deliveryAddress), txt(i.originZone, 80), txt(i.destinationZone, 80), i.pickupDate || null,
          i.deliveryDate || null, txt(i.goodsDescription), i.weightKg ?? null, i.pallets ?? null, i.distanceKm ?? null, i.pricingBasis ?? null,
          p.gridId, p.amountHt, p.taxAmount, p.totalTtc, txt(i.notes)]);
      return this.get(id);
    });
  },

  /** Affectation à une tournée non terminée (chauffeur et véhicule sont ceux de la tournée). */
  async plan(id: string, routeId: string) {
    const route = (await db.query(`SELECT status FROM delivery_routes WHERE id = $1`, [routeId])).rows[0];
    if (!route) throw new TransportOrderError('Tournée introuvable', 404);
    if (route.status === 'done') throw new TransportOrderError('Cette tournée est terminée', 409);
    const r = await db.query(
      `UPDATE transport_orders SET route_id = $2, status = 'planned', updated_at = now() WHERE id = $1 AND status IN ('draft', 'planned') RETURNING id`,
      [id, routeId]);
    if (!r.rowCount) throw new TransportOrderError('Seul un ordre saisi ou planifié s\'affecte à une tournée', 409);
    return this.get(id);
  },

  async pickup(id: string) {
    const r = await db.query(
      `UPDATE transport_orders SET status = 'in_transit', picked_up_at = now(), updated_at = now() WHERE id = $1 AND status = 'planned' RETURNING id`, [id]);
    if (!r.rowCount) throw new TransportOrderError('L\'enlèvement suit la planification sur une tournée', 409);
    return this.get(id);
  },

  /** Preuve de livraison : nom du réceptionnaire obligatoire, réserve éventuelle. */
  async deliver(id: string, podName: string, podNote?: string | null) {
    const name = txt(podName, 120);
    if (!name) throw new TransportOrderError('Indiquez le nom de la personne qui a réceptionné la marchandise');
    const r = await db.query(
      `UPDATE transport_orders SET status = 'delivered', delivered_at = now(), picked_up_at = COALESCE(picked_up_at, now()),
              pod_name = $2, pod_note = $3, updated_at = now()
        WHERE id = $1 AND status IN ('planned', 'in_transit') RETURNING id`, [id, name, txt(podNote)]);
    if (!r.rowCount) throw new TransportOrderError('Seul un ordre planifié ou en cours se livre', 409);
    return this.get(id);
  },

  async cancel(id: string) {
    const r = await db.query(
      `UPDATE transport_orders SET status = 'cancelled', route_id = NULL, updated_at = now() WHERE id = $1 AND status IN ('draft', 'planned') RETURNING id`, [id]);
    if (!r.rowCount) throw new TransportOrderError('Un ordre enlevé ou livré ne s\'annule plus', 409);
    return this.get(id);
  },

  /** Facture émise de la prestation, une seule fois, après la preuve de livraison. */
  async invoice(id: string, userId: string) {
    return withTransaction(async () => {
      const t = (await db.query(
        `SELECT t.*, (SELECT COALESCE(delai_paiement_jours, 0) FROM customers c WHERE c.id = t.customer_id) AS term
           FROM transport_orders t WHERE t.id = $1 FOR UPDATE`, [id])).rows[0];
      if (!t) throw new TransportOrderError('Ordre de transport introuvable', 404);
      if (t.status !== 'delivered') throw new TransportOrderError('Un ordre se facture après la preuve de livraison');
      if (t.invoice_id) throw new TransportOrderError('Cet ordre est déjà facturé', 409);
      if (!(Number(t.amount_ht) > 0)) throw new TransportOrderError('Cet ordre n\'a pas de prix : renseignez-le avant de facturer');
      const ht = Number(t.amount_ht);
      const rate = ht > 0 ? r2(Number(t.tax_amount) / ht * 100) : 0;
      const date = new Date().toISOString().slice(0, 10);
      const due = new Date(Date.now() + Number(t.term || 0) * 86400000).toISOString().slice(0, 10);
      const route = `${String(t.pickup_address).split('\n')[0]} → ${String(t.delivery_address).split('\n')[0]}`;
      const inv = await invoiceRepository.create({
        invoiceType: 'emitted', customerId: t.customer_id, invoiceDate: date, dueDate: due,
        amount: ht, taxAmount: Number(t.tax_amount), totalAmount: Number(t.total_ttc),
        items: [{ description: `Transport ${t.number} — ${route}`.slice(0, 500), quantity: 1, unitPrice: ht, subtotal: ht, tvaRate: rate || null }],
        notes: `Ordre de transport ${t.number}, livré le ${new Date(t.delivered_at).toLocaleDateString('fr-FR')} (réceptionné par ${t.pod_name}).`,
        createdBy: userId,
      });
      await db.query(`UPDATE transport_orders SET invoice_id = $2, updated_at = now() WHERE id = $1`, [id, inv.id]);
      return this.get(id);
    });
  },
};
