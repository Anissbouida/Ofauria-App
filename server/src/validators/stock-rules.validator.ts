import { z } from 'zod';

/**
 * Règles métier tranchées par le plan pilote 2026-11 (section 5, « règles ambiguës ») pour le stock.
 *
 * Ces schémas s'AJOUTENT au schéma de type déjà branché sur la route (stock-flow.validator.ts) :
 * la route enchaîne `validate(schemaDeType), validate(schemaDeRègle)`. Ils ne contrôlent que le
 * signe des quantités et laissent passer tout le reste (passthrough).
 */

/** Valeur numérique lue comme le dépôt la lit (Number(v)) ; vide ou null = absente. */
const asNum = (v: unknown) => (v === '' || v == null ? null : Number(v));

/* ─── Transfert de produits finis (règle 5) ─────────────────────────────── */
// Quantité négative refusée ; une ligne à 0 (ou vide) reste ignorée par le dépôt (lignes vides du
// formulaire) ; mais si TOUTES les lignes envoyées sont à 0, la demande est refusée.
export const productTransferRulesSchema = z.object({
  items: z.array(z.object({
    quantity: z.unknown().refine(v => { const n = asNum(v); return n == null || !(n < 0); },
      'Quantité négative : un transfert ne porte que des quantités positives'),
  }).passthrough()).optional(),
}).passthrough().refine(
  b => !Array.isArray(b.items) || b.items.length === 0 || b.items.some(i => { const n = asNum(i.quantity); return n != null && n > 0; }),
  { message: 'Toutes les lignes sont à 0 : saisissez au moins une quantité à transférer', path: ['items'] },
);

/* ─── Contrôle d'ouverture (règle 8) ────────────────────────────────────── */
// Quantités attendue et constatée : entiers ≥ 0 (le type entier est déjà vérifié en amont).
const nonNegCount = (label: string) => z.unknown().refine(v => { const n = asNum(v); return n == null || !(n < 0); },
  `${label} négative : saisissez 0 ou plus`);
export const openingCheckRulesSchema = z.object({
  items: z.array(z.object({
    expectedQty: nonNegCount('Quantité attendue'),
    foundQty: nonNegCount('Quantité constatée'),
  }).passthrough()).optional(),
}).passthrough();
