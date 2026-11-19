import { z } from 'zod';

/**
 * G0-07 — ouverture et fermeture de caisse : montants numériques et positifs.
 * Les clés inconnues sont conservées (`passthrough`).
 */
const blank = (v: unknown) => (v === '' || v === null || v === undefined ? undefined : v);
const cash = z.coerce.number({ error: 'Montant invalide' }).finite().min(0, 'Montant négatif refusé').max(100_000_000);
const text = (max: number) => z.preprocess(blank, z.string().max(max).optional());

export const openRegisterSchema = z.object({
  openingAmount: z.preprocess(blank, cash.optional()),
}).passthrough();

export const closeRegisterSchema = z.object({
  closeType: z.preprocess(blank, z.string().regex(/^[a-z_]{1,40}$/, 'Type de fermeture invalide').optional()),
}).passthrough();

export const submitRegisterAmountSchema = z.object({
  actualAmount: cash,
  actualCardAmount: z.preprocess(blank, cash.optional()),
  notes: text(2000),
  differenceReason: text(1000),
  cardDifferenceReason: text(1000),
}).passthrough();
