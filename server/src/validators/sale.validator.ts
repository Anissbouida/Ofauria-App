import { z } from 'zod';
import { moneyAmount, positiveQuantity } from './product-loss.validator.js';

const uuid = z.string().uuid('Identifiant UUID invalide');

const PAYMENT_METHODS = ['cash', 'card', 'mobile', 'check', 'credit'] as const;

const saleItemSchema = z.object({
  productId: uuid,
  // Pour les produits unitaires : nombre de pièces.
  // Pour les produits au poids : nombre de grammes (entier, saisi à la caisse).
  // Côté serveur on vérifie la cohérence avec product.sale_unit.
  quantity: positiveQuantity,
  // Unité de saisie choisie au POS pour un produit au poids ('g' ou 'kg').
  // Purement cosmétique : memorisee pour afficher le recu dans la meme unite.
  // Ignoree pour les produits unitaires.
  displayUnit: z.enum(['g', 'kg']).optional(),
  // prix et subtotal sont calcules cote serveur, pas envoyes par le client
});

export const checkoutSchema = z.object({
  customerId: uuid.optional(),
  items: z.array(saleItemSchema).min(1, 'Au moins un article requis').max(200),
  paymentMethod: z.enum(PAYMENT_METHODS),
  notes: z.string().trim().max(1000).optional(),
  // Remise : >= 0, pas d'upper bound ici (verifie contre subtotal dans le controller)
  discountAmount: z.coerce.number()
    .finite('Remise invalide')
    .min(0, 'Remise ne peut etre negative')
    .max(999999.99, 'Remise trop elevee')
    .optional()
    .default(0),
  // Paiement reporte : la vente est enregistree mais non encaissee.
  // Le client part avec la marchandise (stock decremente normalement).
  paymentStatus: z.enum(['paid', 'unpaid']).optional().default('paid'),
  // Nom libre du beneficiaire quand customerId n'est pas fourni (ex: personnel).
  unpaidCustomerName: z.string().trim().min(1).max(120).optional(),
  // Employe qui realise la vente (selecteur explicite au POS). Si absent, le
  // controller utilise le dernier pointage actif du store comme fallback.
  employeeId: uuid.optional(),
  // Sachets : compteur cote vendeuse + suggestion calculee + motif si override
  // a la hausse. Tous optionnels pour ne pas casser les clients existants.
  sachetsGiven: z.coerce.number().int().min(0).max(50).optional(),
  sachetsSuggested: z.coerce.number().int().min(0).max(50).optional(),
  sachetReason: z.enum([
    'client_demande', 'produit_fragile', 'produit_chaud', 'double_sachet', 'autre',
  ]).optional(),
});

export const paySaleSchema = z.object({
  paymentMethod: z.enum(PAYMENT_METHODS),
});

export { moneyAmount, positiveQuantity };
