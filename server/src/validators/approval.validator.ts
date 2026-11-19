import { z } from 'zod';
import { body, txt } from './route-body.validator.js';

/**
 * G0-07 — Demandes d'approbation (approval.routes). approval.controller ne lit qu'un motif
 * facultatif (texte) ; la délégation est vérifiée par approvalService. Types seulement.
 */
export const approvalDecisionSchema = body({ reason: txt(2000) });
export const approvalDelegationSchema = body({ toUserId: z.string().max(60).nullish(), startsOn: txt(40), endsOn: txt(40) });
