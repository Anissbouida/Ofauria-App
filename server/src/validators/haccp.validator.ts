import { z } from 'zod';
import { body, txt, bool } from './route-body.validator.js';

/**
 * G0-07 — HACCP (haccp.routes). Les gestionnaires gardent leur schéma détaillé (plages de
 * température, listes de valeurs, messages) ; ceux-ci, posés devant, ne vérifient que les types.
 */
const n = z.number().nullish();
export const haccpEquipmentSchema = body({
  nom: txt(400), type: txt(30), haccp_monitored: bool, temp_min: n, temp_max: n, readings_per_day: n,
});
export const haccpTaskSchema = body({
  zone: txt(200), label: txt(400), frequency: txt(20), method: txt(2000), is_active: bool, display_order: n,
});
export const haccpReceptionCheckSchema = body({
  temperatureOk: bool, temperatureValue: n, visualOk: bool, packagingOk: bool, labelsOk: bool,
  overallConformity: bool, notes: txt(2000), actionTaken: txt(2000),
});
