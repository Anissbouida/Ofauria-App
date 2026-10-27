import { z } from 'zod';
import { reasonCodeSchema } from './purchase-order-action.validator.js';

/**
 * Paiements (mig 310, D7). Le corps de POST /payments reste ouvert (passthrough) :
 * il est partagé par la paie, les charges et les factures. On ne contrôle ici que
 * ce qui engage l'argent : montant, date, mode typé, dérogation espèces.
 */
const isoDate = z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date au format AAAA-MM-JJ');
const cashOverrideSchema = z.object({
  reasonCodeId: z.string().uuid('Motif de dérogation requis'),
  note: z.string().trim().max(1000).optional().nullable().transform(v => (v ? v : null)),
});

export const createPaymentSchema = z.object({
  amount: z.coerce.number().finite().positive('Le montant doit être positif').max(100_000_000),
  paymentDate: isoDate,
  paymentMode: z.string().trim().min(1).max(20).optional().nullable(),
  paymentMethod: z.string().trim().max(20).optional().nullable(),
  treasuryAccountId: z.string().uuid().optional().nullable(),
  cashOverride: cashOverrideSchema.optional().nullable(),
  // Mig 368 : règlement d'une facture en devise (le montant DH est recalculé par le serveur).
  foreignAmount: z.coerce.number().finite().positive().max(100_000_000).optional().nullable(),
  exchangeRate: z.coerce.number().finite().positive().max(100_000).optional().nullable(),
}).passthrough().refine(d => !!(d.paymentMode || d.paymentMethod), { message: 'Mode de paiement requis', path: ['paymentMode'] });

/** Modification : uniquement les champs descriptifs (le reste est figé par la base). */
export const updatePaymentSchema = z.object({
  categoryId: z.string().uuid().optional().nullable(),
  description: z.string().trim().max(2000).optional(),
  reference: z.string().trim().max(50).optional().nullable(),
  checkDate: isoDate.optional().nullable(),
  amount: z.coerce.number().finite().positive().optional(),
  paymentMethod: z.string().trim().max(20).optional(),
  paymentDate: isoDate.optional(),
});

export const voidPaymentSchema = reasonCodeSchema;

export const reissuePaymentSchema = z.object({
  paymentMode: z.string().trim().min(1).max(20),
  reference: z.string().trim().max(50).optional().nullable(),
  checkNumber: z.string().trim().max(50).optional().nullable(),
  checkDate: isoDate.optional().nullable(),
  paymentDate: isoDate,
  treasuryAccountId: z.string().uuid().optional().nullable(),
  cashOverride: cashOverrideSchema.optional().nullable(),
});

export const internalTransferSchema = z.object({
  fromAccountId: z.string().uuid('Compte source requis'),
  toAccountId: z.string().uuid('Compte destination requis'),
  amount: z.coerce.number().finite().positive('Le montant doit être positif').max(100_000_000),
  paymentDate: isoDate,
  reference: z.string().trim().max(50).optional().nullable(),
  description: z.string().trim().max(500).optional().nullable(),
}).refine(d => d.fromAccountId !== d.toAccountId, { message: 'Les deux comptes doivent être différents', path: ['toAccountId'] });

export const cashCumulQuerySchema = z.object({
  supplierId: z.string().uuid(),
  date: isoDate,
  amount: z.coerce.number().finite().min(0).optional(),
});
