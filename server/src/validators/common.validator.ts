import { z } from 'zod';

/**
 * Briques de validation partagées (G0-07 ciblé, plan pilote 2026-11).
 *
 * Règle du plan pilote : un schéma reprend les TYPES et les règles que le contrôleur ou le
 * dépôt appliquent déjà (bornes, champs requis) — jamais une règle métier nouvelle. Les corps
 * sont en `.passthrough()` : validate() remplace req.body par le résultat du schéma, et un champ
 * non déclaré mais lu plus loin (dépôt qui reçoit le corps entier) ne doit pas disparaître.
 * Les montants et quantités arrivent souvent en texte depuis les formulaires : ils sont
 * convertis en nombre ; une chaîne vide vaut « absent ».
 */
const blankToUndef = (v: unknown) => (v === '' || v === null ? undefined : v);

// zod 4 : .uuid() exige un UUID RFC (version 1-8) et refuserait l'id du magasin par défaut
// 00000000-0000-0000-0000-000000000001 ; .guid() garde le contrôle de forme de zod 3.
export const uuid = z.string().guid('Identifiant invalide');
/** Identifiant facultatif : chaîne vide ou null = absent. */
export const optUuid = z.preprocess(blankToUndef, uuid.optional());
/** Date (AAAA-MM-JJ) ou date-heure ISO. */
export const dateLike = z.string().trim().refine(v => !Number.isNaN(Date.parse(v)), 'Date invalide');
export const optDate = z.preprocess(blankToUndef, dateLike.optional());

/** Texte libre borné, facultatif (null accepté). */
export const optText = (max: number) => z.string().trim().max(max).nullish();

/** Nombre fini quelconque, facultatif. */
export const optNumber = z.preprocess(blankToUndef, z.coerce.number().finite('Nombre invalide').optional());
/** Montant ≥ 0, facultatif. */
export const optMoney = z.preprocess(blankToUndef, z.coerce.number().finite('Montant invalide').min(0, 'Montant négatif').max(1e9, 'Montant trop élevé').optional());
/** Montant ≥ 0, requis. */
export const money = z.coerce.number().finite('Montant invalide').min(0, 'Montant négatif').max(1e9, 'Montant trop élevé');
/** Montant > 0, facultatif (absent, vide ou null = non fourni ; 0 ou négatif refusé). */
export const optPositiveMoney = (label = 'Le montant') => z.preprocess(blankToUndef,
  z.coerce.number({ error: `${label} est invalide` }).finite(`${label} est invalide`)
    .positive(`${label} doit être supérieur à 0`).max(1e9, `${label} est trop élevé`).optional());
/** Montant > 0, requis. */
export const positiveMoney = (label = 'Le montant') => z.preprocess(blankToUndef,
  z.coerce.number({ error: (iss) => (iss.input === undefined ? `${label} est requis` : `${label} est invalide`) }).finite(`${label} est invalide`)
    .positive(`${label} doit être supérieur à 0`).max(1e9, `${label} est trop élevé`));
/** Quantité > 0, requise. */
export const positiveQty = z.coerce.number().finite('Quantité invalide').positive('La quantité doit être positive').max(1e7, 'Quantité trop élevée');
/** Quantité ≥ 0, facultative. */
export const optNonNegQty = z.preprocess(blankToUndef, z.coerce.number().finite('Quantité invalide').min(0, 'Quantité négative').max(1e7, 'Quantité trop élevée').optional());
/** Pourcentage 0..100, facultatif. */
export const optPct = z.preprocess(blankToUndef, z.coerce.number().finite('Pourcentage invalide').min(0).max(100, 'Pourcentage entre 0 et 100').optional());
/** Taux de TVA d'une ligne : null / vide = taux par défaut, sinon 0..100. */
export const tvaRate = z.preprocess(v => (v === '' ? null : v), z.union([z.null(), z.coerce.number().finite().min(0).max(100)]).optional());
export const optBool = z.boolean().optional();
/**
 * Code TVA par défaut d'un article ou d'une catégorie (mig 309, référentiel tax_codes : N20, R10,
 * EXO_SDD, HC…). Vide ou null = pas de code (hériter de la catégorie) ; absent = inchangé.
 */
export const optTaxCode = z.preprocess(v => (typeof v === 'string' && v.trim() === '' ? null : v),
  z.union([z.null(), z.string().trim().max(20, 'Code TVA invalide').regex(/^[A-Za-z0-9_]+$/, 'Code TVA invalide')]).optional());

/** Action sans corps (annuler, imprimer, encaisser…) : corps absent ou objet, rien n'est lu. */
export const emptyBody = z.preprocess(v => v ?? {}, z.object({}).passthrough());
