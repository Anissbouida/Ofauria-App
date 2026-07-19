import { z } from 'zod';

const uuid = z.string().uuid('Identifiant UUID invalide');

// Retour d'un article deja vendu : on n'accepte que saleItemId + quantity.
// unit_price/subtotal sont recalcules exclusivement cote serveur depuis
// sale_items — le client ne doit JAMAIS piloter le montant du remboursement
// (audit V2 : sinon vecteur de fraude direct via subtotal arbitraire).
const returnItemSchema = z.object({
  saleItemId: uuid,
  // Positive : on retourne des unites/grammes, pas d'annulation par quantite
  // negative. Max 100000 pour aligner avec les autres validators.
  quantity: z.coerce.number()
    .finite('Quantite invalide')
    .positive('La quantite doit etre strictement positive')
    .max(100000, 'Quantite trop elevee'),
});

// Echange : selection d'un produit de remplacement (peut differer de la ligne
// retournee). Le prix est resolu cote serveur depuis products.price.
const exchangeProductSchema = z.object({
  saleItemId: uuid,
  newProductId: uuid,
  quantity: z.coerce.number()
    .finite('Quantite invalide')
    .positive('La quantite doit etre strictement positive')
    .max(100000, 'Quantite trop elevee'),
});

// Modes acceptes pour l'encaissement du complement d'echange. Aligne avec
// PAYMENT_METHODS de sale.validator. Si absent -> 'cash' par defaut.
const EXCHANGE_PAYMENT_METHODS = ['cash', 'card', 'mobile'] as const;

export const createReturnSchema = z.object({
  originalSaleId: uuid,
  type: z.enum(['return', 'exchange']),
  reason: z.string().trim().max(500).optional(),
  items: z.array(returnItemSchema).min(1, 'Au moins un article a retourner').max(200),
  exchangeProducts: z.array(exchangeProductSchema).min(1).max(200).optional(),
  // Mode de reglement du complement d'echange (si le client paie une difference
  // positive). Par defaut 'cash' — historiquement code en dur.
  exchangePaymentMethod: z.enum(EXCHANGE_PAYMENT_METHODS).optional(),
}).refine(
  (d) => d.type !== 'exchange' || (Array.isArray(d.exchangeProducts) && d.exchangeProducts.length > 0),
  { message: 'Produits de remplacement requis pour un echange', path: ['exchangeProducts'] }
);
