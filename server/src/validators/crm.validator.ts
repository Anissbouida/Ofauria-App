import { emptyBody } from './common.validator.js';
import { body, txt, numish } from './route-body.validator.js';

/**
 * G0-07 — CRM (crm.routes). Les gestionnaires en ligne gardent leur schéma détaillé (bornes,
 * messages) ; ces schémas posés devant ne vérifient que les types.
 */
export const crmCampaignSchema = body({ name: txt(300), startDate: txt(40), endDate: txt(40), budget: numish, notes: txt(8000) });
export const crmCampaignStatusSchema = body({ status: txt(30) });
/** Création du client depuis une opportunité : aucun champ lu. */
export const crmNoBodySchema = emptyBody;
