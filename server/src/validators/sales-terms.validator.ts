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
