import { z } from 'zod';
import { optUuid } from './common.validator.js';
import { body, txt, bool } from './route-body.validator.js';

/**
 * G0-07 — Centres de coût (cost-center.routes). cost-center.controller garde ses messages
 * (code et nom requis, facture requise) ; types seulement.
 */
export const createCostCenterSchema = body({ code: txt(40), name: txt(200), axisId: z.string().max(60).nullish() });
export const costCenterActiveSchema = body({ active: bool });
/** Rattachement d'une facture : centre facultatif (null = détacher). */
export const assignCostCenterSchema = body({ invoiceId: optUuid, costCenterId: optUuid });
