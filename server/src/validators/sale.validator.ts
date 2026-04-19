import { z } from 'zod';
import { moneyAmount, positiveQuantity } from './product-loss.validator.js';

const uuid = z.string().uuid('Identifiant UUID invalide');

const PAYMENT_METHODS = ['cash', 'card', 'mobile', 'check', 'credit'] as const;

const saleItemSchema = z.object({
  productId: uuid,
  quantity: positiveQuantity,
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
});

export { moneyAmount, positiveQuantity };
