import { emptyBody } from './common.validator.js';
import { body, txt, numish, bool } from './route-body.validator.js';

/**
 * G0-07 — Relances clients (dunning.routes). Le gestionnaire du niveau garde son schéma
 * détaillé (bornes, messages) ; celui-ci, posé devant, ne vérifie que les types.
 */
export const dunningLevelSchema = body({
  label: txt(200), daysAfterDue: numish, feeAmount: numish, interestRate: numish,
  subject: txt(400), body: txt(8000), sendEmail: bool, creditHold: bool, isActive: bool,
});
/** Annulation d'une lettre, levée du blocage d'un client : aucun champ lu. */
export const dunningNoBodySchema = emptyBody;
