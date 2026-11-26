import { z } from 'zod';
import { emptyBody } from './common.validator.js';
import { body, txt, numish } from './route-body.validator.js';

/**
 * G0-07 — Conditions commerciales de vente : ristournes (rebates.routes), contrats-cadres
 * (sales-contracts.routes), abonnements (subscription.routes). Les contrôleurs gardent leurs
 * messages (champs requis, statut connu) et les dépôts leurs règles ; types seulement.
 * Volontairement NON imposé : signe du taux de ristourne, du chiffre minimal, des quantités
 * ou valeurs engagées et du montant d'abonnement (le serveur ne les bornait pas).
 */
const ref = z.string().max(60).nullish();

/* Ristournes — rebate.controller.create ; régler / annuler sans corps. */
export const createRebateSchema = body({ customerId: ref, year: numish, ratePercent: numish, minTurnover: numish, notes: txt(2000) });
export const rebateActionSchema = emptyBody;

/* Contrats-cadres — sales-contract.controller ; clôture sans corps. */
export const createSalesContractSchema = body({
  customerId: ref, basis: txt(20), productId: ref, committedQuantity: numish, committedValue: numish, unitPrice: numish,
  startDate: txt(40), endDate: txt(40), notes: txt(2000),
});
export const salesContractReleaseSchema = body({ orderId: ref });
export const salesContractActionSchema = emptyBody;

/* Abonnements — subscription.controller. */
export const createSubscriptionSchema = body({
  customerId: ref, label: txt(300), amount: numish, tvaRate: numish, frequency: txt(20),
  startDate: txt(40), endDate: txt(40), notes: txt(2000),
});
export const generateSubscriptionsSchema = body({ id: ref, asOf: txt(40) });
export const subscriptionStatusSchema = body({ status: txt(20) });

/* Objectifs commerciaux — sales-target.controller.upsert (vendeur et période requis : contrôleur). */
export const salesTargetSchema = body({ salespersonId: ref, periodStart: txt(40), periodEnd: txt(40), targetAmount: numish });

/* Situations de travaux (mig 713) — progress-billings.routes ; validation et annulation sans corps. */
export const progressBillingTermsSchema = body({ retentionPct: numish, advanceAmount: numish, advanceRecoveryPct: numish });
export const progressBillingDraftSchema = body({
  periodEnd: txt(10), notes: txt(2000),
  lines: z.array(z.object({ quoteItemId: z.string().uuid(), pctCumulative: numish })).max(2000).nullish(),
});
export const progressBillingActionSchema = emptyBody;

/* Grilles tarifaires du transport (mig 714) — freight-rates.routes. */
const freightBase = { basis: txt(10), customerId: ref, originZone: txt(80), destinationZone: txt(80) };
export const freightGridSchema = body({
  ...freightBase, name: txt(120), minimumCharge: numish, tvaRate: numish, validFrom: txt(10), validTo: txt(10), isActive: z.boolean().nullish(),
  brackets: z.array(z.object({ upTo: numish, unitPrice: numish, flatPrice: numish })).max(200).nullish(),
});
export const freightPriceSchema = body({ ...freightBase, quantity: numish, date: txt(10) });
