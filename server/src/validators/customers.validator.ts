import { z } from 'zod';
import { emptyBody } from './common.validator.js';
import { body, txt, numish, formBool } from './route-body.validator.js';

/**
 * G0-07 — Fiches clients (customers.routes). La fiche arrive d'un FormData (CustomersPage) :
 * tout est texte, les montants et délais en chaînes, les identifiants liés en '' quand vides.
 * customer.controller garde ses contrôles (identifiants légaux, champs réservés à la direction,
 * doublon d'ICE) ; ces schémas n'imposent que les types, sans convertir les valeurs.
 * Volontairement NON imposé : signe du plafond de crédit, de la remise ou du délai (l'écran
 * borne à ≥ 0 côté client, le serveur ne l'a jamais exigé).
 */
const ref = z.string().max(60).nullish(); // identifiant lié, '' = aucun
const customerFields = {
  customerType: txt(30),
  firstName: txt(120), lastName: txt(120), companyName: txt(200),
  email: txt(255), phone: txt(60), address: txt(500), city: txt(120), notes: txt(5000),
  birthday: txt(30), allergies: txt(2000), preferredContact: txt(30), contactRole: txt(120),
  ice: txt(30), ifFiscal: txt(30), rc: txt(30), rcVille: txt(120), tp: txt(30), cnss: txt(30),
  formeJuridique: txt(60), president: txt(200), associationRecepisse: txt(120),
  creditLimit: numish, remisePct: numish, delaiPaiementJours: numish,
  tvaExonere: formBool.nullish(), billingFrequency: txt(30),
  salespersonId: ref, parentCustomerId: ref, payerCustomerId: ref,
};
export const customerSchema = body(customerFields);

/* Adresses — parseAddress (ligne requise à la création, contrôlée par le contrôleur). */
export const customerAddressSchema = body({
  addressLine: txt(500), label: txt(120), kind: txt(20), postalCode: txt(20), city: txt(120), countryCode: txt(10),
  isDefaultDelivery: formBool.nullish(), isDefaultBilling: formBool.nullish(),
});

/* Attestation d'exonération de TVA — createExemption. */
export const customerTaxExemptionSchema = body({
  certificateNumber: z.union([z.string().max(120), z.number()]).nullish(),
  reason: txt(500), validFrom: txt(30), validTo: txt(30), notes: txt(2000),
});

/* Jeton du portail client — durée en jours facultative (30 / 90 / 365, 90 par défaut). */
export const portalTokenSchema = body({ expiresInDays: numish });

/* Consentement marketing. */
export const customerConsentSchema = body({ marketingConsent: formBool.nullish() });

export const customerActionSchema = emptyBody;
