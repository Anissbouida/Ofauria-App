import { z } from 'zod';
import { moneyAmount, positiveQuantity } from './product-loss.validator.js';

const uuid = z.string().uuid('Identifiant UUID invalide');

// 'mixed' (mig 250) : reglement partage especes + carte, ventile via
// cashAmount/cardAmount dont la somme doit valoir le total (verifie controller).
const PAYMENT_METHODS = ['cash', 'card', 'mobile', 'check', 'credit', 'mixed'] as const;

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
  // Canal de vente (mig 172). Si absent, le controller resout le canal par defaut.
  channelId: uuid.optional().nullable(),
  // Ventilation d'un paiement mixte (mig 250). Obligatoires quand
  // paymentMethod='mixed' ; la coherence cashAmount+cardAmount=total est
  // verifiee dans le controller (le total est calcule cote serveur).
  cashAmount: z.coerce.number()
    .finite('Montant especes invalide')
    .min(0, 'Montant especes ne peut etre negatif')
    .max(999999.99, 'Montant especes trop eleve')
    .optional(),
  cardAmount: z.coerce.number()
    .finite('Montant carte invalide')
    .min(0, 'Montant carte ne peut etre negatif')
    .max(999999.99, 'Montant carte trop eleve')
    .optional(),
}).superRefine((data, ctx) => {
  if (data.paymentMethod === 'mixed' && data.paymentStatus !== 'unpaid') {
    if (data.cashAmount === undefined || data.cardAmount === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'cashAmount et cardAmount sont requis pour un paiement mixte',
      });
    }
  }
});

// Encaissement d'une vente a plus tard. 'credit' est exclu : c'est le marqueur
// d'une vente non encaissee, pas un mode de reglement.
const SETTLEMENT_METHODS = ['cash', 'card', 'mobile', 'check'] as const;

export const paySaleSchema = z.object({
  paymentMethod: z.enum(SETTLEMENT_METHODS),
  // Date d'encaissement choisie (AAAA-MM-JJ). Absente : encaissement immediat.
  paidAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date attendue au format AAAA-MM-JJ').optional(),
});

// Vente speciale B2B : prix unitaires negocies par ligne. Pas de stock vitrine
// deduit. Client B2B obligatoire (selection d'un customer existant).
const specialSaleItemSchema = z.object({
  productId: uuid,
  quantity: positiveQuantity,
  // Prix unitaire negocie pour cette ligne — saisi par l'admin/manager.
  unitPrice: z.coerce.number()
    .finite('Prix unitaire invalide')
    .min(0, 'Prix unitaire ne peut etre negatif')
    .max(999999.99, 'Prix unitaire trop eleve'),
});

const SPECIAL_PAYMENT_METHODS = ['cash', 'card', 'mobile', 'check', 'credit', 'transfer'] as const;

export const specialSaleSchema = z.object({
  customerId: uuid, // obligatoire pour la tracabilite B2B
  items: z.array(specialSaleItemSchema).min(1, 'Au moins un article requis').max(500),
  paymentMethod: z.enum(SPECIAL_PAYMENT_METHODS),
  paymentStatus: z.enum(['paid', 'unpaid']).optional().default('paid'),
  // Remise globale en plus des prix negocies (optionnelle).
  discountAmount: z.coerce.number()
    .finite('Remise invalide')
    .min(0, 'Remise ne peut etre negative')
    .max(999999.99, 'Remise trop elevee')
    .optional()
    .default(0),
  notes: z.string().trim().max(1000).optional(),
  // Date de la vente : permet de saisir une vente anterieure (ex: facturation
  // d'une livraison de la semaine passee). Defaut = maintenant.
  saleDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date attendue au format AAAA-MM-JJ').optional(),
});

export { moneyAmount, positiveQuantity };
