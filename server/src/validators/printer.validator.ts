import { emptyBody } from './common.validator.js';
import { body, txt, numish, bool } from './route-body.validator.js';

/**
 * G0-07 — Imprimantes (printer.routes). Les valeurs admises (type, interface) restent celles
 * du dépôt et de la base ; ces schémas n'imposent que les types.
 */
/** File CUPS d'une imprimante USB détectée : textes (passés à lpadmin, vérifiés par le service). */
export const attachSystemPrinterSchema = body({ name: txt(120), uri: txt(1000) });
const printerFields = {
  name: txt(200), type: txt(30), interface: txt(30), connectionString: txt(1000),
  printerModel: txt(120), characterSet: txt(60), paperWidth: numish,
  isDefault: bool, openDrawerOnCash: bool, isActive: bool, notes: txt(2000),
};
export const printerSchema = body(printerFields);
/** Impression d'essai, ouverture du tiroir : aucun champ lu. */
export const printerActionSchema = emptyBody;
